import { afterEach, describe, expect, it, vi } from "vitest"
import type { QualifyPosting } from "./api"
import type { BadgeVerdict } from "./badge-cache"
import { BADGE_HOST_ATTR, BADGED_ATTR, createBadgeRunner, renderBadge, type QualifyReply } from "./badge-core"
import { extractJobPosting } from "./extractor"
import { QUALIFICATION_VERDICTS } from "./types"
import { VERDICT_BADGES } from "./verdict-badges"
import jobstreetList from "./__fixtures__/badge-jobstreet-list.html?raw"
import jobstreetDetail from "./__fixtures__/badge-jobstreet-detail.html?raw"

const FORBIDDEN = ["focus", "focusin", "input", "keydown", "submit", "mousedown"]

function load(html: string): void {
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML
}

function verdictFor(posting: QualifyPosting, i: number): BadgeVerdict {
  const verdicts = ["STRONG", "WORTH_A_LOOK", "WEAK", "BLOCKED"] as const
  return { key: posting.key, verdict: verdicts[i % 4], riskLevel: i === 0 ? "HIGH" : null, matched: ["Patient care"] }
}

const answerAll = async (postings: QualifyPosting[]): Promise<QualifyReply> => ({
  ok: true,
  profileComplete: true,
  results: postings.map(verdictFor),
})

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.innerHTML = "<head></head><body></body>"
})

describe("renderBadge", () => {
  it("mounts one closed-shadow badge right after the mount, idempotently", () => {
    document.body.innerHTML = '<h1 id="t">Nurse</h1><p>after</p>'
    const mount = document.getElementById("t")!
    const registry = new WeakMap()
    const result: BadgeVerdict = { key: "k1", verdict: "STRONG", riskLevel: "HIGH", matched: ["Triage", "IV"] }

    const shadow = renderBadge(mount, result, registry)
    expect(renderBadge(mount, result, registry)).toBeNull()
    expect(renderBadge(mount, result, registry)).toBeNull()

    const hosts = document.querySelectorAll(`[${BADGE_HOST_ATTR}]`)
    expect(hosts).toHaveLength(1)
    expect(mount.nextElementSibling).toBe(hosts[0])
    expect(mount.getAttribute(BADGED_ATTR)).toBe("1")
    // Closed: the page cannot reach into it.
    expect((hosts[0] as HTMLElement).shadowRoot).toBeNull()
    expect(shadow?.mode).toBe("closed")
    const pill = shadow!.querySelector(".pill")!
    expect(pill.textContent).toBe("✓ Strong fit· ⚑ risk")
    expect(pill.getAttribute("title")).toContain("Matches: Triage, IV")
    // Styles live in the shadow root only.
    expect(document.querySelector("style")).toBeNull()
    expect(shadow!.querySelector("style")).not.toBeNull()
  })

  it("replaces the badge when the mount is reused for another job", () => {
    document.body.innerHTML = '<h1 id="t">Nurse</h1>'
    const mount = document.getElementById("t")!
    const registry = new WeakMap()
    renderBadge(mount, { key: "a", verdict: "STRONG", riskLevel: null, matched: [] }, registry)
    const shadow = renderBadge(mount, { key: "b", verdict: "BLOCKED", riskLevel: null, matched: [] }, registry)
    expect(document.querySelectorAll(`[${BADGE_HOST_ATTR}]`)).toHaveLength(1)
    expect(shadow!.querySelector(".pill")!.textContent).toBe("⛔ Blocked")
  })
})

describe("badge wording", () => {
  it.each(QUALIFICATION_VERDICTS)("%s uses the side panel's VERDICT_BADGES label", (verdict) => {
    document.body.innerHTML = '<h1 id="t">Nurse</h1>'
    const shadow = renderBadge(document.getElementById("t")!, { key: "k", verdict, riskLevel: null, matched: [] }, new WeakMap())
    expect(shadow!.querySelector(".pill")!.textContent).toBe(VERDICT_BADGES[verdict].label)
  })
})

