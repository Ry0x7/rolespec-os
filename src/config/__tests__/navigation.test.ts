import { describe, expect, it } from "vitest"

import { getBreadcrumbs, getPageTitle } from "../navigation"

describe("getPageTitle", () => {
  it("uses the section title for nested routes", () => {
    expect(getPageTitle("/settings/profile")).toBe("Settings")
    expect(getPageTitle("/jobs/cover-letter/new")).toBe("Cover letters")
  })

  it("falls back to the full product name", () => {
    expect(getPageTitle("/unknown")).toBe("RoleSpec OS")
  })
})

describe("getBreadcrumbs", () => {
  it("collapses a dynamic record id to Details", () => {
    expect(getBreadcrumbs("/resumes/cmw7045sh000458dw2pixdzbv")).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "My resumes", href: "/resumes" },
      { label: "Details", href: "" },
    ])
  })

  it("does not call a static settings sub-page a detail record", () => {
    expect(getBreadcrumbs("/settings/profile")).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Settings", href: "/settings" },
    ])
  })

  it("keeps a static create route under its section", () => {
    expect(getBreadcrumbs("/jobs/cover-letter/new")).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Cover letters", href: "/jobs/cover-letter" },
    ])
  })
})
