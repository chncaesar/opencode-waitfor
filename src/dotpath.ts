export function resolve(obj: unknown, path: string): unknown {
  const segments = path.split(".")
  let current: unknown = obj
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(seg)) return undefined
      current = current[Number(seg)]
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[seg]
    } else {
      return undefined
    }
  }
  return current
}
