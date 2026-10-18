"use client"

import Link from "next/link"
import { Copy, ExternalLink, UserRoundCheck } from "lucide-react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { cn } from "@/shared/lib/utils"

/**
 * One prebuilt board search. Structural on purpose: it mirrors
 * `BoardSearchLink` from the board-search-links service without importing it,
 * so this component does not depend on how that service is put together.
 */
export interface BoardSearchLinkItem {
  board: "LINKEDIN" | "INDEED" | "JOBSTREET"
  label: string
  query: string
  location: string | null
  url: string
}

export interface BoardSearchGroup {
  role: string
  links: BoardSearchLinkItem[]
}

interface Props {
  groups: BoardSearchGroup[]
}

/** The query the copy button hands over: LinkedIn's when there is one. */
function copyableQuery(links: BoardSearchLinkItem[]): string | null {
  const linkedin = links.find((link) => link.board === "LINKEDIN")
  return (linkedin ?? links[0])?.query ?? null
}

/**
 * The location line for a group, or null. Only shown when every link searched
 * the same place — a single line over links that disagree would mislabel some.
 */
function sharedLocationLabel(links: BoardSearchLinkItem[]): string | null {
  if (links.length === 0) return null
  const first = links[0].location
  if (!first) return null
  if (!links.every((link) => link.location === first)) return null
  return first.toLowerCase() === "remote" ? "Remote" : `in ${first}`
}

async function copyQuery(query: string) {
  try {
    await navigator.clipboard.writeText(query)
    toast.success("Query copied")
  } catch {
    toast.error("Couldn't copy the query. Select it and copy it by hand.")
  }
}

/**
 * Direct searches on the big job boards, one row per active target role.
 *
 * Nothing is fetched here: each link is a plain URL the user opens themselves,
 * and the query is shown inline for boards that ignore URL parameters.
 */
export function BoardSearchLinks({ groups }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Search job boards</CardTitle>
        <CardDescription>
          Each search is built from the role, your confirmed capabilities, and your
          preferred locations. Nothing is sent anywhere until you open a link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <EmptyState
            variant="bare"
            icon={UserRoundCheck}
            title="No active target roles"
            description="Board searches are built from your active target roles."
            action={
              <Link
                href="/career-profile"
                className="text-sm font-medium text-brand-400 underline-offset-4 hover:underline"
              >
                Go to Career Profile
              </Link>
            }
          />
        ) : (
          <ul className="space-y-4">
            {groups.map((group) => {
              const query = copyableQuery(group.links)
              const location = sharedLocationLabel(group.links)
              return (
                <li key={group.role} className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h3 className="break-words text-sm font-medium">{group.role}</h3>
                    {location && (
                      <span className="text-xs text-muted-foreground">{location}</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {group.links.map((link) => (
                      <a
                        key={link.board}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={link.query}
                        aria-label={`${link.label}: search ${group.role} (opens in a new tab)`}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        {link.label}
                      </a>
                    ))}
                    {query && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => copyQuery(query)}
                        aria-label={`Copy query for ${group.role}`}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        Copy query
                      </Button>
                    )}
                  </div>

                  {query && (
                    <code className="block break-words rounded-md bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground">
                      {query}
                    </code>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
