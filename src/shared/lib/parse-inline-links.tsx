import type { ReactNode } from "react"

const LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g

export function parseInlineLinks(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  LINK_REGEX.lastIndex = 0
  while ((match = LINK_REGEX.exec(text)) !== null) {
    const [full, label, url] = match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    nodes.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline text-blue-600 hover:text-blue-800"
      >
        {label}
      </a>
    )
    lastIndex = match.index + full.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes.length > 0 ? nodes : [text]
}
