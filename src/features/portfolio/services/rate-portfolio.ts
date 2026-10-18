import { z } from "zod"

import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import {
  ratingIssueSchema,
  ratingSuggestionsSchema,
  scoreSchema,
} from "@/shared/lib/rating/schemas"
import { PROFILE_RATING_MAX_TEXT_LENGTH } from "@/shared/lib/rating/constants"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"

// ─── Zod schema for portfolio rating structured output ──────────────────────

export const portfolioRatingSchema = z.object({
  overallScore: scoreSchema,
  scores: z.object({
    contentClarity: scoreSchema,
    projectShowcase: scoreSchema,
    professionalPositioning: scoreSchema,
    contactability: scoreSchema,
    keywordsSeo: scoreSchema,
  }),
  issues: z.array(ratingIssueSchema),
  suggestions: ratingSuggestionsSchema,
})

export type PortfolioRatingResult = z.infer<typeof portfolioRatingSchema>

// ─── Main portfolio rating function ─────────────────────────────────────────

export async function analyzePortfolio(
  text: string,
  sourceUrl: string,
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
): Promise<PortfolioRatingResult> {
  const pageText = text.slice(0, PROFILE_RATING_MAX_TEXT_LENGTH)

  const { object } = await generateObjectTracked({
    schema: portfolioRatingSchema,
    tracking: {
      feature: AI_USAGE_FEATURES.PORTFOLIO_RATING,
      surface: "app",
      userId,
    },
    system: [
      "You are an expert portfolio reviewer for job seekers. Evaluate a personal portfolio website and return an actionable rating.",
      "",
      "OUTPUT FORMAT: Respond with ONLY a valid JSON object using EXACTLY these camelCase field names — no uppercase keys, no extra fields, no markdown:",
      "{",
      '  "overallScore": 72,',
      '  "scores": { "contentClarity": 75, "projectShowcase": 65, "professionalPositioning": 80, "contactability": 60, "keywordsSeo": 70 },',
      '  "issues": [{ "severity": "warning", "message": "No work samples or evidence links on any project", "category": "Project Showcase" }],',
      '  "suggestions": { "items": ["Add a link or artifact to each piece of work", "Put an email address in the footer"] }',
      "}",
      "",
      "severity must be one of: critical, warning, info. Every score is 0-100.",
      "",
      UNTRUSTED_CONTENT_RULES,
      "",
      "IMPORTANT INPUT LIMITATION: you are given only the text extracted from the page — no screenshots, layout, colors, typography or interactions. Never comment on or penalise visual design, responsiveness or animation, because you cannot see them. Rate only what the text supports, and do not penalise a page for information that simply may not have been extracted.",
      "",
      "Be fair and encouraging, not punitive. Reserve scores below 40 for content that is genuinely missing or placeholder text.",
      "",
      "Score each category 0-100:",
      "",
      "CONTENT CLARITY: is the writing clear, concise and skimmable? Does a reader understand the site within the first few lines? Penalise filler, lorem ipsum, and walls of unstructured text.",
      "",
      "PROJECT SHOWCASE: evidence of concrete work — named projects, what was produced, the tools, methods or technologies used where relevant, the role played, and measurable impact or outcomes. Reward outcomes and evidence (live demos, repositories, case studies, publications, galleries — whatever fits the field) and quantified results. Penalise project lists with no description of what was actually done.",
      "",
      "PROFESSIONAL POSITIONING: is it clear who this person is, what they do, the roles they target, and what they offer? Reward a specific headline or about section over a generic one.",
      "",
      "CONTACTABILITY: is there a way to reach them — email, contact form, LinkedIn or other professional profile — and a clear call to action such as 'hire me' or 'get in touch'?",
      "",
      "KEYWORDS AND SEO: role-relevant keywords present in the text, plus the quality and specificity of the page title and meta description.",
      "",
      "The overall score is a weighted average: contentClarity (25%) + projectShowcase (25%) + professionalPositioning (20%) + contactability (15%) + keywordsSeo (15%).",
      "",
      "Every issue must be specific and name a concrete fix. Return 3-8 suggestions, each a single actionable sentence.",
    ].join("\n"),
    prompt: [
      `Portfolio URL:\n${fenceUntrusted("PORTFOLIO_URL", sourceUrl)}`,
      `Extracted page text:\n${fenceUntrusted("PORTFOLIO_PAGE_TEXT", pageText)}`,
    ].join("\n\n"),
  })

  return object
}
