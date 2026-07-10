import { describe, expect, test } from "bun:test"
import { validate } from "../src/validate"

describe("validate", () => {
  test("defaults applied", () => {
    const v = validate({ target: "http://x/health" })
    expect(v.type).toBe("http")
    expect(v.timeoutMs).toBe(60000)
    expect(v.intervalMs).toBe(2000)
  })
  test("interval greater than timeout throws", () => {
    expect(() => validate({ target: "http://x", timeout: 5, interval: 10 })).toThrow()
  })
  test("non-positive timeout throws", () => {
    expect(() => validate({ target: "http://x", timeout: 0 })).toThrow()
  })
  test("non-positive interval throws", () => {
    expect(() => validate({ target: "http://x", interval: 0 })).toThrow()
  })
  test("exit_code on http target throws", () => {
    expect(() => validate({ target: "http://x", expect: { exit_code: 0 } })).toThrow()
  })
  test("json_match on command target throws", () => {
    expect(() => validate({ target: "test -f /tmp/x", expect: { json_match: { a: "b" } } })).toThrow()
  })
  test("status on tcp target throws", () => {
    expect(() => validate({ target: "localhost:5432", expect: { status: 200 } })).toThrow()
  })
})
