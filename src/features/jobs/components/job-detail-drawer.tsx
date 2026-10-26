"use client"

import Link from "next/link"
import { ArrowRight, CalendarClock, FileText, PenLine } from "lucide-react"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Drawer, DrawerBody, DrawerHeader } from "@/shared/ui/drawer"
import { cn } from "@/shared/lib/utils"
import { formatCalendarDate } from "@/shared/lib/dates"
import { jobDetailHref } from "../lib/job-detail-href"
import { QuickActionButtons } from "./quick-action-buttons"
import { StatusBadge } from "./status-badge"
import type { JobApplicationCardData } from "./job-application-card"

interface JobDetailDrawerProps {
  application: JobApplicationCardData | null
  open: boolean
  onClose: () => void
}

/**
 * Quick-view drawer for the `/jobs` list: the full lifecycle without leaving
 * the board. Status, next step, quick actions, deadline, and one-click
 * entry points into Tailor (resume match), Cover letter, and the full page.
 * Read-only besides the quick actions — edits stay on the detail page.
 */
export function JobDetailDrawer({ application, open, onClose }: JobDetailDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-md"
      aria-labelledby="job-drawer-title"
    >
      {application ? (
        <>
          <DrawerHeader>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Quick view
              </p>
              <h2 id="job-drawer-title" className="text-base font-semibold">
                {application.job.companyName}
              </h2>
              <p className="truncate text-sm text-muted-foreground">{application.job.title}</p>
            </div>
          </DrawerHeader>
          <DrawerBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={application.status} />
              {application.job.location ? (
                <span className="text-xs text-muted-foreground">{application.job.location}</span>
              ) : null}
            </div>

            <p className="text-sm text-foreground">{application.nextStep.label}</p>

            {application.quickActions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <QuickActionButtons
                  applicationId={application.id}
                  companyName={application.job.companyName}
                  actions={application.quickActions}
                />
              </div>
            ) : null}

            <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Deadline</dt>
                <dd className="flex items-center gap-1 font-medium">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  {application.job.deadline
                    ? formatCalendarDate(application.job.deadline)
                    : "None"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Cover letters</dt>
                <dd className="font-medium">
                  {application._count.coverLetters > 0
                    ? `${application._count.coverLetters}`
                    : "None yet"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Posting</dt>
                <dd className="truncate text-xs text-muted-foreground">
                  {application.provenance}
                </dd>
              </div>
            </dl>

            {application.job.description ? (
              <p className="line-clamp-6 whitespace-pre-line text-sm text-muted-foreground">
                {application.job.description.slice(0, 900)}
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-2">
              <Link
                href={jobDetailHref(application.id, "prepare")}
                className={cn(buttonVariants({ variant: "default" }), "w-full")}
              >
                <PenLine className="h-4 w-4" aria-hidden="true" />
                Tailor resume & check match
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href={
                    application.coverLetters[0]
                      ? `/jobs/cover-letter/${application.coverLetters[0].id}`
                      : `/jobs/cover-letter/new?jobId=${application.id}`
                  }
                  className={cn(buttonVariants({ variant: "outline" }), "w-full")}
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {application.coverLetters[0] ? "Open letter" : "Cover letter"}
                </Link>
                <Link
                  href={jobDetailHref(application.id)}
                  className={cn(buttonVariants({ variant: "outline" }), "w-full")}
                >
                  Full details
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>

            <Button variant="ghost" className="w-full" onClick={onClose}>
              Close
            </Button>
          </DrawerBody>
        </>
      ) : null}
    </Drawer>
  )
}
