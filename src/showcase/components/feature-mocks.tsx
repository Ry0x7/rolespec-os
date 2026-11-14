import React from "react"

import { CheckIcon, ChevronRightIcon } from "./icons"

export type FeatureMockKind = "resume" | "board" | "agent" | "ats" | "pipeline"

function Chrome({ label, badge }: { label: string; badge?: string }) {
  return (
    <div className="fm-chrome">
      <span className="fm-app-name">RoleSpec OS</span>
      <span className="fm-view-name">{label}</span>
      {badge && <span className="fm-chip fm-chip--success">{badge}</span>}
    </div>
  )
}

function ResumeMock() {
  const sections = [
    { index: "01", title: "Contact", meta: "5 fields complete", done: true },
    { index: "02", title: "Executive Summary", meta: "3 bullets · tailored", done: true },
    { index: "03", title: "Work Experience", meta: "4 roles · 12 bullets", done: false, open: true },
    { index: "04", title: "Technical Skills", meta: "18 skills", done: true },
    { index: "05", title: "Education", meta: "2 entries", done: true },
  ]

  return (
    <div className="feature-mock">
      <Chrome label="Resume Studio" badge="ATS 94" />
      <div className="fm-resume">
        <div className="fm-editor">
          <div className="fm-editor-head">
            <span className="fm-kicker">Tailored for</span>
            <strong>Anthropic · Staff AI Engineer</strong>
          </div>
          <div className="fm-sections">
            {sections.map((section) => (
              <div key={section.index} className={`fm-section ${section.open ? "is-open" : ""}`}>
                <span className="fm-index">{section.index}</span>
                <span className="fm-section-copy">
                  <strong>{section.title}</strong>
                  <small>{section.meta}</small>
                </span>
                {section.done ? (
                  <span className="fm-check">
                    <CheckIcon />
                  </span>
                ) : (
                  <span className="fm-chevron">
                    <ChevronRightIcon />
                  </span>
                )}
              </div>
            ))}
          </div>
          {/*
           * The active section is the only place the mock shows body copy; the
           * rest stays structural so the panel reads at a glance.
           */}
          <div className="fm-change">
            <span className="fm-change-label">AI polish</span>
            <p>“Architected high-throughput vLLM inference across 32 H100 nodes, cutting P99 latency 44%.”</p>
          </div>
        </div>

        <div className="fm-paper-pane">
          <div className="fm-paper">
            <strong>Alex Morgan</strong>
            <span>Staff Software Engineer</span>
            <small>San Francisco · alex.morgan@email.com</small>
            <i className="fm-paper-rule" />
            <p className="fm-paper-section">SUMMARY</p>
            <p className="fm-paper-copy">Staff engineer with 8 years building high-throughput inference and distributed systems.</p>
            <p className="fm-paper-section">EXPERIENCE</p>
            <div className="fm-paper-entry">
              <strong>Vercel</strong>
              <span>Staff Software Engineer · 2022—Now</span>
            </div>
            <i className="fm-paper-line" />
            <i className="fm-paper-line fm-paper-line--short" />
            <div className="fm-paper-entry">
              <strong>Chroma</strong>
              <span>Senior Software Engineer</span>
            </div>
            <i className="fm-paper-line" />
            <i className="fm-paper-line fm-paper-line--short" />
          </div>
        </div>
      </div>
    </div>
  )
}

const BOARD_COLUMNS = [
  {
    title: "Saved",
    count: 4,
    jobs: [
      { company: "Linear", role: "Product Engineer", score: 91, tag: "Tailored" },
      { company: "Vercel", role: "Design Engineer", score: 88, tag: "Review" },
    ],
  },
  {
    title: "Applied",
    count: 6,
    jobs: [
      { company: "Anthropic", role: "Staff AI Engineer", score: 94, tag: "Follow up" },
      { company: "Stripe", role: "Systems Engineer", score: 87, tag: "3 days" },
    ],
  },
  {
    title: "Interview",
    count: 2,
    jobs: [
      { company: "Figma", role: "Staff Engineer", score: 92, tag: "Fri, 2 PM" },
      { company: "Notion", role: "Product Eng", score: 89, tag: "Round 2" },
    ],
  },
]

