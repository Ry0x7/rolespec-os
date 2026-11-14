"use client"

import Link from "next/link"
import {
  Activity,
  ArrowUpRight,
  Compass,
  Database,
  KeyRound,
  Palette,
  SlidersHorizontal,
  Sparkles,
  User,
} from "lucide-react"

import { Button } from "@/shared/ui/button"
import {
  Card,
  CardDescription,
  CardTitle,
} from "@/shared/ui/card"

interface OverviewItem {
  label: string
  href: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

interface OverviewGroup {
  label: string
  description: string
  items: OverviewItem[]
}

const GROUPS: OverviewGroup[] = [
  {
    label: "Account",
    description: "The basics about you and how you like to work.",
    items: [
      {
        label: "Profile",
        href: "/settings/profile",
        description: "Your name, email and the contact details employers see.",
        icon: User,
      },
      {
        label: "Preferences",
        href: "/settings/preferences",
        description: "Job alerts, salary currency and default instructions for the agent.",
        icon: SlidersHorizontal,
      },
    ],
  },
  {
    label: "Look & feel",
    description: "Make the app easier to read and use.",
    items: [
      {
        label: "Appearance",
        href: "/settings/appearance",
        description: "Light or dark mode, colour theme, motion and notification sound.",
        icon: Palette,
      },
    ],
  },
  {
    label: "AI & connections",
    description: "Choose the brain behind the agent and connect your tools.",
    items: [
      {
        label: "AI model",
        href: "/settings/ai",
        description: "Connect a provider, a local CLI, or your own subscription.",
        icon: Sparkles,
      },
      {
        label: "AI by task",
        href: "/settings/ai-stages",
        description: "Pick a different model for research, writing or checking.",
        icon: SlidersHorizontal,
      },
      {
        label: "Usage",
        href: "/settings/usage",
        description: "See how many tokens you used and what it likely cost.",
        icon: Activity,
      },
      {
        label: "Browser extension",
        href: "/settings/api",
        description: "Connect the extension that fills employer forms with your answers.",
        icon: KeyRound,
      },
    ],
  },
  {
    label: "Privacy & data",
    description: "You control what is stored and what leaves the app.",
    items: [
      {
        label: "Privacy & data",
        href: "/settings/data",
        description: "Download a copy of everything, or erase it for good.",
        icon: Database,
      },
    ],
  },
]

export function SettingsOverview() {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Set up your account, choose how the app looks, and connect the tools
            the agent uses. Nothing here is shared with an employer.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => window.dispatchEvent(new Event("rolespec:start-tour"))}
        >
          <Compass className="h-4 w-4" aria-hidden="true" />
          Replay the guided tour
        </Button>
      </div>

      {GROUPS.map((group) => (
        <section key={group.label} className="space-y-3" aria-labelledby={`settings-${group.label}`}>
          <div className="space-y-0.5">
            <h3 id={`settings-${group.label}`} className="text-sm font-semibold">
              {group.label}
            </h3>
            <p className="text-xs text-muted-foreground">{group.description}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Card variant="interactive" className="h-full p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-brand-400">
                      <item.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{item.label}</CardTitle>
                        <ArrowUpRight
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                          aria-hidden="true"
                        />
                      </div>
                      <CardDescription>{item.description}</CardDescription>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
