import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import plugin from "../src/index"

const WaitForPlugin = plugin.server

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

describe("V2 plugin definition", () => {
  test("default export has id and setup, and setup registers wait_for", async () => {
    expect(plugin.id).toBe("opencode-waitfor")
    expect(typeof plugin.setup).toBe("function")
    const tools: any[] = []
    let disposed = false
    const cleanup = await plugin.setup({
      location: { directory: process.cwd() },
      tool: {
        transform: async (fn: (editor: any) => void) => {
          fn({ add: (t: unknown) => tools.push(t) })
          return { dispose: async () => void (disposed = true) }
        },
      },
    })
    expect(tools.map((t) => t.name)).toEqual(["wait_for"])
    const result = await tools[0].execute({ target: "true", timeout: 2, interval: 1 }, {})
    expect(result.content).toContain("became ready")
    await cleanup()
    expect(disposed).toBe(true)
  })
})
