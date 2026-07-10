import { inferType, type WaitType } from "./infer"

export interface WaitArgs {
  target: string
  timeout?: number
  interval?: number
  expect?: {
    status?: number | number[]
    json_match?: Record<string, string>
    exit_code?: number
  }
}

export function validate(args: WaitArgs): {
  type: WaitType
  timeoutMs: number
  intervalMs: number
} {
  const timeout = args.timeout ?? 60
  const interval = args.interval ?? 2
  if (timeout <= 0) throw new Error("wait_for: timeout must be > 0 seconds")
  if (interval <= 0) throw new Error("wait_for: interval must be > 0 seconds")
  if (interval > timeout) throw new Error("wait_for: interval must be <= timeout")

  const type = inferType(args.target)
  const e = args.expect
  if (e) {
    if (e.exit_code !== undefined && type !== "command") {
      throw new Error(`wait_for: expect.exit_code is only valid for command targets (inferred: ${type})`)
    }
    if ((e.status !== undefined || e.json_match !== undefined) && type !== "http") {
      throw new Error(`wait_for: expect.status/json_match are only valid for http targets (inferred: ${type})`)
    }
  }
  return { type, timeoutMs: timeout * 1000, intervalMs: interval * 1000 }
}
