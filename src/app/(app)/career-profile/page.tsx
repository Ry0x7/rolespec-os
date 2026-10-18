import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/features/auth/config"
import { PageShell } from "@/shared/components/page-shell"
import { buttonVariants } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { CapabilitiesCard } from "@/features/career-profile/components/capabilities-card"
import { ContactsForm } from "@/features/career-profile/components/contacts-form"
import { EvidenceCard } from "@/features/career-profile/components/evidence-card"
import { ImportLinkedinCard } from "@/features/career-profile/components/import-linkedin-card"
import { PreferencesForm } from "@/features/career-profile/components/preferences-form"
import { ProfileSectionNav } from "@/features/career-profile/components/profile-section-nav"
import { CareerSetupWizard } from "@/features/career-profile/components/setup/career-setup-wizard"
import { TargetRolesCard } from "@/features/career-profile/components/target-roles-card"
import {
  computeSectionCompleteness,
  summarizeSectionCompleteness,
} from "@/features/career-profile/lib/section-completeness"
import { loadCareerProfile } from "@/features/career-profile/services/career-profile.service"

/** `searchParams` is a promise in Next.js 16. */
export default async function CareerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  // Everything below is read through the session user's own profile id — there
  // is no route parameter to tamper with.
  const profile = await loadCareerProfile(session.user.id)
  const { setup } = await searchParams

  // A profile that says nothing about direction has never been filled in, so
  // the guided setup is the more useful first screen than four empty cards.
  const needsSetup =
    !profile.experienceLevel && profile.targetRoles.length === 0 && !profile.careerGoals
  const pinned = setup === "1"
  // `?setup=0` is how the wizard says "the user chose the cards instead" — a
  // still-empty profile would otherwise be handed straight back to `needsSetup`.
  const declined = setup === "0"

  const familyNameById = new Map(profile.roleFamilies.map((f) => [f.id, f.name]))
  const evidenceTitleById = new Map(profile.evidence.map((e) => [e.id, e.title]))

  const sectionItems = computeSectionCompleteness({
    contactFullName: profile.contactFullName,
    contactEmail: profile.contactEmail,
    experienceLevel: profile.experienceLevel,
    activeTargetRoleCount: profile.targetRoles.filter((role) => role.active).length,
    evidenceCount: profile.evidence.length,
    capabilityCount: profile.capabilities.length,
  })
  const sectionSummary = summarizeSectionCompleteness(sectionItems)

  if (pinned || (needsSetup && !declined)) {
    return (
      <PageShell>
        <CareerSetupWizard
          pinned={pinned}
          exitHref={needsSetup ? "/career-profile?setup=0" : "/career-profile"}
          preferences={{
            experienceLevel: profile.experienceLevel,
            locations: profile.locations,
            openToRelocation: profile.openToRelocation,
            workModes: profile.workModes,
            workAuthorization: profile.workAuthorization,
            requiresSponsorship: profile.requiresSponsorship,
            salaryMin: profile.salaryMin,
            salaryMax: profile.salaryMax,
            salaryPeriod: profile.salaryPeriod,
            salaryCurrency: profile.salaryCurrency,
            careerGoals: profile.careerGoals,
          }}
          targetRoles={profile.targetRoles.map((role) => ({
            id: role.id,
            title: role.title,
          }))}
          evidence={profile.evidence.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            organization: item.organization,
          }))}
          capabilities={profile.capabilities.map((capability) => ({
            id: capability.id,
            name: capability.name,
          }))}
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Career Profile</h1>
          <p className="text-sm text-muted-foreground">
            Your private, canonical record of what you have done, what you can do, and
            where you want to go.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {sectionSummary.complete} of {sectionSummary.total} sections complete
          </p>
        </div>
        <Link
          href="/career-profile?setup=1"
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        >
          Guided setup
        </Link>
      </div>

      <ProfileSectionNav items={sectionItems} />

      {/*
        Both forms below are keyed on the profile's own `updatedAt` so a
        `router.refresh()` after a save remounts them against the row that was
        just written. Without it a `<select>` kept the option that was selected
        when the page first loaded, which read as "my change did not save" even
        though it had.
      */}
      <div id="contact" className="scroll-mt-28">
        <ContactsForm
          key={`contacts-${profile.updatedAt.toISOString()}`}
          values={{
            contactFullName: profile.contactFullName,
            contactEmail: profile.contactEmail,
            contactPhone: profile.contactPhone,
            contactLocation: profile.contactLocation,
            linkedinUrl: profile.linkedinUrl,
            githubUrl: profile.githubUrl,
            websiteUrl: profile.websiteUrl,
          }}
        />
      </div>

      <div id="preferences" className="scroll-mt-28">
        <PreferencesForm
          key={profile.updatedAt.toISOString()}
          values={{
            experienceLevel: profile.experienceLevel,
            locations: profile.locations,
            openToRelocation: profile.openToRelocation,
            workModes: profile.workModes,
            workAuthorization: profile.workAuthorization,
            requiresSponsorship: profile.requiresSponsorship,
            salaryMin: profile.salaryMin,
            salaryMax: profile.salaryMax,
            salaryPeriod: profile.salaryPeriod,
            salaryCurrency: profile.salaryCurrency,
            careerGoals: profile.careerGoals,
          }}
        />
      </div>

      <div id="target-roles" className="scroll-mt-28">
        <TargetRolesCard
          roleFamilies={profile.roleFamilies.map((family) => ({
            id: family.id,
            name: family.name,
            notes: family.notes,
          }))}
          targetRoles={profile.targetRoles.map((role) => ({
            id: role.id,
            title: role.title,
            priority: role.priority,
            active: role.active,
            roleFamilyId: role.roleFamilyId,
            roleFamilyName: role.roleFamilyId
              ? familyNameById.get(role.roleFamilyId) ?? null
              : null,
          }))}
        />
      </div>

      {/*
        Directly above the Evidence card: an import's whole output lands there
        as rows to confirm, so the upload sits next to the thing it fills.
      */}
      <div id="linkedin-import" className="scroll-mt-28">
        <ImportLinkedinCard />
      </div>

      <div id="evidence" className="scroll-mt-28">
        <EvidenceCard
          evidence={profile.evidence.map((item) => ({
            id: item.id,
            kind: item.kind,
            source: item.source,
            status: item.status,
            title: item.title,
            organization: item.organization,
            details: item.details,
            outcome: item.outcome,
            startDate: item.startDate,
            endDate: item.endDate,
          }))}
        />
      </div>

      <div id="capabilities" className="scroll-mt-28">
        <CapabilitiesCard
          // Only confirmed evidence is offered, matching the server action: an
          // unconfirmed candidate must not become a strength input before the
          // user has vouched for it.
          evidenceOptions={profile.evidence
            .filter((item) => item.status === "CONFIRMED")
            .map((item) => ({
              id: item.id,
              title: item.title,
              kind: item.kind,
            }))}
          capabilities={profile.capabilities.map((capability) => ({
            id: capability.id,
            name: capability.name,
            category: capability.category,
            confirmed: capability.confirmed,
            selfAssessment: capability.selfAssessment,
            notes: capability.notes,
            links: capability.evidenceLinks.map((link) => ({
              id: link.id,
              evidenceId: link.evidenceId,
              evidenceTitle:
                link.evidence?.title ?? evidenceTitleById.get(link.evidenceId) ?? "Evidence",
              depth: link.depth,
              hasMeasuredOutcome: link.hasMeasuredOutcome,
              outcomeNote: link.outcomeNote,
              lastUsedAt: link.lastUsedAt,
            })),
          }))}
        />
      </div>
    </PageShell>
  )
}
