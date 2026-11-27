import React, { useState } from "react"
import { motion } from "framer-motion"

import { SpotlightCard } from "./depth"
import { CheckIcon } from "./icons"

/**
 * The work RoleSpec handles besides employee job applications: finding
 * clients, a preparation mode with no review stops, and career paths well
 * beyond tech. Each card is a small live mock, not an illustration.
 */

const LEADS = [
  { title: "Virtual assistant for inbox and calendar", source: "Freelancer.com", meta: "Hourly · $8–12 USD · 3 h ago", band: "Strong fit", score: 82, tone: "success" },
  { title: "Part-time executive assistant", source: "Remotive", meta: "Part time · Remote · 2 d ago", band: "Good fit", score: 54, tone: "link" },
  { title: "Data entry, start today", source: "Hiring post", meta: "Asks for a starter-kit fee", band: "Check first", score: 18, tone: "warning" },
] as const

const SEARCHES = ["Upwork", "OnlineJobs.ph", "LinkedIn posts", "Reddit r/forhire", "Maps near you"]

type Mode = "MANUAL" | "AGENT_ASSISTED" | "AUTONOMOUS"

const MODES: Array<{ value: Mode; label: string }> = [
  { value: "MANUAL", label: "Manual" },
  { value: "AGENT_ASSISTED", label: "Agent-assisted" },
  { value: "AUTONOMOUS", label: "Full AI" },
]

const REVIEW_STATE: Record<Mode, { label: string; note: string; tone: "muted" | "warning" | "success" }> = {
  MANUAL: { label: "Your step", note: "You complete each step yourself.", tone: "muted" },
  AGENT_ASSISTED: { label: "Waiting for you", note: "The agent stops here for your approval.", tone: "warning" },
  AUTONOMOUS: { label: "Approved by policy", note: "Runs straight through. Questions only you can answer stop the run instead of being guessed.", tone: "success" },
}

const FAMILIES = [
  "Engineering", "Data", "Product", "Design", "Marketing", "Operations", "People", "Sales", "Security", "Writing",
  "Admin & virtual support", "AI & automation", "Finance & bookkeeping", "Education", "Healthcare",
  "Hospitality & retail", "Logistics", "Skilled trades",
]

const LICENSED = ["Registered nurse", "Electrician", "Teacher", "Accountant", "Delivery driver"]

function ClientsMock() {
  return (
    <div className="bj-mock" aria-hidden="true">
      <div className="bj-mock-bar">
        <span className="bj-field">Virtual assistant</span>
        <span className="bj-field bj-field--muted">Remote</span>
        <span className="bj-cta">Find clients</span>
      </div>
      <ul className="bj-leads">
        {LEADS.map((lead) => (
          <li key={lead.title} className="bj-lead">
            <span className={`bj-score bj-score--${lead.tone}`}>{lead.score}</span>
            <span className="bj-lead-copy">
              <strong>{lead.title}</strong>
              <small>
                {lead.source} · {lead.meta}
              </small>
            </span>
            <span className={`fm-chip fm-chip--${lead.tone}`}>{lead.band}</span>
          </li>
        ))}
      </ul>
      <div className="bj-searches">
        {SEARCHES.map((label) => (
          <span key={label} className="bj-search">
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function ModesMock() {
  const [mode, setMode] = useState<Mode>("AUTONOMOUS")
  const review = REVIEW_STATE[mode]
  const steps = ["Research", "Tailor", "Validate", "Review", "Stage package"]

  return (
    <div className="bj-mock">
      <div className="bj-modes" role="group" aria-label="Preparation mode">
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            onClick={() => setMode(option.value)}
            className="bj-mode"
          >
            {option.label}
          </button>
        ))}
      </div>
      <ol className="bj-steps">
        {steps.map((step) => {
          const isReview = step === "Review"
          const done = mode !== "MANUAL" && (!isReview || mode === "AUTONOMOUS") && !(mode === "AGENT_ASSISTED" && step === "Stage package")
          return (
            <li key={step} className="bj-step">
              <span className={`bj-step-dot ${done ? "is-done" : ""}`}>{done && <CheckIcon />}</span>
              <span>{step}</span>
              {isReview && <span className={`fm-chip fm-chip--${review.tone === "muted" ? "link" : review.tone}`}>{review.label}</span>}
            </li>
          )
        })}
      </ol>
      <p className="bj-note" aria-live="polite">
        {review.note}
      </p>
    </div>
  )
}

export function BeyondJobs() {
  return (
    <section id="beyond" aria-labelledby="beyond-heading" className="mx-auto w-full max-w-5xl scroll-mt-20 px-4 py-16 sm:px-6">
      <div className="mb-10 max-w-2xl">
        <h2 id="beyond-heading" className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
          Not only job applications.
        </h2>
        <p className="mt-3 text-pretty text-base sm:text-lg" style={{ color: "var(--text-2)" }}>
          Find clients for freelance work, let the agent run a preparation end to end, and plan a path in
          any field, remote or on site.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="bento"
      >
        <SpotlightCard as="article" className="bento-cell bento-cell--wide">
          <div className="bento-copy">
            <p className="bento-kicker">Find clients</p>
            <h3>Clients for virtual assistants, automation builders and freelancers.</h3>
            <p>
              Public client posts scored for fit, freshness and scam signals, plus ready-made searches on the
              marketplaces and social posts where clients hire. Save a lead and draft the proposal from your
              own profile.
            </p>
          </div>
          <ClientsMock />
        </SpotlightCard>

        <SpotlightCard as="article" className="bento-cell">
          <div className="bento-copy">
            <p className="bento-kicker">Full AI mode</p>
            <h3>No review stops.</h3>
            <p>Pick a mode to see what changes. Nothing is ever submitted for you.</p>
          </div>
          <ModesMock />
        </SpotlightCard>

        <SpotlightCard as="article" className="bento-cell bento-cell--full">
          <div className="bento-copy bento-copy--row">
            <div>
              <p className="bento-kicker">Every career path</p>
              <h3>48 roles in 18 fields, from office to trades.</h3>
            </div>
            <p>
              Readiness is checked against each role&rsquo;s real requirements. Licensed roles ask for the
              credential before they count as a match.
            </p>
          </div>
          <ul className="bj-families" aria-label="Career fields">
            {FAMILIES.map((family) => (
              <li key={family} className="bj-family">
                {family}
              </li>
            ))}
          </ul>
          <ul className="bj-families bj-families--licensed" aria-label="Roles that need a licence">
            {LICENSED.map((role) => (
              <li key={role} className="bj-family bj-family--licensed">
                {role}
                <span>licence</span>
              </li>
            ))}
          </ul>
        </SpotlightCard>
      </motion.div>
    </section>
  )
}
