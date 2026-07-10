import type { WaitType } from "./infer"
import type { PollResult } from "./poll"

export function formatResult(input: {
  type: WaitType
  target: string
  poll: PollResult
}): { title: string; output: string; metadata: Record<string, unknown> } {
  const { type, target, poll } = input
  const elapsed_seconds = Math.round((poll.elapsedMs / 1000) * 100) / 100
  const metadata: Record<string, unknown> = {
    success: poll.success,
    type,
    target,
    elapsed_seconds,
    attempts: poll.attempts,
    last: poll.last,
  }
  if (!poll.success) metadata.reason = "timeout"

  const title = poll.success
    ? `${type} target ready after ${elapsed_seconds}s`
    : `${type} target NOT ready (timed out after ${elapsed_seconds}s)`
  const output = poll.success
    ? `Target "${target}" became ready after ${poll.attempts} attempt(s), ${elapsed_seconds}s.\nLast observation: ${JSON.stringify(poll.last)}`
    : `Timed out waiting for "${target}" after ${poll.attempts} attempt(s), ${elapsed_seconds}s.\nLast observation: ${JSON.stringify(poll.last)}`

  return { title, output, metadata }
}
