"use client"

import { ScrollReveal, ScrollRevealItem } from "@/shared/components/scroll-reveal"
import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"
import { useLinkedin } from "../hooks/use-linkedin"
import type { LinkedinSuggestionData } from "../services/linkedin.service"
import {
  LinkedinAssistResults,
  LinkedinAssistResultsSkeleton,
} from "./linkedin-assist-results"
import { LinkedinBenchmarkNarrative } from "./linkedin-benchmark-narrative"
import {
  LinkedinIssues,
  LinkedinResultsEmpty,
  LinkedinResultsSkeleton,
  LinkedinSuggestions,
} from "./linkedin-findings"
import {
  LinkedinSourcePanel,
  type LinkedinResumeOption,
} from "./linkedin-source-panel"
import { LinkedinStatsSidebar } from "./linkedin-stats-sidebar"

interface LinkedinViewProps {
  initialLinkedin: ProfileRatingData | null
  initialLinkedinSuggestions?: LinkedinSuggestionData | null
  resumeOptions?: LinkedinResumeOption[]
}

export function LinkedinView({
  initialLinkedin,
  initialLinkedinSuggestions = null,
  resumeOptions = [],
}: LinkedinViewProps) {
  const {
    linkedin,
    linkedinSuggestions,
    isRatingLinkedIn,
    isAssistingLinkedIn,
    linkedinError,
    setLinkedinError,
    runLinkedIn,
    runLinkedInAssist,
    selectedResumeId,
    setSelectedResumeId,
    contextUsed,
  } = useLinkedin({
    linkedin: initialLinkedin,
    linkedinSuggestions: initialLinkedinSuggestions,
  })

  const issues = linkedin?.issues ?? []
  const suggestions = linkedin?.suggestions?.items ?? []

  const sourcePanel = (
    <LinkedinSourcePanel
      isPending={isRatingLinkedIn}
      isAssisting={isAssistingLinkedIn}
      error={linkedinError}
      onRate={runLinkedIn}
      onAssist={runLinkedInAssist}
      onError={setLinkedinError}
      resumeOptions={resumeOptions}
      selectedResumeId={selectedResumeId}
      onSelectedResumeIdChange={setSelectedResumeId}
    />
  )

  /**
   * Before the first run there is nothing for the stats rail to hold, so the
   * three-column layout would leave a near-empty column beside a tall upload
   * card. The pre-scan state is its own even two-column row instead.
   */
  const nothingToShow =
    !linkedin &&
    !linkedinSuggestions &&
    !isRatingLinkedIn &&
    !isAssistingLinkedIn

  if (nothingToShow) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {sourcePanel}
        <LinkedinResultsEmpty className="h-full" />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* One fluid scroll: source → context → actions → results. */}
      <div className="space-y-4 lg:col-span-2 lg:space-y-6">
        {sourcePanel}

        {isRatingLinkedIn ? (
          <LinkedinResultsSkeleton />
        ) : !linkedin ? (
          <LinkedinResultsEmpty />
        ) : (
          <ScrollReveal className="space-y-4 lg:space-y-6">
            {linkedin.benchmark && (
              <ScrollRevealItem>
                <LinkedinBenchmarkNarrative benchmark={linkedin.benchmark} />
              </ScrollRevealItem>
            )}
            {issues.length > 0 && (
              <ScrollRevealItem>
                <LinkedinIssues issues={issues} />
              </ScrollRevealItem>
            )}
            {suggestions.length > 0 && (
              <ScrollRevealItem>
                <LinkedinSuggestions suggestions={suggestions} />
              </ScrollRevealItem>
            )}
          </ScrollReveal>
        )}

        {isAssistingLinkedIn ? (
          <LinkedinAssistResultsSkeleton />
        ) : linkedinSuggestions ? (
          <ScrollReveal>
            <ScrollRevealItem>
              <LinkedinAssistResults data={linkedinSuggestions} />
            </ScrollRevealItem>
          </ScrollReveal>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4 lg:col-span-1 lg:max-h-[calc(100dvh-6.5rem)] lg:gap-6 lg:overflow-y-auto lg:sticky lg:top-20 lg:self-start">
        <LinkedinStatsSidebar
          rating={linkedin}
          isPending={isRatingLinkedIn}
          contextUsed={contextUsed}
        />
      </aside>
    </div>
  )
}
