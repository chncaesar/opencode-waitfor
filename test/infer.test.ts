import { describe, expect, test } from "bun:test"
import { inferType } from "../src/infer"

describe("inferType", () => {
  test("http scheme -> http", () => {
    expect(inferType("http://localhost:3000/api/health")).toBe("http")
    expect(inferType("https://example.com")).toBe("http")
  })
  test("host:port -> tcp", () => {
    expect(inferType("localhost:3000")).toBe("tcp")
    expect(inferType("192.168.88.91:5432")).toBe("tcp")
    expect(inferType("db.internal:6379")).toBe("tcp")
  })
  test("schemeless url with path -> command (sharp edge)", () => {
    expect(inferType("localhost:3000/api/health")).toBe("command")
  })
  test("shell command -> command", () => {
    expect(inferType("docker inspect -f '{{.State.Health.Status}}' pg")).toBe("command")
    expect(inferType("test -f /tmp/ready")).toBe("command")
  })
})
