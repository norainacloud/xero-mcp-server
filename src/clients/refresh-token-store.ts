import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Persistent OAuth2 token set for the refresh-token auth mode.
 *
 * Xero rotates refresh tokens: every refresh returns a NEW refresh token and
 * the old one stops working (after a short grace period). The new one must
 * therefore be persisted, otherwise the next server start fails.
 */
export interface StoredTokenSet {
  access_token: string;
  refresh_token: string;
  /** Epoch milliseconds at which the access token expires. */
  expires_at: number;
  token_type?: string;
  scope?: string;
}

export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

/** Refresh this many ms before the access token actually expires. */
const EXPIRY_SKEW_MS = 120_000;

export function defaultTokenFile(): string {
  return (
    process.env.XERO_TOKEN_FILE ||
    path.join(os.homedir(), ".xero-mcp", "token.json")
  );
}

export function readTokenFile(file: string): StoredTokenSet | undefined {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as StoredTokenSet;
    return parsed.refresh_token ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Atomic write with 0600 permissions (the file holds a long-lived secret). */
export function writeTokenFile(file: string, tokens: StoredTokenSet): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Exchanges a refresh token (or an authorization code) at Xero's token
 * endpoint. Works for both confidential apps (client secret, Basic auth) and
 * PKCE apps (no secret, client_id in the body).
 */
export async function requestTokens(
  params: Record<string, string>,
  clientId: string,
  clientSecret?: string,
): Promise<StoredTokenSet> {
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", clientId);
  }

  const res = await fetch(XERO_TOKEN_URL, { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Xero token endpoint returned ${res.status}: ${text}`);
  }
  const data = JSON.parse(text);
  if (!data.access_token || !data.refresh_token) {
    throw new Error(
      `Xero token response is missing access_token/refresh_token (is offline_access in the scopes?): ${text}`,
    );
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in) || 1800) * 1000,
    token_type: data.token_type,
    scope: data.scope,
  };
}

/**
 * Keeps a valid access token in memory, refreshing it when it is about to
 * expire and persisting the rotated refresh token to disk.
 */
export class RefreshingTokenProvider {
  private tokens: StoredTokenSet | undefined;
  private inFlight: Promise<StoredTokenSet> | undefined;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string | undefined,
    private readonly tokenFile: string,
    bootstrapRefreshToken?: string,
  ) {
    // The token file wins over the env var: after the first refresh the env
    // var holds a rotated (dead) token, while the file holds the current one.
    this.tokens = readTokenFile(tokenFile);
    if (!this.tokens && bootstrapRefreshToken) {
      this.tokens = {
        access_token: "",
        refresh_token: bootstrapRefreshToken,
        expires_at: 0,
      };
    }
    if (!this.tokens) {
      throw new Error(
        `No refresh token found. Run "xero-mcp-login" first or set XERO_REFRESH_TOKEN. (token file: ${tokenFile})`,
      );
    }
  }

  /** Returns a valid access token, refreshing it if needed. */
  async getAccessToken(): Promise<string> {
    const current = this.tokens!;
    if (current.access_token && Date.now() < current.expires_at - EXPIRY_SKEW_MS) {
      return current.access_token;
    }
    // Serialise refreshes: concurrent tool calls must not spend the same
    // refresh token twice (the second one would fail after rotation).
    if (!this.inFlight) {
      this.inFlight = this.refresh().finally(() => {
        this.inFlight = undefined;
      });
    }
    return (await this.inFlight).access_token;
  }

  private async refresh(): Promise<StoredTokenSet> {
    // Another process (e.g. a second Claude Desktop window or the login
    // script) may have rotated the token since we loaded it.
    const onDisk = readTokenFile(this.tokenFile);
    if (onDisk && onDisk.refresh_token !== this.tokens!.refresh_token) {
      this.tokens = onDisk;
      if (onDisk.access_token && Date.now() < onDisk.expires_at - EXPIRY_SKEW_MS) {
        return onDisk;
      }
    }

    const fresh = await requestTokens(
      { grant_type: "refresh_token", refresh_token: this.tokens!.refresh_token },
      this.clientId,
      this.clientSecret,
    );
    writeTokenFile(this.tokenFile, fresh);
    this.tokens = fresh;
    console.error(
      `[xero-mcp] access token refreshed, valid until ${new Date(fresh.expires_at).toISOString()}`,
    );
    return fresh;
  }
}
