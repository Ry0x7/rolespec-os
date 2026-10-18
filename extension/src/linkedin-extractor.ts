import type { LinkedInProfileExtraction, LinkedInProfileField, LinkedInProfileSource } from "./types"

/**
 * Extracts a person from a LinkedIn profile page (`linkedin.com/in/*`).
 *
 * IMPORTANT: like `extractJobPosting` in `src/extractor.ts`, this function is shipped
 * into the page by `chrome.scripting.executeScript({ func: extractLinkedInProfile })`,
 * which stringifies it. It must therefore stay entirely self-contained — every helper
 * lives inside the body and no module-scope binding may be referenced at runtime.
 * Type-only imports are erased at build time and are safe.
 *
 * LinkedIn ships obfuscated, frequently-churning markup and no profile JSON-LD on the
 * logged-in page. The primary strategy is therefore the Voyager API payloads the page
 * embeds as JSON inside `<code>` elements, which are far more stable than class names;
 * the older DOM selectors and the `og:*` meta tags then fill in, per field, whatever the
 * JSON pass left empty. Everything is best-effort: the returned `sources` record says
 * which strategy produced each field so the panel can name what it could not read.
 */
export function extractLinkedInProfile(doc: Document = document): LinkedInProfileExtraction {
  const MAX_NAME = 200
  const MAX_HEADLINE = 300
  const MAX_COMPANY = 200
  const MAX_ABOUT = 5000
  const MAX_URL = 500
  const MIN_SELECTION = 200

  const text = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const trimmed = value.replace(/\s+/g, " ").trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  /** Same as `text` but keeps paragraph breaks, which the About section relies on. */
  const block = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const collapsed = value
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.replace(/[ \t ]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    return collapsed.length > 0 ? collapsed : undefined
  }

  const meta = (selector: string): string | undefined => {
    const node = doc.querySelector(selector)
    return text(node?.getAttribute("content"))
  }

  const firstText = (selectors: string[]): string | undefined => {
    for (const selector of selectors) {
      let nodes: Element[]
      try {
        nodes = Array.from(doc.querySelectorAll(selector))
      } catch {
        // A selector Chrome does not understand must not take the whole read down.
        continue
      }
      for (const node of nodes) {
        const value = text(node.textContent)
        if (value) return value
      }
    }
    return undefined
  }

  const ogTitle = meta('meta[property="og:title"], meta[name="og:title"]')
  const ogDescription = meta('meta[property="og:description"], meta[name="og:description"]')
  const ogUrl = meta('meta[property="og:url"], meta[name="og:url"]')

  /**
   * og:title on a profile is "Name - Headline | LinkedIn" (sometimes just
   * "Name | LinkedIn", and the headline itself may contain hyphens).
   */
  const fromOgTitle = (): { name?: string; headline?: string } => {
    if (!ogTitle) return {}
    const withoutSuffix = text(ogTitle.replace(/\s*[|·]\s*LinkedIn\s*$/i, ""))
    if (!withoutSuffix) return {}
    const match = withoutSuffix.match(/^(.+?)\s+[-–—]\s+(.+)$/)
    if (match) return { name: text(match[1]), headline: text(match[2]) }
    return { name: withoutSuffix }
  }

  const ogParts = fromOgTitle()

  // --- Embedded Voyager JSON --------------------------------------------------

  /** The `<slug>` of `/in/<slug>`, used to pick the right person out of the payload. */
  const pageSlug = (): string | undefined => {
    let href: string | undefined
    try {
      href = doc.defaultView?.location?.href
    } catch {
      href = undefined
    }
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href")
    for (const candidate of [href, ogUrl, canonical]) {
      const value = text(candidate)
      if (!value) continue
      const match = value.match(/\/in\/([^/?#]+)/)
      const slug = match ? text(decodeURIComponent(match[1])) : undefined
      if (slug) return slug.toLowerCase()
    }
    return undefined
  }

  type Entity = Record<string, unknown>

  const isEntity = (value: unknown): value is Entity =>
    typeof value === "object" && value !== null && !Array.isArray(value)

  /** Flattens every object in a parsed payload, `included` arrays and all. */
  const collectEntities = (root: unknown): Entity[] => {
    const found: Entity[] = []
    const stack: unknown[] = [root]
    let guard = 0
    while (stack.length > 0 && guard < 20000) {
      guard += 1
      const node = stack.pop()
      if (Array.isArray(node)) {
        for (const item of node) stack.push(item)
        continue
      }
      if (!isEntity(node)) continue
      found.push(node)
      for (const key of Object.keys(node)) {
        const value = node[key]
        if (typeof value === "object" && value !== null) stack.push(value)
      }
    }
    return found
  }

  /** Every JSON blob the page embedded in a `<code>` element, parsed and flattened. */
  const embeddedEntities = (): Entity[] => {
    let nodes: Element[]
    try {
      nodes = Array.from(doc.querySelectorAll("code"))
    } catch {
      return []
    }
    const all: Entity[] = []
    for (const node of nodes) {
      // LinkedIn ships some of these payloads as a comment child (`<code><!--{…}--></code>`),
      // where `textContent` is empty, so both forms are read.
      const blobs: string[] = [node.textContent ?? ""]
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 8) blobs.push(child.nodeValue ?? "")
      }
      for (const raw of blobs) {
        const trimmed = raw.trim()
        if (trimmed.length < 2) continue
        const head = trimmed.charAt(0)
        if (head !== "{" && head !== "[") continue
        let parsed: unknown
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          // Some `<code>` blobs are HTML-escaped or truncated; skip them silently.
          continue
        }
        for (const entity of collectEntities(parsed)) all.push(entity)
      }
    }
    return all
  }

  const fromEmbeddedJson = (): {
    name?: string
    headline?: string
    company?: string
    about?: string
  } => {
    const entities = embeddedEntities()
    if (entities.length === 0) return {}

    const people = entities.filter(
      (entity) => text(entity.firstName) !== undefined && text(entity.lastName) !== undefined
    )
    if (people.length === 0) return {}

    const slug = pageSlug()
    const matchesSlug = (entity: Entity): boolean => {
      const identifier = text(entity.publicIdentifier)
      return slug !== undefined && identifier !== undefined && identifier.toLowerCase() === slug
    }
    const person =
      people.find(matchesSlug) ??
      people.find((entity) => block(entity.summary) !== undefined) ??
      people[0]

    const result: { name?: string; headline?: string; company?: string; about?: string } = {}

    const first = text(person.firstName)
    const last = text(person.lastName)
    if (first && last) result.name = `${first} ${last}`

    result.headline = text(person.headline)

    // The About copy often hangs off a sibling entity that shares the profile urn.
    const urn = text(person.entityUrn)
    const identifier = text(person.publicIdentifier)
    const aboutHolder =
      block(person.summary) !== undefined
        ? person
        : entities.find(
            (entity) =>
              block(entity.summary) !== undefined &&
              ((urn !== undefined && text(entity.entityUrn) === urn) ||
                (identifier !== undefined && text(entity.publicIdentifier) === identifier))
          )
    result.about = aboutHolder ? block(aboutHolder.summary) : undefined

    // Positions carry `companyName`; a company entity carries `name`. Prefer a position
    // with no end date (the current one), else the first one that names a company.
    const companyOf = (entity: Entity): string | undefined => {
      const direct = text(entity.companyName)
      if (direct) return direct
      const linked = entity.miniCompany ?? entity.company
      return isEntity(linked) ? text(linked.name) : undefined
    }
    const positions = entities.filter((entity) => companyOf(entity) !== undefined)
    const isCurrent = (entity: Entity): boolean => {
      const range = entity.dateRange
      if (!isEntity(range)) return entity.endMonthYear === undefined || entity.endMonthYear === null
      return range.end === undefined || range.end === null
    }
    const position = positions.find(isCurrent) ?? positions[0]
    if (position) result.company = companyOf(position)

    return result
  }

  const jsonParts = fromEmbeddedJson()

  // --- SDUI profile page -----------------------------------------------------

  /**
   * The 2026 profile rewrite ships a server-driven UI tree: every class name is a
   * content hash, there is no `<h1>`, no `og:*` meta, no `link[rel=canonical]` and no
   * `<code>` Voyager payload. What it does carry are semantic hooks:
   * `[data-sdui-screen]` on the profile root, `[data-sdui-component]` on each card
   * group and `[data-testid]` on a few leaf widgets. Those are what this pass reads.
   */
  const sduiScreen = (): Element | null => {
    let nodes: Element[]
    try {
      nodes = Array.from(doc.querySelectorAll("[data-sdui-screen]"))
    } catch {
      return null
    }
    const profile = nodes.find((node) =>
      (node.getAttribute("data-sdui-screen") ?? "").toLowerCase().includes("profile")
    )
    return profile ?? nodes[0] ?? null
  }

  const fromSdui = (): {
    name?: string
    headline?: string
    company?: string
    about?: string
  } => {
    const screen = sduiScreen()
    if (!screen) return {}

    const result: { name?: string; headline?: string; company?: string; about?: string } = {}

    // The name is the first heading inside the profile screen (an `h2`, not an `h1`).
    const heading = screen.querySelector("h2")
    const headingText = text(heading?.textContent)
    if (heading && headingText && headingText.length <= MAX_NAME) result.name = headingText

    // The top card is the largest ancestor of that heading that does not yet reach a
    // second heading — i.e. it stops before the About / Featured cards below it.
    let card: Element | null = heading
    if (card) {
      for (let depth = 0; depth < 12; depth += 1) {
        const parent: Element | null = card.parentElement
        if (!parent) break
        if (parent.querySelectorAll("h2").length > 1) break
        card = parent
      }
    }

    if (card) {
      // Each entity chip (current employer, school) is a `[role=button]` whose ghost
      // glyph names the entity type: `company-*` for an employer, `school-*` otherwise.
      // Only an employer chip may answer "company", so a school-only profile — one with
      // no current job — correctly reports no company instead of its university.
      const chips = Array.from(card.querySelectorAll('[role="button"]'))
      const chipTexts: string[] = []
      for (const chip of chips) {
        const value = text(chip.textContent)
        if (value) chipTexts.push(value)
        if (result.company !== undefined || !value) continue
        const glyphs = Array.from(chip.querySelectorAll("svg"))
        const isCompany = glyphs.some((glyph) =>
          (glyph.getAttribute("id") ?? "").toLowerCase().startsWith("company")
        )
        if (isCompany) result.company = value
      }

      // The headline is the first paragraph of the top card that is not a pronoun
      // ("She/Her"), a degree badge ("· 2nd"), or the employer/school chip line. The
      // scan stops at the location row, which is the block holding the contact-info
      // link — so a profile with no headline reports none rather than its city.
      const contactLink = 'a[href*="/overlay/contact-info"]'
      for (const node of Array.from(card.querySelectorAll("p"))) {
        const value = text(node.textContent)
        // The location row is the paragraph paired with the contact-info link.
        const twin = node.nextElementSibling
        if (node.querySelector(contactLink) || (twin && twin.querySelector(contactLink))) break
        if (!value || value.length > MAX_HEADLINE) continue
        if (value.charAt(0) === "·") continue
        if (value === result.name) continue
        if (chipTexts.indexOf(value) !== -1) continue
        // "She/Her", "He/Him", "They/Them" — a slash with no spaces around it.
        if (value.length <= 24 && /^[^\s/]+\/[^\s/]+$/.test(value)) continue
        result.headline = value
        break
      }
    }

    // About lives in an expandable text box; prefer the box under the "About" heading
    // and fall back to the first one in the card group above the activity feed, which
    // is the same node on a non-English page.
    const aboutBox = (): Element | null => {
      for (const section of Array.from(screen.querySelectorAll("section"))) {
        const title = text(section.querySelector("h2")?.textContent)
        if (title && /^about$/i.test(title)) {
          const box = section.querySelector('[data-testid="expandable-text-box"]')
          if (box) return box
        }
      }
      const above = screen.querySelector('[data-sdui-component*="AboveActivity"]')
      return above ? above.querySelector('[data-testid="expandable-text-box"]') : null
    }

    const box = aboutBox()
    if (box) {
      let clone: Element | null = null
      try {
        clone = box.cloneNode(true) as Element
      } catch {
        clone = null
      }
      if (clone) {
        for (const node of Array.from(clone.querySelectorAll("h1, h2, h3, button"))) {
          node.remove()
        }
        // The copy uses `<br>` for its paragraph breaks, which `textContent` drops.
        for (const node of Array.from(clone.querySelectorAll("br"))) {
          const owner = node.ownerDocument
          if (!owner) continue
          node.replaceWith(owner.createTextNode("\n"))
        }
        result.about = block(clone.textContent)
      }
    }

    return result
  }

  const sduiParts = fromSdui()

  // --- Name ------------------------------------------------------------------

  const headingName = firstText([
    "main h1",
    ".ph5 h1",
    ".pv-text-details__left-panel h1",
    ".top-card-layout__title",
    "h1",
  ])

  // --- Headline --------------------------------------------------------------

  /**
   * The top card puts the headline in `div.text-body-medium.break-words` directly
   * under the h1. Anchor on the h1 and search its enclosing card so a
   * `.text-body-medium` elsewhere on the page (locations, list rows) cannot win.
   */
  const headlineNearHeading = (): string | undefined => {
    let heading: Element | null = null
    try {
      heading = doc.querySelector("main h1") ?? doc.querySelector("h1")
    } catch {
      heading = null
    }
    if (!heading) return undefined

    const scopes: (Element | null | undefined)[] = [
      heading.parentElement,
      heading.parentElement?.parentElement,
      heading.closest("section"),
      heading.closest("main"),
    ]
    for (const scope of scopes) {
      if (!scope) continue
      const node =
        scope.querySelector(".text-body-medium.break-words") ??
        scope.querySelector(".text-body-medium") ??
        scope.querySelector(".top-card-layout__headline")
      const value = text(node?.textContent)
      if (value && value !== text(heading.textContent)) return value
    }

    // Last resort: the element right after the h1's wrapper — but only if it is
    // headline-shaped, so a body paragraph cannot be mistaken for one.
    const sibling = heading.nextElementSibling ?? heading.parentElement?.nextElementSibling
    const value = text(sibling?.textContent)
    return value && value.length <= MAX_HEADLINE ? value : undefined
  }

  // --- Company ---------------------------------------------------------------

  /**
   * The current-position button in the top card carries the company in its
   * `aria-label` ("Current company: Acme. Click to skip to experience card").
   */
  const companyFromAria = (): string | undefined => {
    let nodes: Element[]
    try {
      nodes = Array.from(doc.querySelectorAll("[aria-label]"))
    } catch {
      return undefined
    }
    for (const node of nodes) {
      const label = text(node.getAttribute("aria-label"))
      if (!label) continue
      const match = label.match(/current company:\s*([^.]+)/i)
      if (match) {
        const value = text(match[1])
        if (value) return value
      }
    }
    return undefined
  }

  /** og:description reads "… · Experience: Acme · Education: … · Location: …". */
  const companyFromOgDescription = (): string | undefined => {
    if (!ogDescription) return undefined
    const match = ogDescription.match(/experience:\s*([^·|]+)/i)
    return match ? text(match[1]) : undefined
  }

  // --- About -----------------------------------------------------------------

  /**
   * `#about` is an empty anchor div; the copy lives further down the same section.
   * Take the section's text with headings and LinkedIn's duplicated screen-reader
   * spans removed.
   */
  const aboutFromSection = (): string | undefined => {
    const anchor = doc.getElementById("about")
    const scope = anchor?.closest("section") ?? anchor?.parentElement
    if (!scope) return undefined

    let clone: HTMLElement
    try {
      clone = scope.cloneNode(true) as HTMLElement
    } catch {
      return undefined
    }
    for (const node of Array.from(
      clone.querySelectorAll("h1, h2, h3, .visually-hidden, button, .pv-shared-text-with-see-more__see-more-less-toggle")
    )) {
      node.remove()
    }
    const value = block(clone.textContent)
    if (!value) return undefined
    // A section whose only content was the "About" heading yields nothing useful.
    return value.replace(/^about\b[:\s]*/i, "").trim() || undefined
  }

  const selectionText = (): string | undefined => {
    try {
      return block(doc.defaultView?.getSelection()?.toString())
    } catch {
      return undefined
    }
  }

  // --- Profile URL -----------------------------------------------------------

  const stripQuery = (value: unknown): string | undefined => {
    const raw = text(value)
    if (!raw) return undefined
    const cut = raw.split("#")[0].split("?")[0]
    return text(cut)
  }

  const profileUrl = (): string | undefined => {
    let href: string | undefined
    try {
      href = doc.defaultView?.location?.href
    } catch {
      href = undefined
    }
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href")
    return stripQuery(href) ?? stripQuery(ogUrl) ?? stripQuery(canonical)
  }

  // --- Assemble --------------------------------------------------------------

  const result: LinkedInProfileExtraction = {}
  const sources: Record<LinkedInProfileField, LinkedInProfileSource | null> = {
    name: null,
    headline: null,
    company: null,
    about: null,
  }

  /** Takes the first strategy that produced a value and records which one it was. */
  const pick = (
    field: LinkedInProfileField,
    max: number,
    candidates: { source: LinkedInProfileSource; value: string | undefined }[]
  ): void => {
    for (const candidate of candidates) {
      if (!candidate.value) continue
      result[field] = candidate.value.slice(0, max)
      sources[field] = candidate.source
      return
    }
  }

  pick("name", MAX_NAME, [
    { source: "json", value: jsonParts.name },
    { source: "dom", value: headingName },
    { source: "dom", value: sduiParts.name },
    { source: "og", value: ogParts.name },
  ])

  pick("headline", MAX_HEADLINE, [
    { source: "json", value: jsonParts.headline },
    { source: "dom", value: headlineNearHeading() },
    { source: "dom", value: sduiParts.headline },
    { source: "og", value: ogParts.headline },
  ])

  pick("company", MAX_COMPANY, [
    { source: "json", value: jsonParts.company },
    { source: "dom", value: companyFromAria() },
    { source: "dom", value: sduiParts.company },
    { source: "og", value: companyFromOgDescription() },
  ])

  // A substantial selection is an explicit "use this" from the user, so it wins over
  // every other strategy — the same rule the job extractor uses.
  const selection = selectionText()
  pick("about", MAX_ABOUT, [
    {
      source: "selection",
      value: selection && selection.length >= MIN_SELECTION ? selection : undefined,
    },
    { source: "json", value: jsonParts.about },
    { source: "dom", value: aboutFromSection() },
    { source: "dom", value: sduiParts.about },
    { source: "og", value: ogDescription },
  ])

  const url = profileUrl()
  if (url && url.length <= MAX_URL) result.profileUrl = url

  // Only diagnose a read that found something: a page with nothing on it still returns {}.
  const fields: LinkedInProfileField[] = ["name", "headline", "company", "about"]
  if (fields.some((field) => sources[field] !== null)) {
    result.sources = sources
    console.debug("[rolespec] linkedin profile extraction", sources)
  }

  return result
}
