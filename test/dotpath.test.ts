import { describe, expect, test } from "bun:test"
import { resolve } from "../src/dotpath"

describe("resolve", () => {
  test("top-level key", () => {
    expect(resolve({ status: "ok" }, "status")).toBe("ok")
  })
  test("nested keys", () => {
    expect(resolve({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1)
  })
  test("numeric array index", () => {
    expect(resolve({ data: { items: [{ id: 7 }] } }, "data.items.0.id")).toBe(7)
  })
  test("missing key returns undefined", () => {
    expect(resolve({ a: 1 }, "a.b.c")).toBeUndefined()
  })
  test("index into non-array returns undefined", () => {
    expect(resolve({ a: 1 }, "a.0")).toBeUndefined()
  })
  test("null/undefined root returns undefined", () => {
    expect(resolve(null, "a")).toBeUndefined()
    expect(resolve(undefined, "a")).toBeUndefined()
  })
})
