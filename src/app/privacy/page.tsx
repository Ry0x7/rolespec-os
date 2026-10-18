import type { Metadata } from "next"

import { LegalPage, Section } from "@/features/marketing/components/legal-page"
import { siteConfig } from "@/config/site"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${siteConfig.name} collects, uses and shares personal data.`,
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" effectiveDate="August 25, 2026">
      <Section heading="Who we are">
        <p>
          {siteConfig.name} is operated by RoleSpec Inc. For any privacy question, or to
          exercise the rights described below, contact <strong>privacy@rolespec.app</strong>.
          If you use {siteConfig.name} on a self-hosted deployment, the operator of that
          deployment controls its data and this policy applies to the instance we operate.
        </p>
      </Section>

      <Section heading="What we collect">
        <p>Only what the product needs to work. In practice, that is:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Account data.</strong> Your name, email address, and either a password
            (stored only as a bcrypt hash — we never hold the password itself) or, if you sign
            in with Google or GitHub, the profile name, email and avatar URL that provider
            returns.
          </li>
          <li>
            <strong>Career content you create or upload.</strong> Résumés, including the
            contact details, employment history, education, skills, projects and certifications
            they contain; PDF or DOCX files you upload; a LinkedIn profile export if you
            request a rating; job applications, cover letters, outreach emails, notes and
            to-dos; and any job description you paste in for analysis. This is the most
            sensitive category we hold. Uploaded PDF and DOCX files themselves are parsed in
            memory and never stored — only the text extracted from them is kept, as part of
            your résumé.
          </li>
          <li>
            <strong>A portfolio URL</strong>, if you ask us to rate one. We fetch that page
            server-side and analyse its visible text.
          </li>
          <li>
            <strong>Security and abuse-prevention data.</strong> Your email address and IP
            address with a timestamp for sign-in, sign-up and password-reset attempts, kept so
            we can rate limit and block abuse. Deleted automatically after seven days.
          </li>
          <li>
            <strong>AI usage metadata.</strong> For each AI request: which feature ran, the
            provider and model, token counts and whether it succeeded — used to enforce the
            daily request cap and show you your own usage. We do not store the prompts or the
            generated output as part of this record.
          </li>
          <li>
            <strong>API tokens</strong>, if you connect the browser extension. We store only a
            SHA-256 hash of each token, never the token itself. The extension keeps its access
            token and the app URL it connects to in the browser&apos;s local extension storage
            on your device — not on our servers. Deleting your account or revoking the token
            makes it unusable against our servers, but removing the copy stored on your device
            requires removing the extension or clearing its data.
          </li>
        </ul>
        <p>
          We do not collect special-category data deliberately, but a résumé you upload may
          contain it (for example, membership of a professional body, or a photograph). Please
          upload only what you want analysed.
        </p>
      </Section>

      <Section heading="How your career content is used">
        <p>
          This is the part worth reading closely. When you ask for an analysis, rewrite,
          match score, cover letter or export, the relevant content is sent to a third-party AI
          provider to generate the result. That transfer is the feature; it cannot be disabled
          while still using those features.
        </p>
        <p>
          Which provider receives it depends on your settings. You bring your own API key and
          choose the provider — OpenAI, Anthropic, DeepSeek or Google — so your content is sent
          to that provider under your own agreement with them. Because the key is yours, that
          provider processes your content under your agreement with them — review your
          provider&apos;s API terms for its training and retention practices (OpenAI and Anthropic,
          for example, exclude API data from model training by default). If your key is stored
          with us it is encrypted at rest and never shown again after you save it.
        </p>
        <p>
          Generated résumé exports are stored privately. Downloading one requires being signed
          in to the account that owns the résumé; an export link does not work for anyone
          else, signed out or signed in.
        </p>
      </Section>

      <Section heading="Who we share it with">
        <p>
          We do not sell personal data and we do not share it for advertising. We use these
          processors, each with access only to what its function requires:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Neon — database hosting</li>
          <li>Vercel — application hosting and export file storage</li>
          <li>
            The AI provider you configure (OpenAI, Anthropic, DeepSeek or Google) — AI analysis
            and generation
          </li>
          <li>Resend — transactional email, such as password resets</li>
          <li>Sentry — error reporting, when enabled on the deployment</li>
        </ul>
        <p>
          These providers operate primarily from the United States, so your data may be
          processed there. Each processes it under its own data-processing terms, and we rely
          on those contractual safeguards for the transfer.
        </p>
      </Section>

      <Section heading="How long we keep it">
        <p>
          Account and career content is kept until you delete it or close your account.
          Deleting your account removes your résumés, applications, cover letters, notes,
          ratings and generated export files. Rate-limit records expire after seven days.
          Generated export files and their export records are also deleted automatically 90
          days after creation, and immediately if you delete your account. AI usage records
          survive account deletion for aggregate statistics: they keep an internal account
          identifier and token counts, never the content of your requests, your name or your
          email. Records of administrative actions are also retained for accountability, and
          where an administrator acted on your account they may include a snapshot of your
          email address.
        </p>
        <p>
          Some processing happens outside systems we control, and we cannot recall or delete
          data already sent there: transactional emails we have already sent, such as
          password resets, remain on Resend&apos;s systems under Resend&apos;s own retention
          policy. When error reporting is enabled on the deployment, error events already sent
          to Sentry are retained under Sentry&apos;s own policy and are not removed by deleting
          your account. Content sent to the AI provider you configure is retained under your
          own agreement with that provider, not under this policy.
        </p>
      </Section>

      <Section heading="Your rights">
        <p>
          You can access, export, correct or delete your data from{" "}
          <strong>Settings → Your data</strong> at any time — export produces a machine-readable
          JSON file of everything we hold about you, and deletion is immediate and permanent.
        </p>
        <p>
          Depending on where you live you may also have the right to object to processing,
          restrict it, or complain to a supervisory authority — in the Philippines, the
          National Privacy Commission; elsewhere, the authority for your place of residence.
          Where processing relies on consent you may withdraw it at any time.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          Passwords are stored as bcrypt hashes. Sessions are signed, and changing your
          password invalidates every other session. Administrative access requires a second
          password entry. Traffic is served over HTTPS with a strict content security policy.
          No system is perfectly secure, and we will notify affected users and any required
          authority without undue delay if a breach occurs.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          {siteConfig.name} is not intended for anyone under 16. We do not knowingly collect
          their data, and will delete an account on learning of it.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          We will update the effective date above when this policy changes, and notify you by
          email before a material change takes effect.
        </p>
      </Section>
    </LegalPage>
  )
}
