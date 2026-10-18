/**
 * Dev-only seed: creates (or updates) an ADMIN test user for local screenshots
 * and manual QA.
 *
 * Usage: npx tsx scripts/seed-dev-admin.ts
 * Env:   DEV_ADMIN_PASSWORD (default "dev-admin-local-1234")
 *
 * Mirrors what registerAction / the Auth.js `createUser` event do:
 *  - bcrypt hash with 12 rounds into User.password
 *  - a PlayerProfile row
 */
import "dotenv/config"
import bcrypt from "bcryptjs"
import { prisma } from "@/shared/lib/prisma"

const EMAIL = "dev-admin@rolespec.local"
const NAME = "Dev Admin"

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a dev admin user in production")
  }

  const password = process.env.DEV_ADMIN_PASSWORD ?? "dev-admin-local-1234"
  const hashedPassword = await bcrypt.hash(password, 12)

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } })

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: { name: NAME, email: EMAIL, password: hashedPassword, role: "ADMIN" },
    update: { name: NAME, password: hashedPassword, role: "ADMIN" },
    select: { id: true, email: true, role: true },
  })

  // The credentials path never fires the adapter's createUser event, so the
  // player profile has to be created explicitly (dashboard reads it).
  await prisma.playerProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, onboardedAt: new Date() },
    update: {},
  })

  console.log(
    `${existing ? "Updated" : "Created"} dev admin: id=${user.id} email=${user.email} role=${user.role}`
  )
  console.log(`Password: ${password}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
