# Electron MCP Server — Finishing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the partially built `electron-mcp` MCP server at `/Volumes/WorkSSD/repos/personal/electron-mcp-server` from scaffolded-code to green-build + documented + smoke-tested.

**Architecture:** Node 20+ / Bun-compatible, TypeScript ESM, MCP server using `@modelcontextprotocol/sdk` (low-level `Server` class) over stdio. Electron automation via `playwright._electron`. Tool registry is a plain array of `{ name, description, inputSchema, handler }`. Zod is single source of truth for tool I/O (runtime validation → types → JSON Schema). Structured errors with stable `code`s. stderr-only logging (stdout reserved for JSON-RPC).

**Tech Stack:** TypeScript 5.5, Node 20+, `@modelcontextprotocol/sdk@^1.0.4`, `playwright@^1.50`, `zod@^3.23`, `zod-to-json-schema@^3.23`, `tsx`, `vitest` (optional), ESLint 9 flat config, Prettier.

---

## Current State

### What already exists on disk

All paths relative to `/Volumes/WorkSSD/repos/personal/electron-mcp-server/`.

**Config / tooling**
- `package.json` — deps + scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test`)
- `tsconfig.json` — strict ESM (NodeNext)
- `tsconfig.build.json` — production build (no sourcemaps)
- `.gitignore`, `.env.example`, `.prettierrc.json`, `.prettierignore`
- `eslint.config.js` — flat config, type-aware rules

**Source**
- `src/errors/index.ts` — `ElectronMcpError` + subclasses + `normalizeError`
- `src/logging/logger.ts` — JSON logger to stderr with `withTiming` helper
- `src/utils/config.ts` — env → `ServerConfig`
- `src/utils/allowlist.ts` — glob-based executable allowlist
- `src/utils/ids.ts` — `newSessionId`, `newRequestId`
- `src/utils/timeout.ts` — `withTimeout(promise, ms, op)`
- `src/utils/zod-to-json.ts` — wraps `zod-to-json-schema`
- `src/schemas/index.ts` — every tool's input/output schemas (Zod)
- `src/session/types.ts`, `src/session/session-manager.ts` — in-memory registry, cap enforcement, close/closeAll
- `src/electron/electron-adapter.ts` — Playwright wrapper: launch, resolveWindow, waitForWindow, click, fill, evaluate, screenshot
- `src/tools/{types,lifecycle,windows,renderer,main,index}.ts` — per-category handlers + registry builder
- `src/server/mcp-server.ts` — `createElectronMcpServer()` wiring sessions/adapter/tools + dispatch + error normalization
- `src/server/index.ts` — binary entrypoint: config + logger + transport + signals

**Docs**
- `docs/architecture.md`
- `docs/tools.md`
- `docs/session-model.md`
- `docs/security.md`

### What is missing

- `README.md` (root)
- `examples/` directory
- `LICENSE` (MIT text)
- No dependencies installed yet → all TS diagnostics currently complain about `Cannot find module 'zod'`, `playwright`, `@modelcontextprotocol/sdk`, Node types. These will clear after `npm install`.
- No smoke test has been run — we do not yet know whether the server boots cleanly and `tools/list` returns 12 tools.
- No git repo initialized (parent dir is not a git repo).

### Known tech-debt / things to verify during this plan

1. `src/electron/electron-adapter.ts` uses `Parameters<typeof electron.launch>[0]` and `Parameters<Page['click']>[1]` for typed option builders. That works at runtime but the type inference may surface `unknown` in some TS configs — we'll find out at typecheck time (Task 2) and switch to explicit option types if needed.
2. `src/server/mcp-server.ts` imports `CallToolResult` from `@modelcontextprotocol/sdk/types.js`. Confirm the SDK version exports that symbol; if the SDK has renamed it to something like `CallToolResponse`, update.
3. `electron_screenshot` returns either `path` or `base64` but never both. If callers want both, that's a follow-up — not in scope for this plan.
4. HTTP transport is wired in config but the entrypoint refuses to start with a non-stdio transport (exits 2). That's intentional for this release.

### Non-goals for this plan

- No HTTP transport implementation.
- No DOM snapshot / tracing stretch goals.
- No `@nova/mcp-shared` integration — this server stands alone.
- No published release to npm.

---

## File Structure (what will be created during this plan)

```
/electron-mcp-server
├── README.md                                    # Task 4
├── LICENSE                                      # Task 5
├── examples/
│   ├── README.md                                # Task 6
│   ├── requests/
│   │   ├── 01-list-tools.json                   # Task 6
│   │   ├── 02-launch.json                       # Task 6
│   │   ├── 03-list-sessions.json                # Task 6
│   │   ├── 04-list-windows.json                 # Task 6
│   │   ├── 05-wait-for-window.json              # Task 6
│   │   ├── 06-click.json                        # Task 6
│   │   ├── 07-fill.json                         # Task 6
│   │   ├── 08-evaluate-renderer.json            # Task 6
│   │   ├── 09-screenshot.json                   # Task 6
│   │   ├── 10-evaluate-main.json                # Task 6
│   │   ├── 11-restart.json                      # Task 6
│   │   └── 12-close.json                        # Task 6
│   └── workflows/
│       └── login-and-screenshot.md              # Task 7
├── tests/                                       # Task 10 (optional)
│   ├── allowlist.test.ts
│   ├── errors.test.ts
│   ├── session-manager.test.ts
│   └── schemas.test.ts
└── (everything else already exists)
```

---

## Task 1 — Install dependencies

**Files:**
- Modify: none (runtime install only)

- [ ] **Step 1: Install dependencies with npm**

Run:
```bash
cd /Volumes/WorkSSD/repos/personal/electron-mcp-server
npm install
```
Expected: completes without errors. `node_modules/` and `package-lock.json` appear.

If the environment prefers Bun:
```bash
bun install
```
Both are supported by the project.

- [ ] **Step 2: Verify Playwright browsers are not strictly required**

Note: Electron automation only needs the `playwright` npm package, *not* Playwright browsers. Do **NOT** run `npx playwright install` unless you also plan to test the `unified browser+electron layer` stretch goal. Confirm `node_modules/playwright/lib/server/electron` exists:

```bash
ls node_modules/playwright/lib/server/electron | head -5
```
Expected: directory contains `electron.js` or similar.

---

## Task 2 — Typecheck and fix real errors

**Files:** (determined by typecheck output)

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```
Expected: zero errors. All the "cannot find module 'zod' / 'playwright'" warnings from the LSP before installing deps will be gone.

