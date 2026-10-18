import { Document, Link, Page, View, Text } from "@react-pdf/renderer"
import type { Section, SectionItem } from "@/features/resume/hooks/use-resume-store"
import { formatCertificationDateText, formatCertificationNames, groupCertificationsByOrg } from "@/features/resume/services/group-certifications"
// Disables react-pdf hyphenation before any render (see setup.ts).
import "./setup"
import { TEMPLATE_PDF_STYLES } from "./styles"
import { activePdfConfig } from "./config-context"
import { SectionHeading, SplitSection, BulletList, DateRange, ContactHeader, renderPdfText, CombinedAdditionalSection, skillsRows, ExperienceEntry, textSize, normalizeCertDate } from "./primitives"
import type { TemplateProps } from "./minimal"

const baseConfig = TEMPLATE_PDF_STYLES.MODERN

export function ModernTemplate({ sections, groupAdditional, groupAdditionalTitle }: TemplateProps) {
  const config = activePdfConfig(baseConfig)
  const visibleSections = sections
    // The preview keeps a section unless it is explicitly hidden; matching
    // `s.visible` alone dropped every section whose flag was never set.
    .filter((s) => s.visible !== false)
    .sort((a, b) => a.order - b.order)

  const certSection = groupAdditional
    ? visibleSections.find((s) => s.type === "CERTIFICATIONS")
    : undefined
  // Certifications only fold into another section when a visible Skills
  // section exists to host the combined block — otherwise, exactly as the
  // preview does, the certifications section renders the block itself.
  const hasVisibleSkills = visibleSections.some((s) => s.type === "SKILLS")

  return (
    <Document>
      <Page
        size="A4"
        style={{
          fontFamily: config.fontFamily,
          fontSize: config.body.fontSize,
          lineHeight: config.body.lineHeight,
          color: config.colors.body,
          paddingTop: config.page.paddingTop,
          paddingBottom: config.page.paddingBottom,
          paddingHorizontal: config.page.paddingHorizontal,
          // Gap *between* sections only, mirroring the preview's container
          // `rowGap`; a per-section marginBottom also charged a gap after the
          // last section and across every page break.
          rowGap: config.sectionGap,
        }}
      >
        {visibleSections.map((section) => (
          <SectionRenderer
            key={section.id}
            section={section}
            groupAdditional={groupAdditional}
            groupAdditionalTitle={groupAdditionalTitle}
            certSection={certSection}
            hasVisibleSkills={hasVisibleSkills}
          />
        ))}
      </Page>
    </Document>
  )
}

function SectionRenderer({
  section,
  groupAdditional,
  groupAdditionalTitle,
  certSection,
  hasVisibleSkills,
}: {
  section: Section
  groupAdditional?: boolean
  groupAdditionalTitle?: string
  certSection?: Section
  hasVisibleSkills?: boolean
}) {
  const config = activePdfConfig(baseConfig)
  switch (section.type) {
    case "CONTACT":
      return <ContactSection section={section} />
    case "SUMMARY":
      return <SummarySection section={section} />
    case "EXPERIENCE":
      return <ExperienceSection section={section} />
    case "EDUCATION":
      return <EducationSection section={section} />
    case "SKILLS":
      if (groupAdditional && certSection) {
        return (
          <CombinedAdditionalSection
            skillsSection={section}
            certSection={certSection}
            title={groupAdditionalTitle ?? "Additional Information"}
            config={config}
          />
        )
      }
      return <SkillsSection section={section} />
    case "PROJECTS":
      return <ProjectsSection section={section} />
    case "CERTIFICATIONS":
      if (groupAdditional) {
        // With a visible Skills section the combined block is rendered there.
        if (hasVisibleSkills) return null
        return (
          <CombinedAdditionalSection
            certSection={section}
            title={groupAdditionalTitle ?? "Additional Information"}
            config={config}
          />
        )
      }
      return <CertificationsSection section={section} />
    case "CUSTOM":
      return <CustomSection section={section} />
    default:
      return null
  }
}

function ContactSection({ section }: { section: Section }) {
  const config = activePdfConfig(baseConfig)
  const item = section.items[0]
  if (!item) return null

  const c = item.content as Record<string, string>
  if (!c.fullName && !c.email && !c.phone) return null

  return (
    <ContactHeader
      fullName={c.fullName}
      jobTitle={c.jobTitle}
      email={c.email}
      phone={c.phone}
      location={c.location}
      linkedin={c.linkedin}
      github={c.github}
      website={c.website}
      config={config}
    />
  )
}

