/* eslint-disable @next/next/no-img-element -- standalone showcase bundle */
import React from "react"
import { motion } from "framer-motion"

const SECTIONS = [
  {
    title: "Resume Studio",
    body: "A structured editor with AI polish on every section, side-by-side diffs against your original, and one-click rollback to any revision. Export real PDFs in eight templates.",
    img: "RoleSpecOS/resume-editor.png",
    alt: "Resume Studio preview with a tailored bullet and matched keywords",
    width: 656,
    height: 490,
  },
  {
    title: "Job discovery",
    body: "Clip postings from your browser and keep them with salary signals, work type and fit scores. Everything lands on the same board as your applications — nothing gets lost in a tab.",
    img: "RoleSpecOS/jobs-discover.png",
    alt: "The feature grid showing Job Tracker, Chrome Clipper and the other tools",
    width: 1060,
    height: 570,
  },
  {
    title: "ATS, without the guesswork",
    body: "Score a resume against the actual job description. Sub-scores per area, the exact keywords you're missing, and one concrete fix at a time — not a black-box number.",
    img: "RoleSpecOS/ats-chips.png",
    alt: "ATS keyword chips with a 96 percent match score",
    width: 656,
    height: 288,
  },
]

export function FeatureSections() {
  return (
    <section id="features" aria-label="Features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-16">
        {SECTIONS.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className={`grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16 ${i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""}`}
          >
            <div>
              <h3 className="text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">{s.title}</h3>
              <p className="mt-4 max-w-md text-pretty text-base leading-relaxed sm:text-lg" style={{ color: "var(--text-2)" }}>
                {s.body}
              </p>
            </div>
            <div className="shot">
              <img src={s.img} alt={s.alt} width={s.width} height={s.height} loading="lazy" />
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
