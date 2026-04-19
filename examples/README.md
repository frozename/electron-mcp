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

| File                        | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `01-list-tools.json`        | Discover every tool and its schema      |
| `02-launch.json`            | Launch an Electron app                  |
| `03-list-sessions.json`     | Enumerate running sessions              |
| `04-list-windows.json`      | List windows for a session              |
| `05-wait-for-window.json`   | Block until a URL-matching window opens |
| `06-click.json`             | Click `#submit`                         |
| `07-fill.json`              | Fill `#email`                           |
| `08-evaluate-renderer.json` | Count `.row` elements                   |
| `09-screenshot.json`        | PNG screenshot to disk                  |
| `10-evaluate-main.json`     | Read `app.getPath('userData')`          |
| `11-restart.json`           | Kill and relaunch a session             |
| `12-close.json`             | Close a session                         |

Replace `REPLACE_WITH_SESSION_ID` in files 3–12 with the id returned by
`02-launch.json`. Replace `/path/to/your/app` with a real executable
on your machine.

See [`workflows/login-and-screenshot.md`](./workflows/login-and-screenshot.md)
for an end-to-end example using the CLI helper.
