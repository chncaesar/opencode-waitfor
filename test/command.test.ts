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