function SummarySection({ section }: { section: Section }) {
  const config = activePdfConfig(baseConfig)
  const item = section.items[0]
  const text = (item?.content as { text?: string })?.text
  if (!text) return null

  return (
    <View wrap={false}>
      <SectionHeading title="Summary" config={config} />
      {renderPdfText(text, {
        fontFamily: config.fontFamily,
        ...textSize(config, config.body.fontSize),
        color: config.colors.body,
        textAlign: config.body.textAlign,
      })}
    </View>
  )
}

function ExperienceSection({ section }: { section: Section }) {
  const config = activePdfConfig(baseConfig)
  const items = [...section.items].sort((a, b) => a.order - b.order)
  if (items.length === 0) return null

  return (
    <SplitSection title="Experience" config={config} gap={config.spacing.itemGap}>
      {items.map((item) => (
        <ExperienceItem key={item.id} item={item} />
      ))}
    </SplitSection>
  )
}

function ExperienceItem({ item }: { item: SectionItem }) {
  const config = activePdfConfig(baseConfig)
  const c = item.content as {
    company?: string
    role?: string
    location?: string
    startDate?: string
    endDate?: string
    current?: boolean
    bullets?: string[]
  }

  return (
    <View wrap={false}>
      {/* The accent-role entry paints its role from `--resume-heading`, unlike
          every other emphasised text in the preview. */}
      <ExperienceEntry content={c} config={config} strongColor={config.colors.heading} />
      {c.bullets && <BulletList items={c.bullets} config={config} />}
    </View>
  )
}

function EducationSection({ section }: { section: Section }) {
  const config = activePdfConfig(baseConfig)
  const items = [...section.items].sort((a, b) => a.order - b.order)
  if (items.length === 0) return null

  return (
    <SplitSection title="Education" config={config} gap={config.spacing.listGap}>
      {items.map((item) => {
        const c = item.content as {
          school?: string
          degree?: string
          field?: string
          startDate?: string
          endDate?: string
          gpa?: string
        }

        const degreeText = c.degree && c.field ? `${c.degree} in ${c.field}` : c.degree || c.field || "Degree"

        return (
          <View key={item.id} style={{ flexDirection: "row", justifyContent: "space-between" }} wrap={false}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: config.boldFontFamily, ...textSize(config, config.body.fontSize), color: config.colors.strong }}>
                {degreeText}
                {c.school && (
                  <Text style={{ fontFamily: config.fontFamily, color: config.colors.org }}> — {c.school}</Text>
                )}
                {c.gpa && (
                  <Text style={{ fontFamily: config.fontFamily, ...textSize(config, config.body.fontSize - 1), color: config.colors.muted }}> (GPA: {c.gpa})</Text>
                )}
              </Text>
            </View>
            <DateRange startDate={c.startDate} endDate={c.endDate} config={config} />
          </View>
        )
      })}
    </SplitSection>
  )
}

function SkillsSection({ section }: { section: Section }) {
  const config = activePdfConfig(baseConfig)
  const items = [...section.items].sort((a, b) => a.order - b.order)
  const hasSkills = items.some((item) => {
    const c = item.content as { skills?: string[] }
    return c.skills && c.skills.length > 0
  })

  if (!hasSkills) return null

  return (
    // Splits between categories like the preview; each category row is atomic.
    <SplitSection title="Skills" config={config} gap={config.spacing.skillGap}>
      {skillsRows(items, config, config.colors.strong)}
    </SplitSection>
  )
}

