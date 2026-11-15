import React, { useState, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig, motion } from "framer-motion"
import { DownloadIcon, ChevronRightIcon } from "./components/icons"

import { ShowcaseNav } from "./components/showcase-nav"
import { WorkflowPreview } from "./components/workflow-preview"
import { FeatureSections } from "./components/feature-sections"
import { ModelMatrix } from "./components/model-matrix"
import { QuickstartTabs } from "./components/quickstart-tabs"
import { ShowcaseFooter } from "./components/showcase-footer"
import { DashboardMock } from "./components/dashboard-mock"

const RELEASES_URL = "https://github.com/Ry0x7/rolespec-os/releases/latest"

function ShowcaseApp() {
  const [isReducedMotion, setIsReducedMotion] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    const stored = localStorage.getItem("rolespec-motion")
    if (stored === "reduced") return true
    if (stored === "full") return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  })

  useEffect(() => {
    const root = document.documentElement
    if (isReducedMotion) {
      root.classList.add("reduce-motion")
      root.classList.remove("motion-full")
    } else {
      root.classList.add("motion-full")
      root.classList.remove("reduce-motion")
    }
  }, [isReducedMotion])

  // Theme: stored choice wins, otherwise follow the OS. The pre-paint script
  // in index.html applies the same logic before first paint (no flash).
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light"
    const stored = localStorage.getItem("rolespec-theme")
    if (stored === "dark" || stored === "light") return stored
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    localStorage.setItem("rolespec-theme", theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute("content", theme === "dark" ? "#000000" : "#ffffff")
  }, [theme])

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"))

  const toggleMotion = () => {
    setIsReducedMotion((prev) => {
      const next = !prev
      localStorage.setItem("rolespec-motion", next ? "reduced" : "full")
      return next
    })
  }

  return (
    <MotionConfig reducedMotion={isReducedMotion ? "always" : "never"}>
      <div className="relative min-h-screen" style={{ background: "var(--background)", color: "var(--text)" }}>
        <a href="#main-content" className="skip-link">Skip to content</a>
        <ShowcaseNav isReducedMotion={isReducedMotion} onToggleMotion={toggleMotion} theme={theme} onToggleTheme={toggleTheme} />

        <main id="main-content">
          {/* HERO — headline, action, product. Nothing else. */}
          <section aria-labelledby="hero-heading" className="mx-auto max-w-5xl px-4 pb-12 pt-16 text-center sm:px-6 sm:pt-24">
            <motion.h1
              id="hero-heading"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-6xl lg:text-7xl"
            >
              Your job search,<br />in one private place.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed sm:text-xl"
              style={{ color: "var(--text-2)" }}
            >
              Tailor your resume to any role, score against ATS filters, let the
              agent prepare the application, and track every step — on your own
              machine.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="btn-primary">
                <DownloadIcon className="h-5 w-5" />
                Download for Windows
              </a>
              <a href="#workflows" className="link-more">
                See how it works
                <ChevronRightIcon className="h-4 w-4" />
              </a>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-6 text-sm"
              style={{ color: "var(--text-3)" }}
            >
              Free for personal use · Runs offline · Zero telemetry
            </motion.p>

            {/* The product, as an interactive mock rather than a downscaled
                screenshot. Text stays readable, and there is no 3D transform to
                clip the frame's corners. */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto mt-12 max-w-4xl"
            >
              <div className="hero-demo-frame">
                <DashboardMock />
              </div>
              <p className="mx-auto mt-4 max-w-xl text-sm text-pretty" style={{ color: "var(--text-3)" }}>
                Interactive product preview — switch between Today and Pipeline, click a ranked role to see its evidence, or prepare the next application.
              </p>
            </motion.div>
          </section>

          <WorkflowPreview isReducedMotion={isReducedMotion} />
          <FeatureSections />
          <ModelMatrix />
          <QuickstartTabs />
        </main>

        <ShowcaseFooter />
      </div>
    </MotionConfig>
  )
}

const rootElement = document.getElementById("root")
if (rootElement) {
  createRoot(rootElement).render(<ShowcaseApp />)
}
