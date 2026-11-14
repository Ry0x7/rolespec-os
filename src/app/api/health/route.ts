import { NextResponse } from "next/server"

import { prisma } from "@/shared/lib/prisma"

// A cached health check is a lie: the probe must hit the database every time.
export const dynamic = "force-dynamic"

/**
 * Liveness/readiness probe for container orchestration (Docker HEALTHCHECK,
 * load balancers). Public — see the `/api/health` entry in `src/proxy.ts`.
 * Returns 503 when the database is unreachable so a broken instance is pulled
 * out of rotation instead of serving errors.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: "ok" })
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 })
  }
}
