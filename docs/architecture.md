# Architecture

`electron-mcp` exposes a stable, agent-facing surface for driving Electron
applications. It is built around three layers:

```
┌────────────────────────────────────────────────────────────────┐
│  MCP transport  (stdio · HTTP)                                  │
└────────────────────────┬───────────────────────────────────────┘
                         │  JSON-RPC tool calls (CallTool)
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  Tool layer  (src/tools/*)                                      │
│   • lifecycle    launch / close / restart / list_sessions       │
│   • windows      list / focus / wait_for                        │
│   • renderer     click / fill / evaluate / screenshot           │
│   • main         evaluate_main                                  │
│   Each handler:                                                  │
│     1. parses input via Zod                                     │
│     2. resolves session / window                                │
│     3. delegates to the adapter                                 │
│     4. returns a structured `{ ok, … }` payload                 │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  Domain layer                                                   │
│   • SessionManager   in-memory registry of running apps         │
│   • ElectronAdapter  thin Playwright `_electron` wrapper        │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  Playwright + Electron                                          │
└────────────────────────────────────────────────────────────────┘
```

## Module map

| Path                                             | Purpose                                                  |
| ------------------------------------------------ | -------------------------------------------------------- |
| `src/server/index.ts`                            | Process entrypoint; signal handling, transport bootstrap |
| `src/server/mcp-server.ts`                       | Builds the MCP `Server`, dispatch, error normalization   |
| `src/tools/index.ts`                             | Tool registry — names, descriptions, JSON schemas        |
| `src/tools/{lifecycle,windows,renderer,main}.ts` | Per-category tool handlers                               |
| `src/session/session-manager.ts`                 | Session lifecycle and bookkeeping                        |
| `src/electron/electron-adapter.ts`               | Playwright integration (launch / windows / DOM)          |
| `src/schemas/index.ts`                           | Zod schemas (single source of truth for tool I/O)        |
| `src/errors/index.ts`                            | Error categories + `normalizeError()`                    |
| `src/logging/logger.ts`                          | Structured JSON logger writing to `stderr`               |
| `src/utils/*`                                    | Config loading, allowlist matching, ids, timeouts        |

## Why this shape?

**Tool registry as data.** `buildToolRegistry()` returns a flat array of
tool descriptors. The MCP server iterates that array to advertise tools
and route calls — there is no clever metaprogramming. Adding a new tool
is two changes: add a schema in `src/schemas`, append an entry to the
registry.

**Schemas first.** Every tool input and output is a Zod schema. The
schemas are reused for:

1. JSON Schema generation (advertised via `tools/list`)
2. Runtime validation in handlers (`Schema.parse(rawInput)`)
3. Static TypeScript types (`z.infer<typeof Schema>`)

This eliminates the common drift between docs, validation, and types.

**Errors are structured.** Every failure path raises an
`ElectronMcpError` subclass with a stable `code` (e.g. `selector_error`,
`session_not_found`). The server catches all throws, normalizes them
through `normalizeError`, and writes a `{ ok: false, error: { code, … } }`
payload back to the agent. Agents can dispatch on `code` without parsing
prose.

**Adapter abstracts Playwright.** Tool handlers never import
`playwright` directly — they go through `ElectronAdapter`. This keeps
the surface auditable and makes it possible to add tracing, recording,
or an alternative driver (e.g. a unified browser+electron layer) without
rewriting handlers.

**Session manager owns lifecycle.** The manager enforces the concurrent
session cap, listens for unexpected `close` events, and cleans up on
shutdown. Tool handlers obtain sessions via `sessions.get(id)` which
throws `SessionNotFoundError` for missing ids — no `null` checks needed
downstream.

## Concurrency & safety

- All handlers are async and isolated per `sessionId`. Concurrent calls
  to different sessions execute in parallel; the same session can race
  if multiple agents target it (Playwright's per-page locks generally
  serialize the relevant DOM operations).
- Every operation has a timeout. The default action timeout is 15s and
  is overridable per call via the `timeout` field.
- `electron_evaluate_main` is gated behind `ELECTRON_MCP_ALLOW_MAIN_EVALUATE`
  because main-process code has full Node.js access (filesystem, child
  processes, IPC). See [security.md](./security.md).

## stdout discipline

The stdio transport uses `process.stdout` for JSON-RPC framing. The
logger is hard-wired to `process.stderr`. **Do not** `console.log` — use
the logger or a guard that redirects to stderr. Anything written to
stdout that isn't JSON-RPC will corrupt the protocol stream and the
client will disconnect.

## Extending the server

To add a new tool:

1. Define `MyToolInputSchema` and (optionally) `MyToolOutputSchema` in
   `src/schemas/index.ts`.
2. Implement an async handler in the appropriate file under `src/tools/`.
   Use `ctx.sessions.get(input.sessionId)` to load the session and
   `ctx.adapter.…` for Playwright calls.
3. Register it in `buildToolRegistry()` (`src/tools/index.ts`) with a
   one-line description.
4. (Optional) Document it in `docs/tools.md`.

The MCP server, schema generation, and dispatch all pick the new tool
up automatically.
