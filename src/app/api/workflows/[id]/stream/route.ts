import { resolveApiUserId } from "@/features/auth/api-auth"
import { getWorkflow } from "@/features/workflows/services/workflow.service"

export const dynamic = "force-dynamic"

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"])
const POLL_MS = 750
const MAX_POLLS = 480
const HEARTBEAT_EVERY = 20

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Live progress reads persisted rows, not an in-process emitter. A worker
 * restart, another tab or a reconnect therefore sees the same state, and a
 * dropped stream loses nothing.
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
  const initial = await getWorkflow(userId, id)
  if (!initial) {
    return new Response(JSON.stringify({ error: "Workflow not found", code: "NOT_FOUND" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })
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
          // The client already disconnected.
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
          const workflow = await getWorkflow(userId, id)
          if (!workflow) break
          const payload = JSON.stringify(workflow)
          if (payload !== previous) {
            previous = payload
            send("progress", payload)
          } else if (poll > 0 && poll % HEARTBEAT_EVERY === 0) {
            send("ping", "{}")
          }
          if (TERMINAL.has(workflow.state)) break
          await sleep(POLL_MS)
        }
      } catch (error) {
        if (!closed) {
          send(
            "error",
            JSON.stringify({ error: error instanceof Error ? error.message : "Stream stopped." })
          )
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
