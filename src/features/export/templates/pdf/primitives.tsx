import { Children } from "react"
import { View, Text, Link, StyleSheet } from "@react-pdf/renderer"
import type { Style } from "@react-pdf/types"
import { BODY_TEXT, SUB_LABEL_TEXT, type TemplateStyleConfig } from "./styles"
import type { Section, SectionItem } from "@/features/resume/hooks/use-resume-store"
import { normalizeDateString } from "@/shared/lib/normalize-date"
import { parseLinkValue } from "@/shared/lib/url"
import { formatCertificationDateText, formatCertificationNames, groupCertificationsByOrg } from "@/features/resume/services/group-certifications"

const LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g

/**
 * The formatter the preview passes to `formatCertificationDateText`. Without it
 * a stored `2024-06` reaches the page verbatim in the export while the preview
 * shows `Jun 2024`.
 */
export const normalizeCertDate = (value: string) => normalizeDateString(value) ?? value

/**
 * Pairs a font size with the config's *unitless* line height on the same style
 * object.
 *
 * react-pdf resolves a unitless `lineHeight` once, against the font size found
 * on the very same style object, and then inherits the result as an absolute
 * value. So a `Text` that overrides only `fontSize` keeps its ancestor's line
 * box (e.g. the `<Page>`'s 11 × 1.55 = 17.05pt) no matter how large or small its
 * own text is — while the browser preview resolves the same unitless value per
 * element. Emitting both together restores the CSS math, so a PDF paginates
 * exactly where the preview said it would.
 */
export function textSize(
  config: TemplateStyleConfig,
  fontSize: number
): { fontSize: number; lineHeight: number } {
  return { fontSize, lineHeight: config.body.lineHeight }
}

export function renderPdfText(raw: string, textStyle: Style): React.ReactElement {
  const nodes: React.ReactElement[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  LINK_REGEX.lastIndex = 0

  while ((match = LINK_REGEX.exec(raw)) !== null) {
    const [full, label, url] = match
    if (match.index > lastIndex) {
      nodes.push(<Text key={`t-${match.index}`} style={textStyle}>{raw.slice(lastIndex, match.index)}</Text>)
    }
    nodes.push(
      <Link key={`l-${match.index}`} src={url} style={{ ...textStyle, color: "#2563EB", textDecoration: "underline" } as Style}>
        {label}
      </Link>
    )
    lastIndex = match.index + full.length
  }

  if (lastIndex < raw.length) {
    nodes.push(<Text key="t-end" style={textStyle}>{raw.slice(lastIndex)}</Text>)
  }

  if (nodes.length === 0) {
    return <Text style={textStyle}>{raw}</Text>
  }

  return <Text style={textStyle}>{nodes}</Text>
}

const baseStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  bulletRow: {
    flexDirection: "row",
  },
  bulletChar: {
    width: 12,
    textAlign: "center",
  },
  bulletText: {
    flex: 1,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 4,
  },
  contactSeparator: {
    marginHorizontal: 4,
  },
})

interface SectionHeadingProps {
  title: string
  config: TemplateStyleConfig
}

export function SectionHeading({ title, config }: SectionHeadingProps) {
  const hasBg = !!config.colors.headingBg
  const accentBar = config.layout.heading === "accent-bar"

  const label = (
    <Text
      style={{
        fontFamily: config.boldFontFamily,
        ...textSize(config, config.heading.fontSize),
        color: config.colors.heading,
        textTransform: config.heading.textTransform,
        letterSpacing: config.heading.letterSpacing,
      }}
    >
      {title}
    </Text>
  )

  return (
    <View
      // Never strand a heading as the last element on a page: unless the gap
      // below it plus at least one line of the first item still fits, react-pdf
      // moves the heading to the next page along with its content. The preview
      // paginator has the same guard (a slice must fit its heading plus one
      // item), so without this the PDF could break where the preview refused to.
      minPresenceAhead={
        config.heading.marginBottom + config.body.fontSize * config.body.lineHeight
      }
      style={{
        marginBottom: config.heading.marginBottom,
        paddingBottom: config.heading.paddingBottom,
        borderBottomWidth: config.heading.borderBottomWidth,
        borderBottomColor: config.colors.border,
        backgroundColor: hasBg ? config.colors.headingBg : undefined,
        paddingHorizontal: config.heading.paddingHorizontal ?? 0,
        paddingVertical: config.heading.paddingVertical ?? 0,
        flexDirection: accentBar ? "row" : "column",
        alignItems: accentBar ? "center" : undefined,
      }}
    >
      {accentBar && (
        <View
          style={{
            width: 14,
            height: 2,
            marginRight: 5,
            // Preview: `bg-[color:var(--resume-heading)]`.
            backgroundColor: config.colors.heading,
          }}
        />
      )}
      {label}
    </View>
  )
}

