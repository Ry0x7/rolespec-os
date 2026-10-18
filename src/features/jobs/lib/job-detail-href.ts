/**
 * The Job Detail section anchors, matching the `id`s on the page's sections and
 * the keys in `JOB_DETAIL_SECTIONS`. Kept as a plain type here (not imported
 * from the section nav) because that module is a client component and this
 * helper is used by server components too.
 */
export type JobDetailSection = "decide" | "prepare" | "track" | "posting"

/**
 * `/jobs/:id`, optionally deep-linked to one section so a surface that already
 * knows what the user came to do (chase a follow-up, decide, tailor) lands them
 * there instead of at the top of the page.
 */
export function jobDetailHref(id: string, section?: JobDetailSection): string {
  return section ? `/jobs/${id}#${section}` : `/jobs/${id}`
}
