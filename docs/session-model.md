# Session Model

A **session** represents one running Electron application managed by
this server. Sessions are created by `electron_launch`, identified by
an opaque `sessionId`, and live until `electron_close` is called or the
underlying process exits.

## Lifecycle states

```
                ┌────────────┐
electron_launch │ launching  │  Playwright is spawning Electron.
                └──────┬─────┘
                       │ on success
                       ▼
                ┌────────────┐
                │  active    │  Tools may be invoked.
                └──────┬─────┘
                       │
        ┌──────────────┼─────────────────────────┐
        │              │                         │
electron_close   process exits             SIGTERM/SIGINT
        ▼              ▼                         ▼
                ┌────────────┐
                │  closing   │  Tools rejected.
                └──────┬─────┘
                       │
                       ▼
                ┌────────────┐
                │   closed   │  Removed from registry.
                └────────────┘
```

`crashed` is reserved for explicit signal-based detection (not used by
the current implementation; the manager surfaces unexpected exits as
`closed`).

## Snapshot (returned by `electron_list_sessions`)

```jsonc
{
  "sessionId": "sess_a4b2…",
  "label": "my-app", // user-supplied at launch (optional)
  "status": "active",
  "executablePath": "/Applications/MyApp.app/Contents/MacOS/MyApp",
  "startedAt": "2026-04-19T05:01:23.456Z",
  "lastUsedAt": "2026-04-19T05:01:42.118Z",
  "windowCount": 2,
}
```

`lastUsedAt` is bumped by every successful tool invocation so callers
can implement idle-eviction or timeout policies on top of the registry.

## Concurrency cap

`SessionManager` enforces `ELECTRON_MCP_MAX_SESSIONS` (default 5).
Attempting to launch beyond the cap raises `permission_denied` with the
current count and limit in `details`. The newly-spawned Electron
process is closed before the error returns so no resources leak.

## Window references

Tools that target a window accept `window` in three forms:

| Form  | Example                         | Match rule                                  |
| ----- | ------------------------------- | ------------------------------------------- |
| index | `0`                             | `app.windows()[index]`                      |
| URL   | `"/dashboard"` or `"^https://"` | `url.includes` first, then `RegExp.test`    |
| title | `"Settings"`                    | Same as URL, applied to `await win.title()` |

If no `window` is supplied, the first window is used. Resolution always
walks the _current_ window list, so callers do not need to refresh
indices after navigation.

## Lifetime guarantees

- **Crashes** — the manager subscribes to `app.on('close')` and marks
  the session as `closed`. The next tool call against the id returns
  `session_not_found`.
- **Server shutdown** — `SIGINT`/`SIGTERM` triggers `closeAll()`, which
  closes every Electron process with a 5-second per-app deadline. The
  process exits with code 130 (SIGINT) or 143 (SIGTERM).
- **Force close** — `electron_close` with `force: true` calls
  `app.close()` first and falls back to `SIGKILL` after 2s if the app
  is still running.

## Multi-session workflows

Sessions are isolated. An agent orchestrating a regression suite can:

1. Launch `app-A` and `app-B` in parallel.
2. Drive each through `electron_*` tools using their respective
   `sessionId`s.
3. Issue `electron_list_sessions` for a snapshot at any point.
4. Close both with `electron_close` when done.

Concurrent calls against the same session interleave at the Playwright
level — be mindful of races (e.g. two `electron_fill` calls on the same
selector). Use `electron_wait_for_window` and per-step verification to
keep workflows deterministic.
