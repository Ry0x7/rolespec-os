"use client"

import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"
import { usePortfolio } from "../hooks/use-portfolio"
import { PortfolioOfflineChecklist } from "./portfolio-offline-checklist"
import { PortfolioRatingCard } from "./portfolio-rating-card"

interface PortfolioViewProps {
  initialPortfolio: ProfileRatingData | null
}

export function PortfolioView({ initialPortfolio }: PortfolioViewProps) {
  const {
    portfolio,
    isRatingPortfolio,
    portfolioError,
    lastUrl,
    runPortfolio,
    clearPortfolio,
  } = usePortfolio({
    portfolio: initialPortfolio,
  })

  return (
    <div className="space-y-4 lg:space-y-6">
      {lastUrl && <PortfolioOfflineChecklist url={lastUrl} />}
      <PortfolioRatingCard
        result={portfolio}
        isPending={isRatingPortfolio}
        error={portfolioError}
        initialUrl={lastUrl}
        onRate={runPortfolio}
        onClear={clearPortfolio}
      />
    </div>
  )
}
