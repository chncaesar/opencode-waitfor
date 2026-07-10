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
