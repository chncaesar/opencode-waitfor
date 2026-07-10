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
