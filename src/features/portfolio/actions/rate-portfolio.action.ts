"use server"

import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"
import type { PortfolioFetchErrorCode } from "../services/fetch-portfolio"

export type RatePortfolioErrorCode =
  | "RATE_LIMITED"
  | PortfolioFetchErrorCode
  | "FEATURE_DISABLED"

export async function ratePortfolio(_url?: string): Promise<{
  success?: boolean
  error?: string
  code?: RatePortfolioErrorCode
  data?: ProfileRatingData
}> {
  void _url
  return {
    error: "Portfolio rating is disabled in this edition.",
    code: "FEATURE_DISABLED",
  }
}
