/** Upload cap for the LinkedIn "Save profile as PDF" export. */
export const LINKEDIN_PDF_MAX_BYTES = 5 * 1024 * 1024 // 5 MB
/** Below this, the PDF produced no usable text (image-only or wrong file). */
export const LINKEDIN_PDF_MIN_TEXT_LENGTH = 200
