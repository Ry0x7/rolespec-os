import { resolveApiUserId } from "@/features/auth/api-auth"
import {
  getIntakeRun,
  IntakeRunError,
} from "@/features/intake/services/intake-run.service"

export const dynamic = "force-dynamic"

const TERMINAL = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"])
const POLL_MS = 750
const MAX_POLLS = 480 // ~6 minutes, matching the longest supported provider call
const HEARTBEAT_EVERY = 20

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Server-sent events over the same authorization as the detail endpoint. The
 * stream reads persisted progress rather than subscribing to an in-process
 * emitter, so it survives a worker restart and works across tabs.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  }
  const { id } = await params

  try {
    await getIntakeRun(userId, id)
  } catch (error) {
    if (error instanceof IntakeRunError) {
      return new Response(
        JSON.stringify({ error: error.message, code: "INTAKE_NOT_FOUND" }),
        { status: error.status, headers: { "content-type": "application/json" } }
      )
    }
    throw error
  }

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // Client already disconnected.
        }
      }
      const onAbort = () => close()
      req.signal.addEventListener("abort", onAbort)

      const send = (event: string, data: string) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
      }

      try {
        let previous = ""
        for (let poll = 0; poll < MAX_POLLS && !closed; poll += 1) {
          const run = await getIntakeRun(userId, id)
          const payload = JSON.stringify(run)
          if (payload !== previous) {
            previous = payload
            send("progress", payload)
          } else if (poll > 0 && poll % HEARTBEAT_EVERY === 0) {
            send("ping", "{}")
          }
          if (TERMINAL.has(run.status)) break
          await sleep(POLL_MS)
        }
      } catch (error) {
        if (!closed) {
          const message =
            error instanceof Error ? error.message : "Progress streaming stopped."
          send("error", JSON.stringify({ error: message }))
        }
      } finally {
        req.signal.removeEventListener("abort", onAbort)
        close()
      }
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}
