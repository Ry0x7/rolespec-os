"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Target, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { SuggestInput } from "@/shared/ui/suggest-input"
import { Pagination } from "@/shared/ui/pagination"
import { usePagedList } from "@/shared/hooks/use-paged-list"
import { usePreservedScroll } from "@/shared/hooks/use-preserved-scroll"
import {
  createRoleFamily,
  createTargetRole,
  deleteRoleFamily,
  deleteTargetRole,
  setTargetRoleActive,
} from "../actions/career-profile.actions"
import {
  ROLE_FAMILY_SUGGESTIONS,
  TARGET_ROLE_SUGGESTIONS,
} from "../constants/suggestions"
import type { RoleFamilyRow, TargetRoleRow } from "../types"

export const TARGET_ROLES_PAGE_SIZE = 10

interface TargetRolesCardProps {
  targetRoles: TargetRoleRow[]
  roleFamilies: RoleFamilyRow[]
}

export function TargetRolesCard({ targetRoles, roleFamilies }: TargetRolesCardProps) {
  const router = useRouter()
  const roleFormRef = useRef<HTMLFormElement>(null)
  const familyFormRef = useRef<HTMLFormElement>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A pause or delete refreshes the list: keep the scroll position, and let
  // the page clamp so deleting the last row on the last page steps back.
  const {
    ref: scrollerRef,
    onScroll: onScrollerScroll,
    resetScroll,
  } = usePreservedScroll<HTMLDivElement>()
  const paged = usePagedList(targetRoles, { pageSize: TARGET_ROLES_PAGE_SIZE })

  function changePage(next: number) {
    paged.setPage(next)
    resetScroll()
  }

  // Don't suggest a family the user already has — that only invites duplicates.
  const existingFamilies = new Set(
    roleFamilies.map((family) => family.name.trim().toLowerCase())
  )
  const familySuggestions = ROLE_FAMILY_SUGGESTIONS.filter(
    (name) => !existingFamilies.has(name.toLowerCase())
  )

  async function handleAddRole(formData: FormData) {
    setBusy(true)
    const result = await createTargetRole(formData)
    setBusy(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    roleFormRef.current?.reset()
    toast.success("Target role added")
    router.refresh()
  }

  async function handleAddFamily(formData: FormData) {
    setBusy(true)
    const result = await createRoleFamily(formData)
    setBusy(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    familyFormRef.current?.reset()
    toast.success("Role family added")
    router.refresh()
  }

  async function run(id: string, fn: () => Promise<{ error?: string } | void>, ok: string) {
    setPendingId(id)
    const result = await fn()
    setPendingId(null)
    if (result && "error" in result && result.error) {
      toast.error(result.error)
      return
    }
    toast.success(ok)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Target roles &amp; role families</CardTitle>
        <CardDescription>
          The roles you are aiming for, grouped into reusable families.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          ref={familyFormRef}
          action={handleAddFamily}
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
        >
          <div className="space-y-2">
            <Label htmlFor="role-family-name">New role family</Label>
            <SuggestInput
              id="role-family-name"
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Frontend Engineering"
              suggestions={familySuggestions}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            <Plus className="h-4 w-4" />
            Add family
          </Button>
        </form>

        {roleFamilies.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {roleFamilies.map((family) => (
              <span
                key={family.id}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {family.name}
                <button
                  type="button"
                  aria-label={`Delete role family ${family.name}`}
                  disabled={pendingId === family.id}
                  onClick={() =>
                    run(family.id, () => deleteRoleFamily(family.id), "Role family deleted")
                  }
                  className="text-destructive hover:opacity-80 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <form ref={roleFormRef} action={handleAddRole} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="target-role-title">New target role</Label>
              <SuggestInput
                id="target-role-title"
                name="title"
                required
                maxLength={200}
                placeholder="e.g. Senior Frontend Engineer"
                suggestions={TARGET_ROLE_SUGGESTIONS}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="target-role-priority">Priority</Label>
              <Input
                id="target-role-priority"
                name="priority"
                type="number"
                min={0}
                max={999}
                defaultValue={0}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="target-role-family">Role family (optional)</Label>
              <Select id="target-role-family" name="roleFamilyId" defaultValue="">
                <option value="">— none —</option>
                {roleFamilies.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={busy}>
              <Plus className="h-4 w-4" />
              Add target role
            </Button>
          </div>
        </form>

        {targetRoles.length === 0 ? (
          <EmptyState
            icon={Target}
            variant="bare"
            title="No target roles yet"
            description="Add the roles you are aiming for so discovery and resumes have a direction to work from."
          />
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {targetRoles.length}{" "}
              {targetRoles.length === 1 ? "target role" : "target roles"}
            </p>
            {/*
              The list scrolls on its own so a long roster can't stretch the page
              to thousands of pixels. Same pattern as the kanban column.
            */}
            <div
              ref={scrollerRef}
              onScroll={onScrollerScroll}
              className="max-h-[min(50vh,420px)] space-y-2 overflow-y-auto overscroll-contain pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar]:w-1.5"
            >
              {paged.pageItems.map((role) => (
                <div
                  key={role.id}
                  className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{role.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Priority {role.priority}</span>
                      {role.roleFamilyName && (
                        <Badge variant="neutral" size="sm">
                          {role.roleFamilyName}
                        </Badge>
                      )}
                      <Badge variant={role.active ? "success" : "neutral"} size="sm">
                        {role.active ? "Active" : "Paused"}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pendingId === role.id}
                    onClick={() =>
                      run(
                        role.id,
                        () => setTargetRoleActive(role.id, !role.active),
                        role.active ? "Target role paused" : "Target role activated"
                      )
                    }
                  >
                    {role.active ? "Pause" : "Activate"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    aria-label={`Delete target role ${role.title}`}
                    disabled={pendingId === role.id}
                    onClick={() =>
                      run(role.id, () => deleteTargetRole(role.id), "Target role deleted")
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Pagination
              label="Target roles pages"
              page={paged.page}
              pageCount={paged.pageCount}
              onPageChange={changePage}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