interface SplitSectionProps {
  title: string
  config: TemplateStyleConfig
  /** Gap between the section's items — the preview's per-section rowGap. */
  gap: number
  children: React.ReactNode
}

/**
 * Container for a splittable section, replicating the preview paginator's two
 * placement rules exactly:
 *
 * - A slice must fit its heading plus at least one whole item (paginate.ts
 *   flushes the page otherwise), so the heading is bound to the first item in
 *   an atomic group — react-pdf on its own happily strands a heading at a page
 *   bottom when the next atomic item overflows, because `minPresenceAhead`
 *   only reserves a fixed window, never "the whole first item".
 * - The between-item gap is charged only between items on the same page (a
 *   slice's first item costs 0 gap), which is `rowGap` semantics — a per-item
 *   marginTop would be kept when an item opens a continuation page, starting
 *   that page one gap below the top padding.
 */
export function SplitSection({ title, config, gap, children }: SplitSectionProps) {
  const [first, ...rest] = Children.toArray(children)
  return (
    <View style={{ rowGap: gap }}>
      <View wrap={false}>
        <SectionHeading title={title} config={config} />
        {first}
      </View>
      {rest}
    </View>
  )
}

interface BulletListProps {
  items: string[]
  config: TemplateStyleConfig
}

export function BulletList({ items, config }: BulletListProps) {
  const filtered = items.filter((item) => item.trim())
  if (filtered.length === 0) return null

  return (
    // 4pt + the 12pt bullet column ≈ the preview's `pl-4` (16px) total indent.
    <View style={{ marginTop: config.spacing.bulletTop, paddingLeft: 4 }}>
      {filtered.map((item, idx) => (
        // Gap *between* bullets only, exactly like the preview's `<li>` rule.
        <View
          key={idx}
          style={{ ...baseStyles.bulletRow, marginTop: idx > 0 ? config.spacing.bulletGap : 0 }}
        >
          <Text
            style={{
              ...baseStyles.bulletChar,
              fontFamily: config.fontFamily,
              ...textSize(config, config.body.fontSize),
              color: config.colors.body,
            }}
          >
            {"•"}
          </Text>
          {renderPdfText(item, {
            ...baseStyles.bulletText,
            fontFamily: config.fontFamily,
            ...textSize(config, config.body.fontSize),
            color: config.colors.body,
            // The bullet glyph keeps its own `textAlign: "center"`; only the
            // text column follows the customizer, as the preview's `<li>` does.
            textAlign: config.body.textAlign,
          })}
        </View>
      ))}
    </View>
  )
}

interface DateRangeProps {
  startDate?: string
  endDate?: string
  current?: boolean
  config: TemplateStyleConfig
}

export function DateRange({ startDate, endDate, current, config }: DateRangeProps) {
  if (!startDate && !endDate && !current) return null

  const sd = normalizeDateString(startDate)
  const ed = normalizeDateString(endDate)
  let text = ""
  if (sd) text = sd
  if (sd && (ed || current)) text += " – "
  if (current) text += "Present"
  else if (ed) text += ed

  return (
    <Text
      style={{
        fontFamily: config.fontFamily,
        ...textSize(config, config.body.fontSize - 1),
        color: config.colors.muted,
        flexShrink: 0,
        marginLeft: 8,
      }}
    >
      {text}
    </Text>
  )
}

interface ContactDetail {
  label: string
  /** Absolute href (mailto:/tel:/https:) or an empty string for plain text. */
  href: string
}

interface ContactHeaderProps {
  fullName?: string
  jobTitle?: string
  email?: string
  phone?: string
  location?: string
  linkedin?: string
  github?: string
  website?: string
  config: TemplateStyleConfig
}

