"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { localCalendarDateString } from "@/shared/lib/dates"
import { createJobApplication } from "@/features/jobs/actions/job-application.actions"
import { STATUS_LABELS } from "./kanban/kanban-column"

export function QuickAddPanel() {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [loading, setLoading] = useState(false)

  async function handleAdd(formData: FormData) {
    // Adding straight into APPLIED stamps `dateApplied`, and the day that has to
    // be is the one on the user's calendar — the server may be in UTC.
    if (formData.get("status") === "APPLIED" && !formData.get("dateApplied")) {
      formData.set("dateApplied", localCalendarDateString())
    }
    // Same `clientToday` convention as `updateJobApplicationStatus`: a create
    // landing directly on a terminal status stamps `outcomeAt` on the client's
    // own calendar day.
    formData.set("clientToday", localCalendarDateString())
    setLoading(true)
    const result = await createJobApplication(formData)
    setLoading(false)

    if ("error" in result) {
      const details = "details" in result ? result.details : undefined
      const firstFieldError = details
        ? Object.values(details.fieldErrors).flat().filter(Boolean)[0]
        : undefined
      toast.error(firstFieldError ?? result.error)
      return
    }

    formRef.current?.reset()
    toast.success("Added")
    router.refresh()
  }

  return (
    <form ref={formRef} action={handleAdd} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="quickadd-company">Company</Label>
          <Input
            id="quickadd-company"
            name="companyName"
            placeholder="e.g. Acme Inc"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="quickadd-title">Job title</Label>
          <Input
            id="quickadd-title"
            name="jobTitle"
            placeholder="e.g. Project Coordinator"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="quickadd-status">Status</Label>
          <Select id="quickadd-status" name="status" defaultValue="INTERESTED">
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quickadd-link">Job link (optional)</Label>
          <Input
            id="quickadd-link"
            name="jobLink"
            type="url"
            placeholder="https://…"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          <Plus className="h-4 w-4" />
          {loading ? "Adding..." : "Add application"}
        </Button>
      </div>
    </form>
  )
}
