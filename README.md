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
- Hermetic launches: auto-minted tmp `--user-data-dir` per session +
  SingletonLock conflict detection so a stale/locked profile can't silently
  stall startup
- Env passthrough on `electron_launch` so callers can isolate the target
  app from the shell (secret-shaped keys are redacted from logs)
- Window discovery by index, URL pattern, or title — plus event-driven
  `wait_for_new_window` for modals / popups
- DOM interaction: click, fill, hover, press (keyboard shortcuts),
  select_option, wait_for_selector
- Observability: accessibility-tree snapshots, per-session console and
  network ring buffers, Playwright `.zip` tracing for post-mortem
- Dialog policies: auto-accept / dismiss alert·confirm·prompt across
  current and future windows
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
git clone https://github.com/frozename/electron-mcp.git
cd electron-mcp
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
      "args": ["/absolute/path/to/electron-mcp/dist/server/index.js"],
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

## Launching Electron hermetically

`electron_launch` accepts three launch-isolation parameters. All are
optional; the default behavior is the safe one.

- `env: Record<string,string>` — merged with `process.env` before spawn.
  Never mutates the inherited env or the caller's object. Secret-shaped
  keys (anything matching `TOKEN`, `BEARER`, `SECRET`, `KEY`, `PASSWORD`,
  `PASSWD`, `API_KEY`) are redacted to `<redacted>` in launch logs — the
  raw values still reach the child process.
- `userDataDir: string` — path passed via Electron's `--user-data-dir`
  flag. If omitted, the server mints a fresh
  `/tmp/electron-mcp-userdata-<random>` directory for the session and
  removes it on `electron_close`. If the supplied directory already has an
  active `SingletonLock` (symlink → alive pid), the server substitutes a
  tmp dir and echoes the replaced path via `replacedLockedDir` in the
  response.
- `strictUserDataDir: boolean` (default `false`) — when true, a
  SingletonLock conflict throws `launch_error` instead of auto-tmping.

The response always includes `userDataDir` (what actually got passed to
Electron) and `autoTmp` (true when we minted the dir). Crashes before a
graceful close leave auto-minted dirs behind for post-mortem; only
`electron_close` / server shutdown trigger cleanup. Windows users should
pass an explicit `userDataDir` — the SingletonLock format differs from
macOS/Linux and is not parsed in this release.

## Tools

25 tools across 7 categories. All handlers return a structured `{ ok,
sessionId, … }` envelope and throw a typed `ElectronMcpError` on failure.

| Category      | Tool                               | Purpose                                                        |
| ------------- | ---------------------------------- | -------------------------------------------------------------- |
| Lifecycle     | `electron_launch`                  | Launch an Electron app; returns a session id                   |
| Lifecycle     | `electron_close`                   | Close a session (optional `force: true`)                       |
| Lifecycle     | `electron_restart`                 | Close + relaunch preserving args                               |
| Lifecycle     | `electron_list_sessions`           | Enumerate active sessions                                      |
| Windows       | `electron_list_windows`            | List windows for a session                                     |
| Windows       | `electron_focus_window`            | Bring a window to front                                        |
| Windows       | `electron_wait_for_window`         | Wait for an existing URL/title/index predicate                 |
| Windows       | `electron_wait_for_new_window`     | Resolve when the next NEW window (modal, popup) appears        |
| Renderer      | `electron_click`                   | Click an element                                               |
| Renderer      | `electron_fill`                    | Fill an input                                                  |
| Renderer      | `electron_hover`                   | Hover — reveals tooltips, submenus                             |
| Renderer      | `electron_press`                   | Keyboard shortcut (`Meta+K`, `Escape`, `Tab`, modifier combos) |
| Renderer      | `electron_select_option`           | Pick one or more `<option>`s by value / label / index          |
| Renderer      | `electron_wait_for_selector`       | Wait for `visible` / `hidden` / `attached` / `detached`        |
| Renderer      | `electron_evaluate_renderer`       | Evaluate JS in the renderer                                    |
| Renderer      | `electron_screenshot`              | Capture a PNG/JPEG of a window                                 |
| Visual        | `screenshot_diff`                  | Pixel-regression diff vs a caller-supplied baseline PNG        |
| Visual        | `assert_visible_text`              | Assert text appears (substring/regex) with polling waits       |
| Observability | `electron_accessibility_snapshot`  | Structured a11y tree (roles/names/values) for LLM reasoning    |
| Observability | `electron_console_tail`            | Ring buffer of renderer console + page errors (per session)    |
| Observability | `electron_network_tail`            | Ring buffer of HTTP requests/responses with filters            |
| Observability | `electron_dialog_policy`           | Auto-handle alert/confirm/prompt across current + future tabs  |
| Tracing       | `electron_trace_start`             | Start Playwright tracing for the session                       |
| Tracing       | `electron_trace_stop`              | Stop tracing; write a `.zip` viewable in `playwright show-trace` |
| Main          | `electron_evaluate_main`           | Evaluate JS in the main process (opt-in)                       |

