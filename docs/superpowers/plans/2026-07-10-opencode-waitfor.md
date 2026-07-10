# opencode-waitfor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `opencode-waitfor`, a zero-dependency opencode plugin exposing a single `wait_for` tool that polls an HTTP/TCP/command target until ready or timeout and returns a structured result.

**Architecture:** A generic `poll` loop drives pluggable `Probe` closures (one per condition type). The tool infers the condition type from the `target` string, builds the matching probe, runs it through `poll` honoring the session `AbortSignal`, and formats a success/timeout result. Every module is pure or thinly wraps a Node/Bun built-in so it is unit-testable in isolation.

**Tech Stack:** TypeScript, Bun (runtime + `bun test`), `@opencode-ai/plugin` (peer, types + `tool` helper), `zod` (arg schema, via `tool.schema`). No runtime dependencies.

## Global Constraints

- Zero runtime dependencies. Only Node/Bun built-ins (`fetch`, `node:net`, `node:child_process`, `node:timers`) plus `@opencode-ai/plugin` and `zod` as peer/dev.
- Tool name is exactly `wait_for`.
- Type inference from `target`: contains `://` → `http`; else matches `^[\w.-]+:\d+$` → `tcp`; else → `command`. HTTP targets MUST include a scheme.
- Defaults: `timeout` = 60 (seconds), `interval` = 2 (seconds). Output/body/stdout truncation cap = 2048 bytes.
- `json_match` values compared as `String(resolved) === String(expected)`. No `${VAR}` expansion. Dot-path grammar = object keys + numeric array indices separated by `.`.
- Timeout is a non-throwing outcome (`success:false`). Invalid input throws.
- Honor `context.abort` (AbortSignal) — abort stops polling promptly.
- License MIT. Published to npm as `opencode-waitfor`.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts` (temporary empty stub, replaced in Task 9)

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable/testable project. `bun test` runs; `bunx tsc --noEmit` passes.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "opencode-waitfor",
  "version": "0.1.0",
  "description": "opencode plugin: a wait_for tool that polls HTTP/TCP/command targets until ready or timeout.",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src", "README.md", "LICENSE"],
  "keywords": ["opencode", "opencode-plugin", "wait", "healthcheck", "poll"],
  "license": "MIT",
  "peerDependencies": { "@opencode-ai/plugin": "*", "zod": "*" },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.17.18",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "zod": "^3.23.0"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "bun-types"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
*.tgz
dist/
```

- [ ] **Step 4: Create temporary `src/index.ts` stub**

```ts
export {}
```

- [ ] **Step 5: Install dev dependencies**

Run: `bun install`
Expected: creates `bun.lock` and `node_modules/`, exits 0.

- [ ] **Step 6: Verify typecheck passes on empty project**

Run: `bunx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .gitignore src/index.ts bun.lock
git commit -m "chore: scaffold opencode-waitfor project"
```

---

### Task 2: Dot-path resolver

**Files:**
- Create: `src/dotpath.ts`
- Test: `test/dotpath.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolve(obj: unknown, path: string): unknown` — walks object keys and numeric array indices separated by `.`. Returns `undefined` for any missing/invalid segment.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { resolve } from "../src/dotpath"