describe("createBadgeRunner", () => {
  it("badges every JobStreet card once, requests each key once, adds no page listeners", async () => {
    load(jobstreetList)
    const docSpy = vi.spyOn(document, "addEventListener")
    const winSpy = vi.spyOn(window, "addEventListener")
    const inputsBefore = document.querySelectorAll("input, form").length
    const send = vi.fn(answerAll)
    const runner = createBadgeRunner({
      doc: document,
      getUrl: () => "https://ph.jobstreet.com/nurse-jobs",
      send,
      extract: extractJobPosting,
    })

    await runner.scan()
    await runner.scan()
    await runner.scan()

    expect(send).toHaveBeenCalledTimes(1)
    const sent = send.mock.calls[0][0]
    expect(sent).toHaveLength(20)
    expect(sent[0]).toMatchObject({
      key: "https://ph.jobstreet.com/job/95217144",
      url: "https://ph.jobstreet.com/job/95217144",
      title: "Virtual Assistant - Intake Coordinator (Registered Nurse)",
    })
    expect(document.querySelectorAll(`[${BADGE_HOST_ATTR}]`)).toHaveLength(20)
    expect(document.querySelectorAll(`[${BADGED_ATTR}="1"]`)).toHaveLength(20)
    for (const spy of [docSpy, winSpy]) {
      for (const [type] of spy.mock.calls) expect(FORBIDDEN).not.toContain(type)
    }
    expect(docSpy).not.toHaveBeenCalled()
    expect(winSpy).not.toHaveBeenCalled()
    expect(document.querySelectorAll("input, form")).toHaveLength(inputsBefore)
  })

  it("re-badges re-rendered cards from memory without a new request", async () => {
    load(jobstreetList)
    const send = vi.fn(answerAll)
    const runner = createBadgeRunner({
      doc: document,
      getUrl: () => "https://ph.jobstreet.com/nurse-jobs",
      send,
      extract: extractJobPosting,
    })
    await runner.scan()
    // A virtualised list throws the card DOM away and renders it again.
    load(jobstreetList)
    expect(document.querySelectorAll(`[${BADGE_HOST_ATTR}]`)).toHaveLength(0)
    await runner.scan()
    expect(send).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll(`[${BADGE_HOST_ATTR}]`)).toHaveLength(20)
  })

  it("splits more than 40 unknown postings into batches of 40", async () => {
    document.body.innerHTML = Array.from(
      { length: 45 },
      (_, i) =>
        `<article data-testid="job-card" data-job-id="${i + 1}"><a data-automation="jobTitle" href="/job/${i + 1}">Job ${i + 1}</a></article>`,
    ).join("")
    const send = vi.fn(answerAll)
    const runner = createBadgeRunner({
      doc: document,
      getUrl: () => "https://ph.jobstreet.com/jobs",
      send,
      extract: extractJobPosting,
    })
    await runner.scan()
    expect(send.mock.calls.map(([postings]) => postings.length)).toEqual([40, 5])
    expect(document.querySelectorAll(`[${BADGE_HOST_ATTR}]`)).toHaveLength(45)
  })

  it("sends the extracted detail posting and badges the title", async () => {
    load(jobstreetDetail)
    const send = vi.fn(answerAll)
    const url = "https://ph.jobstreet.com/job/95217144?ref=search"
    const runner = createBadgeRunner({ doc: document, getUrl: () => url, send, extract: extractJobPosting })
    await runner.scan()
    expect(send).toHaveBeenCalledTimes(1)
    const [posting] = send.mock.calls[0][0]
    expect(posting).toMatchObject({
      key: "https://ph.jobstreet.com/job/95217144",
      url,
      title: "Virtual Assistant - Intake Coordinator (Registered Nurse)",
      companyName: "Reproductive Sciences Management Company",
    })
    expect(posting.description?.length).toBeGreaterThan(100)
    const title = document.querySelector('h1[data-automation="job-detail-title"]')!
    expect(title.nextElementSibling?.hasAttribute(BADGE_HOST_ATTR)).toBe(true)
  })

  it("renders nothing and stops when the profile is incomplete or signed out", async () => {
    const replies: QualifyReply[] = [
      { ok: true, profileComplete: false, results: [] },
      { ok: false, reason: "signed-out" },
      { ok: false, reason: "unauthorized" },
    ]
    for (const reply of replies) {
      load(jobstreetList)
      const send = vi.fn(async () => reply)
      const runner = createBadgeRunner({
        doc: document,
        getUrl: () => "https://ph.jobstreet.com/nurse-jobs",
        send,
        extract: extractJobPosting,
      })
      await runner.scan()
      await runner.scan()
      expect(send).toHaveBeenCalledTimes(1)
      expect(runner.isStopped()).toBe(true)
      expect(document.querySelectorAll(`[${BADGE_HOST_ATTR}]`)).toHaveLength(0)
    }
  })

  it("backs off after a rate limit instead of re-requesting on every mutation", async () => {
    load(jobstreetList)
    let clock = 0
    const send = vi.fn(async (): Promise<QualifyReply> => ({ ok: false, reason: "rate_limited" }))
    const runner = createBadgeRunner({
      doc: document,
      getUrl: () => "https://ph.jobstreet.com/nurse-jobs",
      send,
      extract: extractJobPosting,
      now: () => clock,
    })
    await runner.scan()
    await runner.scan()
    expect(send).toHaveBeenCalledTimes(1)
    clock = 61_000
    await runner.scan()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("does nothing on an unsupported site", async () => {
    load(jobstreetList)
    const send = vi.fn(answerAll)
    const runner = createBadgeRunner({ doc: document, getUrl: () => "https://example.com/jobs", send, extract: extractJobPosting })
    await runner.scan()
    expect(send).not.toHaveBeenCalled()
  })
})
