# opencode-waitfor

A zero-dependency opencode plugin that adds a `wait_for` tool to poll HTTP, TCP, or shell command targets until they are ready or a timeout elapses.

Replaces the manual `for i in $(seq 1 40); do sleep 3; curl ...; done` polling loops that agents write by hand.

## Install

Add `"opencode-waitfor"` to the `plugin` array in your `opencode.json`:

```json
{
  "plugin": ["opencode-waitfor"]
}
```

Then restart opencode.

## Tool: `wait_for`

Poll a target until it meets a readiness condition or the timeout expires. The condition type is **inferred from `target`**:

| `target` pattern | Condition type |
|---|---|
| Contains `://` (e.g. `http://localhost:3000`) | HTTP |
| Bare `host:port` (e.g. `localhost:5432`) | TCP |
| Anything else | Shell command |

### Args

| Arg | Type | Default | Description |
|---|---|---|---|
| `target` | string | *(required)* | URL (with scheme), host:port, or shell command |
| `timeout` | number | `60` | Total seconds to wait |
| `interval` | number | `2` | Seconds between attempts |
| `expect.status` | number \| number[] | any 2xx | HTTP only — acceptable status code(s) |
| `expect.json_match` | `{path: value}` | — | HTTP only — dot-path → expected value (compared as strings) |
| `expect.exit_code` | number | `0` | Command only — required exit code |

### Result

Returns `{ title, output, metadata }` with `metadata.{ success, type, target, elapsed_seconds, attempts, last, reason? }`.

On timeout, `metadata.success` is `false`, `metadata.reason` is `"timeout"`, and `metadata.last` contains the final probe's state (last HTTP status + body, last command exit + output, etc.) — enough to diagnose the failure without re-probing.

Invalid inputs (e.g. `interval > timeout`, `expect.exit_code` on an HTTP target) throw an error immediately.

## Examples

### Wait for a dev server

```
wait_for http://localhost:3000
```

### Deploy verify — health endpoint version check

After deploying commit `abc123`:

```
wait_for http://host/api/health
  timeout 30 interval 3
  expect { json_match: { status: ok, version: abc123 } }
```

### Wait for a database port

```
wait_for localhost:5432
  timeout 10
```

### Wait for Docker container health

```
wait_for 'docker inspect -f "{{.State.Health.Status}}" pg | grep -q healthy'
  timeout 60 interval 5
```

## Sharp edges

- **HTTP targets MUST include the scheme** (`http://` or `https://`). A schemeless URL like `localhost:3000/health` is treated as a shell command (and will fail to run).
- **`json_match` compares stringified values only** — no deep equality, numeric comparison, or regex. Exact string match.
- **`command` runs through the shell** and inherits the agent's environment/cwd. The caller is responsible for command safety.

## More OpenCode Tools

| Tool | Description |
|------|-------------|
| [opencode-db-clean](https://github.com/chncaesar/opencode-db-clean) | Reclaim disk space from bloated SQLite databases |
| [opencode-waitfor](https://github.com/chncaesar/opencode-waitfor) | `wait_for` for HTTP/TCP/command readiness checks |
| [opencode-session-reflection](https://github.com/chncaesar/opencode-session-reflection) | Qualitative review of past coding sessions |
| [opencode-fleet](https://github.com/chncaesar/opencode-fleet) | Multi-node remote OpenCode orchestration |

## License

MIT
