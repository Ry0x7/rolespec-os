/**
 * The composite key an agenda item carries, in one place.
 *
 * The agenda is a merge of four sources, so a row's identity has to say which
 * source it came from. Splitting that back apart is how the todo row reaches
 * the `Todo` it stands for — and it lives here, apart from `calendar.service`,
 * because the agenda renders in the browser and that module talks to Prisma.
 */

const TODO_KEY_PREFIX = "todo:"

export function todoAgendaKey(todoId: string): string {
  return `${TODO_KEY_PREFIX}${todoId}`
}

/** The `Todo` row behind a `todo` agenda item. */
export function todoIdFromAgendaKey(key: string): string {
  return key.startsWith(TODO_KEY_PREFIX) ? key.slice(TODO_KEY_PREFIX.length) : key
}
