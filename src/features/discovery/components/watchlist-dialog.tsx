"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { DEFAULT_ATS_COMPANY_WATCHLIST } from "@/config/discovery"
import {
  ATS_SLUG_PATTERN,
  MAX_ATS_SLUGS,
  MAX_ATS_SLUG_LENGTH,
  type AtsWatchlist,
} from "@/features/settings/schemas/preferences.schema"
import { Button } from "@/shared/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/shared/ui/dialog"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"

import {
  MAX_WORKDAY_BOARD_URL_LENGTH,
  parseWorkdayBoardUrl,
} from "../constants/workday-board"
import { probeCompanyBoards } from "../actions/discovery.actions"
import { updateAtsWatchlist } from "../actions/watchlist.actions"
import { providerLabel } from "../constants/providers"
import { MAX_COMPANY_NAME_LENGTH } from "../schemas/discovery.schema"
import type { BoardProbeHit } from "../services/company-board-probe.service"

/** The sources a single slug names. Workday takes a board URL and has its own section. */
type SlugAts = Exclude<keyof AtsWatchlist, "workday">

const SECTIONS: Array<{ key: SlugAts; label: string; example: string }> = [
  { key: "greenhouse", label: "Greenhouse", example: "gitlab" },
  { key: "lever", label: "Lever", example: "spotify" },
  { key: "ashby", label: "Ashby", example: "linear" },
  { key: "bamboohr", label: "BambooHR", example: "kumu" },
  { key: "freshteam", label: "Freshteam", example: "thinkingmachines" },
]

interface Props {
  watchlist: AtsWatchlist
  onClose: () => void
}

/**
 * Edits the companies whose ATS boards discovery scans. These are user config,
 * never evidence of anything — a watched company only decides which public
 * board gets one request per run.
 */
