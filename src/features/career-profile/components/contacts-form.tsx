"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { updateContactInfo } from "../actions/career-profile.actions"
import type { CareerContactValues } from "../types"

/** Form state is all strings — it mirrors what the fields submit. */
interface FormState {
  contactFullName: string
  contactEmail: string
  contactPhone: string
  contactLocation: string
  linkedinUrl: string
  githubUrl: string
  websiteUrl: string
}

function toFormState(values: CareerContactValues): FormState {
  return {
    contactFullName: values.contactFullName ?? "",
    contactEmail: values.contactEmail ?? "",
    contactPhone: values.contactPhone ?? "",
    contactLocation: values.contactLocation ?? "",
    linkedinUrl: values.linkedinUrl ?? "",
    githubUrl: values.githubUrl ?? "",
    websiteUrl: values.websiteUrl ?? "",
  }
}

/**
 * Manual save and fully controlled fields, matching `PreferencesForm`: the card
 * is one coherent statement, and a controlled field survives the
 * `router.refresh()` that follows a save.
 *
 * These values — not the sign-in account — are what a new master resume puts in
 * its header, so an empty card is a legitimate state: assembly falls back to the
 * account name and email rather than inventing anything.
 */
export function ContactsForm({ values }: { values: CareerContactValues }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<FormState>(() => toFormState(values))

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((current) => ({ ...current, [key]: value }))
  }

  async function handleSubmit(formData: FormData) {
    setSaving(true)
    setError(null)
    const result = await updateContactInfo(formData)
    setSaving(false)
    if (result?.error) {
      setError(result.error)
      toast.error(result.error)
      return
    }
    toast.success("Contact information saved")
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact information</CardTitle>
        <CardDescription>
          The header of every resume you create. Leave the name or email blank to
          fall back to your account details.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contactFullName">Full name</Label>
              <Input
                id="contactFullName"
                name="contactFullName"
                placeholder="e.g. Ada Lovelace"
                value={state.contactFullName}
                disabled={saving}
                onChange={(e) => set("contactFullName", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Email</Label>
              <Input
                id="contactEmail"
                name="contactEmail"
                type="email"
                placeholder="e.g. ada@example.com"
                value={state.contactEmail}
                disabled={saving}
                onChange={(e) => set("contactEmail", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Phone</Label>
              <Input
                id="contactPhone"
                name="contactPhone"
                placeholder="e.g. +63 917 000 0000"
                value={state.contactPhone}
                disabled={saving}
                onChange={(e) => set("contactPhone", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactLocation">Location</Label>
              <Input
                id="contactLocation"
                name="contactLocation"
                placeholder="e.g. Manila, PH"
                value={state.contactLocation}
                disabled={saving}
                onChange={(e) => set("contactLocation", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
              <Input
                id="linkedinUrl"
                name="linkedinUrl"
                type="url"
                placeholder="https://linkedin.com/in/..."
                value={state.linkedinUrl}
                disabled={saving}
                onChange={(e) => set("linkedinUrl", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="githubUrl">GitHub URL</Label>
              <Input
                id="githubUrl"
                name="githubUrl"
                type="url"
                placeholder="https://github.com/..."
                value={state.githubUrl}
                disabled={saving}
                onChange={(e) => set("githubUrl", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="websiteUrl">Website URL</Label>
              <Input
                id="websiteUrl"
                name="websiteUrl"
                type="url"
                placeholder="https://..."
                value={state.websiteUrl}
                disabled={saving}
                onChange={(e) => set("websiteUrl", e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save contact information"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
