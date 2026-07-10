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