- [ ] **Step 2: Triage any remaining errors**

If typecheck fails, the likely suspects are:

1. **`CallToolResult` import in `src/server/mcp-server.ts`**

   If the SDK version does not export `CallToolResult`, inspect:
   ```bash
   grep -r "export.*CallTool" node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts | head
   ```
   If the type is named differently, update the import:
   ```typescript
   // src/server/mcp-server.ts line 4-6
   import {
     CallToolRequestSchema,
     ListToolsRequestSchema,
     type CallToolResult, // <-- rename if SDK uses different symbol
   } from '@modelcontextprotocol/sdk/types.js';
   ```
   If the SDK has no exported result type, replace uses of `CallToolResult` with an inline type:
   ```typescript
   type CallToolResult = {
     content: Array<{ type: 'text'; text: string }>;
     isError?: boolean;
   };
   ```

2. **Option builder types in `src/electron/electron-adapter.ts`**

   Lines like `const clickOptions: Parameters<Page['click']>[1] = { … };` may infer `unknown` because `Page['click']` has overloads. If that's the case, replace with explicit object types:
   ```typescript
   // src/electron/electron-adapter.ts click() method
   const clickOptions: {
     button?: 'left' | 'right' | 'middle';
     clickCount?: number;
     delay?: number;
     force?: boolean;
     timeout?: number;
   } = {
     timeout: options.timeoutMs,
     button: options.button ?? 'left',
     clickCount: options.clickCount ?? 1,
     force: options.force ?? false,
   };
   if (options.delay !== undefined) {
     clickOptions.delay = options.delay;
   }
   await win.click(selector, clickOptions);
   ```
   Apply the same pattern to `screenshot` / `launch` option builders if they complain.

3. **`app.off('window', onWindow)` in `waitForWindow`**

   Playwright's `ElectronApplication` uses typed event emitter overloads. If TS complains, cast the handler:
   ```typescript
   app.on('window', onWindow as (page: import('playwright').Page) => void);
   app.off('window', onWindow as (page: import('playwright').Page) => void);
   ```

4. **`zod` peer warning from `zod-to-json-schema`**

   If there's a peer-deps mismatch, make sure `zod@^3.23` is installed and `zod-to-json-schema@^3.23`. They should be compatible out of the box.

- [ ] **Step 3: Re-run typecheck until clean**

```bash
npm run typecheck
```
Expected: zero errors.

- [ ] **Step 4: Commit typecheck fixes (if any)**

Only if changes were made. Stage only the edited source files (never `node_modules`, `package-lock.json`, `dist/`):
```bash
git add src/
git commit -m "fix(types): resolve typecheck errors after dep install"
```

Skip this commit if the tree is clean.

---

## Task 3 — Lint and format

**Files:** source files flagged by the linter

- [ ] **Step 1: Run lint**

```bash
npm run lint
```
Expected: zero errors. Warnings are acceptable but should be triaged.

- [ ] **Step 2: Auto-fix anything fixable**

```bash
npm run lint:fix
npm run format
```

- [ ] **Step 3: Address remaining lint errors manually**

Likely culprits:
- `@typescript-eslint/no-floating-promises` on signal handlers in `src/server/index.ts`. These are intentionally wrapped in `void onExit(…)` and `.catch(…)` — no action needed.
- `@typescript-eslint/no-explicit-any` warnings in `src/tools/index.ts` where handlers are cast. Suppress with a file-scoped comment if warranted:
  ```typescript
  /* eslint-disable @typescript-eslint/no-explicit-any */
  ```
  Only use this if there is no cleaner cast possible.

- [ ] **Step 4: Rerun lint + format check**

```bash
npm run lint && npm run format:check
```
Expected: both pass with exit code 0.

- [ ] **Step 5: Commit lint/format fixes (if any)**

```bash
git add src/ eslint.config.js .prettierrc.json
git commit -m "chore: lint and format pass"
```

