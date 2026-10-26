"use client"

import { useState } from "react"
import { Zap } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { Textarea } from "@/shared/ui/textarea"
import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"
import { rateLinkedInHeuristic } from "../services/linkedin-heuristic"

/**
 * Paste-text LinkedIn check that needs no AI provider, no upload and no
 * network. Runs the deterministic heuristic locally and hands the result to
 * the parent so the existing findings UI renders it unchanged.
 */
export function LinkedinQuickCheck({ onResult }: { onResult: (data: ProfileRatingData) => void }) {
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)

  function run() {
    if (text.trim().length < 40) {
      toast.error("Paste at least a few lines of your profile first")
      return
    }
    onResult(rateLinkedInHeuristic(text))
    toast.success("Quick check done — no AI used")
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Zap className="h-3.5 w-3.5" aria-hidden="true" />
        Quick check (no AI)
      </Button>
    )
  }

  return (
    <Card className="border-brand-400/40">
      <CardHeader>
        <CardTitle className="text-base">Quick check — no AI</CardTitle>
        <CardDescription>
          Paste profile text for an instant offline score. Nothing is uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Paste your LinkedIn About + Experience text here…"
          aria-label="LinkedIn profile text for offline check"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Detects strong verbs, metrics, skills and contacts inline.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={run}>
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              Check now
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setText('') } }>
              Close
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