See [`docs/tools.md`](./docs/tools.md) for full input/output schemas.

## Documentation

- [Architecture](./docs/architecture.md) — module map and design decisions
- [Tools](./docs/tools.md) — every tool with examples and error codes
- [Session model](./docs/session-model.md) — lifecycle, window refs, timeouts
- [Security](./docs/security.md) — allowlists, main-process gating, threat model
- [Examples](./examples/README.md) — copy-paste MCP requests and full workflows

## Project scripts

| Command                     | What it does                                                 |
| --------------------------- | ------------------------------------------------------------ |
| `npm run dev`               | Run the server with `tsx watch`                              |
| `npm run build`             | Emit `dist/` via the build tsconfig                          |
| `npm run start`             | Run the compiled `dist/server/index.js`                      |
| `npm run lint`              | ESLint over `src/**/*.ts`                                    |
| `npm run typecheck`         | `tsc --noEmit`                                               |
| `npm run test`              | Vitest (unit tests)                                          |
| `npm run test:smoke:all`    | Run sprint 1/2/3 smokes against the CI fixture (needs `CI_ELECTRON_BIN`) |
| `npm run test:smoke:sprint1` | Sprint 1 smoke only (wait/a11y/console)                      |
| `npm run test:smoke:sprint2` | Sprint 2 smoke only (hover/press/select/dialog-policy)       |
| `npm run test:smoke:sprint3` | Sprint 3 smoke only (network/trace)                          |
| `npm run format`            | Prettier over source and docs                                |

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull
request, across `ubuntu-latest` and `macos-latest`:

1. `npm ci` → `npm run typecheck` → `npm run build` → `npm test` (Vitest).
2. `npm run test:smoke:all` — drives the three sprint smokes
   (`tests/sprint{1,2,3}-smoke.ts`) against the bundled Electron fixture
   at `tests/fixtures/ci-app/`. On Linux the smokes run under
   `xvfb-run`; macOS needs no virtual display. Smoke output is uploaded
   as an artifact when the job fails.

The fixture app is a deliberately minimal Electron window with a
primary-nav sidebar (Dashboard / Presets / Nodes / Models / Cost) plus
per-section root containers. Add new UI affordances there when you need
new smoke coverage — keep the smokes themselves portable.

### Running smokes locally

```sh
npm ci
npm run build

# macOS
export CI_ELECTRON_BIN="$PWD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

# Linux (Electron needs a display; install xvfb once):
# sudo apt-get install -y xvfb libnss3 libatk-bridge2.0-0 libdrm2 libgbm1 libxkbcommon0 libasound2t64
# export CI_ELECTRON_BIN="$PWD/node_modules/electron/dist/electron"
# run via: xvfb-run -a npm run test:smoke:all

npm run test:smoke:all
```

Each smoke script accepts `--executable=<path>` and `--args=<main.js>`,
so the same scripts drive a real target app (e.g. a locally built
product binary) in addition to the CI fixture.

## Environment variables

| Variable                            | Default         | Meaning                                                 |
| ----------------------------------- | --------------- | ------------------------------------------------------- |
| `ELECTRON_MCP_LOG_LEVEL`            | `info`          | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `ELECTRON_MCP_MAX_SESSIONS`         | `5`             | Hard cap on concurrent sessions                         |
| `ELECTRON_MCP_LAUNCH_TIMEOUT`       | `30000`         | Default launch timeout (ms)                             |
| `ELECTRON_MCP_ACTION_TIMEOUT`       | `15000`         | Default DOM action timeout (ms)                         |
| `ELECTRON_MCP_EVALUATE_TIMEOUT`     | `10000`         | Default evaluate timeout (ms)                           |
| `ELECTRON_MCP_EXECUTABLE_ALLOWLIST` | _(empty)_       | Comma-separated globs; empty = no restriction           |
| `ELECTRON_MCP_ALLOW_MAIN_EVALUATE`  | `false`         | Gate on `electron_evaluate_main`                        |
| `ELECTRON_MCP_SCREENSHOT_DIR`       | `./screenshots` | Output directory for screenshots                        |
| `ELECTRON_MCP_TRANSPORT`            | `stdio`         | `stdio` (only option today)                             |

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
