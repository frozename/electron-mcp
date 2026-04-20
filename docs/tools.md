# Tool Reference

Every tool returns a JSON object. Successful calls always start with
`{ "ok": true, … }`; failures with `{ "ok": false, "error": { "code", … } }`.

Conventions:

- `sessionId` is opaque and returned by `electron_launch`.
- `window` accepts an integer index, a URL substring/regex, or a title
  substring/regex. When omitted, the first window is used.
- `timeout` is always milliseconds. Defaults come from environment
  variables (see [`.env.example`](../.env.example)).

---

## Lifecycle

### `electron_launch`

Launch an Electron application via Playwright.

| Field                | Type                         | Notes                                                     |
| -------------------- | ---------------------------- | --------------------------------------------------------- |
| `executablePath`     | string (required)            | Absolute path; subject to allowlist                       |
| `args`               | string[]                     | Passed to Electron                                        |
| `cwd`                | string                       | Working directory                                         |
| `env`                | object                       | Merged with process env (secret-shaped keys redacted in logs) |
| `userDataDir`        | string                       | Passed via `--user-data-dir`. If omitted, an auto-tmp dir is minted. Locked dirs trigger auto-substitute unless strict. |
| `strictUserDataDir`  | boolean (default false)      | When true, fail with `launch_error` if `userDataDir` is locked instead of auto-substituting |
| `timeout`            | number (ms)                  | Override `ELECTRON_MCP_LAUNCH_TIMEOUT`                    |
| `recordVideoDir`     | string                       | Forwarded to Playwright                                   |
| `colorScheme`        | `light\|dark\|no-preference` | Forwarded to Playwright                                   |
| `label`              | string                       | Stored with the session for listings/logs                 |

Response:

```json
{
  "ok": true,
  "sessionId": "sess_…",
  "label": "my-app",
  "status": "active",
  "startedAt": "2026-04-19T05:01:23.456Z",
  "windowCount": 1,
  "userDataDir": "/tmp/electron-mcp-userdata-abc123",
  "autoTmp": true,
  "replacedLockedDir": "/Users/you/Library/Application Support/MyApp"
}
```

- `userDataDir` is always present — the actual path passed to Electron
  (useful when the server auto-minted or substituted it).
- `autoTmp` is true when the server created the dir and will clean it up
  on graceful close.
- `replacedLockedDir` appears only when the caller's `userDataDir` was
  locked by another Electron instance and the server substituted a
  tmp dir. Missing otherwise.

Errors: `permission_denied` (allowlist), `launch_error` (includes locked
userDataDir under strict mode), `timeout`.

### `electron_close`

Close a session. Pass `force: true` to send `SIGKILL` after a 2s grace
period. Always removes the session from the registry, even on error.

```json
{ "sessionId": "sess_…", "force": false }
```

### `electron_restart`

Close and relaunch a session reusing the original executable, args, and
label. Returns the same shape as `electron_launch` with a new
`sessionId`.

### `electron_list_sessions`

Returns every active session, including status and window count. Takes
no arguments.

---

## Windows

### `electron_list_windows`

```json
{ "sessionId": "sess_…" }
```

Response:

```json
{
  "ok": true,
  "sessionId": "sess_…",
  "windows": [{ "index": 0, "title": "App", "url": "file:///…/index.html", "isClosed": false }]
}
```

### `electron_focus_window`

Bring a specific window to the front (`page.bringToFront()`).

```json
{ "sessionId": "sess_…", "window": 0 }
```

### `electron_wait_for_window`

Block until a window matching the predicate exists. At least one of
`urlPattern`, `titlePattern`, or `index` is required.

```json
{
  "sessionId": "sess_…",
  "urlPattern": "/login",
  "timeout": 10000
}
```

Errors: `validation_error` (no predicate), `window_not_found`,
`timeout`.

---

## Renderer

### `electron_click`

```json
{
  "sessionId": "sess_…",
  "selector": "button[data-test='submit']",
  "button": "left",
  "clickCount": 1,
  "force": false
}
```

Errors: `selector_error` (element missing or unclickable), `timeout`.

### `electron_fill`

Replace the value of an input/textarea/contenteditable.

```json
{
  "sessionId": "sess_…",
  "selector": "#email",
  "value": "user@example.com"
}
```

### `electron_evaluate_renderer`

Run JavaScript inside the renderer context. The `expression` may be:

- A bare expression — `document.title` (auto-wrapped in `return (...);`).
- A function body — `const el = document.querySelector('#x'); return el?.value;`.

The function receives `arg` (your serializable input) as its single
parameter.

```json
{
  "sessionId": "sess_…",
  "window": "/dashboard",
  "expression": "document.querySelectorAll('.row').length"
}
```

Response:

```json
{ "ok": true, "sessionId": "sess_…", "result": 12 }
```

### `electron_screenshot`

```json
{
  "sessionId": "sess_…",
  "fullPage": true,
  "path": "./screenshots/dashboard.png",
  "type": "png"
}
```

If `path` is omitted, the response includes a base64 string. `byteLength`
is always set so callers can size their decode buffers.

---

## Main process

### `electron_evaluate_main`

⚠️ **Disabled by default.** Set
`ELECTRON_MCP_ALLOW_MAIN_EVALUATE=true` to enable.

The `expression` is executed inside the Electron main process. Your
function receives `(electron, arg)` where `electron` is the Electron
module (`app`, `BrowserWindow`, `dialog`, …).

```json
{
  "sessionId": "sess_…",
  "expression": "return electron.app.getPath('userData');"
}
```

```json
{ "ok": true, "sessionId": "sess_…", "result": "/Users/…/Library/Application Support/MyApp" }
```

Errors: `permission_denied` (feature gate), `evaluation_error`,
`timeout`.

---

## Error envelope

Every failure is shaped like:

```json
{
  "ok": false,
  "error": {
    "code": "selector_error",
    "message": "Selector failed: button#submit (timeout waiting for element)",
    "details": {
      "selector": "button#submit",
      "cause": "timeout waiting for element"
    }
  }
}
```

| Code                | Meaning                                                |
| ------------------- | ------------------------------------------------------ |
| `validation_error`  | Input failed Zod validation                            |
| `launch_error`      | Could not start the Electron process                   |
| `session_not_found` | Unknown `sessionId`                                    |
| `window_not_found`  | No window matched the reference / predicate            |
| `selector_error`    | DOM operation failed (missing element, detached, etc.) |
| `timeout`           | Operation exceeded its deadline                        |
| `evaluation_error`  | Renderer or main process evaluation threw              |
| `permission_denied` | Allowlist / gate refused the request                   |
| `internal_error`    | Catch-all for unexpected failures                      |

Agents should dispatch on `code` and surface `message` to humans only
when no code-specific handling exists.
