import type { Metadata } from "next"

import { LegalPage, Section } from "@/features/marketing/components/legal-page"
import { siteConfig } from "@/config/site"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${siteConfig.name} handles personal data.`,
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" effectiveDate="November 8, 2026">
      <Section heading="Who we are">
        <p>
          {siteConfig.name} is published by {siteConfig.publisher}. A self-hosted
          deployment is operated by whoever runs it, and that operator controls its data.
          For a privacy question about this deployment, contact its operator. For the
          project itself, use the repository&apos;s issue tracker.
        </p>
        <p>
          There is no RoleSpec account system: the workspace belongs to one owner, and the
          app does not ask for a name, email address or password to open it.
        </p>
      </Section>

      <Section heading="What the workspace holds">
        <p>Only what the product needs to work. In practice, that is:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Career content you create or upload.</strong> Résumés, including the
            contact details, employment history, education, skills, projects and
            certifications they contain; PDF or DOCX files you upload; a LinkedIn profile
            export if you import one; career-profile evidence and capabilities; job
            postings, applications, status history, cover letters, outreach drafts, notes
            and to-dos; and any job description you paste in for analysis. Uploaded PDF and
            DOCX files are parsed and are not stored as files — only the text extracted from
            them, as part of your résumé.
          </li>
          <li>
            <strong>Optional workspace identity.</strong> A display name and email address
            if you add them to the local profile or career-profile contact section. They are
            shown only inside your workspace and in documents you choose to export.
          </li>
          <li>
            <strong>AI configuration.</strong> The provider and model you select, and an API
            key if you save one. Keys are encrypted at rest with AES-256-GCM and are never
            returned to the browser after saving. Any independent sign-in required by a
            provider (for example the Claude Code or Codex CLI) stays in that provider&apos;s
            own credential store and is not copied into RoleSpec.
          </li>
          <li>
            <strong>Security and abuse-prevention data.</strong> When the remote key gate is
            enabled, the server records the client IP address and a timestamp for failed
            unlock attempts so it can rate limit them. The key itself is compared in memory
            and is never stored in the database. Records are pruned automatically.
          </li>
          <li>
            <strong>AI usage metadata.</strong> For each AI request: which feature ran, the
            provider and model, token counts and whether it succeeded — used to enforce the
            daily request cap and show your own usage. Prompts and generated output are not
            stored in this record.
          </li>
          <li>
            <strong>Extension pairing tokens.</strong> If you connect the browser extension,
            only a SHA-256 hash of each token is stored. The extension keeps its copy in the
            browser&apos;s local extension storage on your device. Revoking the token makes it
            unusable against the server; removing the device copy requires removing the
            extension or clearing its data.
          </li>
        </ul>
      </Section>

      <Section heading="How career content is used">
        <p>
          When you ask for an analysis, rewrite, match score, cover letter or export, the
          relevant content is sent to the AI provider you configured so it can generate the
          result. That transfer is the feature; it cannot be disabled while still using
          those features.
        </p>
        <p>
          You bring your own API key or use a locally authenticated CLI, so the provider
          processes the content under your own agreement with it. Review that provider&apos;s
          API terms for its training and retention practices. Keys saved in RoleSpec are
          encrypted at rest and are never shown again in full.
        </p>
        <p>
          Generated résumé exports are stored privately. Downloading one requires access to
          the owner workspace; an export link is not a public share link.
        </p>
      </Section>

      <Section heading="Who processes it">
        <p>
          We do not sell personal data and do not share it for advertising. A self-hosted
          deployment sends data only to the services its operator configures:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>The database the operator points RoleSpec at (local PostgreSQL or a hosted provider)</li>
          <li>The AI provider selected in Settings → AI provider</li>
          <li>Vercel Blob, only if the operator configures a blob token for exports</li>
          <li>Sentry, only if error reporting is enabled on that deployment</li>
          <li>
            Firecrawl, only if job discovery is configured to use it; otherwise discovery
            fetches public job pages directly
          </li>
        </ul>
        <p>
          These providers may process data outside your country. Each processes it under its
          own terms and the operator&apos;s agreement with it.
        </p>
      </Section>

      <Section heading="How long it is kept">
        <p>
          Career content stays until you delete it or erase the workspace from{" "}
          <strong>Settings → Your data</strong>. Erasing deletes the owner row and cascades to
          every owned résumé, application, cover letter, note, token and AI setting. Generated
          export files and export records are also deleted automatically after 90 days by
          default. AI usage records and rate-limit attempts are retained briefly for aggregate
          statistics and abuse prevention; they contain no résumé text.
        </p>
        <p>
          Some processing happens outside systems the operator controls and cannot be
          recalled: content already sent to an AI provider remains under that provider&apos;s
          policy, and error events already sent to Sentry remain under Sentry&apos;s policy.
        </p>
      </Section>

      <Section heading="Your rights">
        <p>
          From <strong>Settings → Your data</strong> you can export a machine-readable JSON
          copy of everything the workspace holds, or erase it immediately and permanently.
          Depending on where you live you may also have the right to object to processing,
          restrict it, or complain to a supervisory authority. Where processing relies on
          consent you may withdraw it at any time.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          A private deployment opens directly for its owner and is meant to be bound to
          loopback or a trusted private network. A public deployment must set an owner access
          key; the key is exchanged for a signed, HttpOnly cookie, and the workspace stays
          locked without it. API tokens are hashed at rest, AI keys are encrypted at rest, and
          traffic should be served over HTTPS with the app&apos;s strict content security
          policy. No system is perfectly secure; if a breach affects you, the deployment
          operator should notify you and any required authority without undue delay.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          {siteConfig.name} is not intended for anyone under 16. Do not use it to store a
          child&apos;s personal data.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          The effective date above changes when this policy changes. A self-hosted operator
          is responsible for notifying its users of a material change.
        </p>
      </Section>
    </LegalPage>
  )
}