export function WatchlistDialog({ watchlist, onClose }: Props) {
  const router = useRouter()
  const [slugs, setSlugs] = useState<AtsWatchlist>({
    greenhouse: [...watchlist.greenhouse],
    lever: [...watchlist.lever],
    // Added after this preference shipped, so a stored watchlist may not have them.
    ashby: [...(watchlist.ashby ?? [])],
    bamboohr: [...(watchlist.bamboohr ?? [])],
    freshteam: [...(watchlist.freshteam ?? [])],
    workday: [...(watchlist.workday ?? [])],
  })
  const [drafts, setDrafts] = useState<Record<SlugAts, string>>({
    greenhouse: "",
    lever: "",
    ashby: "",
    bamboohr: "",
    freshteam: "",
  })
  const [workdayDraft, setWorkdayDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // "Find a company's board". `probe` is null until a search has run, so an
  // untouched dialog shows nothing rather than an empty state.
  const [companyName, setCompanyName] = useState("")
  const [probe, setProbe] = useState<{ name: string; hits: BoardProbeHit[] } | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [isProbing, startProbe] = useTransition()

  function handleProbe() {
    const name = companyName.trim()
    if (!name || isProbing) return

    setProbeError(null)
    startProbe(async () => {
      const result = await probeCompanyBoards(name)
      if ("error" in result) {
        setProbe(null)
        setProbeError(result.error)
        return
      }
      setProbe({ name, hits: result.hits })
    })
  }

  /**
   * Stages a found board in its section. Same rules as a typed slug — the hit
   * still has to fit the per-source cap — and, like every other edit here,
   * nothing is written until Save.
   */
  function handleAddHit(hit: BoardProbeHit) {
    if (slugs[hit.provider].includes(hit.slug)) {
      toast.info(`${providerLabel(hit.provider)} board ${hit.slug} is already on the list`)
      return
    }
    if (slugs[hit.provider].length >= MAX_ATS_SLUGS) {
      setError(`You can watch at most ${MAX_ATS_SLUGS} companies per source.`)
      return
    }
    setError(null)
    setSlugs((current) => ({ ...current, [hit.provider]: [...current[hit.provider], hit.slug] }))
  }

  function handleClose() {
    if (isSaving) return
    onClose()
  }

  /**
   * Stages a Workday career site. The URL is validated and reduced to its
   * canonical board form here as well as on the server, so a typo is answered in
   * the dialog rather than on Save.
   */
  function handleAddWorkday() {
    const raw = workdayDraft.trim()
    if (!raw) return
    const board = parseWorkdayBoardUrl(raw)
    if (!board) {
      setError("A Workday board URL looks like https://company.wd3.myworkdayjobs.com/Careers")
      return
    }
    if (slugs.workday.includes(board.boardUrl)) {
      setWorkdayDraft("")
      return
    }
    if (slugs.workday.length >= MAX_ATS_SLUGS) {
      setError(`You can watch at most ${MAX_ATS_SLUGS} companies per source.`)
      return
    }
    setError(null)
    setSlugs((current) => ({ ...current, workday: [...current.workday, board.boardUrl] }))
    setWorkdayDraft("")
  }

  function handleRemoveWorkday(boardUrl: string) {
    setSlugs((current) => ({
      ...current,
      workday: current.workday.filter((url) => url !== boardUrl),
    }))
  }

  function handleAdd(ats: SlugAts) {
    const slug = drafts[ats].trim().toLowerCase()
    if (!slug) return
    if (!ATS_SLUG_PATTERN.test(slug) || slug.length > MAX_ATS_SLUG_LENGTH) {
      setError("A board slug can only contain letters, numbers, hyphens and underscores.")
      return
    }
    if (slugs[ats].includes(slug)) {
      setDrafts((current) => ({ ...current, [ats]: "" }))
      return
    }
    if (slugs[ats].length >= MAX_ATS_SLUGS) {
      setError(`You can watch at most ${MAX_ATS_SLUGS} companies per source.`)
      return
    }
    setError(null)
    setSlugs((current) => ({ ...current, [ats]: [...current[ats], slug] }))
    setDrafts((current) => ({ ...current, [ats]: "" }))
  }

  /**
   * Fills an empty section with the starting list a never-edited watchlist
   * would have had. Users whose preferences predate a source keep an empty
   * array for it, which silently returns nothing on every run; this is the
   * one-click way back to the default rather than typing five slugs.
   */
  function handleAddSuggested(ats: SlugAts) {
    setError(null)
    setSlugs((current) => ({
      ...current,
      [ats]: [...DEFAULT_ATS_COMPANY_WATCHLIST[ats]].slice(0, MAX_ATS_SLUGS),
    }))
  }

  function handleRemove(ats: SlugAts, slug: string) {
    setSlugs((current) => ({ ...current, [ats]: current[ats].filter((s) => s !== slug) }))
  }

  async function handleSave() {
    setIsSaving(true)
    setError(null)
    const result = await updateAtsWatchlist(slugs)
    setIsSaving(false)

    if ("error" in result && result.error) {
      setError(result.error)
      toast.error(result.error)
      return
    }

    toast.success("Watched companies saved")
    onClose()
    router.refresh()
  }

  return (
    <Dialog open onClose={handleClose} aria-labelledby="watchlist-dialog-title">
      <DialogHeader>
        <h2 id="watchlist-dialog-title" className="text-lg font-semibold">
          Watched companies
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These ATSs have no cross-company search, so discovery scans one board at a
          time. A slug is the company&apos;s board id in its careers URL — the{" "}
          <code>gitlab</code> in <code>job-boards.greenhouse.io/gitlab</code>. Workday is
          the exception: a site needs a tenant, a data centre and a site id, so it takes
          the whole board URL.
        </p>
      </DialogHeader>

      <DialogBody className="space-y-6">
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          <div className="space-y-1">
            <Label htmlFor="watchlist-company-probe">Find a company&apos;s board</Label>
            <p className="text-xs text-muted-foreground">
              Checks Greenhouse, Lever, Ashby, BambooHR and Freshteam for a public board
              under slugs derived from the name. Workday cannot be found by name — paste
              its board URL below.
            </p>
          </div>

          <div className="flex gap-2">
            <Input
              id="watchlist-company-probe"
              value={companyName}
              maxLength={MAX_COMPANY_NAME_LENGTH}
              placeholder="e.g. GitLab"
              onChange={(event) => setCompanyName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                handleProbe()
              }}
            />
            <Button
              type="button"
              variant="secondary"
              loading={isProbing}
              disabled={isSaving || companyName.trim().length === 0}
              onClick={handleProbe}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Find
            </Button>
          </div>

          {probeError ? <p className="text-sm text-error">{probeError}</p> : null}

          {probe && !isProbing ? (
            probe.hits.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No public board found under this name on Greenhouse, Lever, Ashby,
                BambooHR or Freshteam — the slug may differ; try the company&apos;s careers
                page URL or the extension.
              </p>
            ) : (
              <ul className="space-y-2">
                {probe.hits.map((hit) => (
                  <li
                    key={`${hit.provider}:${hit.slug}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{providerLabel(hit.provider)}</span>{" "}
                      <code className="text-xs text-muted-foreground">{hit.slug}</code>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {hit.postingCount === 1 ? "1 open role" : `${hit.postingCount} open roles`}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={isSaving || slugs[hit.provider].includes(hit.slug)}
                      onClick={() => handleAddHit(hit)}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {slugs[hit.provider].includes(hit.slug) ? "On the list" : "Add to watchlist"}
                    </Button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>

        {SECTIONS.map((section) => (
          <div key={section.key} className="space-y-3">
            <Label htmlFor={`watchlist-${section.key}`}>{section.label}</Label>

            <div className="flex gap-2">
              <Input
                id={`watchlist-${section.key}`}
                value={drafts[section.key]}
                maxLength={MAX_ATS_SLUG_LENGTH}
                placeholder={`e.g. ${section.example}`}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [section.key]: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  handleAdd(section.key)
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={isSaving}
                onClick={() => handleAdd(section.key)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            </div>

            {slugs[section.key].length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {section.label} boards watched — this source will return nothing.{" "}
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => handleAddSuggested(section.key)}
                  className="font-medium text-foreground underline underline-offset-4 hover:opacity-80 disabled:opacity-50"
                >
                  Add suggested boards
                </button>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slugs[section.key].map((slug) => (
                  <span
                    key={slug}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {slug}
                    <button
                      type="button"
                      aria-label={`Remove ${section.label} board ${slug}`}
                      disabled={isSaving}
                      onClick={() => handleRemove(section.key, slug)}
                      className="text-destructive hover:opacity-80 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="space-y-3">
          <Label htmlFor="watchlist-workday">Workday</Label>
          <p className="text-xs text-muted-foreground">
            Paste the career site URL, e.g.{" "}
            <code>https://globe.wd3.myworkdayjobs.com/GLB_Careers</code>. A posting URL
            from the same site works too.
          </p>

          <div className="flex gap-2">
            <Input
              id="watchlist-workday"
              value={workdayDraft}
              maxLength={MAX_WORKDAY_BOARD_URL_LENGTH}
              placeholder="e.g. https://globe.wd3.myworkdayjobs.com/GLB_Careers"
              onChange={(event) => setWorkdayDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                handleAddWorkday()
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={isSaving}
              onClick={handleAddWorkday}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          </div>

          {slugs.workday.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Workday boards watched — this source will return nothing.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slugs.workday.map((boardUrl) => (
                <span
                  key={boardUrl}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <span className="truncate">{boardUrl}</span>
                  <button
                    type="button"
                    aria-label={`Remove Workday board ${boardUrl}`}
                    disabled={isSaving}
                    onClick={() => handleRemoveWorkday(boardUrl)}
                    className="text-destructive hover:opacity-80 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {error ? <p className="text-sm text-error">{error}</p> : null}
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="ghost" disabled={isSaving} onClick={handleClose}>
          Cancel
        </Button>
        <Button type="button" loading={isSaving} onClick={handleSave}>
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
