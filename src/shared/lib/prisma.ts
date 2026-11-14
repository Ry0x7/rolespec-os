import { PrismaClient } from "@/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const globalForPrisma = globalThis as unknown as {
  prisma: InstanceType<typeof PrismaClient> | undefined
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL!
  const adapter = new PrismaPg(connectionString)
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

// Cached in every environment, not just development. The dev reason is HMR
// re-evaluating this module; the production reason is serverless — two route
// bundles in one instance would otherwise each open their own pg pool, with no
// shared cap on connections to Postgres.
globalForPrisma.prisma = prisma
