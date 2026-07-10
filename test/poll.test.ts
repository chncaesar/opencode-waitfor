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
