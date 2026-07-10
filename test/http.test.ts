import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { httpProbe } from "../src/probes/http"

let server: Server
let base = ""
let mode = "ok"

beforeAll(async () => {
  server = createServer((_req, res) => {
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
