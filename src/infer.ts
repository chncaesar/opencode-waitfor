export type WaitType = "http" | "tcp" | "command"

export function inferType(target: string): WaitType {
  if (target.includes("://")) return "http"
  if (/^[\w.-]+:\d+$/.test(target)) return "tcp"
  return "command"
}
