#!/usr/bin/env node
/**
 * One-off interactive login for refresh-token mode.
 *
 * Runs the OAuth2 authorization code flow (with PKCE when no client secret is
 * set), catches the redirect on localhost and stores the resulting token set
 * in XERO_TOKEN_FILE (default ~/.xero-mcp/token.json). The MCP server then
 * keeps it fresh on its own.
 *
 * Env: XERO_CLIENT_ID (required), XERO_CLIENT_SECRET (web apps only),
 *      XERO_REDIRECT_URI (default http://localhost:8080/callback),
 *      XERO_SCOPES, XERO_TOKEN_FILE
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import dotenv from "dotenv";

import {
  defaultTokenFile,
  requestTokens,
  writeTokenFile,
} from "./clients/refresh-token-store.js";

dotenv.config();

// Granular scopes (required for apps created after Xero's scope change).
// offline_access is mandatory: without it Xero issues no refresh token.
// Payroll scopes are left out on purpose (no payroll API for IE orgs).
const DEFAULT_SCOPES = [
  "offline_access",
  "accounting.contacts",
  "accounting.settings",
  "accounting.invoices",
  "accounting.payments",
  "accounting.banktransactions",
  "accounting.manualjournals",
  "accounting.reports.profitandloss.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.aged.read",
  "accounting.reports.trialbalance.read",
].join(" ");

const clientId = process.env.XERO_CLIENT_ID;
const clientSecret = process.env.XERO_CLIENT_SECRET || undefined;
const redirectUri =
  process.env.XERO_REDIRECT_URI || "http://localhost:8080/callback";
const scopes = process.env.XERO_SCOPES || DEFAULT_SCOPES;
const tokenFile = defaultTokenFile();

if (!clientId) {
  console.error("XERO_CLIENT_ID is required.");
  process.exit(1);
}

const base64url = (buf: Buffer) => buf.toString("base64url");
const state = base64url(crypto.randomBytes(16));
const verifier = base64url(crypto.randomBytes(32));
const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());

const authUrl = new URL("https://login.xero.com/identity/connect/authorize");
authUrl.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  scope: scopes,
  state,
  ...(clientSecret
    ? {}
    : { code_challenge: challenge, code_challenge_method: "S256" }),
}).toString();

const redirect = new URL(redirectUri);

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", redirectUri);
  if (url.pathname !== redirect.pathname) {
    res.writeHead(404).end();
    return;
  }

  const finish = (status: number, msg: string, exitCode: number) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(msg);
    console.error(msg);
    server.close();
    setTimeout(() => process.exit(exitCode), 100);
  };

  if (url.searchParams.get("error")) {
    finish(400, `Xero returned an error: ${url.searchParams.get("error")}`, 1);
    return;
  }
  if (url.searchParams.get("state") !== state) {
    finish(400, "State mismatch, aborting.", 1);
    return;
  }

  try {
    const tokens = await requestTokens(
      {
        grant_type: "authorization_code",
        code: url.searchParams.get("code") || "",
        redirect_uri: redirectUri,
        ...(clientSecret ? {} : { code_verifier: verifier }),
      },
      clientId,
      clientSecret,
    );
    writeTokenFile(tokenFile, tokens);

    const conn = await fetch("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
    });
    const tenants = (await conn.json()) as { tenantId: string; tenantName: string }[];
    const list = tenants.map((t) => `  ${t.tenantId}  ${t.tenantName}`).join("\n");

    finish(
      200,
      `Login OK. Tokens saved to ${tokenFile}\nGranted scopes: ${tokens.scope ?? "(not returned)"}\n` +
        `Connected organisations:\n${list || "  (none - re-run and select an organisation)"}\n` +
        (tenants.length > 1 ? "Set XERO_TENANT_ID to pick one; otherwise the first is used.\n" : "") +
        "You can close this tab.",
      0,
    );
  } catch (err) {
    finish(500, `Token exchange failed: ${(err as Error).message}`, 1);
  }
});

server.listen(Number(redirect.port) || 80, redirect.hostname, () => {
  console.error(`Opening browser for Xero login. If it does not open, visit:\n${authUrl}\n`);
  openBrowser(authUrl.toString());
});
