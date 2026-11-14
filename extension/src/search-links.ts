import type { SearchLink, SearchLinkGroup, SearchLinksResponse } from "./api"

export interface RenderSearchLinksOptions {
  /** RoleSpec base URL, for the "fill in your Career Profile" link. */
  appUrl: string
  onCopy(query: string): void
}

/**
 * The location every link in the group searches, phrased for one line under the role
 * heading. Null when the links disagree or none carries a location: a line that is
 * only true for some of the links would mislead.
 */
export function sharedLocationLabel(links: SearchLink[]): string | null {
  const first = links[0]?.location ?? null
  if (!first) return null
  if (!links.every((link) => link.location === first)) return null
  return /^remote$/i.test(first.trim()) ? "Remote" : `in ${first}`
}

/** The query "Copy query" copies: LinkedIn's when the group has one, else the first. */
export function copyQueryFor(group: SearchLinkGroup): string {
  const linkedIn = group.links.find((link) => link.board === "LINKEDIN")
  return (linkedIn ?? group.links[0])?.query ?? ""
}

function anchor(href: string, text: string): HTMLAnchorElement {
  const node = document.createElement("a")
  node.className = "link"
  node.href = href
  node.target = "_blank"
  node.rel = "noreferrer"
  node.textContent = text
  return node
}

function renderGroup(group: SearchLinkGroup, opts: RenderSearchLinksOptions): HTMLElement {
  const section = document.createElement("section")
  section.className = "search-group"

  const head = document.createElement("div")
  head.className = "field-head"
  const heading = document.createElement("h2")
  heading.className = "search-role"
  heading.textContent = group.role
  head.append(heading)

  const query = copyQueryFor(group)
  if (query) {
    const copy = document.createElement("button")
    copy.type = "button"
    copy.className = "button button-quiet button-mini"
    copy.textContent = "Copy query"
    copy.addEventListener("click", () => opts.onCopy(query))
    head.append(copy)
  }
  section.append(head)

  const location = sharedLocationLabel(group.links)
  if (location) {
    const line = document.createElement("p")
    line.className = "hint"
    line.textContent = location
    section.append(line)
  }

  const list = document.createElement("ul")
  list.className = "search-links"
  for (const link of group.links) {
    const item = document.createElement("li")
    item.className = "search-link"
    const a = anchor(link.url, link.label || link.board)
    a.title = link.query
    item.append(a)
    if (link.query) {
      const code = document.createElement("code")
      code.textContent = link.query
      item.append(code)
    }
    list.append(item)
  }
  section.append(list)
  return section
}

/**
 * Render the Search tab's body into `container`, replacing whatever was there. Every
 * string from the server goes in through `textContent` or an attribute, never markup.
 */
export function renderSearchLinks(
  container: HTMLElement,
  data: SearchLinksResponse,
  opts: RenderSearchLinksOptions,
): void {
  container.replaceChildren()

  if (data.groups.length === 0) {
    const empty = document.createElement("p")
    empty.className = "notice"
    empty.textContent = "No active target roles in your Career Profile. "
    empty.append(anchor(`${opts.appUrl}/career-profile`, "Add target roles"))
    container.append(empty)
    return
  }

  for (const group of data.groups) container.append(renderGroup(group, opts))

  if (data.activeTargetRoleCount > data.groups.length) {
    const note = document.createElement("p")
    note.className = "hint"
    note.textContent = `Showing your top ${data.groups.length} of ${data.activeTargetRoleCount} target roles.`
    container.append(note)
  }
}
