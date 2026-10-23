import type { ParsedResume } from "./parse-resume"

export class ResumeTextRequiredError extends Error {
  constructor() {
    super("No readable text was found. Use a text-based PDF or DOCX. Scanned resumes need OCR before uploading.")
    this.name = "ResumeTextRequiredError"
  }
}

// Only split on familiar standalone headings. Everything else stays verbatim;
// guessing employer, role and date boundaries would silently lose information.
const SECTION_HEADING = /^(?:(?:professional |career )?(?:summary|profile|experience)|work (?:experience|history)|employment(?: history)?|education|(?:technical |core )?skills|projects|certifications?|licenses?(?: and certifications)?|awards|publications|languages|volunteer(?: experience)?|interests|references)\s*:?$/i

export function importResumeText(text: string): ParsedResume {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
    // pdf-parse adds page delimiters; they are not resume content.
    .filter((line) => !/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/.test(line))
  if (!lines.some((line) => /[\p{L}\p{N}]/u.test(line))) {
    throw new ResumeTextRequiredError()
  }

  const importedSections: NonNullable<ParsedResume["importedSections"]> = []
  let title = "Imported details"
  let content: string[] = []
  function flush() {
    const value = content.join("\n").trim()
    if (value) importedSections.push({ title, content: value })
    content = []
  }
  for (const line of lines) {
    if (SECTION_HEADING.test(line.trim())) {
      flush()
      title = line.trim().replace(/:$/, "")
    } else {
      content.push(line)
    }
  }
  flush()
  // A document consisting only of headings still has readable source text.
  if (!importedSections.length) {
    importedSections.push({ title: "Imported resume", content: lines.join("\n").trim() })
  }

  return {
    title: "", // The route uses the sanitized filename.
    contact: {}, summary: {}, experience: [], education: [], skills: [],
    projects: [], certifications: [], importedSections,
  }
}
