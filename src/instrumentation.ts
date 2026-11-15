/**
 * Next calls `register` once when a server instance starts. The workflow worker
 * is started here so restart recovery (expired leases) happens without a cron
 * job or an external daemon — the packaged Tauri app runs the same server.
 *
 * Guarded by runtime: the edge bundle never touches PostgreSQL.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return

  const { startWorkflowWorker } = await import(
    "@/features/workflows/services/workflow-worker"
  )
  startWorkflowWorker()
}
