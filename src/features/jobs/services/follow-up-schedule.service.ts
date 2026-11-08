import type { ApplicationStatus } from "@/generated/prisma/enums"
import { localCalendarDateString } from "@/shared/lib/dates"

export interface FollowUpScheduleAdvice {
  recommendedDate: string // YYYY-MM-DD
  recommendedDaysFromNow: number
  reason: string
  isDeadlineUrgent: boolean
  deadlineNote?: string
}

export function recommendFollowUpSchedule(input: {
  status: ApplicationStatus | string
  dateApplied?: Date | string | null
  interviewDate?: Date | string | null
  deadline?: Date | string | null
  now?: Date
}): FollowUpScheduleAdvice {
  const now = input.now ?? new Date()

  // 1. Check deadline urgency
  let isDeadlineUrgent = false
  let deadlineNote: string | undefined = undefined

  if (input.deadline) {
    const deadlineDate = new Date(input.deadline)
    const daysUntilDeadline = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (daysUntilDeadline < 0) {
      isDeadlineUrgent = false
      deadlineNote = `Deadline passed on ${deadlineDate.toISOString().slice(0, 10)}.`
    } else if (daysUntilDeadline <= 2) {
      isDeadlineUrgent = true
      deadlineNote = `Application deadline closes in ${daysUntilDeadline === 0 ? "today" : `${daysUntilDeadline} day(s)`}!`
    } else {
      deadlineNote = `Deadline is in ${daysUntilDeadline} days (${deadlineDate.toISOString().slice(0, 10)}).`
    }
  }

  // 2. Recommend follow-up timing based on status
  let daysOffset = 7
  let reason = "Standard 7-day follow-up after applying."

  if (input.status === "INTERVIEW") {
    // If interview happened today or recently, 1-day thank you note
    if (input.interviewDate) {
      const interviewDate = new Date(input.interviewDate)
      const daysSinceInterview = Math.floor((now.getTime() - interviewDate.getTime()) / (1000 * 60 * 60 * 24))
      if (daysSinceInterview <= 1) {
        daysOffset = 1
        reason = "Send a thank-you note within 24 hours of the interview."
      } else {
        daysOffset = 5
        reason = "Check in on interview decision 5 business days later."
      }
    } else {
      daysOffset = 1
      reason = "Send post-interview thank you note within 24 hours."
    }
  } else if (input.status === "SCREENING") {
    daysOffset = 4
    reason = "Check in on recruiter screening results after 4-5 business days."
  } else if (input.status === "APPLIED") {
    daysOffset = 7
    reason = "Check in politely 1 week after submitting your application."
  } else if (input.status === "OFFER") {
    daysOffset = 3
    reason = "Respond to offer questions or updates within 3 days."
  }

  const targetDate = new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000)
  const recommendedDate = localCalendarDateString(targetDate)

  return {
    recommendedDate,
    recommendedDaysFromNow: daysOffset,
    reason,
    isDeadlineUrgent,
    deadlineNote,
  }
}