export function ContactHeader({
  fullName,
  jobTitle,
  email,
  phone,
  location,
  linkedin,
  github,
  website,
  config,
}: ContactHeaderProps) {
  // Each detail keeps the href it came from so the PDF gets real annotations
  // (mailto:/tel:/https:) instead of dead text.
  const details: ContactDetail[] = [
    email ? { label: email, href: `mailto:${email}` } : null,
    phone ? { label: phone, href: `tel:${phone.replace(/[^\d+]/g, "")}` } : null,
    location ? { label: location, href: "" } : null,
    ...[linkedin, github, website].map((raw) => {
      if (!raw) return null
      const { label, href } = parseLinkValue(raw)
      return label ? { label, href } : null
    }),
  ].filter((d): d is ContactDetail => Boolean(d))

  const layout = config.layout.header
  const centered = layout === "centered"

  const block = (
    <>
      {fullName && (
        <Text
          style={{
            fontFamily: config.boldFontFamily,
            ...textSize(config, config.name.fontSize),
            color: config.colors.name,
            textTransform: config.name.textTransform ?? "none",
            letterSpacing: config.name.letterSpacing ?? 0,
            marginBottom: jobTitle ? 2 : 4,
          }}
        >
          {fullName}
        </Text>
      )}
      {jobTitle && (
        <Text
          style={{
            fontFamily: config.fontFamily,
            ...textSize(config, config.body.fontSize + 1),
            // Job title and the detail line share the preview's `--resume-muted`.
            color: config.colors.contact,
            marginBottom: 4,
          }}
        >
          {jobTitle}
        </Text>
      )}
      {details.length > 0 && (
        <View
          style={{
            ...baseStyles.contactRow,
            justifyContent: centered ? "center" : "flex-start",
          }}
        >
          {details.map((detail, idx) => {
            const detailStyle = {
              fontFamily: config.fontFamily,
              ...textSize(config, config.body.fontSize),
              color: config.colors.contact,
            } as Style

            return (
              <View key={idx} style={{ flexDirection: "row" }}>
                {idx > 0 && (
                  <Text
                    style={{
                      ...baseStyles.contactSeparator,
                      ...detailStyle,
                    }}
                  >
                    {"·"}
                  </Text>
                )}
                {detail.href ? (
                  <Link src={detail.href} style={detailStyle}>
                    {detail.label}
                  </Link>
                ) : (
                  <Text style={detailStyle}>{detail.label}</Text>
                )}
              </View>
            )
          })}
        </View>
      )}
    </>
  )

  return (
    <View
      style={{
        flexDirection: layout === "accent-bar" ? "row" : "column",
        alignItems: centered ? "center" : "stretch",
        paddingBottom: config.spacing.contactPad,
        // MODERN leans on the accent bar instead of a rule; CORPORATE gets a
        // heavier accent-coloured banner underline.
        borderBottomWidth: layout === "accent-bar" ? 0 : layout === "banner" ? 2 : 1,
        // Preview: `border-[color:var(--resume-name)]` on the banner.
        borderBottomColor: layout === "banner" ? config.colors.name : config.colors.border,
      }}
    >
      {layout === "accent-bar" && (
        <View
          style={{ width: 4, marginRight: 8, backgroundColor: config.colors.name }}
        />
      )}
      <View style={{ flex: layout === "accent-bar" ? 1 : undefined, alignItems: centered ? "center" : "flex-start" }}>
        {block}
      </View>
    </View>
  )
}

/**
 * Skill categories in the arrangement the template calls for: comma list
 * (MINIMAL), boxed chips (MODERN), label-over-line (HARVARD) or a two-column
 * grid (CORPORATE). Returns one element per category so the template's
 * SplitSection can bind the first category to the heading and charge the gaps.
 * `strongColor` is the colour for the category label — each template keeps
 * its own emphasis.
 */
