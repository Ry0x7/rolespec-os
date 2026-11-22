"use client"

import { forwardRef } from "react"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { Textarea } from "@/shared/ui/textarea"
import { toDateInputValue, toDateTimeInputValue } from "./job-table-utils"
import { compactCurrencyLabel } from "@/shared/lib/money/money"

import {
  JOB_TYPE_OPTIONS,
  SALARY_CURRENCY_OPTIONS,
  SALARY_PERIOD_OPTIONS,
  STATUS_OPTIONS,
  WORK_TYPE_OPTIONS,
} from "./job-form-options"
import type { JobFormApplication } from "./job-form-application"

/** Every field name is a `FormData` key the create/update actions understand. */
export const JOB_FORM_FIELDS = [
  "companyName",
  "jobTitle",
  "status",
  "location",
  "jobType",
  "workType",
  "salaryMin",
  "salaryMax",
  "salaryPeriod",
  "salaryCurrency",
  "salaryTermMonths",
  "jobLink",
  "dateApplied",
  "deadline",
  "interviewDate",
  "followUpAt",
  "contact",
  "jobDescription",
  "notes",
] as const

export type JobFormField = (typeof JOB_FORM_FIELDS)[number]

interface JobFormFieldsProps {
  /** Prefills the form for an edit; omitted for a create. */
  application?: JobFormApplication
  /** Namespaces the `id`s so two forms can coexist without colliding. */
  idPrefix: string
}

/**
 * Uncontrolled field set shared by the create and edit dialogs — both read the
 * values back off the submitted `FormData`, so no draft state is needed.
 */
export const JobFormFields = forwardRef<HTMLInputElement, JobFormFieldsProps>(
  function JobFormFields({ application, idPrefix }, firstFieldRef) {
    const id = (field: JobFormField) => `${idPrefix}-${field}`

    return (
      // One grid for the whole form: two columns from `sm` up, in logical
      // pairs. Anything that has no partner spans both columns, so no field
      // ever sits next to a void.
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={id("companyName")}>Company</Label>
          <Input
            ref={firstFieldRef}
            id={id("companyName")}
            name="companyName"
            placeholder="Acme Corp"
            defaultValue={application?.companyName ?? ""}
            maxLength={200}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={id("jobTitle")}>Job title</Label>
          <Input
            id={id("jobTitle")}
            name="jobTitle"
            placeholder="e.g. Sales Manager"
            defaultValue={application?.jobTitle ?? ""}
            maxLength={200}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={id("status")}>Status</Label>
          <Select
            id={id("status")}
            name="status"
            defaultValue={application?.status ?? "INTERESTED"}
            required
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={id("jobType")}>Job type</Label>
          <Select
            id={id("jobType")}
            name="jobType"
            defaultValue={application?.jobType ?? ""}
          >
            <option value="">— select —</option>
            {JOB_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={id("location")}>Location</Label>
          <Input
            id={id("location")}
            name="location"
            placeholder="San Francisco, CA"
            defaultValue={application?.location ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={id("workType")}>Work type</Label>
          <Select
            id={id("workType")}
            name="workType"
            defaultValue={application?.workType ?? ""}
          >
            <option value="">— select —</option>
            {WORK_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={id("salaryMin")}>Salary</Label>
          <p className="text-xs text-muted-foreground">
            The posting&apos;s own figures, in the posting&apos;s own currency. Leave the
            currency blank only when the posting does not state one — it is never assumed.
          </p>
          {/* Range, currency, period and contract term are one control group:
              a figure without a currency and a period cannot be compared, and a
              contract total without its length cannot be annualized. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_7rem_9rem_9rem]">
            <Input
              id={id("salaryMin")}
              name="salaryMin"
              inputMode="decimal"
              aria-label="Salary minimum"
              placeholder="85000"
              defaultValue={application?.salaryMin ?? ""}
              className="min-w-0"
            />
            <Input
              id={id("salaryMax")}
              name="salaryMax"
              inputMode="decimal"
              aria-label="Salary maximum"
              placeholder="95000"
              defaultValue={application?.salaryMax ?? ""}
              className="min-w-0"
            />
            <Select
              id={id("salaryCurrency")}
              name="salaryCurrency"
              aria-label="Salary currency"
              defaultValue={application?.salaryCurrency ?? ""}
              className="min-w-0"
            >
              <option value="">none</option>
              {/* Code plus glyph: the field is narrow, and "JPY ¥" identifies a
                  currency faster than a truncated name would. */}
              {SALARY_CURRENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {compactCurrencyLabel(option.value)}
                </option>
              ))}
            </Select>
            <Select
              id={id("salaryPeriod")}
              name="salaryPeriod"
              aria-label="Salary period"
              defaultValue={application?.salaryPeriod ?? ""}
              className="min-w-0"
            >
              <option value="">— select —</option>
              {SALARY_PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Input
              id={id("salaryTermMonths")}
              name="salaryTermMonths"
              type="number"
              min={1}
              max={120}
              aria-label="Contract length in months"
              placeholder="Contract months"
              defaultValue={application?.salaryTermMonths ?? ""}
              className="min-w-0"
            />
          </div>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={id("jobLink")}>Job link</Label>
          <Input
            id={id("jobLink")}
            name="jobLink"
            type="url"
            placeholder="https://..."
            defaultValue={application?.jobLink ?? ""}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={id("dateApplied")}>Date applied</Label>
          <Input
            id={id("dateApplied")}
            name="dateApplied"
            type="date"
            defaultValue={toDateInputValue(application?.dateApplied ?? null)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={id("deadline")}>Deadline</Label>
          <Input
            id={id("deadline")}
            name="deadline"
            type="date"
            defaultValue={toDateInputValue(application?.deadline ?? null)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={id("interviewDate")}>Interview date</Label>
          <Input
            id={id("interviewDate")}
            name="interviewDate"
            type="datetime-local"
            defaultValue={toDateTimeInputValue(application?.interviewDate ?? null)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={id("followUpAt")}>Follow up on</Label>
          <Input
            id={id("followUpAt")}
            name="followUpAt"
            type="date"
            defaultValue={toDateInputValue(application?.followUpAt ?? null)}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={id("contact")}>Contact</Label>
          <Input
            id={id("contact")}
            name="contact"
            placeholder="hiring@company.com"
            defaultValue={application?.contact ?? ""}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={id("jobDescription")}>Job description</Label>
          <Textarea
            id={id("jobDescription")}
            name="jobDescription"
            rows={5}
            placeholder="Paste the full job description here..."
            className="resize-y"
            defaultValue={application?.jobDescription ?? ""}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={id("notes")}>Notes</Label>
          <Textarea
            id={id("notes")}
            name="notes"
            rows={3}
            placeholder="Any notes..."
            className="resize-none"
            defaultValue={application?.notes ?? ""}
          />
        </div>
      </div>
    )
  }
)
