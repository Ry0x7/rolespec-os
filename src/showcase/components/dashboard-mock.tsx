import React, { useState } from "react"

import { CheckIcon, ChevronRightIcon, LogoMarkIcon } from "./icons"

type Tone = "success" | "warning" | "link"

interface Role {
  company: string
  role: string
  location: string
  score: number
  tint: string
  reason: string
  factors: { label: string; value: number; tone: Tone }[]
}

const ROLES: Role[] = [
  {
    company: "Anthropic",
    role: "Staff AI Engineer",
    location: "Remote · US",
    score: 94,
    tint: "#0066cc",
    reason:
      "Your inference and distributed-systems work maps directly. Evidence covers 8 of 9 must-haves; only the compensation range needs a check.",
    factors: [
      { label: "Skills", value: 96, tone: "success" },
      { label: "Evidence", value: 88, tone: "success" },
      { label: "Logistics", value: 74, tone: "warning" },
    ],
  },
  {
    company: "Linear",
    role: "Senior Product Engineer",
    location: "Remote · EU",
    score: 91,
    tint: "#5e5ce6",
    reason:
      "Product craft and TypeScript depth are a strong match. The role asks for design-system ownership, which your last two projects show clearly.",
    factors: [
      { label: "Skills", value: 92, tone: "success" },
      { label: "Evidence", value: 90, tone: "success" },
      { label: "Logistics", value: 86, tone: "link" },
    ],
  },
  {
    company: "Stripe",
    role: "Staff Systems Engineer",
    location: "Hybrid · SF",
    score: 87,
    tint: "#30b0c7",
    reason:
      "Reliability and API-platform experience line up. The only gap is payments-domain evidence, which one focused resume bullet can address.",
    factors: [
      { label: "Skills", value: 89, tone: "success" },
      { label: "Evidence", value: 82, tone: "link" },
      { label: "Logistics", value: 78, tone: "warning" },
    ],
  },
]

const METRICS = [
  { label: "Applications today", value: "2", note: "Goal 2 of 3", pill: "On track", tone: "success" as Tone },
  { label: "Follow-ups due", value: "1", note: "Reply to Stripe", pill: "Due today", tone: "warning" as Tone },
  { label: "Interviews", value: "2", note: "Next Fri, 2 PM", pill: "Upcoming", tone: "link" as Tone },
]

const PIPELINE = [
  {
    name: "Interested",
    count: 4,
    tone: "neutral" as const,
    cards: [
      { company: "Linear", role: "Product Engineer", meta: "Saved 2d ago" },
      { company: "Vercel", role: "Design Engineer", meta: "Saved 4d ago" },
    ],
  },
  {
    name: "Applied",
    count: 6,
    tone: "link" as const,
    cards: [
      { company: "Anthropic", role: "Staff AI Engineer", meta: "Tailored · 94 fit" },
      { company: "Stripe", role: "Systems Engineer", meta: "Applied 3d ago" },
    ],
  },
  {
    name: "Interview",
    count: 2,
    tone: "success" as const,
    cards: [
      { company: "Figma", role: "Staff Engineer", meta: "Fri, 2:00 PM" },
      { company: "Notion", role: "Product Eng", meta: "Round 2" },
    ],
  },
]

function scoreTone(score: number): Tone {
  if (score >= 90) return "success"
  if (score >= 85) return "link"
  return "warning"
}

/**
 * A real HTML preview of the dashboard rather than a downscaled screenshot.
 * It stays legible at every width, and the view switch plus the ranked-role
 * rows make the product's core loop tangible without pretending to be the app.
 */
