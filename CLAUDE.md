# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MCP server (stdio) exposing the Xero accounting/payroll API as tools. This repo is the **Noraina fork** (`@noraina/xero-mcp-server`) of `XeroAPI/xero-mcp-server`; its main addition is an auto-refreshing OAuth2 "refresh-token" auth mode for regions without Custom Connections (e.g. Ireland). See [NORAINA.md](NORAINA.md) for setup and env vars of that mode.

## Commands

```bash
npm install
npm run build          # tsc -> dist/, then chmod +x dist/*.js
npm run watch          # tsc --watch
npm run lint           # eslint .   (lint:fix to autofix)
npm test               # vitest run (src/**/*.test.ts)
npx vitest run src/clients/refresh-token-store.test.ts   # single file
npx vitest run -t "<test name>"                          # single test
./start-server.sh      # compile and run dist/index.js
node dist/login.js     # interactive OAuth login for refresh-token mode (bin: xero-mcp-login)
```

ESM project (`"type": "module"`, `Node16` module resolution): relative imports must use the `.js` extension even in `.ts` files. Test files are excluded from the `tsc` build.

## Architecture

Request flow: `src/index.ts` → `ToolFactory` registers all tools on the singleton `McpServer` → tool callback → handler → `xeroClient` (xero-node SDK).

- **Tools** (`src/tools/{list,get,create,update,delete}/*.tool.ts`): each file default-exports the result of `CreateXeroTool(name, description, zodShape, callback)` (`src/helpers/create-xero-tool.ts`). The callback calls a handler and formats the result into MCP `content` text blocks. Each folder's `index.ts` holds the array of tools; **a new tool must be added to that array** or it is never registered.
- **Handlers** (`src/handlers/*.handler.ts`): one per tool. Pattern: `await xeroClient.authenticate()`, call `xeroClient.accountingApi` / `payrollNZApi` etc. with `xeroClient.tenantId` and `getClientHeaders()` as the last arg, and return a `XeroClientResponse<T>` discriminated union (`src/types/tool-response.ts`) — never throw; catch and return `{ isError: true, error: formatError(error) }`.
- **`formatError`** (`src/helpers/format-error.ts`) normalises Axios and xero-node SDK errors; it deliberately avoids echoing request details to prevent token leaks.
- **Deep links** (`src/helpers/get-deeplink.ts`, `src/consts/deeplinks.ts`) build Xero web URLs using the org short code from `xeroClient.getShortCode()`.
- **Payroll types**: `src/types/payroll-{nz,au}-types.ts` is a shim re-exporting models from `xero-node/dist/gen/model/...`; prefer importing from the shim (some older files still import directly).

### Auth (`src/clients/xero-client.ts`)

`xeroClient` is a module-level singleton created at import time (env is read via `dotenv` then, and missing vars throw on import). `createClient()` picks one of three `MCPXeroClient` subclasses:

1. `RefreshTokenXeroClient` — when `XERO_AUTH_MODE=refresh_token` or `XERO_REFRESH_TOKEN` is set. Uses `RefreshingTokenProvider` (`src/clients/refresh-token-store.ts`): refreshes when <2 min remain, persists rotated refresh tokens atomically to `XERO_TOKEN_FILE` (default `~/.xero-mcp/token.json`, mode 0600), dedupes concurrent refreshes, and re-reads the file if another process rotated the token. Tenant from `XERO_TENANT_ID` or first `/connections` entry.
2. `BearerTokenXeroClient` — `XERO_CLIENT_BEARER_TOKEN` (takes precedence over client id/secret).
3. `CustomConnectionsXeroClient` — `XERO_CLIENT_ID` + `XERO_CLIENT_SECRET`, client_credentials grant. Uses `XERO_SCOPES` if set, else tries V1 (legacy bundled) scopes and falls back to V2 (granular) only on `invalid_scope`.

`authenticate()` is called at the start of every handler, so token refresh happens per tool call.

## Notes

- Payroll tools target NZ/UK orgs; the fork's default login scopes omit payroll, so those tools fail in refresh-token mode unless scopes are overridden.
- README.md keeps a hand-maintained "Available MCP Commands" list of tool names.