Skip if clean.

---

## Task 4 — Write README.md

**Files:**
- Create: `/Volumes/WorkSSD/repos/personal/electron-mcp-server/README.md`

- [ ] **Step 1: Create `README.md` with the content below**

````markdown
# electron-mcp

> MCP server that lets AI agents drive **Electron apps** via Playwright.

`electron-mcp` exposes a narrow, predictable tool surface — launch an
Electron app, inspect its windows, click and fill the DOM, evaluate
JavaScript in the renderer or main process — as a [Model Context
Protocol](https://modelcontextprotocol.io) server. Agents (Claude Code,
Codex, Cursor, Continue, your own orchestrator) drive it over stdio.

Built for multi-agent orchestration systems, so:

- APIs are **predictable**
- outputs are **structured JSON** with a consistent `{ ok, … }` envelope
- errors are **machine-readable** — stable `code`s, not prose

## Features

- Launch and manage multiple Electron sessions in parallel
- Window discovery by index, URL pattern, or title
- DOM interaction: click, fill, evaluate, screenshot
- Main-process evaluation (gated behind an env flag)
- Executable allowlist, per-call timeouts, max-concurrent-session cap
- Structured JSON logging to `stderr`
- Strict TypeScript, Zod-validated I/O, ESM

## Requirements

- **Node 20+** or **Bun 1.1+**
- An Electron app you control (or a prebuilt binary path)

## Install

```bash
# from source
git clone <this-repo>
cd electron-mcp-server
npm install        # or: bun install
npm run build
```

Playwright browsers are **not** required — `electron-mcp` only uses
Playwright's `_electron` driver.

## Quick start

### 1. Configure the server

Copy `.env.example` to `.env` and pick conservative defaults:

```env
ELECTRON_MCP_MAX_SESSIONS=3
ELECTRON_MCP_LAUNCH_TIMEOUT=30000
ELECTRON_MCP_ALLOW_MAIN_EVALUATE=false
ELECTRON_MCP_EXECUTABLE_ALLOWLIST=/Applications/*.app/**
```

### 2. Register the server with your MCP client

**Claude Code** (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "electron": {
      "command": "node",
      "args": ["/absolute/path/to/electron-mcp-server/dist/server/index.js"],
      "env": {
        "ELECTRON_MCP_EXECUTABLE_ALLOWLIST": "/Applications/*.app/**"
      }
    }
  }
}
```

**Any stdio-capable MCP client** — invoke the binary directly:

```bash
node dist/server/index.js
```

### 3. Ask the agent to drive Electron

> "Launch `/Applications/MyApp.app/Contents/MacOS/MyApp`, wait for a
> window matching `/login`, fill `#email` with `user@example.com`,
> click `#submit`, then screenshot the dashboard."

## Tools

| Category  | Tool                           | Purpose                                        |
| --------- | ------------------------------ | ---------------------------------------------- |
| Lifecycle | `electron_launch`              | Launch an Electron app; returns a session id  |
| Lifecycle | `electron_close`               | Close a session (optional `force: true`)      |
| Lifecycle | `electron_restart`             | Close + relaunch preserving args              |
| Lifecycle | `electron_list_sessions`       | Enumerate active sessions                     |
| Windows   | `electron_list_windows`        | List windows for a session                    |
| Windows   | `electron_focus_window`        | Bring a window to front                       |
| Windows   | `electron_wait_for_window`     | Wait for a URL/title/index predicate          |
| Renderer  | `electron_click`               | Click an element                              |
| Renderer  | `electron_fill`                | Fill an input                                 |
| Renderer  | `electron_evaluate_renderer`   | Evaluate JS in the renderer                   |
| Renderer  | `electron_screenshot`          | Capture a PNG/JPEG of a window                |
| Main      | `electron_evaluate_main`       | Evaluate JS in the main process (opt-in)      |

See [`docs/tools.md`](./docs/tools.md) for full input/output schemas.

## Documentation

- [Architecture](./docs/architecture.md) — module map and design decisions
- [Tools](./docs/tools.md) — every tool with examples and error codes
- [Session model](./docs/session-model.md) — lifecycle, window refs, timeouts
- [Security](./docs/security.md) — allowlists, main-process gating, threat model
- [Examples](./examples/README.md) — copy-paste MCP requests and full workflows

## Project scripts

| Command                | What it does                             |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Run the server with `tsx watch`          |
| `npm run build`        | Emit `dist/` via the build tsconfig      |
| `npm run start`        | Run the compiled `dist/server/index.js`  |
| `npm run lint`         | ESLint over `src/**/*.ts`                |
| `npm run typecheck`    | `tsc --noEmit`                           |
| `npm run test`         | Vitest (unit tests, if present)          |
| `npm run format`       | Prettier over source and docs            |

## Environment variables

