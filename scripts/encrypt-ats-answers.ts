/**
 * One-time backfill for answers written before at-rest encryption.
 *
 * Run with the same AUTH_SECRET (or ENCRYPTION_KEY) the app uses:
 *   npx tsx scripts/encrypt-ats-answers.ts
 *
 * It never prints answer values. Re-running is safe: encrypted rows are skipped.
 */
import { prisma } from "../src/shared/lib/prisma"
import {
  encryptAnswerValue,
  isEncryptedAnswerValue,
} from "../src/shared/lib/answer-crypto"

async function main(): Promise<void> {
  let answers = 0
  let reviewTasks = 0

  const answerRows = await prisma.atsAnswer.findMany({
    select: { id: true, value: true },
  })
  for (const row of answerRows) {
    if (isEncryptedAnswerValue(row.value)) continue
    await prisma.atsAnswer.update({
      where: { id: row.id },
      data: { value: encryptAnswerValue(row.value) },
    })
    answers += 1
  }

  const taskRows = await prisma.reviewTask.findMany({
    select: { id: true, answer: true },
  })
  for (const row of taskRows) {
    if (row.answer === null || row.answer === undefined) continue
    if (isEncryptedAnswerValue(row.answer)) continue
    await prisma.reviewTask.update({
      where: { id: row.id },
      data: { answer: encryptAnswerValue(row.answer) },
    })
    reviewTasks += 1
  }

  console.log(
    `Encrypted ${answers} stored answer(s) and ${reviewTasks} review answer(s).`
  )
}

main()
  .catch((error) => {
    console.error("Answer encryption backfill failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
