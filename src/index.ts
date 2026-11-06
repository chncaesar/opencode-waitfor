import { type Plugin, tool } from "@opencode-ai/plugin"
import { formatResult } from "./format"
import { poll, type Probe } from "./poll"
import { commandProbe } from "./probes/command"
import { httpProbe } from "./probes/http"
import { tcpProbe } from "./probes/tcp"
import { validate, type WaitArgs } from "./validate"

const MAX_BYTES = 2048

const DESCRIPTION =
  "Poll a target until it is ready or a timeout elapses. " +
  "The condition type is inferred from `target`: a URL with scheme (http:// or https://) is polled over HTTP; " +
  "a bare host:port is polled as a TCP connection; anything else is run as a shell command. " +
  "Use this instead of writing manual sleep/curl loops. Returns success or a timeout result with the last observed state. " +
  "Examples: wait_for a dev server (http://localhost:3000), a deployed /health version (target http://host/health, expect.json_match {status: ok, version: <sha>}), " +
  "a database port (localhost:5432), or docker health (target: docker inspect -f '{{.State.Health.Status}}' pg | grep -q healthy)."

/** Shared by the V1 (`server`) and V2 (`setup`) entry points. */
async function runWaitFor(args: WaitArgs, cwd: string, signal: AbortSignal | undefined) {
  const { type, timeoutMs, intervalMs } = validate(args)
  const perAttemptMs = Math.min(intervalMs, 10000)

  let probe: Probe
  if (type === "http") {
    probe = httpProbe(args.target, args.expect, { perAttemptMs, maxBytes: MAX_BYTES })
  } else if (type === "tcp") {
    const m = args.target.match(/^([\w.-]+):(\d+)$/)!
    probe = tcpProbe(m[1], Number(m[2]), { perAttemptMs })
  } else {
    probe = commandProbe(args.target, args.expect, { cwd, maxBytes: MAX_BYTES, timeoutMs })
  }

  const result = await poll({ probe, timeoutMs, intervalMs, signal })
  return formatResult({ type, target: args.target, poll: result })
}

// JSON Schema input for the V2 host (which accepts JSON Schema, Effect Schema or Standard Schema).
const INPUT_SCHEMA = {
  type: "object",
  properties: {
    target: { type: "string", description: "URL (with scheme), host:port, or a shell command." },
    timeout: { type: "number", exclusiveMinimum: 0, description: "Total seconds to wait. Default 60." },
    interval: { type: "number", exclusiveMinimum: 0, description: "Seconds between attempts. Default 2." },
    expect: {
      type: "object",
      properties: {
        status: {
          anyOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
          description: "HTTP only: acceptable status code(s). Default any 2xx.",
        },
        json_match: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "HTTP only: dot-path -> expected value (compared as strings).",
        },
        exit_code: { type: "number", description: "Command only: required exit code. Default 0." },
      },
    },
  },
  required: ["target"],
} as const

/**
 * V2 entry point (OpenCode >= 2.x). The V2 loader requires a default export
 * with `id` and `setup`; it ignores `server`.
 */
async function setup(ctx: {
  location: { directory: string }
  tool: { transform: (fn: (editor: any) => void) => Promise<{ dispose: () => Promise<void> }> }
}) {
  const registration = await ctx.tool.transform((editor) => {
    editor.add({
      name: "wait_for",
      description: DESCRIPTION,
      input: INPUT_SCHEMA,
      options: { codemode: false },
      execute: async (args: WaitArgs, context: { signal?: AbortSignal }) => {
        const result = await runWaitFor(args, ctx.location.directory, context.signal)
        return { content: result.output, metadata: { title: result.title, ...result.metadata } }
      },
    })
  })
  return () => registration.dispose()
}

const WaitForPlugin: Plugin = async ({ directory }) => {
  return {
    tool: {
      wait_for: tool({
        description: DESCRIPTION,
        args: {
          target: tool.schema
            .string()
            .describe("URL (with scheme), host:port, or a shell command."),
          timeout: tool.schema
            .number()
            .positive()
            .optional()
            .describe("Total seconds to wait. Default 60."),
          interval: tool.schema
            .number()
            .positive()
            .optional()
            .describe("Seconds between attempts. Default 2."),
          expect: tool.schema
            .object({
              status: tool.schema
                .union([tool.schema.number(), tool.schema.array(tool.schema.number())])
                .optional()
                .describe("HTTP only: acceptable status code(s). Default any 2xx."),
              json_match: tool.schema
                .record(tool.schema.string(), tool.schema.string())
                .optional()
                .describe("HTTP only: dot-path -> expected value (compared as strings)."),
              exit_code: tool.schema
                .number()
                .optional()
                .describe("Command only: required exit code. Default 0."),
            })
            .optional(),
        },
        async execute(args, context) {
          return runWaitFor(args as WaitArgs, context.directory ?? directory, context.abort)
        },
      }),
    },
  }
}

export default { id: "opencode-waitfor", server: WaitForPlugin, setup }
