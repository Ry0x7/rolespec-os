import React from "react"
import { motion } from "framer-motion"
import { ShotImage } from "./shot-image"

const SECTIONS = [
  {
    title: "Resume Studio",
    body: "A structured editor with AI polish on every section, a live ATS score, and a PDF that exports in eight templates. Your master resume stays the source of truth.",
    light: "resume-editor.png",
    dark: "resume-editor-dark.png",
    alt: "The Resume Studio editing a tailored resume with a 94 ATS score and a live PDF preview",
  },
  {
    title: "Every application, one board",
    body: "Saved roles, fit signals, follow-ups and the next action sit together — not in a spreadsheet, five tabs and your memory. Nothing gets lost in the handoff.",
    light: "jobs.png",
    dark: "jobs-dark.png",
    alt: "The Job Applications board with saved roles, status badges and Apply with agent actions",
  },
  {
    title: "Apply with the agent",
    body: "One click researches the company, ranks the role, tailors and validates the resume, and prepares the application facts. It stops for your review; final submit stays with you.",
    light: "job-prepare.png",
    dark: "job-prepare-dark.png",
    alt: "The Apply with the agent panel on a job, with agent-assisted mode selected and a Run agent preparation button",
  },
  {
    title: "ATS, without the guesswork",
    body: "Open the score, the sub-scores and every concrete suggestion in one drawer. Re-analyze after an edit instead of guessing which bullet moved the number.",
    light: "job-ats.png",
    dark: "job-ats-dark.png",
    alt: "The Resume Quality drawer showing a 94 score, category scores and two specific suggestions",
  },
  {
    title: "The pipeline, not a spreadsheet",
    body: "Drag applications across seven statuses and keep the weekly goal, response rate and follow-ups in the same view. The board is the tracker.",
    light: "workspace.png",
    dark: "workspace-dark.png",
    alt: "The workspace pipeline board with Interested, Applied, Screening, Interview and Offer columns",
  },
]

export function FeatureSections() {
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
            <div className="shot">
              <ShotImage
                light={section.light}
                dark={section.dark}
                alt={section.alt}
                width={1440}
                height={960}
                loading="lazy"
              />
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
