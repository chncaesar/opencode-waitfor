# opencode-waitfor — Design

Date: 2026-07-10
Status: Approved (ready for implementation plan)

## 1. Purpose & scope

`opencode-waitfor` is a zero-dependency TypeScript opencode plugin that registers a
single custom tool, `wait_for`. It replaces the manual
`for i in $(seq 1 40); do sleep 3; curl ...; done` polling loops that the agent
currently writes by hand. The tool polls a target until a readiness condition is met
or a timeout elapses, then returns a structured result the agent can act on.

### Problem evidence
Analysis of local opencode session history (139 sessions) found the poll-until-ready
pattern is pervasive and hand-rolled:
- 215 `sleep` loops used as manual waits.
- 82 HTTP `/health` probes, frequently inside `seq`/`sleep` loops.
- 44 docker-health style checks (`docker ps | grep healthy`, `docker inspect`).
- 9 version/SHA match checks against a `/health` payload.
- 4 TCP port checks.

Each manual loop costs multiple agent turns (probe, sleep, probe again) and produces
noisy, non-deterministic transcripts. A single blocking tool call collapses this into
one turn with one clear result.

### In scope (v1)
- One tool, `wait_for`, one target, blocking until ready-or-timeout.
- Three condition types: HTTP, TCP, shell command.

### Out of scope (v1)
- Docker-health as a first-class condition type (covered via the `command` condition,
  e.g. `docker inspect --format '{{.State.Health.Status}}' <name>` matched on stdout).
- Background / detached waiting.
- Multiple simultaneous targets in one call.

## 2. Tool interface

Single tool `wait_for`. The condition type is **inferred from `target`**.

### Arguments
- `target` (string, required): the thing to wait on.
- `timeout` (number, seconds, default 60): total time budget for all attempts.
- `interval` (number, seconds, default 2): delay between attempts.
- `expect` (object, optional): condition assertions, interpreted per inferred type.

### Type inference rule
Applied to `target` in order:
1. Contains `://` → **HTTP** condition. HTTP targets MUST include the scheme
   (`http://` or `https://`).
2. Else matches `^[\w.-]+:\d+$` exactly (host:port, nothing after the port) → **TCP**
   condition.
3. Else → **shell command** condition.

Consequence: a schemeless URL like `localhost:3000/api/health` does NOT match TCP
(text after the port) and falls through to `command`, where it will fail to run. This
is intentional — HTTP targets must always carry a scheme. Documented as a known sharp
edge.

### `expect` semantics by type

HTTP:
- `status` (number or number[]): acceptable status code(s). Default: any 2xx.
- `json_match` (object): map of dot-path → expected value. The response body is parsed
  as JSON; each dot-path is resolved and compared to the expected value as a string.
  All entries must match. Example: `{ "status": "ok", "version": "abc123" }`.
  - Dot-path grammar: object keys and numeric array indices separated by `.`
    (e.g. `version`, `data.items.0.id`). Implemented in-house; no JSON-path library.
  - Values are compared with `String(resolved) === String(expected)`.
  - `${VAR}` shell-style expansion is NOT performed on expected values. The caller
    passes literals (the agent already knows the SHA it deployed).

command:
- `exit_code` (number, default 0): the target string is run through the shell; success
  when the process exits with this code.

TCP:
- No `expect` fields. Success = TCP connection established to `host:port`.

## 3. Polling & timeout model

- The tool attempts the condition immediately (attempt 1 at t=0), then repeats every
  `interval` seconds until either the condition succeeds or cumulative elapsed time
  would exceed `timeout`.