describe("resolve", () => {
  test("top-level key", () => {
    expect(resolve({ status: "ok" }, "status")).toBe("ok")
  })
  test("nested keys", () => {
    expect(resolve({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1)
  })
  test("numeric array index", () => {
    expect(resolve({ data: { items: [{ id: 7 }] } }, "data.items.0.id")).toBe(7)
  })
  test("missing key returns undefined", () => {
    expect(resolve({ a: 1 }, "a.b.c")).toBeUndefined()
  })
  test("index into non-array returns undefined", () => {
    expect(resolve({ a: 1 }, "a.0")).toBeUndefined()
  })
  test("null/undefined root returns undefined", () => {
    expect(resolve(null, "a")).toBeUndefined()
    expect(resolve(undefined, "a")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/dotpath.test.ts`
Expected: FAIL — cannot find module `../src/dotpath` / `resolve` is not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/dotpath.ts
export function resolve(obj: unknown, path: string): unknown {
  const segments = path.split(".")
  let current: unknown = obj
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(seg)) return undefined
      current = current[Number(seg)]
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[seg]
    } else {
      return undefined
    }
  }
  return current
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/dotpath.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/dotpath.ts test/dotpath.test.ts
git commit -m "feat: add dot-path resolver"
```

---

### Task 3: Type inference

**Files:**
- Create: `src/infer.ts`
- Test: `test/infer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type WaitType = "http" | "tcp" | "command"`
  - `inferType(target: string): WaitType`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { inferType } from "../src/infer"

describe("inferType", () => {
  test("http scheme -> http", () => {
    expect(inferType("http://localhost:3000/api/health")).toBe("http")
    expect(inferType("https://example.com")).toBe("http")
  })
  test("host:port -> tcp", () => {
    expect(inferType("localhost:3000")).toBe("tcp")
    expect(inferType("192.168.88.91:5432")).toBe("tcp")
    expect(inferType("db.internal:6379")).toBe("tcp")
  })
  test("schemeless url with path -> command (sharp edge)", () => {
    expect(inferType("localhost:3000/api/health")).toBe("command")
  })
  test("shell command -> command", () => {
    expect(inferType("docker inspect -f '{{.State.Health.Status}}' pg")).toBe("command")
    expect(inferType("test -f /tmp/ready")).toBe("command")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/infer.test.ts`
Expected: FAIL — `inferType` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infer.ts
export type WaitType = "http" | "tcp" | "command"

export function inferType(target: string): WaitType {
  if (target.includes("://")) return "http"
  if (/^[\w.-]+:\d+$/.test(target)) return "tcp"
  return "command"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/infer.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/infer.ts test/infer.test.ts
git commit -m "feat: add target type inference"
```

---

### Task 4: Generic poll loop

**Files:**
- Create: `src/poll.ts`
- Test: `test/poll.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface ProbeResult { ok: boolean; snapshot: Record<string, unknown> }`
  - `export type Probe = (signal: AbortSignal) => Promise<ProbeResult>`
  - `export interface PollResult { success: boolean; attempts: number; elapsedMs: number; last: Record<string, unknown> }`
  - `poll(opts: { probe: Probe; timeoutMs: number; intervalMs: number; signal?: AbortSignal }): Promise<PollResult>`

Behavior: attempt immediately, then every `intervalMs` until the probe returns `ok:true` or scheduling another attempt would exceed `timeoutMs` (i.e. stop when `elapsed + intervalMs > timeoutMs`). An overall timeout timer (and any external `signal`) aborts the signal passed into the probe so long-running probes are cut off. `last` always carries the final attempt's snapshot.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { poll, type Probe } from "../src/poll"

function countingProbe(succeedOnAttempt: number): Probe {
  let n = 0
  return async () => {
    n++
    return { ok: n >= succeedOnAttempt, snapshot: { attempt: n } }
  }
}

describe("poll", () => {
  test("succeeds on the Nth attempt", async () => {
    const r = await poll({ probe: countingProbe(3), timeoutMs: 1000, intervalMs: 10 })
    expect(r.success).toBe(true)
    expect(r.attempts).toBe(3)
    expect(r.last).toEqual({ attempt: 3 })
  })

  test("times out and returns last snapshot", async () => {
    const probe: Probe = async () => ({ ok: false, snapshot: { note: "never" } })
    const r = await poll({ probe, timeoutMs: 45, intervalMs: 10 })
    expect(r.success).toBe(false)
    expect(r.attempts).toBeGreaterThanOrEqual(1)
    expect(r.last).toEqual({ note: "never" })
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  test("pre-aborted signal stops promptly", async () => {
    const ac = new AbortController()
    ac.abort()
    const probe: Probe = async () => ({ ok: false, snapshot: {} })
    const r = await poll({ probe, timeoutMs: 1000, intervalMs: 10, signal: ac.signal })
    expect(r.success).toBe(false)
  })

  test("probe receives an abort signal aborted at overall timeout", async () => {
    let sawAbort = false
    const probe: Probe = (signal) =>
      new Promise((res) => {
        signal.addEventListener("abort", () => {
          sawAbort = true
          res({ ok: false, snapshot: { aborted: true } })
        })
      })
    const r = await poll({ probe, timeoutMs: 30, intervalMs: 5 })
    expect(r.success).toBe(false)
    expect(sawAbort).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/poll.test.ts`
Expected: FAIL — `poll` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/poll.ts
export interface ProbeResult {
  ok: boolean
  snapshot: Record<string, unknown>
}
export type Probe = (signal: AbortSignal) => Promise<ProbeResult>
export interface PollResult {
  success: boolean
  attempts: number
  elapsedMs: number
  last: Record<string, unknown>
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((res) => {
    if (signal.aborted) return res()
    const onAbort = () => {
      clearTimeout(t)
      signal.removeEventListener("abort", onAbort)
      res()
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      res()
    }, ms)
    signal.addEventListener("abort", onAbort)
  })
}

export async function poll(opts: {
  probe: Probe
  timeoutMs: number
  intervalMs: number
  signal?: AbortSignal
}): Promise<PollResult> {
  const { probe, timeoutMs, intervalMs, signal: external } = opts
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener("abort", onExternalAbort)
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  let attempts = 0
  let last: Record<string, unknown> = {}

  try {
    while (true) {
      if (controller.signal.aborted) break
      attempts++
      const result = await probe(controller.signal)
      last = result.snapshot
      if (result.ok) {
        return { success: true, attempts, elapsedMs: Date.now() - start, last }
      }
      if (controller.signal.aborted) break
      const elapsed = Date.now() - start
      if (elapsed + intervalMs > timeoutMs) break
      await sleep(intervalMs, controller.signal)
    }
    return { success: false, attempts, elapsedMs: Date.now() - start, last }
  } finally {
    clearTimeout(timer)
    if (external) external.removeEventListener("abort", onExternalAbort)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/poll.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poll.ts test/poll.test.ts
git commit -m "feat: add generic poll loop"
```

---

### Task 5: HTTP probe

**Files:**
- Create: `src/probes/http.ts`
- Test: `test/http.test.ts`

**Interfaces:**
- Consumes: `Probe`, `ProbeResult` from `src/poll.ts`; `resolve` from `src/dotpath.ts`.
- Produces:
  - `export interface HttpExpect { status?: number | number[]; json_match?: Record<string, string> }`
  - `httpProbe(target: string, expect: HttpExpect | undefined, opts: { perAttemptMs: number; maxBytes: number }): Probe`

Behavior: `fetch(target)` with a per-attempt AbortController timing out at `perAttemptMs` (also aborts if the poll signal aborts). Success when the status matches (`expect.status` number/array, default any 2xx) AND every `json_match` dot-path stringifies equal to its expected value. Snapshot: `{ status, bodyPreview, error? }` with body truncated to `maxBytes`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { httpProbe } from "../src/probes/http"

let server: Server
let base = ""
let mode = "ok"

beforeAll(async () => {
  server = createServer((req, res) => {
    if (mode === "500") { res.statusCode = 500; res.end("boom"); return }
    res.statusCode = 200
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ status: "ok", version: "abc123" }))
  })
  await new Promise<void>((r) => server.listen(0, r))
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0
  base = `http://127.0.0.1:${port}`
})
afterAll(() => { server.close() })

const opts = { perAttemptMs: 1000, maxBytes: 2048 }
const sig = () => new AbortController().signal

describe("httpProbe", () => {
  test("2xx with no expect -> ok", async () => {
    mode = "ok"
    const r = await httpProbe(base, undefined, opts)(sig())
    expect(r.ok).toBe(true)
    expect(r.snapshot.status).toBe(200)
  })
  test("json_match all match -> ok", async () => {
    mode = "ok"
    const r = await httpProbe(base, { json_match: { status: "ok", version: "abc123" } }, opts)(sig())
    expect(r.ok).toBe(true)
  })
  test("json_match mismatch -> not ok", async () => {
    mode = "ok"
    const r = await httpProbe(base, { json_match: { version: "deadbeef" } }, opts)(sig())
    expect(r.ok).toBe(false)
  })
  test("explicit status mismatch -> not ok", async () => {
    mode = "500"
    const r = await httpProbe(base, { status: 200 }, opts)(sig())
    expect(r.ok).toBe(false)
    expect(r.snapshot.status).toBe(500)
  })
  test("connection refused -> not ok with error", async () => {
    const r = await httpProbe("http://127.0.0.1:1", undefined, opts)(sig())
    expect(r.ok).toBe(false)
    expect(r.snapshot.error).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/http.test.ts`
Expected: FAIL — `httpProbe` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/probes/http.ts
import type { Probe, ProbeResult } from "../poll"
import { resolve } from "../dotpath"

export interface HttpExpect {
  status?: number | number[]
  json_match?: Record<string, string>
}

function statusOk(status: number, expect: HttpExpect | undefined): boolean {
  if (!expect || expect.status === undefined) return status >= 200 && status < 300
  const wanted = Array.isArray(expect.status) ? expect.status : [expect.status]
  return wanted.includes(status)
}

export function httpProbe(
  target: string,
  expect: HttpExpect | undefined,
  opts: { perAttemptMs: number; maxBytes: number },
): Probe {
  return async (signal: AbortSignal): Promise<ProbeResult> => {
    const ac = new AbortController()
    const onAbort = () => ac.abort()
    if (signal.aborted) ac.abort()
    else signal.addEventListener("abort", onAbort)
    const timer = setTimeout(() => ac.abort(), opts.perAttemptMs)
    try {
      const res = await fetch(target, { signal: ac.signal })
      const text = await res.text()
      const bodyPreview = text.slice(0, opts.maxBytes)
      const snapshot: Record<string, unknown> = { status: res.status, bodyPreview }
      if (!statusOk(res.status, expect)) return { ok: false, snapshot }
      if (expect?.json_match) {
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          return { ok: false, snapshot: { ...snapshot, error: "response not JSON" } }
        }
        for (const [path, want] of Object.entries(expect.json_match)) {
          if (String(resolve(parsed, path)) !== String(want)) {
            return { ok: false, snapshot }
          }
        }
      }
      return { ok: true, snapshot }
    } catch (e) {
      return { ok: false, snapshot: { error: (e as Error).message } }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/http.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/probes/http.ts test/http.test.ts
git commit -m "feat: add HTTP probe"
```

---

### Task 6: TCP probe

**Files:**
- Create: `src/probes/tcp.ts`
- Test: `test/tcp.test.ts`

**Interfaces:**
- Consumes: `Probe`, `ProbeResult` from `src/poll.ts`.
- Produces: `tcpProbe(host: string, port: number, opts: { perAttemptMs: number }): Probe`

Behavior: attempt a TCP connection via `node:net`. Success = socket `connect` event. Snapshot: `{ connected: true }` on success; `{ connected: false, error }` on failure/timeout. Destroys the socket on abort or per-attempt timeout.

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:net"
import { tcpProbe } from "../src/probes/tcp"

let server: Server
let port = 0

beforeAll(async () => {
  server = createServer((s) => s.end())
  await new Promise<void>((r) => server.listen(0, r))
  const addr = server.address()
  port = typeof addr === "object" && addr ? addr.port : 0
})
afterAll(() => { server.close() })

const sig = () => new AbortController().signal

describe("tcpProbe", () => {
  test("open port -> connected", async () => {
    const r = await tcpProbe("127.0.0.1", port, { perAttemptMs: 1000 })(sig())
    expect(r.ok).toBe(true)
    expect(r.snapshot.connected).toBe(true)
  })
  test("closed port -> not connected with error", async () => {
    const r = await tcpProbe("127.0.0.1", 1, { perAttemptMs: 1000 })(sig())
    expect(r.ok).toBe(false)
    expect(r.snapshot.connected).toBe(false)
    expect(r.snapshot.error).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/tcp.test.ts`
Expected: FAIL — `tcpProbe` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/probes/tcp.ts
import { Socket } from "node:net"
import type { Probe, ProbeResult } from "../poll"

export function tcpProbe(
  host: string,
  port: number,
  opts: { perAttemptMs: number },
): Probe {
  return (signal: AbortSignal): Promise<ProbeResult> => {
    return new Promise<ProbeResult>((res) => {
      const socket = new Socket()
      let settled = false
      const done = (result: ProbeResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
        socket.destroy()
        res(result)
      }
      const onAbort = () => done({ ok: false, snapshot: { connected: false, error: "aborted" } })
      const timer = setTimeout(
        () => done({ ok: false, snapshot: { connected: false, error: "timeout" } }),
        opts.perAttemptMs,
      )
      if (signal.aborted) return onAbort()
      signal.addEventListener("abort", onAbort)
      socket.once("connect", () => done({ ok: true, snapshot: { connected: true } }))
      socket.once("error", (e) =>
        done({ ok: false, snapshot: { connected: false, error: (e as Error).message } }),
      )
      socket.connect(port, host)
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/tcp.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/probes/tcp.ts test/tcp.test.ts
git commit -m "feat: add TCP probe"
```

---

### Task 7: Command probe

**Files:**
- Create: `src/probes/command.ts`
- Test: `test/command.test.ts`

**Interfaces:**
- Consumes: `Probe`, `ProbeResult` from `src/poll.ts`.
- Produces:
  - `export interface CommandExpect { exit_code?: number }`
  - `commandProbe(command: string, expect: CommandExpect | undefined, opts: { cwd: string; maxBytes: number; timeoutMs: number }): Probe`

Behavior: run `command` through the shell via `node:child_process` `exec`. Success when the exit code equals `expect.exit_code` (default 0). Snapshot: `{ exitCode, stdoutPreview, stderrPreview }`, previews truncated to `maxBytes`. Kills the child on abort or `timeoutMs`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { commandProbe } from "../src/probes/command"

const opts = { cwd: process.cwd(), maxBytes: 2048, timeoutMs: 5000 }
const sig = () => new AbortController().signal

describe("commandProbe", () => {
  test("exit 0 command -> ok", async () => {
    const r = await commandProbe("exit 0", undefined, opts)(sig())
    expect(r.ok).toBe(true)
    expect(r.snapshot.exitCode).toBe(0)
  })
  test("exit 1 command -> not ok (default expect 0)", async () => {
    const r = await commandProbe("exit 1", undefined, opts)(sig())
    expect(r.ok).toBe(false)
    expect(r.snapshot.exitCode).toBe(1)
  })
  test("explicit non-zero exit_code match -> ok", async () => {
    const r = await commandProbe("exit 3", { exit_code: 3 }, opts)(sig())
    expect(r.ok).toBe(true)
  })
  test("captures stdout", async () => {
    const r = await commandProbe("echo hello", undefined, opts)(sig())
    expect(r.ok).toBe(true)
    expect(String(r.snapshot.stdoutPreview)).toContain("hello")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/command.test.ts`
Expected: FAIL — `commandProbe` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/probes/command.ts
import { exec } from "node:child_process"
import type { Probe, ProbeResult } from "../poll"

export interface CommandExpect {
  exit_code?: number
}

export function commandProbe(
  command: string,
  expect: CommandExpect | undefined,
  opts: { cwd: string; maxBytes: number; timeoutMs: number },
): Probe {
  const wanted = expect?.exit_code ?? 0
  return (signal: AbortSignal): Promise<ProbeResult> => {
    return new Promise<ProbeResult>((res) => {
      const child = exec(
        command,
        { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          signal.removeEventListener("abort", onAbort)
          const code =
            err && typeof (err as { code?: unknown }).code === "number"
              ? (err as { code: number }).code
              : err
                ? 1
                : 0
          const snapshot = {
            exitCode: code,
            stdoutPreview: String(stdout).slice(0, opts.maxBytes),
            stderrPreview: String(stderr).slice(0, opts.maxBytes),
          }
          res({ ok: code === wanted, snapshot })
        },
      )
      const onAbort = () => child.kill()
      if (signal.aborted) child.kill()
      else signal.addEventListener("abort", onAbort)
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/command.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/probes/command.ts test/command.test.ts
git commit -m "feat: add command probe"
```

---

### Task 8: Result formatter

**Files:**
- Create: `src/format.ts`
- Test: `test/format.test.ts`

**Interfaces:**
- Consumes: `WaitType` from `src/infer.ts`; `PollResult` from `src/poll.ts`.
- Produces: `formatResult(input: { type: WaitType; target: string; poll: PollResult }): { title: string; output: string; metadata: Record<string, unknown> }`

Behavior: build a one-line `title`, a human-readable `output` string, and a `metadata` object with `{ success, reason?, type, target, elapsed_seconds, attempts, last }`. `reason` is `"timeout"` when `poll.success` is false. `elapsed_seconds` = `poll.elapsedMs / 1000` rounded to 2 decimals.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { formatResult } from "../src/format"

describe("formatResult", () => {
  test("success payload", () => {
    const r = formatResult({
      type: "http",
      target: "http://x/health",
      poll: { success: true, attempts: 2, elapsedMs: 3400, last: { status: 200 } },
    })
    expect(r.metadata.success).toBe(true)
    expect(r.metadata.reason).toBeUndefined()
    expect(r.metadata.type).toBe("http")
    expect(r.metadata.elapsed_seconds).toBe(3.4)
    expect(r.metadata.attempts).toBe(2)
    expect(r.title.toLowerCase()).toContain("ready")
  })
  test("timeout payload carries reason and last", () => {
    const r = formatResult({
      type: "command",
      target: "exit 1",
      poll: { success: false, attempts: 5, elapsedMs: 60000, last: { exitCode: 1 } },
    })
    expect(r.metadata.success).toBe(false)
    expect(r.metadata.reason).toBe("timeout")
    expect(r.metadata.last).toEqual({ exitCode: 1 })
    expect(r.output.toLowerCase()).toContain("timed out")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/format.test.ts`
Expected: FAIL — `formatResult` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/format.ts
import type { WaitType } from "./infer"
import type { PollResult } from "./poll"

export function formatResult(input: {
  type: WaitType
  target: string
  poll: PollResult
}): { title: string; output: string; metadata: Record<string, unknown> } {
  const { type, target, poll } = input
  const elapsed_seconds = Math.round((poll.elapsedMs / 1000) * 100) / 100
  const metadata: Record<string, unknown> = {
    success: poll.success,
    type,
    target,
    elapsed_seconds,
    attempts: poll.attempts,
    last: poll.last,
  }
  if (!poll.success) metadata.reason = "timeout"

  const title = poll.success
    ? `${type} target ready after ${elapsed_seconds}s`
    : `${type} target NOT ready (timed out after ${elapsed_seconds}s)`
  const output = poll.success
    ? `Target "${target}" became ready after ${poll.attempts} attempt(s), ${elapsed_seconds}s.\nLast observation: ${JSON.stringify(poll.last)}`
    : `Timed out waiting for "${target}" after ${poll.attempts} attempt(s), ${elapsed_seconds}s.\nLast observation: ${JSON.stringify(poll.last)}`

  return { title, output, metadata }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/format.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts test/format.test.ts
git commit -m "feat: add result formatter"
```

---

### Task 9: Tool wiring, validation, and dispatch

**Files:**
- Modify: `src/index.ts` (replace the Task 1 stub)
- Create: `src/validate.ts`
- Test: `test/validate.test.ts`
- Test: `test/integration.test.ts`

**Interfaces:**
- Consumes: `inferType`/`WaitType` (`src/infer.ts`), `poll` (`src/poll.ts`), `httpProbe`/`HttpExpect` (`src/probes/http.ts`), `tcpProbe` (`src/probes/tcp.ts`), `commandProbe`/`CommandExpect` (`src/probes/command.ts`), `formatResult` (`src/format.ts`); `tool`, `Plugin` from `@opencode-ai/plugin`.
- Produces:
  - `src/validate.ts`: `export interface WaitArgs { target: string; timeout?: number; interval?: number; expect?: { status?: number | number[]; json_match?: Record<string, string>; exit_code?: number } }` and `validate(args: WaitArgs): { type: WaitType; timeoutMs: number; intervalMs: number }` — throws `Error` on invalid input.
  - `src/index.ts`: default export `Plugin` registering the `wait_for` tool.

Validation rules (throw `Error` with a clear message):
- `timeout` (after default 60) must be > 0; `interval` (after default 2) must be > 0; `interval` must be ≤ `timeout`.
- `expect.exit_code` present but inferred type ≠ `command` → throw.
- `expect.status` or `expect.json_match` present but inferred type ≠ `http` → throw.

- [ ] **Step 1: Write the failing validation test**

```ts
import { describe, expect, test } from "bun:test"
import { validate } from "../src/validate"

describe("validate", () => {
  test("defaults applied", () => {
    const v = validate({ target: "http://x/health" })
    expect(v.type).toBe("http")
    expect(v.timeoutMs).toBe(60000)
    expect(v.intervalMs).toBe(2000)
  })
  test("interval greater than timeout throws", () => {
    expect(() => validate({ target: "http://x", timeout: 5, interval: 10 })).toThrow()
  })
  test("non-positive timeout throws", () => {
    expect(() => validate({ target: "http://x", timeout: 0 })).toThrow()
  })
  test("exit_code on http target throws", () => {
    expect(() => validate({ target: "http://x", expect: { exit_code: 0 } })).toThrow()
  })
  test("json_match on command target throws", () => {
    expect(() => validate({ target: "test -f /tmp/x", expect: { json_match: { a: "b" } } })).toThrow()
  })
  test("status on tcp target throws", () => {
    expect(() => validate({ target: "localhost:5432", expect: { status: 200 } })).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/validate.test.ts`
Expected: FAIL — `validate` not defined.

- [ ] **Step 3: Write `src/validate.ts`**

```ts
// src/validate.ts
import { inferType, type WaitType } from "./infer"

export interface WaitArgs {
  target: string
  timeout?: number
  interval?: number
  expect?: {
    status?: number | number[]
    json_match?: Record<string, string>
    exit_code?: number
  }
}

export function validate(args: WaitArgs): {
  type: WaitType
  timeoutMs: number
  intervalMs: number
} {
  const timeout = args.timeout ?? 60
  const interval = args.interval ?? 2
  if (timeout <= 0) throw new Error("wait_for: timeout must be > 0 seconds")
  if (interval <= 0) throw new Error("wait_for: interval must be > 0 seconds")
  if (interval > timeout) throw new Error("wait_for: interval must be <= timeout")

  const type = inferType(args.target)
  const e = args.expect
  if (e) {
    if (e.exit_code !== undefined && type !== "command") {
      throw new Error(`wait_for: expect.exit_code is only valid for command targets (inferred: ${type})`)
    }
    if ((e.status !== undefined || e.json_match !== undefined) && type !== "http") {
      throw new Error(`wait_for: expect.status/json_match are only valid for http targets (inferred: ${type})`)
    }
  }
  return { type, timeoutMs: timeout * 1000, intervalMs: interval * 1000 }
}
```

- [ ] **Step 4: Run validation test to verify it passes**

Run: `bun test test/validate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `src/index.ts`**

```ts
// src/index.ts
import { type Plugin, tool } from "@opencode-ai/plugin"
import { formatResult } from "./format"
import { poll, type Probe } from "./poll"
import { commandProbe } from "./probes/command"
import { httpProbe } from "./probes/http"
import { tcpProbe } from "./probes/tcp"
import { validate, type WaitArgs } from "./validate"

const MAX_BYTES = 2048

const WaitForPlugin: Plugin = async ({ directory }) => {
  return {
    tool: {
      wait_for: tool({
        description:
          "Poll a target until it is ready or a timeout elapses. " +
          "The condition type is inferred from `target`: a URL with scheme (http:// or https://) is polled over HTTP; " +
          "a bare host:port is polled as a TCP connection; anything else is run as a shell command. " +
          "Use this instead of writing manual sleep/curl loops. Returns success or a timeout result with the last observed state. " +
          "Examples: wait_for a dev server (http://localhost:3000), a deployed /health version (target http://host/health, expect.json_match {status: ok, version: <sha>}), " +
          "a database port (localhost:5432), or docker health (target: docker inspect -f '{{.State.Health.Status}}' pg | grep -q healthy).",
        args: {
          target: tool.schema
            .string()
            .describe("URL (with scheme), host:port, or a shell command."),
          timeout: tool.schema
            .number()
            .positive()
            .optional()
            .describe("Total seconds to wait. Default 60."),
          interval: tool.schema
            .number()
            .positive()
            .optional()
            .describe("Seconds between attempts. Default 2."),
          expect: tool.schema
            .object({
              status: tool.schema
                .union([tool.schema.number(), tool.schema.array(tool.schema.number())])
                .optional()
                .describe("HTTP only: acceptable status code(s). Default any 2xx."),
              json_match: tool.schema
                .record(tool.schema.string(), tool.schema.string())
                .optional()
                .describe("HTTP only: dot-path -> expected value (compared as strings)."),
              exit_code: tool.schema
                .number()
                .optional()
                .describe("Command only: required exit code. Default 0."),
            })
            .optional(),
        },
        async execute(args, context) {
          const { type, timeoutMs, intervalMs } = validate(args as WaitArgs)
          const perAttemptMs = Math.min(intervalMs, 10000)

          let probe: Probe
          if (type === "http") {
            probe = httpProbe(args.target, args.expect, { perAttemptMs, maxBytes: MAX_BYTES })
          } else if (type === "tcp") {
            const m = args.target.match(/^([\w.-]+):(\d+)$/)!
            probe = tcpProbe(m[1], Number(m[2]), { perAttemptMs })
          } else {
            probe = commandProbe(args.target, args.expect, {
              cwd: context.directory ?? directory,
              maxBytes: MAX_BYTES,
              timeoutMs,
            })
          }

          const result = await poll({ probe, timeoutMs, intervalMs, signal: context.abort })
          return formatResult({ type, target: args.target, poll: result })
        },
      }),
    },
  }
}

export default WaitForPlugin
```

- [ ] **Step 6: Write the integration test**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import WaitForPlugin from "../src/index"

async function getTool() {
  const hooks = await WaitForPlugin(
    { directory: process.cwd(), worktree: process.cwd() } as never,
    undefined,
  )
  return hooks.tool!.wait_for
}
const ctx = () =>
  ({ directory: process.cwd(), abort: new AbortController().signal }) as never

let server: Server
let base = ""
beforeAll(async () => {
  server = createServer((_req, res) => {
    res.statusCode = 200
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ status: "ok", version: "abc123" }))
  })
  await new Promise<void>((r) => server.listen(0, r))
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0
  base = `http://127.0.0.1:${port}`
})
afterAll(() => { server.close() })

describe("wait_for integration", () => {
  test("http json_match success", async () => {
    const t = await getTool()
    const r = await t.execute(
      { target: base, expect: { json_match: { status: "ok", version: "abc123" } } } as never,
      ctx(),
    )
    const meta = (r as { metadata: Record<string, unknown> }).metadata
    expect(meta.success).toBe(true)
    expect(meta.type).toBe("http")
  })

  test("command success", async () => {
    const t = await getTool()
    const r = await t.execute({ target: "exit 0" } as never, ctx())
    expect((r as { metadata: Record<string, unknown> }).metadata.success).toBe(true)
  })

  test("timeout returns success:false with last state", async () => {
    const t = await getTool()
    const r = await t.execute({ target: "exit 1", timeout: 1, interval: 1 } as never, ctx())
    const meta = (r as { metadata: Record<string, unknown> }).metadata
    expect(meta.success).toBe(false)
    expect(meta.reason).toBe("timeout")
  })

  test("invalid input throws", async () => {
    const t = await getTool()
    await expect(
      t.execute({ target: base, timeout: 1, interval: 5 } as never, ctx()),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 7: Run all tests + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: all test files PASS; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts src/validate.ts test/validate.test.ts test/integration.test.ts
git commit -m "feat: wire wait_for tool with validation and dispatch"
```

---

### Task 10: Packaging docs (README + LICENSE)

**Files:**
- Create: `README.md`
- Create: `LICENSE`

**Interfaces:**
- Consumes: nothing.
- Produces: publishable package documentation.

- [ ] **Step 1: Create `LICENSE`**

Write a standard MIT license text with year `2026` and the author name `zjc`.

- [ ] **Step 2: Create `README.md`**

Include, in order:
1. Title and one-sentence description.
2. Install: add `"opencode-waitfor"` to the `plugin` array in `opencode.json`, then restart opencode.
3. Tool reference table: `target`, `timeout`, `interval`, `expect.{status,json_match,exit_code}`.
4. The inference rule (http scheme / host:port / command) and the schemeless-URL sharp edge, verbatim from the spec §2 and §8.
5. Four copy-paste examples: dev server (`http://localhost:3000`), deploy `/health` version match (`json_match: {status: ok, version: <sha>}`), DB port (`localhost:5432`), docker health via command (`docker inspect -f '{{.State.Health.Status}}' pg | grep -q healthy`).
6. Result contract: success vs timeout `metadata` shape.
7. Known sharp edges (spec §8) and MIT license note.

- [ ] **Step 3: Verify package contents**

Run: `npm pack --dry-run`
Expected: lists `src/`, `README.md`, `LICENSE`, `package.json` — and does NOT list `test/` or `node_modules/`.

- [ ] **Step 4: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: add README and LICENSE"
```

---

## Self-Review

**Spec coverage:**
- §1 purpose/scope → Tasks 1–9 build the single `wait_for` tool; docker-health-via-command exercised in Task 9 description + Task 10 example. ✓
- §2 tool interface + inference → Task 3 (infer), Task 9 (args schema, host:port parse), schemeless edge tested in Task 3. ✓
- §2 expect semantics (status, json_match dot-path/string compare, no ${VAR}, exit_code) → Tasks 2, 5, 7, 9. ✓
- §3 polling/timeout (immediate attempt, interval, stop-scheduling rule, per-attempt timeout, abort) → Task 4 (loop + overall abort), Tasks 5–7 (per-attempt timeout via `perAttemptMs`/`timeoutMs`). ✓
- §4 result contract (non-throwing timeout, success/timeout/last, invalid-input throws, truncation) → Task 8 (format), Task 9 (validate throws), `maxBytes` truncation in Tasks 5/7. ✓
- §5 modules → one task per module; shared `Probe`/`ProbeResult`/`PollResult` live in `poll.ts` (consumed by probes), a minor consolidation from the spec's separate listing, no behavior change. ✓
- §6 testing → each task is TDD; local `http.Server`/`net.Server` used per plan. ✓
- §7 distribution → Task 1 `package.json` + Task 10 README/LICENSE + `npm pack --dry-run`. ✓
- §8 sharp edges → documented in Task 10 README. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. Task 10 steps 1–2 describe document contents rather than inlining full prose, which is appropriate for a README (content, not logic).

**Type consistency:** `Probe`/`ProbeResult`/`PollResult` defined in Task 4 and imported unchanged by Tasks 5–7, 9. `WaitType` defined in Task 3, imported by Tasks 8–9. `HttpExpect`/`CommandExpect` defined in Tasks 5/7; `src/index.ts` passes `args.expect` (superset object) to `httpProbe`/`commandProbe` whose signatures accept their respective optional-field subsets — compatible since extra fields are ignored and both are structurally optional. `validate` returns `{type,timeoutMs,intervalMs}` consumed exactly in Task 9. Consistent. ✓
