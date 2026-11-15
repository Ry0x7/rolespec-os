import { logger } from "@/shared/lib/logger"

const log = logger("workflows/schedule")

/**
 * `after` keeps the first tick attached to the request's lifetime. Later ticks
 * come from the in-process worker started by `instrumentation.ts`, so the
 * desktop app needs no cron, daemon or cloud queue. Tests replace this module;
 * routes never depend on the scheduler directly.
 */
export async function scheduleWorkflowTick(): Promise<void> {
  const { after } = await import("next/server")
  after(async () => {
    try {
      const { tickWorkflowWorker } = await import("./workflow-worker")
      await tickWorkflowWorker()
    } catch (error) {
      log.error("Scheduled workflow tick failed", { err: error })
    }
  })
}
