import { describe, expect, it, vi } from "vitest"
import { BADGE_SCRIPT_FILE, BADGE_SCRIPT_ID, createBadgeRegistration, type BadgeRegistrationDeps } from "./badge-registration"

/** A fake `chrome` slice with real-ish state: granted origins, one registration, open tabs. */
function fakeChrome(options: { origins: string[]; registered?: boolean; tabs?: Array<{ id?: number; url: string }> }) {
  let origins = [...options.origins]
  let registered: chrome.scripting.RegisteredContentScript | null = options.registered
    ? { id: BADGE_SCRIPT_ID, js: [BADGE_SCRIPT_FILE], matches: ["https://old.example/*"] }
    : null
  const tabs = options.tabs ?? []
  const deps = {
    permissions: { getAll: vi.fn(async () => ({ origins })) },
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => (registered ? [registered] : [])),
      registerContentScripts: vi.fn(async ([script]: chrome.scripting.RegisteredContentScript[]) => {
        if (registered) throw new Error("Duplicate script ID")
        registered = script
      }),
      updateContentScripts: vi.fn(async ([script]: chrome.scripting.RegisteredContentScript[]) => {
        registered = script
      }),
      unregisterContentScripts: vi.fn(async () => {
        registered = null
      }),
      executeScript: vi.fn(async (_injection: { target: { tabId: number; allFrames?: boolean }; files: string[] }) => []),
    },
    tabs: {
      query: vi.fn(async ({ url }: { url: string[] }) =>
        tabs.filter((tab) => url.some((pattern) => tab.url.startsWith(pattern.slice(0, -1)))),
      ),
    },
    log: { error: vi.fn(), warn: vi.fn() },
  } satisfies BadgeRegistrationDeps
  return {
    deps,
    setOrigins: (next: string[]) => (origins = next),
    registered: () => registered,
  }
}

describe("badge registration", () => {
  it("onAdded with a supported origin registers it and injects into each open tab there", async () => {
    const fake = fakeChrome({
      origins: ["https://ph.jobstreet.com/*", "https://example.com/*"],
      tabs: [
        { id: 1, url: "https://ph.jobstreet.com/nurse-jobs" },
        { id: 2, url: "https://ph.jobstreet.com/job/95217144" },
        { id: 3, url: "https://example.com/" },
        { url: "https://ph.jobstreet.com/no-id" },
      ],
    })
    const registration = createBadgeRegistration(fake.deps)

    await registration.onPermissionsAdded({ origins: ["https://ph.jobstreet.com/*"] })

    expect(fake.deps.scripting.registerContentScripts).toHaveBeenCalledWith([
      {
        id: BADGE_SCRIPT_ID,
        js: [BADGE_SCRIPT_FILE],
        matches: ["https://ph.jobstreet.com/*"],
        runAt: "document_idle",
        allFrames: false,
        persistAcrossSessions: true,
      },
    ])
    expect(fake.deps.tabs.query).toHaveBeenCalledWith({ url: ["https://ph.jobstreet.com/*"] })
    expect(fake.deps.scripting.executeScript.mock.calls.map(([injection]) => injection)).toEqual([
      { target: { tabId: 1, allFrames: false }, files: [BADGE_SCRIPT_FILE] },
      { target: { tabId: 2, allFrames: false }, files: [BADGE_SCRIPT_FILE] },
    ])
  })

  it("onAdded on an existing registration updates the matches instead of re-registering", async () => {
    const fake = fakeChrome({ origins: ["https://ph.jobstreet.com/*", "https://ph.linkedin.com/*"], registered: true })
    await createBadgeRegistration(fake.deps).onPermissionsAdded({ origins: ["https://ph.linkedin.com/*"] })
    expect(fake.deps.scripting.registerContentScripts).not.toHaveBeenCalled()
    expect(fake.registered()?.matches).toEqual(["https://ph.jobstreet.com/*", "https://ph.linkedin.com/*"])
  })

  it.each([["https://*/*"], ["http://*/*"], ["https://example.com/*"], ["https://*.indeed.com/*"]])(
    "onAdded with %s registers nothing and injects nothing",
    async (origin) => {
      const fake = fakeChrome({ origins: [origin], tabs: [{ id: 1, url: "https://ph.jobstreet.com/" }] })
      await createBadgeRegistration(fake.deps).onPermissionsAdded({ origins: [origin] })
      expect(fake.deps.scripting.registerContentScripts).not.toHaveBeenCalled()
      expect(fake.deps.scripting.updateContentScripts).not.toHaveBeenCalled()
      expect(fake.deps.scripting.executeScript).not.toHaveBeenCalled()
    },
  )

  it("a broad grant alongside a supported one never widens the matches", async () => {
    const fake = fakeChrome({ origins: ["https://*/*", "https://ph.indeed.com/*"] })
    await createBadgeRegistration(fake.deps).syncBadgeScripts()
    expect(fake.registered()?.matches).toEqual(["https://ph.indeed.com/*"])
  })

  it("onRemoved shrinks the matches, then unregisters when no supported origin is left", async () => {
    const fake = fakeChrome({ origins: ["https://ph.jobstreet.com/*", "https://ph.indeed.com/*"] })
    const registration = createBadgeRegistration(fake.deps)
    await registration.syncBadgeScripts()
    expect(fake.registered()?.matches).toEqual(["https://ph.jobstreet.com/*", "https://ph.indeed.com/*"])

    fake.setOrigins(["https://ph.indeed.com/*", "https://example.com/*"])
    await registration.onPermissionsRemoved()
    expect(fake.deps.scripting.updateContentScripts).toHaveBeenCalledTimes(1)
    expect(fake.registered()?.matches).toEqual(["https://ph.indeed.com/*"])

    fake.setOrigins(["https://example.com/*"])
    await registration.onPermissionsRemoved()
    expect(fake.deps.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [BADGE_SCRIPT_ID] })
    expect(fake.registered()).toBeNull()
  })

  it("overlapping syncs are serialised (no duplicate-id register)", async () => {
    const fake = fakeChrome({ origins: ["https://ph.jobstreet.com/*"] })
    const registration = createBadgeRegistration(fake.deps)
    await Promise.all([registration.syncBadgeScripts(), registration.syncBadgeScripts(), registration.syncBadgeScripts()])
    expect(fake.deps.scripting.registerContentScripts).toHaveBeenCalledTimes(1)
    expect(fake.deps.scripting.updateContentScripts).toHaveBeenCalledTimes(2)
    expect(fake.deps.log.error).not.toHaveBeenCalled()
  })
})
