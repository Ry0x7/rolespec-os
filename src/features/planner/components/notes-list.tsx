"use client"

import { useMemo, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Pencil, X, Check, StickyNote, Search } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/shared/ui/card"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { Label } from "@/shared/ui/label"
import { Pagination } from "@/shared/ui/pagination"
import { EmptyState } from "@/shared/components/empty-state"
import { usePagedList } from "@/shared/hooks/use-paged-list"
import { cn, formatDate } from "@/shared/lib/utils"
import { createNote, updateNote, deleteNote } from "../actions/note.actions"
import type { NoteRow } from "../types"

interface NotesListProps {
  notes: NoteRow[]
}

const NOTES_PAGE_SIZE = 10

/** Bodies clamp to six lines; these thresholds decide when to offer "Show more". */
const CLAMP_LINES = 6
const CLAMP_CHARS = 420

/**
 * Whether a note body is long enough to be clamped. A text heuristic rather
 * than a layout measurement, so it is stable across renders and testable; a
 * body under both limits fits in six lines at the card's width.
 */
export function isLongNote(content: string): boolean {
  return content.split("\n").length > CLAMP_LINES || content.length > CLAMP_CHARS
}

export function NotesList({ notes }: NotesListProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const needle = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      needle ? notes.filter((note) => note.content.toLowerCase().includes(needle)) : notes,
    [needle, notes]
  )
  // A new search goes back to page 1; a delete on the last page clamps.
  const paged = usePagedList(filtered, { pageSize: NOTES_PAGE_SIZE, resetKey: needle })

  async function handleAdd(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await createNote(formData)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
    } else {
      formRef.current?.reset()
      toast.success("Note added")
      router.refresh()
    }
  }

  function startEdit(note: NoteRow) {
    setEditingId(note.id)
    setEditContent(note.content)
  }

  async function handleSaveEdit(id: string) {
    setPendingId(id)
    const fd = new FormData()
    fd.set("content", editContent)
    const result = await updateNote(id, fd)
    setPendingId(null)
    if (result?.error) {
      toast.error(result.error)
    } else {
      setEditingId(null)
      toast.success("Note updated")
      router.refresh()
    }
  }

  async function handleDelete(id: string) {
    setPendingId(id)
    const result = await deleteNote(id)
    setPendingId(null)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success("Note deleted")
      router.refresh()
    }
  }

  return (
    <div className="space-y-6">
      {/* Add form */}
      <Card>
        <CardContent>
          <form ref={formRef} action={handleAdd} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="note-content">New note</Label>
              <Textarea
                id="note-content"
                name="content"
                rows={3}
                placeholder="Jot down anything — interview prep, contacts, reminders..."
                required
                className="resize-none"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={loading}>
                <Plus className="h-4 w-4" />
                {loading ? "Adding..." : "Add Note"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      {notes.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="No notes yet"
          description="Capture freeform notes above."
        />
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
              className="pl-9"
            />
          </div>
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">No notes match your search.</p>
          )}
          {paged.pageItems.map((note) => (
            <div key={note.id} className="group rounded-lg border border-border bg-card p-4">
              {editingId === note.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    aria-label="Edit note content"
                    className="resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      disabled={pendingId === note.id}
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleSaveEdit(note.id)}
                      disabled={pendingId === note.id || editContent.trim() === ""}
                    >
                      <Check className="h-3.5 w-3.5" />
                      {pendingId === note.id ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p
                      id={`note-body-${note.id}`}
                      className={cn(
                        "whitespace-pre-wrap break-words text-sm",
                        isLongNote(note.content) && !expanded[note.id] && "line-clamp-6"
                      )}
                    >
                      {note.content}
                    </p>
                    {isLongNote(note.content) && (
                      <button
                        type="button"
                        aria-expanded={!!expanded[note.id]}
                        aria-controls={`note-body-${note.id}`}
                        onClick={() =>
                          setExpanded((current) => ({ ...current, [note.id]: !current[note.id] }))
                        }
                        className="mt-1 inline-flex rounded-sm text-xs font-medium text-brand-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {expanded[note.id] ? "Show less" : "Show more"}
                      </button>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Updated {formatDate(note.updatedAt.toISOString())}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label="Edit note"
                      onClick={() => startEdit(note)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      aria-label="Delete note"
                      disabled={pendingId === note.id}
                      onClick={() => handleDelete(note.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onPageChange={paged.setPage}
            label="Notes pages"
          />
        </div>
      )}
    </div>
  )
}
