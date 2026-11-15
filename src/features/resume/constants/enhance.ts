/**
 * Caps shared by the enhance server action's zod schema and the client that
 * feeds it — the client truncates to these so oversized-but-legitimate input is
 * shortened instead of failing the whole run with "Invalid input".
 */
export const MAX_ENHANCE_TARGETS = 80
export const MAX_ENHANCE_LABEL_LENGTH = 200
export const MAX_ENHANCE_TARGET_TEXT_LENGTH = 2000
export const MAX_ENHANCE_JOB_DESCRIPTION_LENGTH = 5000
