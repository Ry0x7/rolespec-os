import { logger } from "@/shared/lib/logger"
import { executeIntakeRun } from "./intake-run.service"

const log = logger("intake/schedule")

/**
 * `after` keeps the work attached to the request's lifetime, which matters on
 * serverless where a detached promise can be frozen. Tests replace this module
 * with a synchronous fake, so no route needs to know about the scheduler.
 */
export async function scheduleIntakeRun(runId: string): Promise<void> {
  const { after } = await import("next/server")
  after(async () => {
    try {
      await executeIntakeRun(runId)
    } catch (error) {
      log.error("Intake run failed unexpectedly", { err: error, runId })
    }
  })
}
