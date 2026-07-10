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