| Variable                               | Default        | Meaning                                                   |
| -------------------------------------- | -------------- | --------------------------------------------------------- |
| `ELECTRON_MCP_LOG_LEVEL`               | `info`         | `trace` / `debug` / `info` / `warn` / `error` / `fatal`   |
| `ELECTRON_MCP_MAX_SESSIONS`            | `5`            | Hard cap on concurrent sessions                           |
| `ELECTRON_MCP_LAUNCH_TIMEOUT`          | `30000`        | Default launch timeout (ms)                               |
| `ELECTRON_MCP_ACTION_TIMEOUT`          | `15000`        | Default DOM action timeout (ms)                           |
| `ELECTRON_MCP_EVALUATE_TIMEOUT`        | `10000`        | Default evaluate timeout (ms)                             |
| `ELECTRON_MCP_EXECUTABLE_ALLOWLIST`    | *(empty)*      | Comma-separated globs; empty = no restriction             |
| `ELECTRON_MCP_ALLOW_MAIN_EVALUATE`     | `false`        | Gate on `electron_evaluate_main`                          |
| `ELECTRON_MCP_SCREENSHOT_DIR`          | `./screenshots` | Output directory for screenshots                         |
| `ELECTRON_MCP_TRANSPORT`               | `stdio`        | `stdio` (only option today)                               |

## Error envelope

```json
{
  "ok": false,
  "error": {
    "code": "selector_error",
    "message": "Selector failed: button#submit (timeout waiting for element)",
    "details": { "selector": "button#submit", "cause": "timeout waiting for element" }
  }
}
```

Stable codes: `validation_error`, `launch_error`, `session_not_found`,
`window_not_found`, `selector_error`, `timeout`, `evaluation_error`,
`permission_denied`, `internal_error`.

## License

MIT — see [LICENSE](./LICENSE).
````

- [ ] **Step 2: Commit the README**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Task 5 — Add LICENSE

**Files:**
- Create: `/Volumes/WorkSSD/repos/personal/electron-mcp-server/LICENSE`

- [ ] **Step 1: Write the MIT license**

```
MIT License

Copyright (c) 2026 electron-mcp contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "docs: add MIT license"
```

---

## Task 6 — Write example MCP requests

**Files:**
- Create: `/Volumes/WorkSSD/repos/personal/electron-mcp-server/examples/README.md`
- Create: `examples/requests/01-list-tools.json` through `12-close.json`

- [ ] **Step 1: Create the examples index**

File: `examples/README.md`

````markdown
# Examples

Every `.json` file in `requests/` is a valid MCP JSON-RPC 2.0 frame you
can pipe into a running `electron-mcp` server over stdio.

## Running an example

```bash
# Build once
npm run build

# In one terminal, start the server
ELECTRON_MCP_EXECUTABLE_ALLOWLIST=/Applications/*.app/** \
node dist/server/index.js

# In another terminal, send a request. The server speaks JSON-RPC over
# stdin, so you need either the MCP client library or a small helper.
# The simplest helper is `jq -c . request.json | node dist/server/index.js`
# but that won't let you read the response reliably. For ad-hoc testing,
# use the @modelcontextprotocol/inspector:
npx @modelcontextprotocol/inspector node dist/server/index.js
```

The Inspector UI loads the tool schemas from `tools/list` and lets you
invoke any tool by filling in the form.

## Files

| File                          | Purpose                                 |
| ----------------------------- | --------------------------------------- |
| `01-list-tools.json`          | Discover every tool and its schema      |
| `02-launch.json`              | Launch an Electron app                  |
| `03-list-sessions.json`       | Enumerate running sessions              |
| `04-list-windows.json`        | List windows for a session              |
| `05-wait-for-window.json`     | Block until a URL-matching window opens |
| `06-click.json`               | Click `#submit`                         |
| `07-fill.json`                | Fill `#email`                           |
| `08-evaluate-renderer.json`   | Count `.row` elements                   |
| `09-screenshot.json`          | PNG screenshot to disk                  |
| `10-evaluate-main.json`       | Read `app.getPath('userData')`          |
| `11-restart.json`             | Kill and relaunch a session             |
| `12-close.json`               | Close a session                         |

Replace `REPLACE_WITH_SESSION_ID` in files 3–12 with the id returned by
`02-launch.json`. Replace `/path/to/your/app` with a real executable
on your machine.

See [`workflows/login-and-screenshot.md`](./workflows/login-and-screenshot.md)
for an end-to-end example using the CLI helper.
````

