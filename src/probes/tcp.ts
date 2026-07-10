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
