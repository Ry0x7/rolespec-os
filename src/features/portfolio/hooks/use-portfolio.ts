"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { GENERIC_ERROR, isNoisyCode } from "@/shared/lib/rating/constants"
import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"
import { ratePortfolio } from "../actions/rate-portfolio.action"

/**
 * Inline copy for every error code the portfolio action can return. The action
 * ships its own messages too, but the UI keeps a user-facing variant so the
 * card reads consistently with the LinkedIn side.
 */
export const PORTFOLIO_ERROR_MESSAGES: Record<string, string> = {
  INVALID_URL: "Enter a valid public website URL.",
  BLOCKED_URL: "That address cannot be scanned — use a public website URL.",
  FETCH_FAILED: "We couldn't reach that site. Check the URL and try again.",
  UNSUPPORTED_CONTENT: "That URL didn't return a readable web page.",
  TOO_LARGE: "That page is too large to analyse.",
  TIMEOUT: "That site took too long to respond. Try again.",
  RATE_LIMITED: "Too many portfolio ratings. Wait a few minutes and try again.",
}

export interface UsePortfolioInitial {
  portfolio: ProfileRatingData | null
}

const LAST_URL_KEY = "rolespec:last-portfolio-url"

/** Adds https:// when the user typed a bare domain — the #1 retype driver. */
export function normalizePortfolioUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function readLastUrl(): string | null {
  try {
    return localStorage.getItem(LAST_URL_KEY)
  } catch {
    return null
  }
}

export function usePortfolio(initial: UsePortfolioInitial) {

  const [portfolio, setPortfolio] = useState<ProfileRatingData | null>(
    initial.portfolio
  )
  const [isRatingPortfolio, setIsRatingPortfolio] = useState(false)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)
  const [lastUrl, setLastUrl] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readLastUrl()
  )

  const runPortfolio = useCallback(
    async (url: string) => {
      if (isRatingPortfolio) return
      const normalized = normalizePortfolioUrl(url)
      if (!normalized) {
        setPortfolioError("Enter your portfolio URL to run a rating.")
        return
      }

      setIsRatingPortfolio(true)
      setPortfolioError(null)

      try {
        const result = await ratePortfolio(normalized)
        try {
          localStorage.setItem(LAST_URL_KEY, normalized)
        } catch {
          // Private-mode storage failure must not break the rating.
        }
        setLastUrl(normalized)

        if (result.data) {
          setPortfolio(result.data)
          toast.success("Portfolio rated")
          return
        }

        const message =
          (result.code && PORTFOLIO_ERROR_MESSAGES[result.code]) ||
          result.error ||
          GENERIC_ERROR
        setPortfolioError(message)
        if (isNoisyCode(result.code)) {
          toast.error(message)
        }
      } catch {
        setPortfolioError("Portfolio rating failed. Please try again.")
      } finally {
        setIsRatingPortfolio(false)
      }
    },
    [isRatingPortfolio]
  )

  /** Clears the current rating back to the input state. */
  const clearPortfolio = useCallback(() => {
    setPortfolio(null)
    setPortfolioError(null)
  }, [])

  return {
    portfolio,
    isRatingPortfolio,
    portfolioError,
    lastUrl,
    setPortfolioError,
    runPortfolio,
    clearPortfolio,
  }
}
