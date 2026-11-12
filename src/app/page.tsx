import Link from "next/link"
import { redirect } from "next/navigation"
import {
  ArrowRight,
  Gauge,
  KeyRound,
  Mail,
  PanelRight,
  ReceiptText,
  Server,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  Target,
} from "lucide-react"
import { auth } from "@/features/auth/config"
import { buttonVariants } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { MarketingNav } from "@/features/marketing/components/marketing-nav"
import { MarketingFooter } from "@/features/marketing/components/marketing-footer"
import { InteractivePreview } from "@/features/marketing/components/interactive-preview"
import { HiggsfieldAura } from "@/features/marketing/components/higgsfield-aura"
import { AnimatedBadge } from "@/features/marketing/components/animated-badge"
import { SpotlightCard } from "@/features/marketing/components/spotlight-card"
import { ModelShowcase } from "@/features/marketing/components/model-showcase"
import {
  HeroReveal,
  HeroRevealItem,
} from "@/features/marketing/components/hero-reveal"
import {
  ScrollReveal,
  ScrollRevealItem,
} from "@/shared/components/scroll-reveal"

/** The modules that ship in the app today — nothing here is aspirational. */
const MODULES = [
  {
    icon: Sparkles,
    name: "Resume Studio",
    description:
      "A structured resume editor with AI enhance on every section, versions you can keep, and real PDF export.",
  },
  {
    icon: Gauge,
    name: "ATS Engine",
    description:
      "Score a resume against a real job description. Sub-scores per area and the exact keywords you are missing.",
  },
  {
    icon: SquareKanban,
    name: "Job Tracker",
    description:
      "A kanban pipeline across seven statuses — interested, applied, screening, interview, offer, rejected, withdrawn.",
  },
  {
    icon: Mail,
    name: "Outreach Composer",
    description:
      "Cover letters, cold emails, application emails and replies, drafted from the resume and job you already saved.",
  },
  {
    icon: Target,
    name: "Planner & Goals",
    description:
      "Todos, notes and a calendar next to a weekly application goal, so the search keeps a cadence.",
  },
  {
    icon: PanelRight,
    name: "Chrome Clipper",
    description:
      "Save job postings from Chrome and draft LinkedIn outreach without leaving the page.",
  },
] as const

const STEPS = [
  {
    step: "01",
    title: "Start with your resume",
    description:
      "Open your RoleSpec workspace. Import an existing PDF or DOCX resume, or build one from scratch.",
  },
  {
    step: "02",
    title: "Tailor it to the role",
    description:
      "Connect your local AI (Ollama / LM Studio) or cloud key. Compare your resume with a job description and export.",
  },
  {
    step: "03",
    title: "Apply, reach out, track",
    description:
      "Clip jobs from the browser, draft the outreach, and move every application across the pipeline until it lands.",
  },
] as const

const STACK = [
  {
    icon: ReceiptText,
    title: "100% Free & Open Source",
    description:
      "Licensed under AGPL-3.0. No subscriptions, no paywalls, no artificial feature gates.",
  },
  {
    icon: ShieldCheck,
    title: "Complete Privacy",
    description:
      "Your career data, resumes, and notes stay in your own database. No tracking, no data harvesting.",
  },
  {
    icon: KeyRound,
    title: "Local Offline Models or Cloud",
    description:
      "Keep it entirely local with Ollama or LM Studio at zero cost, or connect OpenAI, Anthropic, or DeepSeek directly.",
  },
  {
    icon: Server,
    title: "Self-host anywhere",
    description:
      "Run RoleSpec on your own infrastructure or as a native Windows desktop app. You own the database.",
  },
] as const

/** Shared section heading and supporting copy. */
function SectionHeading({
  headingId,
  title,
  blurb,
}: {
  headingId: string
  title: string
  blurb: string
}) {
  return (
    <ScrollRevealItem className="max-w-2xl space-y-3">
      <h2
        id={headingId}
        className="text-balance text-3xl font-bold tracking-tight sm:text-4xl"
      >
        {title}
      </h2>
      <p className="text-pretty text-muted-foreground">{blurb}</p>
    </ScrollRevealItem>
  )
}