- [ ] **Step 2: Create `01-list-tools.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

- [ ] **Step 3: Create `02-launch.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "electron_launch",
    "arguments": {
      "executablePath": "/path/to/your/app",
      "args": ["--enable-logging"],
      "label": "my-app",
      "timeout": 30000
    }
  }
}
```

- [ ] **Step 4: Create `03-list-sessions.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "electron_list_sessions",
    "arguments": {}
  }
}
```

- [ ] **Step 5: Create `04-list-windows.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "electron_list_windows",
    "arguments": {
      "sessionId": "REPLACE_WITH_SESSION_ID"
    }
  }
}
```

- [ ] **Step 6: Create `05-wait-for-window.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "electron_wait_for_window",
    "arguments": {
      "sessionId": "REPLACE_WITH_SESSION_ID",
      "urlPattern": "/login",
      "timeout": 10000
    }
  }
}
```

- [ ] **Step 7: Create `06-click.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "electron_click",
    "arguments": {
      "sessionId": "REPLACE_WITH_SESSION_ID",
      "selector": "button#submit",
      "timeout": 5000
    }
  }
}
```

- [ ] **Step 8: Create `07-fill.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "electron_fill",
    "arguments": {
      "sessionId": "REPLACE_WITH_SESSION_ID",
      "selector": "input#email",
      "value": "user@example.com"
    }
  }
}
```

- [ ] **Step 9: Create `08-evaluate-renderer.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "tools/call",
  "params": {
    "name": "electron_evaluate_renderer",
    "arguments": {
      "sessionId": "REPLACE_WITH_SESSION_ID",
      "expression": "document.querySelectorAll('.row').length"
    }
  }
}
```

- [ ] **Step 10: Create `09-screenshot.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "method": "tools/call",
  "params": {
    "name": "electron_screenshot",
    "arguments": {
      "sessionId": "REPLACE_WITH_SESSION_ID",
      "path": "./screenshots/dashboard.png",
      "fullPage": true,
      "type": "png"
    }
  }
}
```

- [ ] **Step 11: Create `10-evaluate-main.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "tools/call",
  "params": {
    "name": "electron_evaluate_main",
    "arguments": {
      "sessionId": "REPLACE_WITH_SESSION_ID",
      "expression": "return electron.app.getPath('userData');"
    }
  }
}
```

- [ ] **Step 12: Create `11-restart.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "tools/call",
  "params": {
    "name": "electron_restart",
    "arguments": {
      "sessionId": "REPLACE_WITH_SESSION_ID"
    }
  }
}
```

- [ ] **Step 13: Create `12-close.json`**

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tools/call",
  "params": {
    "name": "electron_close",
    "arguments": {
      "sessionId": "REPLACE_WITH_SESSION_ID",
      "force": false
    }
  }
}
```

- [ ] **Step 14: Commit the example requests**

```bash
git add examples/
git commit -m "docs(examples): add MCP request samples for every tool"
```

---

## Task 7 — Write the end-to-end workflow example

**Files:**
- Create: `examples/workflows/login-and-screenshot.md`

- [ ] **Step 1: Create the workflow document**

````markdown
# Workflow: Login + Screenshot

A complete agent-driven scenario: launch an Electron app, authenticate,
and capture a screenshot of the post-login dashboard.

## Prerequisites

- `electron-mcp` server registered with your MCP client (see the main
  [README](../../README.md#2-register-the-server-with-your-mcp-client)).
- An Electron app with a login form at `/login` that redirects to
  `/dashboard` on success.
- The executable path is on your allowlist.

## Script the agent should follow

1. **Launch** the app.
2. **Wait** for the login window.
3. **Fill** email + password.
4. **Click** submit.
5. **Wait** for the dashboard window.
6. **Screenshot** the result.
7. **Close** the session.

## Tool calls (JSON-RPC)

### 1. Launch

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_launch",
    "arguments": {
      "executablePath": "/Applications/MyApp.app/Contents/MacOS/MyApp",
      "label": "login-flow"
    }
  }
}
```

Response → take `sessionId` from `result.content[0].text`.

### 2. Wait for login window

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_wait_for_window",
    "arguments": {
      "sessionId": "sess_…",
      "urlPattern": "/login",
      "timeout": 10000
    }
  }
}
```

### 3. Fill email

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_fill",
    "arguments": {
      "sessionId": "sess_…",
      "selector": "input[name='email']",
      "value": "user@example.com"
    }
  }
}
```

### 4. Fill password

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_fill",
    "arguments": {
      "sessionId": "sess_…",
      "selector": "input[name='password']",
      "value": "correct-horse-battery-staple"
    }
  }
}
```

### 5. Click submit

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_click",
    "arguments": {
      "sessionId": "sess_…",
      "selector": "button[type='submit']"
    }
  }
}
```

### 6. Wait for dashboard

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_wait_for_window",
    "arguments": {
      "sessionId": "sess_…",
      "urlPattern": "/dashboard",
      "timeout": 15000
    }
  }
}
```

### 7. Screenshot

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_screenshot",
    "arguments": {
      "sessionId": "sess_…",
      "path": "./screenshots/dashboard.png",
      "fullPage": true,
      "type": "png"
    }
  }
}
```

### 8. Close

```json
{
  "method": "tools/call",
  "params": {
    "name": "electron_close",
    "arguments": { "sessionId": "sess_…" }
  }
}
```

## What a correct trace looks like

Every successful step returns:

```json
{
  "ok": true,
  "sessionId": "sess_…",
  "…": "…tool-specific fields…"
}
```

If a window takes too long to appear, the wait step fails with:

```json
{
  "ok": false,
  "error": { "code": "window_not_found", "message": "No window matching: url~=/dashboard", "details": { "windowRef": "url~=/dashboard" } }
}
```

The agent should either retry once with a longer timeout or surface the
error rather than pushing forward.
````

- [ ] **Step 2: Commit**

```bash
git add examples/workflows/
git commit -m "docs(examples): add login + screenshot end-to-end workflow"
```

---

## Task 8 — Build the project

**Files:**
- Output: `dist/` tree

- [ ] **Step 1: Remove stale build output (if any)**

```bash
rm -rf dist
```

- [ ] **Step 2: Run the build**

```bash
npm run build
```
Expected: exits 0, emits `dist/server/index.js`, `dist/server/mcp-server.js`, and trees for every subdirectory in `src/`.

- [ ] **Step 3: Verify the binary is executable-ready**

```bash
node --input-type=module -e "import('./dist/server/mcp-server.js').then(m => console.log(Object.keys(m)))"
```
Expected output includes `createElectronMcpServer`.

- [ ] **Step 4: Verify the shebang on the entrypoint**

```bash
head -1 dist/server/index.js
```
Expected: `#!/usr/bin/env node`.

