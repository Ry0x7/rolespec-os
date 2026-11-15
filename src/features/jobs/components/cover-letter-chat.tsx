"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { Button } from "@/shared/ui/button"

interface Props {
  onImprove: (instruction: string) => Promise<void>
  isImproving: boolean
}

const PRESETS = [
  "Make more concise",
  "More professional",
  "Add missing keywords",
  "Stronger opening",
]

export function CoverLetterChat({ onImprove, isImproving }: Props) {
  const [instruction, setInstruction] = useState("")

  async function handleImprove() {
    if (!instruction.trim() || isImproving) return
    await onImprove(instruction)
    setInstruction("")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">AI Assistant</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              variant="outline"
              size="sm"
              onClick={() => setInstruction(preset)}
            >
              {preset}
            </Button>
          ))}
        </div>

        <textarea
          aria-label="Improvement instruction"
          rows={2}
          placeholder="Give a specific instruction..."
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />

        <Button
          type="button"
          onClick={handleImprove}
          disabled={isImproving || !instruction.trim()}
        >
          {isImproving ? "Improving..." : "Improve"}
        </Button>
      </CardContent>
    </Card>
  )
}
