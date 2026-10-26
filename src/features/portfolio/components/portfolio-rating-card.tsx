"use client"

import { useState } from "react"
import { Globe } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { RatingResults, RatingResultsSkeleton } from "@/shared/components/rating-results"
import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"

interface PortfolioRatingCardProps {
  result: ProfileRatingData | null
  isPending: boolean
  error: string | null
  /** Last rated URL, remembered on this device — pre-fills the field. */
  initialUrl?: string | null
  onRate: (url: string) => void
  onClear?: () => void
}

export function PortfolioRatingCard({
  result,
  isPending,
  error,
  initialUrl,
  onRate,
  onClear,
}: PortfolioRatingCardProps) {
  const [url, setUrl] = useState(
    result?.sourceUrl ?? initialUrl ?? ""
  )

  return (
    <Card className="space-y-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Portfolio website
          </CardTitle>
        </div>
        <CardDescription>
          We read your live site and score how well it sells you to a recruiter.
        </CardDescription>
      </CardHeader>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          onRate(url)
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="portfolio-url">Portfolio URL</Label>
          <Input
            id="portfolio-url"
            name="portfolio-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://yourportfolio.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isPending}
            aria-describedby={error ? "portfolio-url-error" : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>

        {error && (
          <p id="portfolio-url-error" role="alert" className="text-sm text-error">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="submit"
            loading={isPending}
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            {isPending ? "Rating..." : result ? "Re-rate portfolio" : "Rate portfolio"}
          </Button>
          {result && onClear && !isPending && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setUrl("")
                onClear()
              }}
            >
              Clear & start over
            </Button>
          )}
        </div>
      </form>

      <div className="border-t border-border pt-4">
        {isPending ? (
          <RatingResultsSkeleton />
        ) : (
          <RatingResults
            data={result}
            emptyHint="Add your portfolio URL above and we'll score clarity, projects, positioning, contactability, and SEO."
          />
        )}
      </div>
    </Card>
  )
}
