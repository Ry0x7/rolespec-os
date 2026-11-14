import React, { useState } from "react"
import { motion } from "framer-motion"

import { FeatureMock, type FeatureMockKind } from "./feature-mocks"
import { MockDialog, MockStage, type MockGalleryItem } from "./mock-stage"

interface FeatureSection {
  title: string
  body: string
  kind: FeatureMockKind
  mockAlt: string
}

const SECTIONS: FeatureSection[] = [
  {
    title: "Resume Studio",
    body: "A structured editor with AI polish on every section, a live ATS score, and a PDF that exports in eight templates. Your master resume stays the source of truth.",
    kind: "resume",
    mockAlt: "Resume Studio showing a tailored resume, section editor and 94 ATS score",
  },
  {
    title: "Every application, one board",
    body: "Saved roles, fit signals, follow-ups and the next action sit together — not in a spreadsheet, five tabs and your memory. On a phone the same board becomes one readable column, so nothing gets lost in the handoff.",
    kind: "board",
    mockAlt: "Job applications board with saved, applied and interview columns, fit scores and follow-up labels",
  },
  {
    title: "Apply with the agent",
    body: "One click researches the company, ranks the role, tailors and validates the resume, and prepares the application facts. It stops for your review; final submit stays with you.",
    kind: "agent",
    mockAlt: "Agent preparation showing research, ranking, tailoring, validation and a human review step",
  },
  {
    title: "ATS, without the guesswork",
    body: "Open the score, the sub-scores and every concrete suggestion in one drawer. Re-analyze after an edit instead of guessing which bullet moved the number.",
    kind: "ats",
    mockAlt: "Resume quality view with a 94 score, category scores, matched tokens and one suggested fix",
  },
  {
    title: "The pipeline, not a spreadsheet",
    body: "Drag applications across seven statuses on desktop, or work one column at a time on a phone. The weekly goal, response rate and follow-ups stay in the same view, without a sideways scroll.",
    kind: "pipeline",
    mockAlt: "Application pipeline with stage counts, a 28 percent response rate and recent activity",
  },
]

const ITEMS: MockGalleryItem[] = SECTIONS.map((section) => ({
  title: section.title,
  caption: section.mockAlt,
  render: () => <FeatureMock kind={section.kind} />,
}))

export function FeatureSections() {
  const [openIndex, setOpenIndex] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)

  function openPreview(index: number) {
    setOpenIndex(index)
    setDialogOpen(true)
  }

  return (
    <section id="features" aria-label="Features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-16">
        {SECTIONS.map((section, index) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className={`grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16 ${index % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""}`}
          >
            <div>
              <h3 className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">{section.title}</h3>
              <p className="mt-4 max-w-md text-pretty text-base leading-relaxed sm:text-lg" style={{ color: "var(--text-2)" }}>
                {section.body}
              </p>
            </div>
            <MockStage item={ITEMS[index]} onExpand={() => openPreview(index)} />
          </motion.div>
        ))}
      </div>

      <MockDialog
        open={dialogOpen}
        items={ITEMS}
        index={openIndex}
        onIndexChange={setOpenIndex}
        onClose={() => setDialogOpen(false)}
      />
    </section>
  )
}
