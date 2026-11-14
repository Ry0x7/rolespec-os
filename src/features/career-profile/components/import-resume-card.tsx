"use client"

import Link from "next/link"
import { useActionState } from "react"
import { FileText, ListChecks } from "lucide-react"

import { Button } from "@/shared/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card"
import { Select } from "@/shared/ui/select"

import {
  importResumeToCareerProfile,
  type ResumeImportResult,
} from "../actions/import-resume.actions"

export interface ImportableResume {
  id: string
  title: string
  variant: "MASTER" | "ROLE_FAMILY" | "JOB_TAILORED"
  updatedAt: Date
}

const VARIANT_LABEL: Record<ImportableResume["variant"], string> = {
  MASTER: "Master",
  ROLE_FAMILY: "Role family",
  JOB_TAILORED: "Job-tailored",
}

function summarize(result: ResumeImportResult): string {
  if ("error" in result) return result.error

  const parts: string[] = []
  if (result.evidenceCreated > 0) {
    parts.push(
      `${result.evidenceCreated} ${result.evidenceCreated === 1 ? "fact" : "facts"} to review`
    )
  }
  if (result.capabilitiesCreated > 0) {
    parts.push(
      `${result.capabilitiesCreated} ${
        result.capabilitiesCreated === 1 ? "skill" : "skills"
      } to confirm`
    )
  }

  const skipped = result.evidenceSkipped + result.capabilitiesSkipped
  const added = parts.length === 0 ? "Nothing new to add" : `Imported ${parts.join(" and ")}`
  return skipped === 0 ? added : `${added}; ${skipped} already existed`
}

/**
 * Resume → Career Profile import. The resume is parsed deterministically on the
 * server, not by AI, and every row lands as a CANDIDATE with its source resume
 * recorded. The user confirms or deletes each row in the Evidence card.
 */
export function ImportResumeCard({ resumes }: { resumes: ImportableResume[] }) {
  const [result, action, isPending] = useActionState(
    async (_previous: ResumeImportResult | null, formData: FormData) =>
      importResumeToCareerProfile(formData),
    null
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand-400" aria-hidden="true" />
          Import from a resume
        </CardTitle>
        <CardDescription>
          Turn an existing master, role-family or job-tailored resume into career facts.
          Nothing is rewritten and no AI is used. Imported facts stay unconfirmed
          candidates until you review them in Evidence.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {resumes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No resumes to import yet.{" "}
            <Link href="/resumes" className="text-brand-400 hover:underline">
              Create or upload a resume
            </Link>{" "}
            first.
          </p>
        ) : (
          <form action={action} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="career-import-resume" className="text-sm font-medium">
                Resume
              </label>
              <Select
                id="career-import-resume"
                name="resumeId"
                defaultValue={resumes[0]?.id}
                required
              >
                {resumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.title} — {VARIANT_LABEL[resume.variant]}
                  </option>
                ))}
              </Select>
            </div>

            <p className="flex gap-2 text-xs text-muted-foreground">
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Skills arrive unconfirmed. Experience, education, projects and
                certifications are added as candidates with the source resume noted
                in their provenance.
              </span>
            </p>

            {result && (
              <p
                role={("error" in result) ? "alert" : "status"}
                className={
                  "error" in result
                    ? "text-sm text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {summarize(result)}
              </p>
            )}

            <div className="flex justify-end">
              <Button type="submit" loading={isPending} disabled={isPending}>
                {isPending ? "Importing…" : "Import facts"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
