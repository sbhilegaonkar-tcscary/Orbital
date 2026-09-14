# ORBITAL agent sidecar

A small Node process that runs the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
and speaks the WebSocket protocol defined in `app/src/agent/protocol.ts`.

```
npm install          # once
../scripts/agent.ps1 # or ../scripts/agent.sh
```

Listens on `ws://localhost:8787/ws`. The agent's working directory is the
repo's `workspace/` folder, the same tree Jupyter serves.

## Auth

ORBITAL runs the agent on the **user's Claude login**, never an API key. This
process never reads, stores, forwards or prompts for a credential: `auth.mjs`
asks the Claude Code runtime bundled inside the SDK whether a working login
exists and, if not, hands the panel the command to create one:

```
npx -y @anthropic-ai/claude-code@latest auth login
```

The probe runs `claude auth status --json` first (free and instant); only if a
credential exists does it spend one no-tool turn confirming the credential is
still live, which is the only way to tell an expired OAuth session from a
missing one. The answer is cached for five minutes and re-probed on
`auth_check`.

## Layout

| File | Role |
|------|------|
| `server.mjs` | WebSocket server; one `query()` per connection at a time |
| `tools.mjs` | the seven `orbital_*` tools as an in-process MCP server |
| `auth.mjs` | login probe and `loginCommand` |
| `server.test.mjs` | protocol tests (`npm test`) against a stubbed SDK |

The sidecar performs no notebook operation itself. Every `orbital_*` call is
relayed to the browser as `tool_request`; `app/src/agent/executor.ts` runs it
through the notebook store so the user watches it happen, and answers with
`tool_result`. Mutating tools go through `canUseTool`, which forwards to the
panel as `permission_request`.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `ORBITAL_AGENT_PORT` | `8787` | listen port |
| `ORBITAL_WORKSPACE` | `../workspace` | the agent's `cwd` |
| `ORBITAL_AGENT_FAKE` | unset | `1` replaces the SDK with a scripted run (tests) |
| `ORBITAL_CLAUDE_BIN` | auto | override the Claude Code runtime the probe uses |

## Tests

```
npm test    # node --test
```

They start the real server with `ORBITAL_AGENT_FAKE=1` and drive it over a real
`ws` client, so the transport, the run lifecycle and the tool round-trip are
covered without a model or a login.