export function skillsRows(
  items: SectionItem[],
  cfg: TemplateStyleConfig,
  strongColor: string
): React.ReactElement[] {
  const labelStyle = {
    fontFamily: cfg.boldFontFamily,
    ...textSize(cfg, cfg.body.fontSize),
    color: strongColor,
  }
  const bodyStyle = {
    fontFamily: cfg.fontFamily,
    ...textSize(cfg, cfg.body.fontSize),
    color: cfg.colors.body,
  }

  // Filtered before mapping — as the preview does at `SkillsPreview` — so the
  // index-based gap only counts categories that actually render.
  const rendered = items.filter((item) => {
    const c = item.content as { skills?: string[] }
    return c.skills && c.skills.length > 0
  })

  return rendered.map((item) => {
        const c = item.content as { category?: string; skills?: string[] }
        const skills = c.skills ?? []

        // Each category is atomic — the section itself may split between them,
        // exactly like the preview's per-item pagination.
        switch (cfg.layout.skills) {
          case "chips":
            return (
              <View key={item.id} wrap={false}>
                {c.category && <Text style={labelStyle}>{c.category}</Text>}
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 2 }}>
                  {skills.map((skill) => (
                    <View
                      key={skill}
                      style={{
                        borderWidth: 0.75,
                        borderColor: cfg.colors.border,
                        borderRadius: 6,
                        paddingHorizontal: 4,
                        paddingVertical: 1,
                        marginRight: 3,
                        marginBottom: 3,
                      }}
                    >
                      <Text style={{ ...bodyStyle, ...textSize(cfg, cfg.body.fontSize - 1) }}>{skill}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )
          case "grid":
            return (
              <View key={item.id} wrap={false}>
                {c.category && (
                  <Text style={{ ...labelStyle, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {c.category}
                  </Text>
                )}
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 2 }}>
                  {skills.map((skill) => (
                    <View key={skill} style={{ width: "50%", paddingRight: 8 }}>
                      <Text style={bodyStyle}>{skill}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )
          case "lines":
            return (
              <View key={item.id} wrap={false}>
                {c.category && <Text style={labelStyle}>{c.category}</Text>}
                <Text style={bodyStyle}>{skills.join(", ")}</Text>
              </View>
            )
          default:
            return (
              <View key={item.id} wrap={false}>
                <Text style={bodyStyle}>
                  {c.category && (
                    <Text style={{ fontFamily: cfg.boldFontFamily, color: strongColor }}>
                      {c.category}:{" "}
                    </Text>
                  )}
                  {skills.join(", ")}
                </Text>
              </View>
            )
        }
      })
}

interface ExperienceEntryProps {
  content: {
    company?: string
    role?: string
    location?: string
    startDate?: string
    endDate?: string
    current?: boolean
  }
  config: TemplateStyleConfig
  strongColor: string
}

/** Header lines of one Experience entry, arranged per template identity. */
export function ExperienceEntry({ content: c, config: cfg, strongColor }: ExperienceEntryProps) {
  const dates = (
    <DateRange startDate={c.startDate} endDate={c.endDate} current={c.current} config={cfg} />
  )
  const row = {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  } as const
  const meta = {
    fontFamily: cfg.fontFamily,
    ...textSize(cfg, cfg.body.fontSize - 1),
    color: cfg.colors.muted,
  }
  const rightMeta = { ...meta, flexShrink: 0, marginLeft: 8 }

  switch (cfg.layout.entry) {
    // Organisation over an italic role, dates on the right — the academic block.
    case "academic":
      return (
        <>
          <View style={row}>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: cfg.boldFontFamily,
                  ...textSize(cfg, cfg.body.fontSize),
                  color: strongColor,
                }}
              >
                {c.company || c.role || "Company"}
              </Text>
            </View>
            {c.location && <Text style={rightMeta}>{c.location}</Text>}
          </View>
          <View style={row}>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: cfg.fontFamily,
                  ...textSize(cfg, cfg.body.fontSize),
                  color: cfg.colors.body,
                  fontStyle: "italic",
                }}
              >
                {c.role || "Role"}
              </Text>
            </View>
            {dates}
          </View>
        </>
      )
    case "accent-role":
      return (
        <>
          <View style={row}>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: cfg.boldFontFamily,
                  ...textSize(cfg, cfg.body.fontSize),
                  color: strongColor,
                }}
              >
                {c.role || "Role"}
                {c.company && (
                  <Text style={{ fontFamily: cfg.fontFamily, color: cfg.colors.body }}>
                    {" · "}
                    {c.company}
                  </Text>
                )}
              </Text>
            </View>
            {dates}
          </View>
          {c.location && <Text style={meta}>{c.location}</Text>}
        </>
      )
    case "structured":
      return (
        <>
          <View style={row}>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: cfg.boldFontFamily,
                  ...textSize(cfg, cfg.body.fontSize),
                  color: strongColor,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {c.role || "Role"}
              </Text>
            </View>
            {dates}
          </View>
          {(c.company || c.location) && (
            <View style={row}>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: cfg.boldFontFamily,
                    ...textSize(cfg, cfg.body.fontSize),
                    // Preview: `font-semibold text-gray-600`.
                    color: cfg.colors.org,
                  }}
                >
                  {c.company}
                </Text>
              </View>
              {c.location && <Text style={rightMeta}>{c.location}</Text>}
            </View>
          )}
        </>
      )
    default:
      return (
        <>
          <View style={row}>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: cfg.boldFontFamily,
                  ...textSize(cfg, cfg.body.fontSize),
                  color: strongColor,
                }}
              >
                {c.role || "Role"}
                {c.company && (
                  // Preview: `text-gray-600`.
                  <Text style={{ fontFamily: cfg.fontFamily, color: cfg.colors.org }}>
                    {" "}
                    — {c.company}
                  </Text>
                )}
              </Text>
            </View>
            {dates}
          </View>
          {c.location && <Text style={meta}>{c.location}</Text>}
        </>
      )
  }
}

interface DividerProps {
  config: TemplateStyleConfig
}

