# Refresh-token auth mode (Noraina fork)

Upstream supports two auth modes: **Custom Connections** (client credentials,
not available in every region, e.g. Ireland) and a **static bearer token**
(expires after 30 minutes, never refreshed). This fork adds a third mode that
uses a standard OAuth2 app and refreshes the access token automatically.

## How it works

- Before every tool call the server checks the access token and refreshes it
  when less than 2 minutes remain.
- Xero rotates refresh tokens on every refresh, so the new one is written to a
  token file (`~/.xero-mcp/token.json` by default, mode `0600`, atomic write).
- Concurrent tool calls share a single refresh, so a refresh token is never
  spent twice. If another process rotated the token, the server picks it up
  from the file instead of using the dead one.
- The tenant is resolved once via `/connections` (first organisation), or set
  explicitly with `XERO_TENANT_ID`.

## Setup

1. In developer.xero.com create an app of type **Web app** (client secret) or
   **Auth code with PKCE** (no secret), with redirect URI
   `http://localhost:8080/callback`.
2. Build:
   ```bash
   npm install && npm run build
   ```
3. Log in once (opens the browser, stores the tokens):
   ```bash
   XERO_CLIENT_ID=... XERO_CLIENT_SECRET=... node dist/login.js
   ```
   It prints the granted scopes and the connected organisations. Omit
   `XERO_CLIENT_SECRET` for PKCE apps. If Xero rejects the scopes, override
   them with `XERO_SCOPES` (space-separated, keep `offline_access`).
4. Claude Desktop (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "xero": {
         "command": "/absolute/path/to/node",
         "args": ["/absolute/path/to/xero-mcp-server/dist/index.js"],
         "env": {
           "XERO_AUTH_MODE": "refresh_token",
           "XERO_CLIENT_ID": "...",
           "XERO_CLIENT_SECRET": "..."
         }
       }
     }
   }
   ```

## Environment variables

| Variable | Purpose |
|---|---|
| `XERO_AUTH_MODE=refresh_token` | Enables this mode (also enabled implicitly by `XERO_REFRESH_TOKEN`) |
| `XERO_CLIENT_ID` | Required |
| `XERO_CLIENT_SECRET` | Web apps only; omit for PKCE apps |
| `XERO_TOKEN_FILE` | Token file path (default `~/.xero-mcp/token.json`) |
| `XERO_REFRESH_TOKEN` | Optional bootstrap instead of `login.js` (e.g. from xoauth). Used only when the token file does not exist yet |
| `XERO_TENANT_ID` | Pick the organisation when the token has several |
| `XERO_SCOPES` | Login scopes override |
| `NODE_EXTRA_CA_CERTS` | CA bundle when TLS inspection (e.g. Cloudflare Gateway) sits in the path |

## Notes

- A refresh token that is not used for 60 days expires; run `login.js` again.
- If the token file is lost or corrupted, run `login.js` again.
- Payroll scopes are not requested by default (no payroll API for IE
  organisations), so the payroll tools will fail.
- Code: `src/clients/refresh-token-store.ts`, `RefreshTokenXeroClient` in
  `src/clients/xero-client.ts`, `src/login.ts`. Tests:
  `npx vitest run src/clients`.
