"use client"

import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"
import { usePortfolio } from "../hooks/use-portfolio"
import { PortfolioRatingCard } from "./portfolio-rating-card"

interface PortfolioViewProps {
  initialPortfolio: ProfileRatingData | null
}

export function PortfolioView({ initialPortfolio }: PortfolioViewProps) {
  const { portfolio, isRatingPortfolio, portfolioError, runPortfolio } =
    usePortfolio({
      portfolio: initialPortfolio,
    })

  return (
    <div className="space-y-4 lg:space-y-6">
      <PortfolioRatingCard
        result={portfolio}
        isPending={isRatingPortfolio}
        error={portfolioError}
        onRate={runPortfolio}
      />
    </div>
  )
}
