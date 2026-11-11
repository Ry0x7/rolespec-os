/**
 * ATS vendor support, kept separate from the generic host allowlist.
 *
 * `ingestion` and `formFilling` are deliberately different facts. RoleSpec can
 * ingest a posting from many boards it cannot safely fill; the panel must say so
 * instead of implying a Workday form is fully automatic.
 */

export type AtsVendorKey =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "bamboohr"
  | "smartrecruiters"
  | "jobvite"
  | "icims"
  | "taleo"
  | "workday"
  | "recruitee"
  | "teamtailor"
  | "personio"
  | "generic"

export type AtsFillingMode = "verified-fixture" | "assisted" | "manual"

export interface AtsAdapter {
  key: AtsVendorKey
  label: string
  hosts: readonly string[]
  /** Postings on this host can be clipped into RoleSpec. */
  ingestion: boolean
  /** How far the form filler is supported. */
  formFilling: AtsFillingMode
  /** One sentence the panel shows before scanning. */
  note: string
}

export const ATS_ADAPTERS: readonly AtsAdapter[] = [
  {
    key: "greenhouse",
    label: "Greenhouse",
    hosts: ["greenhouse.io"],
    ingestion: true,
    formFilling: "verified-fixture",
    note: "Standard labelled fields. Safe profile facts fill; questions go to review.",
  },
  {
    key: "lever",
    label: "Lever",
    hosts: ["lever.co"],
    ingestion: true,
    formFilling: "verified-fixture",
    note: "Radio groups and typeaheads are recognised and never guessed.",
  },
  {
    key: "ashby",
    label: "Ashby",
    hosts: ["ashbyhq.com"],
    ingestion: true,
    formFilling: "verified-fixture",
    note: "React controls are scanned; choice controls always stay manual.",
  },
  {
    key: "workable",
    label: "Workable",
    hosts: ["workable.com"],
    ingestion: true,
    formFilling: "assisted",
    note: "Assisted filling; verify every value before submitting.",
  },
  {
    key: "bamboohr",
    label: "BambooHR",
    hosts: ["bamboohr.com"],
    ingestion: true,
    formFilling: "assisted",
    note: "Assisted filling; embedded frames are scanned individually.",
  },
  {
    key: "smartrecruiters",
    label: "SmartRecruiters",
    hosts: ["smartrecruiters.com"],
    ingestion: true,
    formFilling: "assisted",
    note: "Assisted filling; custom widgets may need manual selection.",
  },
  {
    key: "jobvite",
    label: "Jobvite",
    hosts: ["jobvite.com"],
    ingestion: true,
    formFilling: "assisted",
    note: "Assisted filling; verify every value before submitting.",
  },
  {
    key: "icims",
    label: "iCIMS",
    hosts: ["icims.com"],
    ingestion: true,
    formFilling: "assisted",
    note: "Assisted filling; some steps open in separate frames.",
  },
  {
    key: "taleo",
    label: "Taleo",
    hosts: ["taleo.net"],
    ingestion: true,
    formFilling: "manual",
    note: "Taleo's custom controls are not safely automatable. Use the manual fallback.",
  },
  {
    key: "workday",
    label: "Workday",
    hosts: ["myworkdayjobs.com", "workday.com"],
    ingestion: true,
    formFilling: "assisted",
    note: "Workday spans frames and custom menus. Scan each step; attach the resume manually if needed.",
  },
  {
    key: "recruitee",
    label: "Recruitee",
    hosts: ["recruitee.com"],
    ingestion: true,
    formFilling: "assisted",
    note: "Assisted filling; verify every value before submitting.",
  },
  {
    key: "teamtailor",
    label: "Teamtailor",
    hosts: ["teamtailor.com"],
    ingestion: true,
    formFilling: "assisted",
    note: "Assisted filling; verify every value before submitting.",
  },
  {
    key: "personio",
    label: "Personio",
    hosts: ["personio.com"],
    ingestion: true,
    formFilling: "assisted",
    note: "Assisted filling; verify every value before submitting.",
  },
  {
    key: "generic",
    label: "Application form",
    hosts: [],
    ingestion: false,
    formFilling: "manual",
    note: "Unrecognised ATS. Only open a supported form, or fill this one manually.",
  },
]

export function adapterForVendor(key: string | null | undefined): AtsAdapter {
  return ATS_ADAPTERS.find((adapter) => adapter.key === key) ?? ATS_ADAPTERS[ATS_ADAPTERS.length - 1]
}

/** The adapter whose host suffix matches, or null when this is not a supported ATS. */
export function detectAtsAdapter(url: string | null | undefined): AtsAdapter | null {
  if (!url) return null
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
    host = parsed.hostname.toLowerCase()
  } catch {
    return null
  }
  for (const adapter of ATS_ADAPTERS) {
    for (const suffix of adapter.hosts) {
      if (host === suffix || host.endsWith(`.${suffix}`)) return adapter
    }
  }
  return null
}

/** `verified-fixture` still requires the user to review the page; say so plainly. */
export function fillingLabel(mode: AtsFillingMode): string {
  if (mode === "verified-fixture") return "Form filling: fixture-tested"
  if (mode === "assisted") return "Form filling: assisted"
  return "Form filling: manual fallback"
}