If missing, confirm `src/server/index.ts` line 1 is `#!/usr/bin/env node`. TSC preserves the shebang line.

- [ ] **Step 5: Set executable bit**

```bash
chmod +x dist/server/index.js
```

---

## Task 9 — Smoke test the server

**Files:** none (manual verification)

- [ ] **Step 1: Start the server in one terminal**

```bash
cd /Volumes/WorkSSD/repos/personal/electron-mcp-server
node dist/server/index.js
```
Expected:
- stderr shows `{"time":"…","level":"info","msg":"electron-mcp starting", …}` and then `{"…","msg":"electron-mcp ready","transport":"stdio"}`.
- stdout is silent (MCP framing waits for input).
- the process stays alive.

If nothing is printed, there's likely an early crash — check `npm run dev` for a clearer trace.

- [ ] **Step 2: From a second terminal, use the Inspector to list tools**

```bash
cd /Volumes/WorkSSD/repos/personal/electron-mcp-server
npx --yes @modelcontextprotocol/inspector node dist/server/index.js
```

- Open the browser URL the inspector prints.
- Click **Tools → List**. You should see **12** tools:
  `electron_launch`, `electron_close`, `electron_restart`,
  `electron_list_sessions`, `electron_list_windows`,
  `electron_focus_window`, `electron_wait_for_window`,
  `electron_click`, `electron_fill`, `electron_evaluate_renderer`,
  `electron_screenshot`, `electron_evaluate_main`.

- [ ] **Step 3: Test a validation error path**

In the Inspector, call `electron_close` with an empty `sessionId` (or
omit it). The response should be:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "{\n  \"ok\": false,\n  \"error\": {\n    \"code\": \"validation_error\", …"
    }
  ]
}
```

If instead the server crashes or returns a non-structured error, open
a bug in a new chapter — do not silently "fix" it. The expected
behavior is the structured `validation_error` envelope.

- [ ] **Step 4: Test the launch-path error for a bogus executable**

Call `electron_launch` with `executablePath: "/does/not/exist"`. Expect:

```json
{ "ok": false, "error": { "code": "launch_error", "message": "Executable does not exist or is not accessible: /does/not/exist", … } }
```

- [ ] **Step 5: Test against a real Electron binary (if available)**

If you have an Electron app at hand — e.g. the sample
`electron-quick-start` repo:

```bash
git clone --depth 1 https://github.com/electron/electron-quick-start /tmp/electron-quick-start
cd /tmp/electron-quick-start
npm install
```

Then from the Inspector, call:

```json
{
  "name": "electron_launch",
  "arguments": {
    "executablePath": "/tmp/electron-quick-start/node_modules/.bin/electron",
    "args": ["/tmp/electron-quick-start"]
  }
}
```

Expect a `{"ok":true,"sessionId":"sess_…"}` response. Follow up with
`electron_list_windows` to confirm one window, then
`electron_screenshot` → verify the file on disk. Finish with
`electron_close`.

- [ ] **Step 6: Record the smoke-test outcome**

If all steps pass, note in the commit message. If a step fails, file
it as a follow-up and do NOT mark the plan complete.

- [ ] **Step 7: (Optional) Commit a smoke-test log snippet**

If you captured useful stderr JSON during the smoke test, drop it into
`docs/samples/smoke-test-2026-04-19.log` and commit. Otherwise skip.

---

## Task 10 — (Optional) Unit tests

**Files:**
- Create: `tests/allowlist.test.ts`
- Create: `tests/errors.test.ts`
- Create: `tests/session-manager.test.ts`
- Create: `tests/schemas.test.ts`

Vitest is already in `devDependencies`. These tests cover pure logic
(allowlist globs, error serialization, schema parsing, session cap).
The Electron adapter is not covered here — it needs an Electron binary
fixture and is better tested in the smoke-test path above.

- [ ] **Step 1: Create `tests/allowlist.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import { matchesAllowlist } from '../src/utils/allowlist.js';