function ProjectsSection({ section }: { section: Section }) {
  const config = activePdfConfig(baseConfig)
  // Filtered before mapping — as the preview does — so the between-items gap
  // counts only entries that actually render.
  const items = section.items
    .filter((item) => {
      const c = item.content as { name?: string; bullets?: string[] }
      return c.name || c.bullets?.some((b) => b.trim())
    })
    .sort((a, b) => a.order - b.order)

  if (items.length === 0) return null

  return (
    <SplitSection title="Projects" config={config} gap={config.spacing.itemGap}>
      {items.map((item) => {
        const c = item.content as {
          name?: string
          bullets?: string[]
          technologies?: string[]
          url?: string
          urlLabel?: string
          startDate?: string
          endDate?: string
        }
        return (
          <View key={item.id} wrap={false}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: config.boldFontFamily, ...textSize(config, config.body.fontSize), color: config.colors.strong }}>
                  {c.name || "Project"}
                  {c.url && c.urlLabel && (
                    // Preview: a bare underlined `text-gray-500` label after a gap.
                    <Text style={{ fontFamily: config.fontFamily, ...textSize(config, config.body.fontSize - 1) }}>
                      {" "}
                      <Link
                        src={/^https?:\/\//i.test(c.url) ? c.url : `https://${c.url}`}
                        style={{ fontFamily: config.fontFamily, ...textSize(config, config.body.fontSize - 1), color: config.colors.muted, textDecoration: "underline" }}
                      >{c.urlLabel}</Link>
                    </Text>
                  )}
                </Text>
              </View>
              <DateRange startDate={c.startDate} endDate={c.endDate} config={config} />
            </View>
            {c.technologies && c.technologies.length > 0 && (
              <Text style={{ fontFamily: config.fontFamily, ...textSize(config, config.body.fontSize - 1), color: config.colors.muted }}>
                {c.technologies.join(" · ")}
              </Text>
            )}
            {c.bullets && c.bullets.some((b) => b.trim()) && <BulletList items={c.bullets} config={config} />}
          </View>
        )
      })}
    </SplitSection>
  )
}

function CertificationsSection({ section }: { section: Section }) {
  const config = activePdfConfig(baseConfig)
  const items = [...section.items].sort((a, b) => a.order - b.order)

  const groups = groupCertificationsByOrg(items)

  if (groups.length === 0) return null

  return (
    // Splits between rows like the preview; only a row is atomic.
    <SplitSection title="Certifications" config={config} gap={config.spacing.certGap}>
      {groups.map((group) => {
        if (group.certs.length === 1) {
          const { id, content: c } = group.certs[0]
          const dateText = formatCertificationDateText(c, normalizeCertDate)
          return (
            <View key={id} style={{ flexDirection: "row", justifyContent: "space-between" }} wrap={false}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: config.boldFontFamily, ...textSize(config, config.body.fontSize), color: config.colors.strong }}>
                  {c.name || "Certification"}
                  {c.organization && (
                    <Text style={{ fontFamily: config.fontFamily, color: config.colors.org }}> — {c.organization}</Text>
                  )}
                  {c.credentialId && (
                    <Text style={{ fontFamily: config.fontFamily, ...textSize(config, config.body.fontSize - 1), color: config.colors.muted }}> (ID: {c.credentialId})</Text>
                  )}
                </Text>
              </View>
              {dateText && (
                <Text style={{ fontFamily: config.fontFamily, ...textSize(config, config.body.fontSize - 1), color: config.colors.muted, flexShrink: 0, marginLeft: 8 }}>
                  {dateText}
                </Text>
              )}
            </View>
          )
        }
        const certNames = formatCertificationNames(group.certs)
        const dateRange = group.dateRange
        return (
          <View key={group.certs[0].id} style={{ flexDirection: "row", justifyContent: "space-between" }} wrap={false}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: config.boldFontFamily, ...textSize(config, config.body.fontSize), color: config.colors.strong }}>
                {group.organization}
                <Text style={{ fontFamily: config.fontFamily, color: config.colors.org }}>: {certNames}</Text>
              </Text>
            </View>
            {dateRange && (
              <Text style={{ fontFamily: config.fontFamily, ...textSize(config, config.body.fontSize - 1), color: config.colors.muted, flexShrink: 0, marginLeft: 8 }}>
                {dateRange}
              </Text>
            )}
          </View>
        )
      })}
    </SplitSection>
  )
}

function CustomSection({ section }: { section: Section }) {
  const config = activePdfConfig(baseConfig)
  // Filtered before mapping — as the preview does — so the between-items gap
  // counts only entries that actually render.
  const items = section.items
    .filter((item) => {
      const c = item.content as { title?: string; content?: string }
      return c.title || c.content
    })
    .sort((a, b) => a.order - b.order)

  if (items.length === 0) return null

  return (
    <SplitSection title={section.title} config={config} gap={config.spacing.listGap}>
      {items.map((item) => {
        const c = item.content as { title?: string; content?: string }

        return (
          <View key={item.id} wrap={false}>
            {c.title && (
              <Text style={{ fontFamily: config.boldFontFamily, ...textSize(config, config.body.fontSize), color: config.colors.strong }}>
                {c.title}
              </Text>
            )}
            {c.content && renderPdfText(c.content, { fontFamily: config.fontFamily, ...textSize(config, config.body.fontSize), color: config.colors.body, textAlign: config.body.textAlign })}
          </View>
        )
      })}
    </SplitSection>
  )
}

