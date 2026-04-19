# Security & Guardrails

This server hands an MCP client (typically an LLM agent) the ability to
launch native applications and run arbitrary JavaScript inside them.
Treat it accordingly. Defaults err on the side of safety; opt in to
relax them per environment.

## Threat model

* **Untrusted prompt → server**: an agent could be steered into
  launching arbitrary binaries, exfiltrating files via the renderer, or
  pivoting to network resources via `electron_evaluate_main`.
* **Untrusted server → host**: the MCP transport is local stdio by
  default, but HTTP transport (when enabled) exposes the API surface.
* **Untrusted Electron app**: a compromised app can attempt to read
  files via the renderer evaluator that the server exposes. The
  allowlist restricts which apps may be launched.

## Defaults

| Setting                       | Default | Why                                              |
| ----------------------------- | ------- | ------------------------------------------------ |
| `ELECTRON_MCP_ALLOW_MAIN_EVALUATE` | `false` | Main process has full Node.js — opt-in only |
| `ELECTRON_MCP_MAX_SESSIONS`        | `5`     | Bound resource use                          |
| `ELECTRON_MCP_LAUNCH_TIMEOUT`      | `30000` | Prevent indefinite hangs                    |
| `ELECTRON_MCP_ACTION_TIMEOUT`      | `15000` | Bound DOM operations                        |
| `ELECTRON_MCP_EVALUATE_TIMEOUT`    | `10000` | Bound evaluator runtime                     |
| `ELECTRON_MCP_TRANSPORT`           | `stdio` | No network exposure unless explicitly opted in |

## Executable allowlist

Set `ELECTRON_MCP_EXECUTABLE_ALLOWLIST` to a comma-separated list of
glob patterns. The launcher resolves each pattern to an absolute path
(supports `~`, `*`, `**`) and refuses to launch anything that does not
match.

```env
ELECTRON_MCP_EXECUTABLE_ALLOWLIST=/Applications/MyApp.app/**,/usr/local/bin/electron-test-*
```

An **empty allowlist disables enforcement** and allows any executable
the user can run. This is convenient for development but should never
ship in production; surface a deploy-time check that the variable is
set.

## Main process evaluation

`electron_evaluate_main` runs JavaScript with full Node.js access:

```js
return electron.app.getPath('userData');           // safe-ish
require('child_process').execSync('rm -rf …');     // catastrophic
require('fs').readFileSync('/etc/passwd', 'utf8'); // exfiltration
```

Keep `ELECTRON_MCP_ALLOW_MAIN_EVALUATE=false` unless:

1. The MCP transport is local stdio.
2. The agent driving the server is trusted (or the prompts feeding it
   are reviewed).
3. The Electron app's main process does not contain secrets that an
   attacker shouldn't read.

Even when enabled, prefer to expose targeted helpers via your app's IPC
surface and drive them through `electron_evaluate_main` with narrow
expressions. Treat any request to read files, run shell commands, or
make network calls as a red flag.

## Renderer evaluation

`electron_evaluate_renderer` runs in the renderer's web context. With
default Electron settings (context isolation on, node integration off)
this is sandboxed similarly to a browser tab — it can read DOM and call
exposed `contextBridge` APIs, but cannot `require('fs')`. If your app
disables context isolation or enables node integration, the renderer
evaluator inherits whatever capabilities the page itself has.

## stdio vs HTTP

* **stdio (default)**: bound to the parent process. No network surface.
  Recommended for desktop integrations (Claude Code, Codex, Cursor).
* **HTTP**: opt in by setting `ELECTRON_MCP_TRANSPORT=http`. *Not*
  implemented in this initial release — the entrypoint will refuse to
  start and exit code `2`. When implemented, bind to `127.0.0.1` and
  protect with a token; never expose to a public interface.

## Logging

All tool invocations log `tool.call.begin` / `tool.call.end` at `info`
level, with `requestId`, `sessionId` (when applicable), `durationMs`,
and on errors the `code` and `message`. Logs are JSON to `stderr`.

User-supplied content (selectors, expression bodies, fill values) is
**not** redacted. If you need to drive flows that handle credentials,
either:

* Lower the log level to `warn` for those sessions, or
* Write the secret server-side (e.g. via env) and reference it inside
  an `electron_evaluate_renderer` body so the secret stays in the app.

## Reporting issues

Open a private security report via your repository's vulnerability
reporting workflow. Do not file a public issue.
