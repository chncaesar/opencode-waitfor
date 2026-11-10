# opencode-waitfor

AI coding agents often write fragile polling loops by hand.

`opencode-waitfor` adds a small `wait_for` tool to OpenCode so agents can wait for HTTP endpoints, TCP ports, or shell commands until reality is actually ready.

It replaces loops like this:

```bash
for i in $(seq 1 40); do sleep 3; curl -s http://localhost:3000 && break; done
```

With a readiness primitive the agent can call directly:

```text
wait_for http://localhost:3000
```

## Install

Add it to your `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-waitfor"]
}
```

Pin a version with `"opencode-waitfor@0.2.1"` if you want reproducible setups. OpenCode installs the package on demand and reloads plugins when the config changes.

On OpenCode 1.x, use the `plugin` key instead of `plugins`, then restart opencode.

## Compatibility

One package covers both plugin APIs:

- **OpenCode 2.x** — V2 plugin entry (`id` + `setup`), registering `wait_for` as a tool.
- **OpenCode 1.x** — legacy server plugin export, same `wait_for` tool and arguments.

The tool surface is identical on both, so a config or skill written against `wait_for` keeps working across the upgrade.

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

## When to use this

Use `wait_for` when an agent needs to wait for a real readiness condition before continuing:

- A dev server must finish starting before browser or API tests run.
- A deployment health endpoint must return the expected version before smoke tests pass.
- A database, cache, or container port must accept connections before migration or test commands run.
- A shell command must report a ready state before the next step begins.

## When not to use this

Do not use `wait_for` as a substitute for proper application health checks. If the service has no meaningful readiness signal, add one first. A poller can only verify the condition it is given.

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

## License

MIT
