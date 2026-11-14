import { toCalendarDateString } from "@/shared/lib/dates"
import type { JobFormApplication } from "./job-form-application"

/** Fields the inline table lets you edit through `updateJobApplication`. */
export type EditableField =
  | "companyName"
  | "jobTitle"
  | "dateApplied"
  | "deadline"
  | "jobType"
  | "salary"
  | "location"
  | "jobLink"

/** Fields the blank "new row" can submit through `createJobApplication`. */
export type NewRowDraft = Record<EditableField | "status", string>

export const EMPTY_NEW_ROW_DRAFT: NewRowDraft = {
  companyName: "",
  jobTitle: "",
  status: "INTERESTED",
  dateApplied: "",
  deadline: "",
  jobType: "",
  salary: "",
  location: "",
  jobLink: "",
}

/**
 * `dateApplied` / `deadline` / `followUpAt` are calendar dates stored at UTC
 * midnight, so the date-input value is the raw UTC slice — never a
 * locale-shifted one. Same convention the detail page renders with, which is
 * what makes the dialog show the date the page shows.
 */
export function toDateInputValue(value: Date | null): string {
  if (!value) return ""
  return toCalendarDateString(value)
}

/**
 * `interviewDate` is a real instant, not a calendar date, and
 * `<input type="datetime-local">` both shows and submits *local* wall-clock time
 * — the action parses what comes back with `new Date("YYYY-MM-DDTHH:mm")`, which
 * is local too. Rendering the UTC slice here therefore reopened the form with
 * the time shifted by the reader's offset and saved that shift on every edit.
 */
export function toDateTimeInputValue(value: Date | null): string {
  if (!value) return ""
  const offsetMs = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16)
}

/** The string a cell input should show for `field` of `row`. */
export function getEditableCellValue(
  row: JobFormApplication,
  field: EditableField
): string {
  switch (field) {
    case "dateApplied":
      return toDateInputValue(row.dateApplied)
    case "deadline":
      return toDateInputValue(row.deadline)
    case "salary":
      return row.salary === null ? "" : String(row.salary)
    case "jobType":
      return row.jobType ?? ""
    default:
      return row[field] ?? ""
  }
}

/** Whitespace-only edits are not edits. */
export function hasCellChanged(next: string, previous: string): boolean {
  return next.trim() !== previous.trim()
}

/**
 * `updateJobApplication` only writes fields present in the FormData, so a cell
 * commit sends exactly one entry.
 */
export function buildFieldFormData(
  field: EditableField,
  value: string
): FormData {
  const formData = new FormData()
  formData.set(field, value.trim())
  return formData
}

/**
 * `dateApplied` is only stamped in `updateJobApplicationStatus`, on a transition
 * TO `APPLIED`. A row created straight as `APPLIED` would skip it, so the add
 * flow creates the row at the default status and then transitions it.
 */
export function needsAppliedStatusFollowUp(draft: NewRowDraft): boolean {
  return draft.status.trim() === "APPLIED"
}

/**
 * Blank optional fields are omitted entirely — the create schema rejects `""`
 * for enum fields and would otherwise persist empty strings. `status` is also
 * omitted when it is `APPLIED`, so the caller can stamp `dateApplied` via the
 * follow-up status transition (see `needsAppliedStatusFollowUp`).
 */
export function buildCreateFormData(draft: NewRowDraft): FormData {
  const skipStatus = needsAppliedStatusFollowUp(draft)
  const formData = new FormData()
  for (const [key, value] of Object.entries(draft)) {
    if (key === "status" && skipStatus) continue
    const trimmed = value.trim()
    if (trimmed !== "") formData.set(key, trimmed)
  }
  return formData
}