export default async function LandingPage() {
  const session = await auth()
  if (session?.user?.id) redirect("/dashboard")

  return (
    <div className="force-dark dark flex min-h-screen flex-col bg-background text-foreground selection:bg-brand-500/30 selection:text-brand-200">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:p-3 focus:text-foreground focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <MarketingNav />

      <main id="main-content" tabIndex={-1} className="flex-1">
        {/* Hero Section with Higgsfield Generative Aura Animation */}
        <section
          aria-labelledby="hero-heading"
          className="relative overflow-hidden border-b border-border"
        >
          {/* Custom Javascript Fluid Particle Canvas */}
          <HiggsfieldAura />

          <HeroReveal className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-28">
            <div className="space-y-6">
              <HeroRevealItem>
                <AnimatedBadge />
              </HeroRevealItem>

              <HeroRevealItem>
                <h1
                  id="hero-heading"
                  className="max-w-2xl text-balance text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl"
                >
                  Build a stronger resume.
                  <br />
                  <span className="bg-gradient-to-r from-brand-300 via-indigo-300 to-purple-300 bg-clip-text text-transparent">
                    Keep your job search moving.
                  </span>
                </h1>
                <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                  Tailor your resume to any role with local or cloud AI, score against ATS filters, write customized outreach, and track every application on one private board.
                </p>
              </HeroRevealItem>

              <HeroRevealItem className="flex flex-col gap-3 sm:flex-row pt-2">
                <Link
                  href="/dashboard"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "min-h-12 text-sm font-semibold shadow-glow hover:shadow-glow-lg transition-all"
                  )}
                >
                  Open workspace
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="#how-it-works"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "min-h-12 text-sm backdrop-blur-sm hover:border-brand-500/50 transition-colors"
                  )}
                >
                  See how it works
                </Link>
              </HeroRevealItem>

              <HeroRevealItem>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-brand-400" />
                    AGPL-3.0 Open Source
                  </span>
                  <span>•</span>
                  <span>Runs 100% Offline with Ollama</span>
                  <span>•</span>
                  <span>Zero Telemetry</span>
                </div>
              </HeroRevealItem>
            </div>

            {/* Interactive framer-motion Product Preview */}
            <HeroRevealItem className="min-w-0">
              <InteractivePreview />
            </HeroRevealItem>
          </HeroReveal>
        </section>

        {/* Modules Section with Interactive Spotlight Cards */}
        <section
          id="features"
          aria-labelledby="features-heading"
          className="relative mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24"
        >
          <ScrollReveal>
            <SectionHeading
              headingId="features-heading"
              title="Everything for your next application"
              blurb="Your resumes, saved jobs, ATS scans and outreach stay connected, so you can pick up where you left off."
            />

            <ul className="mt-12 grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((module) => (
                <ScrollRevealItem as="li" key={module.name}>
                  <SpotlightCard className="h-full">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400 transition-transform group-hover:scale-110">
                      <module.icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 font-semibold text-foreground">{module.name}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                      {module.description}
                    </p>
                  </SpotlightCard>
                </ScrollRevealItem>
              ))}
            </ul>
          </ScrollReveal>
        </section>

        {/* How it works with Animated Connector Steps */}
        <section
          id="how-it-works"
          aria-labelledby="how-it-works-heading"
          className="relative scroll-mt-20 border-y border-border bg-card/40"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <ScrollReveal>
              <SectionHeading
                headingId="how-it-works-heading"
                title="From your resume to your next opportunity"
                blurb="A clear, repeatable workflow for each application, with your edits saved locally."
              />

              <div className="relative mt-12">
                <span
                  aria-hidden="true"
                  className="step-rail absolute left-[calc(33.333%-1rem)] top-11 hidden h-px w-6 md:block"
                />
                <span
                  aria-hidden="true"
                  className="step-rail absolute left-[calc(66.667%-0.5rem)] top-11 hidden h-px w-6 md:block"
                />
                <ol className="relative grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-3">
                  {STEPS.map((item) => (
                    <ScrollRevealItem as="li" key={item.step}>
                      <SpotlightCard className="h-full">
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-700/20 font-mono text-sm font-bold text-brand-300 shadow-glow-sm ring-1 ring-brand-700/50">
                          {item.step}
                        </span>
                        <h3 className="mt-4 text-base font-semibold sm:text-lg">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                          {item.description}
                        </p>
                      </SpotlightCard>
                    </ScrollRevealItem>
                  ))}
                </ol>
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* Local AI & Cloud Model Showcase */}
        <section
          id="ai-stack"
          aria-labelledby="ai-stack-heading"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24"
        >
          <ScrollReveal>
            <SectionHeading
              headingId="ai-stack-heading"
              title="Run locally with Ollama, or bring any model"
              blurb="RoleSpec is designed for complete model freedom. Run local GGUF models on your GPU without internet, or connect ChatGPT, Claude, and DeepSeek."
            />

            <ModelShowcase />
          </ScrollReveal>
        </section>

        {/* Own your stack */}
        <section
          id="pricing"
          aria-labelledby="pricing-heading"
          className="border-t border-border bg-card/20"
        >
          <div className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
            <ScrollReveal>
              <SectionHeading
                headingId="pricing-heading"
                title="Own your stack. Run it yourself."
                blurb="Free, open source, and self-hosted. You own the deployment, the database, and the career data."
              />

              <ul className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
                {STACK.map((item) => (
                  <ScrollRevealItem as="li" key={item.title}>
                    <SpotlightCard className="flex h-full items-start gap-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-700/20 text-brand-400 shadow-glow-sm ring-1 ring-brand-700/50">
                        <item.icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">{item.title}</h3>
                        <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed sm:text-sm">
                          {item.description}
                        </p>
                      </div>
                    </SpotlightCard>
                  </ScrollRevealItem>
                ))}
              </ul>
            </ScrollReveal>
          </div>
        </section>

        {/* Final CTA */}
        <section
          aria-labelledby="cta-heading"
          className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
        >
          <ScrollReveal>
            <ScrollRevealItem>
              <div className="relative overflow-hidden rounded-2xl border border-brand-500/30 bg-gradient-to-b from-card to-card/60 p-8 text-center sm:p-14 shadow-glow">
                <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-500/20 blur-3xl" />

                <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center gap-5">
                  <h2
                    id="cta-heading"
                    className="text-balance text-3xl font-extrabold tracking-tight sm:text-5xl"
                  >
                    Make your next application count
                  </h2>
                  <p className="text-pretty text-sm text-muted-foreground sm:text-base">
                    Start with your resume. Tailor it to a role with local or cloud AI. Keep every opportunity moving forward.
                  </p>
                  <Link
                    href="/dashboard"
                    className={cn(
                      buttonVariants({ size: "lg" }),
                      "min-h-12 w-full text-sm font-semibold shadow-glow hover:shadow-glow-lg transition-all sm:w-auto"
                    )}
                  >
                    Open workspace
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </ScrollRevealItem>
          </ScrollReveal>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