- Each individual attempt has a per-attempt timeout so a single hung probe cannot
  consume the whole budget:
  - HTTP: per-request timeout = `min(interval, 10s)` via `fetch` + `AbortController`.
  - TCP: connection attempt timeout = `min(interval, 10s)`.
  - command: per-run timeout = the remaining budget (a slow command legitimately eats
    the budget; it is the caller's condition).
- The loop stops scheduling a new attempt once `elapsed + interval > timeout`.
- Transient errors (connection refused, DNS failure, non-matching status, non-zero
  exit) are NOT terminal — they are just a failed attempt; the loop continues.

## 4. Result contract

The tool always returns a value (it does not throw on timeout). Timeout is a normal,
non-throwing outcome carrying diagnostics.

### On success
A human-readable summary string plus structured fields:
- `success: true`
- `type`: `"http" | "tcp" | "command"`
- `target`
- `elapsed_seconds`
- `attempts`
- `last`: type-specific snapshot of the successful probe (HTTP: status + parsed body
  or truncated text; command: exit code + truncated stdout/stderr; TCP: connected=true).

### On timeout
- `success: false`
- `reason: "timeout"`
- `type`, `target`, `elapsed_seconds`, `attempts`
- `last`: the most recently observed state — last HTTP status and truncated body, or
  last command exit code and truncated stdout/stderr, or last TCP connection error.
  This is what lets the agent diagnose *why* readiness never happened without
  re-probing manually.

### On invalid input
Throws (fails the tool call) for unusable arguments, e.g. `timeout <= 0`,
`interval <= 0`, `interval > timeout`, or an `expect` shape that contradicts the
inferred type (e.g. `json_match` on a TCP target). These are caller errors, not
runtime outcomes.

Output volume: captured bodies / command output are truncated (e.g. 2 KB) so a chatty
endpoint cannot flood the transcript.

## 5. Architecture & modules

Small, single-purpose modules, each independently testable:

- `src/index.ts` — plugin entry. Exports the default `Plugin` function returning
  `{ tool: { wait_for } }`. Defines the tool via the `@opencode-ai/plugin` `tool`
  helper: description, Zod arg schema, and `execute`.
- `src/infer.ts` — `inferType(target): "http" | "tcp" | "command"`. Pure, from §2 rule.
- `src/poll.ts` — the generic poll loop: given a `probe()` async function returning a
  `ProbeResult`, an `interval`, and a `timeout`, drives attempts, tracks
  elapsed/attempts, and returns the final `{success, attempts, elapsed, last}`.
- `src/probes/http.ts` — HTTP probe: `fetch` with `AbortController`, evaluate `status`
  and `json_match` (uses the dot-path resolver), capture last snapshot.
- `src/probes/tcp.ts` — TCP probe: `net.Socket` connect with timeout.
- `src/probes/command.ts` — command probe: `child_process` exec via the shell, compare
  exit code, capture stdout/stderr.
- `src/dotpath.ts` — `resolve(obj, path): unknown`. Pure, keys + numeric indices.
- `src/format.ts` — build the human-readable summary + structured payload from a poll
  result.

Runtime dependencies: none. Uses only Node/Bun built-ins (`fetch`, `node:net`,
`node:child_process`). `@opencode-ai/plugin` and `zod` are dev/peer types provided by
the host.

## 6. Testing strategy

Unit tests (no network) for the pure and mockable pieces:
- `inferType`: URL / host:port / command / schemeless-URL-is-command edge cases.
- `dotpath.resolve`: nested keys, array indices, missing paths.
- `poll`: with a fake probe that succeeds on attempt N — assert attempts/elapsed;
  a probe that never succeeds — assert timeout result and `last` propagation;
  boundary where `interval > remaining` stops scheduling.
- HTTP probe: against a local ephemeral `http.Server` returning scripted
  status/bodies — assert status match, json_match match/mismatch, body truncation.
- TCP probe: against a local `net.Server` that is opened/closed — assert connect
  success and refused-connection failure.
- command probe: `true` / `false` / a script that succeeds only after a sentinel file
  appears — assert exit-code handling and output capture.
- Invalid-input guards throw.

## 7. Distribution

- Published to npm as `opencode-waitfor`; installed via the `plugin` array in
  `opencode.json` (`"plugin": ["opencode-waitfor"]`).
- MIT licensed. README documents the tool, the inference rule, the schemeless-URL
  sharp edge, and copy-paste examples for the three condition types plus the
  `/health` version==sha deploy-verify case.

## 8. Known sharp edges (documented, not fixed in v1)
- Schemeless HTTP targets fall through to `command` and fail. Always include scheme.
- `json_match` compares stringified values; no numeric/deep-equality or regex matching.
- `command` condition runs through the shell and inherits the agent's environment and
  cwd; the caller is responsible for the command's own safety.