export function Divider({ config }: DividerProps) {
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: config.colors.border,
        marginVertical: config.sectionGap / 2,
      }}
    />
  )
}

interface CombinedAdditionalSectionProps {
  /** Absent when no visible Skills section hosts the block, as in the preview. */
  skillsSection?: Section
  certSection: Section
  title: string
  config: TemplateStyleConfig
}

export function CombinedAdditionalSection({
  skillsSection,
  certSection,
  title,
  config: cfg,
}: CombinedAdditionalSectionProps) {
  const skillItems = [...(skillsSection?.items ?? [])].sort((a, b) => a.order - b.order)
  const certItems = [...certSection.items].sort((a, b) => a.order - b.order)

  const hasSkills = skillItems.some((item) => {
    const c = item.content as { skills?: string[] }
    return c.skills && c.skills.length > 0
  })
  const hasCerts = certItems.some((item) => {
    const c = item.content as { name?: string; organization?: string }
    return c.name || c.organization
  })

  if (!hasSkills && !hasCerts) return null

  return (
    // The block splits between rows, as the preview does; only a row is atomic.
    <View>
      <SectionHeading title={title} config={cfg} />
      {hasSkills && (
        // rowGap spaces the label and every row; a per-item marginTop would be
        // kept when a row opens a continuation page, rowGap is not.
        <View style={{ marginBottom: 6, rowGap: cfg.spacing.skillGap }}>
          <Text style={{ fontFamily: cfg.boldFontFamily, ...textSize(cfg, cfg.body.fontSize - 2), color: SUB_LABEL_TEXT, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Skills
          </Text>
          {skillItems
            .filter((item) => {
              const c = item.content as { skills?: string[] }
              return c.skills && c.skills.length > 0
            })
            .map((item) => {
              const c = item.content as { category?: string; skills?: string[] }
              return (
                <View key={item.id} wrap={false}>
                  <Text style={{ fontFamily: cfg.fontFamily, ...textSize(cfg, cfg.body.fontSize), color: BODY_TEXT }}>
                    {c.category && (
                      <Text style={{ fontFamily: cfg.boldFontFamily, color: cfg.colors.org }}>{c.category}: </Text>
                    )}
                    {(c.skills ?? []).join(", ")}
                  </Text>
                </View>
              )
            })}
        </View>
      )}
      {hasCerts && (
        <View style={{ rowGap: cfg.spacing.skillGap }}>
          <Text style={{ fontFamily: cfg.boldFontFamily, ...textSize(cfg, cfg.body.fontSize - 2), color: SUB_LABEL_TEXT, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Certifications
          </Text>
          {(() => {
            const groups = groupCertificationsByOrg(certItems)
            return groups.map((group) => {
              if (group.certs.length === 1) {
                const { id, content: c } = group.certs[0]
                const dateText = formatCertificationDateText(c, normalizeCertDate)
                return (
                  <View key={id} style={{ flexDirection: "row", justifyContent: "space-between" }} wrap={false}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: cfg.fontFamily, ...textSize(cfg, cfg.body.fontSize), color: BODY_TEXT }}>
                        <Text style={{ color: SUB_LABEL_TEXT }}>{"• "}</Text>
                        {c.name || "Certification"}
                        {c.organization && (
                          <Text style={{ fontFamily: cfg.fontFamily, color: cfg.colors.muted }}> — {c.organization}</Text>
                        )}
                      </Text>
                    </View>
                    {dateText && (
                      <Text style={{ fontFamily: cfg.fontFamily, ...textSize(cfg, cfg.body.fontSize - 1), color: cfg.colors.muted, flexShrink: 0, marginLeft: 8 }}>
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
                    <Text style={{ fontFamily: cfg.fontFamily, ...textSize(cfg, cfg.body.fontSize), color: BODY_TEXT }}>
                      <Text style={{ color: SUB_LABEL_TEXT }}>{"• "}</Text>
                      {/* The preview's `font-medium`; only 400/700 faces are
                          registered, so bold is the closest available weight. */}
                      <Text style={{ fontFamily: cfg.boldFontFamily }}>{group.organization}</Text>
                      <Text style={{ color: cfg.colors.org }}>: {certNames}</Text>
                    </Text>
                  </View>
                  {dateRange && (
                    <Text style={{ fontFamily: cfg.fontFamily, ...textSize(cfg, cfg.body.fontSize - 1), color: cfg.colors.muted, flexShrink: 0, marginLeft: 8 }}>
                      {dateRange}
                    </Text>
                  )}
                </View>
              )
            })
          })()}
        </View>
      )}
    </View>
  )
}
