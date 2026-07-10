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