export function DashboardMock() {
  const [view, setView] = useState<"today" | "pipeline">("today")
  const [selected, setSelected] = useState(0)
  const [prepared, setPrepared] = useState(false)
  const role = ROLES[selected]

  return (
    <div className="app-mock" role="group" aria-label="Interactive RoleSpec OS product preview">
      <aside className="app-mock-rail" aria-hidden="true">
        <p className="app-mock-rail-label">Workspace</p>
        <div className="app-mock-nav">
          <span data-active="true">Dashboard</span>
          <span>Jobs</span>
          <span>Workspace</span>
          <span>Resumes</span>
          <span>Profile</span>
        </div>
        <div className="app-mock-owner">
          <span className="app-mock-owner-mark">R</span>
          <span>
            <strong>Private owner</strong>
            <small>Local database</small>
          </span>
        </div>
      </aside>

      <div className="app-mock-main">
        <div className="app-mock-top">
          <div className="app-mock-path">
            <LogoMarkIcon className="app-mock-logo" />
            <span className="app-mock-path-name">RoleSpec OS</span>
            <span className="app-mock-path-slash">/</span>
            <strong>Dashboard</strong>
          </div>
          <div className="app-mock-tabs" role="group" aria-label="Preview view">
            <button
              type="button"
              className="app-mock-tab"
              aria-pressed={view === "today"}
              onClick={() => setView("today")}
            >
              Today
            </button>
            <button
              type="button"
              className="app-mock-tab"
              aria-pressed={view === "pipeline"}
              onClick={() => setView("pipeline")}
            >
              Pipeline
            </button>
          </div>
        </div>

        {view === "today" ? (
          <div className="app-mock-body">
            <div className="app-mock-head">
              <div>
                <p className="app-mock-kicker">Wednesday, Nov 14</p>
                <h2 className="app-mock-title">Today</h2>
              </div>
              <div className="app-mock-goal">
                <span>
                  <span>Daily goal</span>
                  <strong>2 / 3</strong>
                </span>
                <span className="app-mock-progress" aria-hidden="true">
                  <i style={{ width: "67%" }} />
                </span>
              </div>
            </div>

            <div className="app-mock-metrics">
              {METRICS.map((metric) => (
                <article key={metric.label} className="app-mock-metric">
                  <span className="app-mock-metric-label">{metric.label}</span>
                  <span className="app-mock-metric-value">
                    <strong>{metric.value}</strong>
                    <em className={`app-mock-pill app-mock-pill--${metric.tone}`}>{metric.pill}</em>
                  </span>
                  <span className="app-mock-metric-note">{metric.note}</span>
                </article>
              ))}
            </div>

            <div className="app-mock-columns">
              <section className="app-mock-panel">
                <div className="app-mock-panel-head">
                  <div>
                    <h3>Ranked for you</h3>
                    <p>Clear evidence first</p>
                  </div>
                  <span className="app-mock-count">3 roles</span>
                </div>
                <div className="app-mock-role-list">
                  {ROLES.map((item, index) => (
                    <button
                      key={item.company}
                      type="button"
                      className="app-mock-role"
                      aria-pressed={selected === index}
                      onClick={() => {
                        setSelected(index)
                        setPrepared(false)
                      }}
                    >
                      <span className="app-mock-avatar" style={{ background: item.tint }} aria-hidden="true">
                        {item.company.slice(0, 1)}
                      </span>
                      <span className="app-mock-role-copy">
                        <strong>{item.role}</strong>
                        <small>
                          {item.company} · {item.location}
                        </small>
                      </span>
                      <span className={`app-mock-score app-mock-score--${scoreTone(item.score)}`}>{item.score}</span>
                    </button>
                  ))}
                </div>
              </section>

              <aside className="app-mock-panel app-mock-why" aria-live="polite">
                <div className="app-mock-why-head">
                  <h3>Why this rank?</h3>
                  <span className="app-mock-fit">{role.score} fit</span>
                </div>
                <p className="app-mock-why-role">
                  {role.role} at {role.company}
                </p>
                <div className="app-mock-badges">
                  {role.factors.map((factor) => (
                    <span key={factor.label} className={`app-mock-badge app-mock-badge--${factor.tone}`}>
                      {factor.label} {factor.value}
                    </span>
                  ))}
                </div>
                <p className="app-mock-reason">{role.reason}</p>
                <div className="app-mock-factors">
                  {role.factors.map((factor) => (
                    <div key={factor.label} className="app-mock-factor">
                      <span>{factor.label}</span>
                      <span className="app-mock-meter">
                        <i data-tone={factor.tone} style={{ width: `${factor.value}%` }} />
                      </span>
                      <em>{factor.value}</em>
                    </div>
                  ))}
                </div>
              </aside>
            </div>

            <div className="app-mock-next">
              <div>
                <span className="app-mock-kicker">Next action</span>
                <strong>{prepared ? "Ready for your review" : `Tailor for ${role.role}`}</strong>
                <small>
                  {prepared
                    ? "Resume, cover letter and ATS answers are prepared."
                    : `${role.company} · resume + cover letter · about 8 min`}
                </small>
              </div>
              <button
                type="button"
                className="app-mock-next-action"
                aria-pressed={prepared}
                onClick={() => setPrepared((value) => !value)}
              >
                {prepared ? (
                  <>
                    <CheckIcon /> Prepared
                  </>
                ) : (
                  <>
                    Prepare <ChevronRightIcon />
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="app-mock-body">
            <div className="app-mock-head">
              <div>
                <p className="app-mock-kicker">This week</p>
                <h2 className="app-mock-title">Pipeline</h2>
              </div>
              <div className="app-mock-goal">
                <span>
                  <span>Weekly goal</span>
                  <strong>6 / 10</strong>
                </span>
                <span className="app-mock-progress" aria-hidden="true">
                  <i style={{ width: "60%" }} />
                </span>
              </div>
            </div>

            <div className="app-mock-pipeline">
              {PIPELINE.map((lane) => (
                <section key={lane.name} className="app-mock-lane">
                  <div className="app-mock-lane-head">
                    <span>{lane.name}</span>
                    <em>{lane.count}</em>
                  </div>
                  {lane.cards.map((card) => (
                    <div key={card.company} className="app-mock-job">
                      <strong>{card.company}</strong>
                      <span>{card.role}</span>
                      <em data-tone={lane.tone}>{card.meta}</em>
                    </div>
                  ))}
                </section>
              ))}
            </div>

            <div className="app-mock-next app-mock-next--static">
              <div>
                <span className="app-mock-kicker">Response rate</span>
                <strong>28% across 6 applications</strong>
                <small>2 interviews scheduled · 1 follow-up due today</small>
              </div>
              <span className="app-mock-week">This week</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