describe('matchesAllowlist', () => {
  test('empty allowlist permits anything', () => {
    expect(matchesAllowlist('/Applications/Foo.app/Contents/MacOS/Foo', [])).toBe(true);
  });

  test('exact path matches', () => {
    expect(
      matchesAllowlist('/usr/local/bin/electron', ['/usr/local/bin/electron']),
    ).toBe(true);
  });

  test('star glob matches within a segment', () => {
    expect(
      matchesAllowlist('/usr/local/bin/electron-1.2.3', ['/usr/local/bin/electron-*']),
    ).toBe(true);
  });

  test('double-star glob crosses segments', () => {
    expect(
      matchesAllowlist(
        '/Applications/MyApp.app/Contents/MacOS/MyApp',
        ['/Applications/*.app/**'],
      ),
    ).toBe(true);
  });

  test('non-matching path is rejected', () => {
    expect(
      matchesAllowlist('/opt/not-allowed/bin/electron', ['/usr/local/bin/*']),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Create `tests/errors.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import {
  ElectronMcpError,
  SelectorError,
  SessionNotFoundError,
  TimeoutError,
  ValidationError,
  normalizeError,
} from '../src/errors/index.js';

describe('normalizeError', () => {
  test('passes through ElectronMcpError subclasses', () => {
    const err = new ValidationError('bad input', { field: 'x' });
    expect(normalizeError(err)).toBe(err);
  });

  test('maps unknown Error to internal_error with stack', () => {
    const err = normalizeError(new Error('boom'));
    expect(err).toBeInstanceOf(ElectronMcpError);
    expect(err.code).toBe('internal_error');
    expect(err.message).toBe('boom');
  });

  test('detects timeout in message', () => {
    const err = normalizeError(new Error('playwright timeout exceeded'));
    expect(err.code).toBe('timeout');
  });

  test('wraps non-Error throws', () => {
    const err = normalizeError('just a string');
    expect(err.code).toBe('internal_error');
    expect(err.message).toBe('just a string');
  });
});

describe('toJSON', () => {
  test('serializes selector error', () => {
    const err = new SelectorError('button#x', 'not found');
    expect(err.toJSON()).toEqual({
      ok: false,
      error: {
        code: 'selector_error',
        message: 'Selector failed: button#x (not found)',
        details: { selector: 'button#x', cause: 'not found' },
      },
    });
  });

  test('serializes session not found', () => {
    const err = new SessionNotFoundError('sess_abc');
    expect(err.toJSON().error.code).toBe('session_not_found');
    expect(err.toJSON().error.details).toMatchObject({ sessionId: 'sess_abc' });
  });

  test('serializes timeout', () => {
    const err = new TimeoutError('click', 5000);
    expect(err.toJSON().error.code).toBe('timeout');
    expect(err.toJSON().error.details).toMatchObject({ operation: 'click', timeoutMs: 5000 });
  });
});
```

- [ ] **Step 3: Create `tests/session-manager.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import { SessionManager } from '../src/session/session-manager.js';
import { PermissionDeniedError, SessionNotFoundError } from '../src/errors/index.js';
import { createLogger } from '../src/logging/logger.js';

interface FakeApp {
  _handlers: Record<string, (() => void)[]>;
  on(event: string, fn: () => void): void;
  off(event: string, fn: () => void): void;
  windows(): unknown[];
  close(): Promise<void>;
}

function fakeApp(): FakeApp {
  return {
    _handlers: {},
    on(event, fn) {
      this._handlers[event] ??= [];
      this._handlers[event].push(fn);
    },
    off(event, fn) {
      this._handlers[event] = (this._handlers[event] ?? []).filter((h) => h !== fn);
    },
    windows() {
      return [];
    },
    async close() {
      /* noop */
    },
  };
}

describe('SessionManager', () => {
  const logger = createLogger('error');

  test('registers and retrieves a session', () => {
    const sm = new SessionManager({ maxSessions: 2, logger });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sm.register({ app: fakeApp() as any, executablePath: '/x', args: [] });
    expect(sm.get(session.id)).toBe(session);
  });

  test('enforces max sessions cap', () => {
    const sm = new SessionManager({ maxSessions: 1, logger });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sm.register({ app: fakeApp() as any, executablePath: '/a', args: [] });
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sm.register({ app: fakeApp() as any, executablePath: '/b', args: [] }),
    ).toThrow(PermissionDeniedError);
  });

  test('get throws on unknown session id', () => {
    const sm = new SessionManager({ maxSessions: 1, logger });
    expect(() => sm.get('nope')).toThrow(SessionNotFoundError);
  });

  test('list() returns a snapshot', () => {
    const sm = new SessionManager({ maxSessions: 3, logger });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = sm.register({ app: fakeApp() as any, executablePath: '/a', args: [], label: 'x' });
    const snaps = sm.list();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.sessionId).toBe(s.id);
    expect(snaps[0]?.label).toBe('x');
  });
});
```

- [ ] **Step 4: Create `tests/schemas.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import {
  ElectronClickInputSchema,
  ElectronLaunchInputSchema,
  ElectronWaitForWindowInputSchema,
} from '../src/schemas/index.js';

describe('ElectronLaunchInputSchema', () => {
  test('accepts a minimal launch', () => {
    const result = ElectronLaunchInputSchema.parse({ executablePath: '/bin/electron' });
    expect(result.executablePath).toBe('/bin/electron');
    expect(result.args).toEqual([]);
  });

  test('rejects empty executable path', () => {
    expect(() => ElectronLaunchInputSchema.parse({ executablePath: '' })).toThrow();
  });

  test('rejects overly large timeout', () => {
    expect(() =>
      ElectronLaunchInputSchema.parse({ executablePath: '/x', timeout: 999_999 }),
    ).toThrow();
  });
});

describe('ElectronClickInputSchema', () => {
  test('applies defaults', () => {
    const parsed = ElectronClickInputSchema.parse({
      sessionId: 'sess_1',
      selector: '#x',
    });
    expect(parsed.button).toBe('left');
    expect(parsed.clickCount).toBe(1);
    expect(parsed.force).toBe(false);
  });
});

describe('ElectronWaitForWindowInputSchema', () => {
  test('accepts urlPattern only', () => {
    const parsed = ElectronWaitForWindowInputSchema.parse({
      sessionId: 'sess_1',
      urlPattern: '/login',
    });
    expect(parsed.urlPattern).toBe('/login');
  });
});
```

- [ ] **Step 5: Create a test-only tsconfig so `npm run typecheck` still covers tests**

The base `tsconfig.json` excludes `**/*.test.ts` so the build doesn't pull them in. Vitest uses its own transpiler at runtime, so we don't need to change `tsconfig.json` at all — Vitest will compile `.test.ts` files itself. If you want IDE-level typechecking for tests, add a `tsconfig.test.json`:

File: `tsconfig.test.json`
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

No change to the default `typecheck` script is required — skipping this step is fine.

- [ ] **Step 6: Run the tests**

```bash
npm run test
```
Expected: all tests pass, exit 0.

- [ ] **Step 7: Run typecheck again**

```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add tests/ tsconfig.json
git commit -m "test: add unit tests for allowlist, errors, session manager, schemas"
```

---

## Task 11 — Initialize git and push (if desired)

**Files:** none (git operations only)

- [ ] **Step 1: Initialize the repo if not already**

```bash
cd /Volumes/WorkSSD/repos/personal/electron-mcp-server
git init -b main
```

Skip if `.git/` already exists.

- [ ] **Step 2: Stage everything we've created**

```bash
git add .gitignore .env.example package.json tsconfig.json tsconfig.build.json \
        eslint.config.js .prettierrc.json .prettierignore \
        src/ docs/ examples/ tests/ README.md LICENSE
```

- [ ] **Step 3: Make the initial commit if empty**

```bash
git diff --cached --stat | head
git commit -m "feat: initial electron-mcp server"
```

Use one commit per task instead of a single big commit if you prefer —
the task-local commits from earlier steps already split the tree.

- [ ] **Step 4: (Optional) Create a remote and push**

If the user supplies a remote, follow their convention. Otherwise skip.

---

## Acceptance Criteria

The plan is complete when:

1. `npm install` completes cleanly.
2. `npm run typecheck` exits 0 with no errors.
3. `npm run lint` exits 0.
4. `npm run build` emits a working `dist/server/index.js`.
5. `node dist/server/index.js` starts the server and prints the JSON
   `"electron-mcp ready"` log line.
6. `@modelcontextprotocol/inspector` can connect and `tools/list`
   returns **12** tools with their schemas.
7. Invoking a tool with bad input returns a structured
   `validation_error` envelope (not a thrown error).
8. Invoking `electron_launch` against a real Electron binary returns
   `{"ok":true,"sessionId":…}` and `electron_close` cleans up.
9. `README.md`, `examples/README.md`, and `examples/workflows/login-and-screenshot.md`
   all exist.
10. *(If Task 10 was done)* `npm run test` passes.

---

## Design decisions captured (for future maintainers)

- **Lower-level `Server` vs `McpServer`.** We use the lower-level
  `Server` class so that the tool registry is plain data (an array of
  `{name, description, inputSchema, handler}`) and so that dispatch can
  catch every throw and normalize it into a structured envelope. The
  higher-level `McpServer.registerTool(...)` API was considered but
  makes structured error envelopes harder to enforce uniformly.
- **Single-source-of-truth schemas.** Zod schemas live in
  `src/schemas/index.ts`. They produce TypeScript types (`z.infer`),
  runtime validation (`.parse`), and advertised JSON Schema
  (`zod-to-json-schema`). Do not duplicate types by hand elsewhere.
- **stderr for logs.** `stdout` is reserved for MCP framing. The
  logger hard-writes to `process.stderr`. Never use `console.log` in
  this codebase.
- **Main-process evaluation is gated.** `electron_evaluate_main` has
  full Node access. It is off by default and must be flipped via
  `ELECTRON_MCP_ALLOW_MAIN_EVALUATE=true`. The gate lives in the tool
  handler, not the adapter, so tests of the adapter still pass.
- **Tool registry is a flat array.** Adding a new tool is two files:
  schemas + handler, then append an entry to `buildToolRegistry()`.
  Avoid reflection / decorator-based registration.
- **No abstractions for hypothetical features.** The spec mentions HTTP
  transport, tracing, DOM snapshots, IPC hooks as stretch goals. They
  are intentionally *not* scaffolded — introducing an abstraction
  before we have two concrete implementations invariably costs more to
  maintain than it saves.

---

## Known gaps and follow-ups

These were explicitly deferred — do NOT silently implement during
execution of this plan.

- HTTP transport (the entrypoint refuses non-stdio today).
- Tracing / Playwright recording hooks.
- DOM snapshot support (Playwright `locator.snapshot()` equivalent).
- IPC hooks for main-process messages.
- A unified browser + electron driver (stretch goal in spec).
- Publishing to npm / Docker image / CI pipeline.

Create follow-up issues / plans for any of these when a concrete use
case appears.
