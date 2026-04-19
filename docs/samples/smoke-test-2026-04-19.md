# Smoke test — 2026-04-19

Smoke test run against `dist/server/index.js` on Node v24.14.1. Exercised
`initialize`, `tools/list`, and two `tools/call` paths (validation and
launch errors).

## stderr

```json
{"time":"2026-04-19T05:30:22.492Z","level":"info","msg":"electron-mcp starting","version":"0.1.0","transport":"stdio","node":"v24.14.1","maxSessions":5,"allowMainEvaluate":false,"allowlistEntries":0}
{"time":"2026-04-19T05:30:22.497Z","level":"info","msg":"electron-mcp ready","transport":"stdio"}
{"time":"2026-04-19T05:30:23.557Z","level":"info","msg":"tool.call.begin","tool":"electron_close","requestId":"req_1c2f5bf8bcc5"}
{"time":"2026-04-19T05:30:23.558Z","level":"error","msg":"tool.call.end","tool":"electron_close","requestId":"req_1c2f5bf8bcc5","durationMs":1,"ok":false,"code":"validation_error","message":"Invalid tool input"}
{"time":"2026-04-19T05:30:24.057Z","level":"info","msg":"tool.call.begin","tool":"electron_launch","requestId":"req_87569bc894e2"}
{"time":"2026-04-19T05:30:24.057Z","level":"info","msg":"launching electron app","tool":"electron_launch","executablePath":"/does/not/exist"}
{"time":"2026-04-19T05:30:24.058Z","level":"error","msg":"tool.call.end","tool":"electron_launch","requestId":"req_87569bc894e2","durationMs":1,"ok":false,"code":"launch_error","message":"Executable does not exist or is not accessible: /does/not/exist"}
{"time":"2026-04-19T05:30:25.058Z","level":"info","msg":"received shutdown signal","signal":"SIGTERM"}
```

## `tools/list` result

12 tools returned:

- `electron_launch`
- `electron_close`
- `electron_restart`
- `electron_list_sessions`
- `electron_list_windows`
- `electron_focus_window`
- `electron_wait_for_window`
- `electron_click`
- `electron_fill`
- `electron_evaluate_renderer`
- `electron_screenshot`
- `electron_evaluate_main`

## `electron_close` with empty `sessionId` — validation_error envelope

```json
{
  "ok": false,
  "error": {
    "code": "validation_error",
    "message": "Invalid tool input",
    "details": {
      "issues": [{ "path": "sessionId", "message": "Str..." }]
    }
  }
}
```

## `electron_launch` with `/does/not/exist` — launch_error envelope

```json
{
  "ok": false,
  "error": {
    "code": "launch_error",
    "message": "Executable does not exist or is not accessible: /does/not/exist",
    "details": { "executablePath": "/does/not/exist" }
  }
}
```
