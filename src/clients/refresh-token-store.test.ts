import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readTokenFile,
  RefreshingTokenProvider,
  writeTokenFile,
} from "./refresh-token-store.js";

const tmpFile = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xero-")), "token.json");

/** Fake Xero token endpoint that rotates refresh tokens like the real one. */
function mockXero() {
  let n = 0;
  const valid = new Set(["rt-0"]);
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = new URLSearchParams(init.body as URLSearchParams);
    const rt = body.get("refresh_token")!;
    if (!valid.has(rt)) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    valid.delete(rt);
    n++;
    valid.add(`rt-${n}`);
    return new Response(
      JSON.stringify({ access_token: `at-${n}`, refresh_token: `rt-${n}`, expires_in: 1800 }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RefreshingTokenProvider", () => {
  it("bootstraps from env, refreshes once and persists the rotated token", async () => {
    const fetchMock = mockXero();
    const file = tmpFile();
    const p = new RefreshingTokenProvider("cid", "secret", file, "rt-0");

    expect(await p.getAccessToken()).toBe("at-1");
    expect(await p.getAccessToken()).toBe("at-1"); // cached
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readTokenFile(file)?.refresh_token).toBe("rt-1");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("serialises concurrent refreshes (no double spend of a refresh token)", async () => {
    const fetchMock = mockXero();
    const p = new RefreshingTokenProvider("cid", "secret", tmpFile(), "rt-0");
    const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => p.getAccessToken()));
    expect(new Set(tokens)).toEqual(new Set(["at-1"]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes again when the access token is about to expire", async () => {
    vi.useFakeTimers();
    mockXero();
    const p = new RefreshingTokenProvider("cid", "secret", tmpFile(), "rt-0");
    expect(await p.getAccessToken()).toBe("at-1");
    vi.advanceTimersByTime(29 * 60 * 1000); // inside the 2-minute skew
    expect(await p.getAccessToken()).toBe("at-2");
  });

  it("prefers the token file over a stale env refresh token on restart", async () => {
    mockXero();
    const file = tmpFile();
    await new RefreshingTokenProvider("cid", "secret", file, "rt-0").getAccessToken();
    // Restart with the original (now rotated, dead) env token: must still work.
    const p2 = new RefreshingTokenProvider("cid", "secret", file, "rt-0");
    expect(await p2.getAccessToken()).toBe("at-1"); // still valid, no refresh needed
  });

  it("picks up a token rotated by another process", async () => {
    vi.useFakeTimers();
    mockXero();
    const file = tmpFile();
    const a = new RefreshingTokenProvider("cid", "secret", file, "rt-0");
    await a.getAccessToken(); // rt-1 on disk
    const b = new RefreshingTokenProvider("cid", "secret", file);
    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(await b.getAccessToken()).toBe("at-2"); // b rotates rt-1 -> rt-2
    expect(await a.getAccessToken()).toBe("at-2"); // a must not spend dead rt-1
  });

  it("uses client_id in the body for PKCE apps (no secret)", async () => {
    const fetchMock = mockXero();
    await new RefreshingTokenProvider("cid", undefined, tmpFile(), "rt-0").getAccessToken();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new URLSearchParams(init.body as URLSearchParams).get("client_id")).toBe("cid");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("fails clearly when there is no refresh token at all", () => {
    expect(() => new RefreshingTokenProvider("cid", "s", tmpFile())).toThrow(/xero-mcp-login/);
  });

  it("writeTokenFile is atomic and readable", () => {
    const file = tmpFile();
    writeTokenFile(file, { access_token: "a", refresh_token: "r", expires_at: 1 });
    expect(readTokenFile(file)?.refresh_token).toBe("r");
  });
});