function BoardMock() {
  return (
    <div className="feature-mock">
      <Chrome label="Saved jobs" badge="12 active" />
      <div className="fm-board">
        <div className="fm-board-head">
          <div>
            <span className="fm-kicker">Application board</span>
            <strong>Every role, one next step</strong>
            <p>Fit, status and follow-up in the same row.</p>
          </div>
          <span className="fm-chip fm-chip--warning">3 due</span>
        </div>
        <div className="fm-columns">
          {BOARD_COLUMNS.map((column) => (
            <div key={column.title} className="fm-column">
              <div className="fm-column-head">
                <span>{column.title}</span>
                <em>{column.count}</em>
              </div>
              {column.jobs.map((job) => (
                <div key={job.company} className="fm-job">
                  <div className="fm-job-head">
                    <span className="fm-job-mark">{job.company.slice(0, 1)}</span>
                    <span className="fm-job-copy">
                      <strong>{job.company}</strong>
                      <small>{job.role}</small>
                    </span>
                    <em className="fm-score">{job.score}</em>
                  </div>
                  <div className="fm-job-meta">
                    <span className="fm-chip">{job.tag}</span>
                    <span>2d</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AgentMock() {
  const steps = [
    { label: "Research", meta: "Company + role evidence", done: true },
    { label: "Rank", meta: "94 fit · 8 of 9 must-haves", done: true },
    { label: "Tailor", meta: "Resume + cover letter", done: true },
    { label: "Validate", meta: "8 of 9 claims grounded", done: true },
    { label: "Your review", meta: "Approve before submit", done: false, active: true },
  ]

  return (
    <div className="feature-mock">
      <Chrome label="Apply with agent" badge="Human review" />
      <div className="fm-agent">
        <div className="fm-agent-head">
          <span className="fm-kicker">Anthropic · Staff AI Engineer</span>
          <strong>Prepare application</strong>
          <p>The agent does the work. You make the call.</p>
        </div>
        <div className="fm-steps">
          {steps.map((step, index) => (
            <div key={step.label} className={`fm-step ${step.done ? "is-done" : ""} ${step.active ? "is-active" : ""}`}>
              <span className="fm-step-index">
                {step.done ? <CheckIcon /> : index + 1}
              </span>
              <span className="fm-step-copy">
                <strong>{step.label}</strong>
                <small>{step.meta}</small>
              </span>
              {step.done && <span className="fm-chip fm-chip--success">Done</span>}
              {step.active && <span className="fm-chip fm-chip--link">Now</span>}
            </div>
          ))}
        </div>
        <div className="fm-agent-progress">
          <span>
            <span>Package readiness</span>
            <strong>92%</strong>
          </span>
          <i>
            <span style={{ width: "92%" }} />
          </i>
        </div>
        <div className="fm-agent-foot">
          <span className="fm-button">Review prepared package</span>
          <span className="fm-chip">Never auto-submits</span>
        </div>
      </div>
    </div>
  )
}

function AtsMock() {
  return (
    <div className="feature-mock">
      <Chrome label="Resume quality" badge="Job match 94" />
      <div className="fm-ats">
        <div className="fm-ats-top">
          <div className="fm-ring" style={{ background: "conic-gradient(var(--success) 0 94%, var(--border-soft) 94% 100%)" }}>
            <span>
              <strong>94</strong>
              <small>Quality</small>
            </span>
          </div>
          <div className="fm-ats-copy">
            <span className="fm-kicker">Staff AI Engineer</span>
            <strong>Strong match</strong>
            <p>11 of 12 must-haves covered. Two fixes left.</p>
          </div>
        </div>

        <div className="fm-ats-bars">
          {[
            { label: "Keyword density", value: 98 },
            { label: "Hard requirements", value: 91 },
            { label: "Semantic cohesion", value: 95 },
          ].map((bar) => (
            <div key={bar.label} className="fm-ats-bar">
              <span>{bar.label}</span>
              <i>
                <span style={{ width: `${bar.value}%` }} />
              </i>
              <em>{bar.value}%</em>
            </div>
          ))}
        </div>

        <div className="fm-tokens">
          <span className="fm-chip fm-chip--success">pgvector</span>
          <span className="fm-chip fm-chip--success">vLLM</span>
          <span className="fm-chip fm-chip--success">Kubernetes</span>
          <span className="fm-chip fm-chip--warning">CUDA +3.2</span>
          <span className="fm-chip fm-chip--warning">Speculative decoding +2.8</span>
        </div>

        <div className="fm-suggestion">
          <span className="fm-kicker">Suggested fix</span>
          <p>Add one bullet about CUDA kernel benchmarks for batch inference to raise the score toward 99.</p>
        </div>
      </div>
    </div>
  )
}

const STAGES = [
  { label: "Interested", count: 4, width: 40 },
  { label: "Applied", count: 6, width: 60 },
  { label: "Screening", count: 3, width: 34 },
  { label: "Interview", count: 2, width: 24 },
  { label: "Offer", count: 1, width: 12 },
]

function PipelineMock() {
  return (
    <div className="feature-mock">
      <Chrome label="Pipeline" badge="Week 6 / 10" />
      <div className="fm-pipeline">
        <div className="fm-pipeline-head">
          <div>
            <span className="fm-kicker">Application pipeline</span>
            <strong>28% response rate</strong>
            <p>6 applications · 2 interviews · 1 offer</p>
          </div>
          <span className="fm-chip fm-chip--success">On track</span>
        </div>

        <div className="fm-stages">
          {STAGES.map((stage) => (
            <div key={stage.label} className="fm-stage">
              <span>{stage.label}</span>
              <i>
                <span style={{ width: `${stage.width}%` }} />
              </i>
              <em>{stage.count}</em>
            </div>
          ))}
        </div>

        <div className="fm-activity">
          <div className="fm-activity-head">
            <span className="fm-kicker">Recent activity</span>
            <span>This week</span>
          </div>
          <div className="fm-activity-row">
            <span className="fm-job-mark">F</span>
            <span>
              <strong>Figma</strong>
              <small>Interview scheduled · Fri, 2:00 PM</small>
            </span>
            <em>Next</em>
          </div>
          <div className="fm-activity-row">
            <span className="fm-job-mark">S</span>
            <span>
              <strong>Stripe</strong>
              <small>Follow-up sent · 2 days ago</small>
            </span>
            <em className="is-muted">Waiting</em>
          </div>
          <div className="fm-activity-row">
            <span className="fm-job-mark">N</span>
            <span>
              <strong>Notion</strong>
              <small>Round 2 feedback received</small>
            </span>
            <em className="is-success">Advance</em>
          </div>
        </div>
      </div>
    </div>
  )
}

const MOCKS: Record<FeatureMockKind, () => React.JSX.Element> = {
  resume: ResumeMock,
  board: BoardMock,
  agent: AgentMock,
  ats: AtsMock,
  pipeline: PipelineMock,
}

export function FeatureMock({ kind }: { kind: FeatureMockKind }) {
  const Mock = MOCKS[kind]
  return <Mock />
}
