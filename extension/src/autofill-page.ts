/**
 * Page-side helpers injected with `chrome.scripting.executeScript({ func })`.
 *
 * Chrome stringifies these functions, so each one must be completely
 * self-contained: no imports, no module-scope constants, no helper calls.
 * They only read visible controls and write the values the panel approved.
 * Neither function can submit a form — there is no `form.submit()`, no button
 * click and no keyboard event here.
 */

export interface ScannedField {
  id: string
  label: string
  name?: string
  type?: string
  autocomplete?: string
  tagName?: string
  required?: boolean
  options?: string[]
  /** A typeahead/combobox that discards free text unless a suggestion is chosen. */
  requiresSelection?: boolean
}

export interface FillAssignment {
  id: string
  value: string
}

export interface FieldFillResult {
  id: string
  status: "FILLED" | "FAILED"
  reason?: string
}

export interface FillOutcome {
  filled: number
  missed: number
  /** One entry per assignment, so the panel can report field-level outcomes. */
  results: FieldFillResult[]
}

export interface PageGuardInfo {
  submitControlCount: number
  captchaDetected: boolean
  formCount: number
}

export interface ResumeAttachOutcome {
  attached: boolean
  reason?: string
}

/**
 * Reads every visible, fillable control on the page. It never reads a value —
 * only the question the form asks — so the panel cannot leak what the page
 * already contains.
 */
export function scanAutofillFields(): ScannedField[] {
  const FILLABLE_INPUT_TYPES = new Set([
    "text",
    "email",
    "tel",
    "url",
    "search",
    "",
  ])

  function clean(value: string | null | undefined): string {
    return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 300)
  }

  function textOf(node: Element | null): string {
    if (!node) return ""
    return clean((node as HTMLElement).innerText || node.textContent || "")
  }

  function visible(el: Element): boolean {
    if (el.getClientRects().length === 0) return false
    const style = window.getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") return false
    if (el.closest("[hidden]")) return false
    if (el.closest('[aria-hidden="true"]')) return false
    return true
  }

  /**
   * The question a radio/checkbox group asks, rather than the text of one
   * option. Lever, for example, puts "Will you require visa sponsorship?" in a
   * sibling label above the Yes/No list, so reading the wrapping label alone
   * made every choice a field called "Yes" or "No" and lost the question the
   * approved-answer cache is keyed on.
   */
  function groupLabelFor(el: HTMLElement): string {
    let node: HTMLElement | null = el.parentElement
    while (node && node !== document.body) {
      if (node.matches('fieldset, [role="radiogroup"], [role="group"]')) {
        const legend = node.querySelector(":scope > legend")
        const text = textOf(legend)
        if (text) return text
      }

      const labelledBy = node.getAttribute("aria-labelledby")
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => textOf(document.getElementById(id)))
          .filter(Boolean)
          .join(" ")
        if (text) return text
      }

      const previous = node.previousElementSibling
      if (
        previous &&
        !previous.querySelector("input, select, textarea, button, [role='button']")
      ) {
        const text = textOf(previous)
        if (text) return text
      }

      node = node.parentElement
    }
    return ""
  }

  /**
   * True when the control is a typeahead whose value only sticks if the user
   * picks one of the page's suggestions. Lever's location field is the common
   * case: typing free text and blurring it clears the input.
   */
  function needsSuggestion(el: HTMLInputElement): boolean {
    if (el.getAttribute("role") === "combobox") return true
    const auto = (el.getAttribute("aria-autocomplete") ?? "").toLowerCase()
    if (auto === "list" || auto === "both") return true
    if (el.hasAttribute("list")) return true

    const container = el.parentElement
    if (!container || container === document.body) return false
    const hidden = Array.from(container.children).find(
      (child): child is HTMLInputElement =>
        child instanceof HTMLInputElement && child.type === "hidden",
    )
    if (!hidden) return false
    const name = `${hidden.name} ${hidden.id}`
    return /(^|[^a-z])(selected|selection|place|location|geo|id)([^a-z]|$)/i.test(name)
  }

  function labelFor(el: HTMLElement, preferGroup = false): string {
    if (preferGroup) {
      const group = groupLabelFor(el)
      if (group) return group
    }

    const aria = clean(el.getAttribute("aria-label"))
    if (aria) return aria

    const labelledBy = el.getAttribute("aria-labelledby")
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .filter(Boolean)
        .join(" ")
      if (text) return text
    }

    const labels = (el as HTMLInputElement).labels
    if (labels && labels.length > 0) {
      const text = Array.from(labels)
        .map((label) => textOf(label))
        .filter(Boolean)
        .join(" ")
      if (text) return text
    }

    const wrapping = el.closest("label")
    if (wrapping) {
      const text = textOf(wrapping)
      if (text) return text
    }

    const fieldset = el.closest("fieldset")
    const legend = fieldset?.querySelector("legend")
    if (legend) {
      const text = textOf(legend)
      if (text) return text
    }

    // Lever and several Workday steps put the question in a sibling block
    // rather than a <label>. Read that block before falling back to the input's
    // machine name, which would otherwise become a review row called
    // "cards[abc][field0]" and lose the meaning the classification depends on.
    let questionNode = el.parentElement
    while (questionNode && questionNode !== document.body) {
      // Only question/field wrappers are searched, and only their direct
      // children count: an unrelated heading on the form must not become this
      // control's question.
      if (
        questionNode.matches(
          '.application-question, .application-field, [class*="question" i], [class*="field" i]',
        )
      ) {
        const candidates = questionNode.querySelectorAll(
          ':scope > .application-label, :scope > label, :scope > legend, :scope > [class*="question-label" i]',
        )
        for (const candidate of Array.from(candidates)) {
          if (candidate.querySelector("input, select, textarea, button")) continue
          const text = textOf(candidate)
          if (text) return text
        }
      }
      questionNode = questionNode.parentElement
    }

    const placeholder = clean(el.getAttribute("placeholder"))
    if (placeholder) return placeholder

    return clean(el.getAttribute("name")) || clean(el.id)
  }

  const seen = new Set<Element>()
  const fields: ScannedField[] = []
  let index = 0

  const controls = document.querySelectorAll<HTMLElement>("input, select, textarea")
  for (const el of Array.from(controls)) {
    if (seen.has(el)) continue
    seen.add(el)
    if (fields.length >= 150) break

    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
      continue
    }
    if (el.disabled) continue
    if (!visible(el)) continue

    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly) {
      continue
    }

    const tag = el.tagName.toLowerCase()
    const type = el instanceof HTMLInputElement ? el.type.toLowerCase() : ""
    const preferGroup = type === "radio" || type === "checkbox"
    if (el instanceof HTMLInputElement) {
      if (["hidden", "password", "submit", "button", "reset", "image"].includes(type)) {
        continue
      }
      if (
        !FILLABLE_INPUT_TYPES.has(type) &&
        type !== "radio" &&
        type !== "checkbox" &&
        type !== "file"
      ) {
        continue
      }
    }

    let label = labelFor(el, preferGroup)
    // A bare <select> often has no label element; its name (or generated id) is
    // all the browser exposes. Fall back to the same question search the radio
    // groups use, so "Are you legally authorized to work?" is not reviewed as
    // an opaque cards[...] field.
    if (tag === "select") {
      const nameAttr = clean(el.getAttribute("name"))
      const idAttr = clean(el.id)
      if (!label || label === nameAttr || label === idAttr) {
        const group = groupLabelFor(el)
        if (group) label = group
      }
    }
    if (!label) continue

    if (!el.hasAttribute("data-rolespec-af")) {
      el.setAttribute("data-rolespec-af", `af-${index++}`)
    }
    const id = el.getAttribute("data-rolespec-af") ?? ""

    const field: ScannedField = {
      id,
      label: label.slice(0, 200),
      tagName: tag,
      required: el.required,
    }
    if (el instanceof HTMLInputElement && type === "text" && needsSuggestion(el)) {
      field.requiresSelection = true
    }
    if (el.getAttribute("name")) field.name = clean(el.getAttribute("name")).slice(0, 120)
    if (type) field.type = type
    if (el.getAttribute("autocomplete")) {
      field.autocomplete = clean(el.getAttribute("autocomplete")).slice(0, 60)
    }
    if (el instanceof HTMLSelectElement) {
      field.options = Array.from(el.options)
        .map((option) => clean(option.textContent))
        .filter(Boolean)
        .slice(0, 40)
    }
    if (el instanceof HTMLInputElement && type === "radio") {
      field.options = [clean(el.value)].filter(Boolean)
    }

    // A group of radios shares a label; one review row per group is enough,
    // and the row should list every choice, not just the first radio scanned.
    const duplicate = fields.find(
      (existing) =>
        existing.label === field.label &&
        existing.type === field.type &&
        existing.name === field.name,
    )
    if (duplicate) {
      if (field.options && field.options.length > 0) {
        const merged = [...(duplicate.options ?? [])]
        for (const option of field.options) {
          if (!merged.includes(option)) merged.push(option)
        }
        duplicate.options = merged.slice(0, 40)
      }
    } else {
      fields.push(field)
    }
  }

  return fields
}

/**
 * Writes the approved values and dispatches the events a React/Vue form listens
 * for. Missing elements are counted, not thrown. No submit control is touched.
 */
export function fillAutofillFields(assignments: FillAssignment[]): FillOutcome {
  let filled = 0
  let missed = 0
  const results: FieldFillResult[] = []

  function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    if (setter) setter.call(el, value)
    else el.value = value
  }

  for (const assignment of assignments.slice(0, 150)) {
    if (!/^af-\d+$/.test(assignment.id)) {
      missed += 1
      results.push({ id: assignment.id, status: "FAILED", reason: "Invalid field id" })
      continue
    }
    const el = document.querySelector<HTMLElement>(
      `[data-rolespec-af="${assignment.id}"]`,
    )
    if (!el) {
      missed += 1
      results.push({ id: assignment.id, status: "FAILED", reason: "Field left the page" })
      continue
    }

    if (el instanceof HTMLSelectElement) {
      const wanted = assignment.value.trim().toLowerCase()
      const option = Array.from(el.options).find(
        (candidate) =>
          candidate.value.trim().toLowerCase() === wanted ||
          (candidate.textContent ?? "").trim().toLowerCase() === wanted,
      )
      if (!option) {
        missed += 1
        results.push({ id: assignment.id, status: "FAILED", reason: "No matching option" })
        continue
      }
      el.value = option.value
    } else if (el instanceof HTMLInputElement) {
      if (["radio", "checkbox", "file", "hidden", "password"].includes(el.type)) {
        missed += 1
        results.push({ id: assignment.id, status: "FAILED", reason: "Control type is read-only" })
        continue
      }
      setNativeValue(el, assignment.value)
    } else if (el instanceof HTMLTextAreaElement) {
      setNativeValue(el, assignment.value)
    } else {
      missed += 1
      results.push({ id: assignment.id, status: "FAILED", reason: "Unsupported control" })
      continue
    }

    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    el.dispatchEvent(new Event("blur", { bubbles: true }))
    el.setAttribute("data-rolespec-filled", "1")
    el.style.outline = "2px solid #7c5cff"
    el.style.outlineOffset = "1px"
    filled += 1
    results.push({ id: assignment.id, status: "FILLED" })
  }

  // The highlight is a review aid, not a permanent page change.
  window.setTimeout(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-rolespec-filled]"))) {
      el.style.outline = ""
      el.style.outlineOffset = ""
      el.removeAttribute("data-rolespec-filled")
    }
  }, 5000)

  return { filled, missed, results }
}

/**
 * Counts the controls that can submit, without touching them, and reports
 * whether a CAPTCHA is present. The panel warns about both; neither is bypassed.
 */
export function inspectAutofillPage(): PageGuardInfo {
  const submitControls = document.querySelectorAll(
    'button[type="submit"], input[type="submit"], input[type="image"]',
  )
  const captcha = document.querySelector(
    'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], [class*="captcha" i], [id*="captcha" i], [data-sitekey]',
  )
  return {
    submitControlCount: submitControls.length,
    captchaDetected: Boolean(captcha),
    formCount: document.querySelectorAll("form").length,
  }
}

/**
 * Arms a short-lived page guard that prevents an accidental submit while the
 * user reviews the fill plan. It is installed by the side panel only, removed by
 * the panel's "Release submit guard" button, and expires on its own. It never
 * submits anything itself.
 */
export function armSubmitGuard(): number {
  const KEY = "__rolespecSubmitGuard"
  const win = window as unknown as Record<string, unknown>
  const existing = win[KEY] as
    | {
        onSubmit: (event: Event) => void
        onClick: (event: Event) => void
        onKey: (event: KeyboardEvent) => void
        timer: number
        controlCount: number
      }
    | undefined

  if (existing) {
    window.clearTimeout(existing.timer)
    existing.timer = window.setTimeout(() => {
      document.removeEventListener("submit", existing.onSubmit, true)
      document.removeEventListener("click", existing.onClick, true)
      document.removeEventListener("keydown", existing.onKey, true)
      delete win[KEY]
    }, 5 * 60 * 1000)
    return existing.controlCount
  }

  const onSubmit = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onClick = (event: Event) => {
    const target = event.target as Element | null
    const control = target?.closest?.(
      'button, input[type="submit"], input[type="image"], [role="button"]',
    ) as HTMLElement | null
    if (!control) return
    const type = (control.getAttribute("type") ?? "").toLowerCase()
    const text = (control.innerText || control.textContent || control.getAttribute("value") || "")
      .replace(/\s+/g, " ")
      .trim()
    const looksLikeSubmit =
      type === "submit" || type === "image" || /submit|send application|finish/i.test(text)
    if (!looksLikeSubmit) return
    // A submit button inside a form is the dangerous case. A naked "Apply" link
    // that only navigates is left alone.
    if (!control.closest("form") && type !== "submit" && type !== "image") return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return
    const target = event.target as HTMLElement | null
    if (!target?.closest("form")) return
    if (target.tagName === "TEXTAREA") return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const controlCount = document.querySelectorAll(
    'button[type="submit"], input[type="submit"], input[type="image"]',
  ).length
  const timer = window.setTimeout(() => {
    document.removeEventListener("submit", onSubmit, true)
    document.removeEventListener("click", onClick, true)
    document.removeEventListener("keydown", onKey, true)
    delete win[KEY]
  }, 5 * 60 * 1000)

  document.addEventListener("submit", onSubmit, true)
  document.addEventListener("click", onClick, true)
  document.addEventListener("keydown", onKey, true)
  win[KEY] = { onSubmit, onClick, onKey, timer, controlCount }
  return controlCount
}

/** Removes the guard so the user can submit after reviewing the page. */
export function disarmSubmitGuard(): boolean {
  const KEY = "__rolespecSubmitGuard"
  const win = window as unknown as Record<string, unknown>
  const guard = win[KEY] as
    | {
        onSubmit: (event: Event) => void
        onClick: (event: Event) => void
        onKey: (event: KeyboardEvent) => void
        timer: number
      }
    | undefined
  if (!guard) return false
  window.clearTimeout(guard.timer)
  document.removeEventListener("submit", guard.onSubmit, true)
  document.removeEventListener("click", guard.onClick, true)
  document.removeEventListener("keydown", guard.onKey, true)
  delete win[KEY]
  return true
}

/**
 * Attaches a chosen resume to one file input, after an explicit user press.
 * `base64` crosses the extension message boundary because `executeScript`
 * arguments are JSON. Returns a failure reason instead of throwing so the panel
 * can offer the download + manual-select fallback.
 */
export function attachResumeToPage(
  fieldId: string,
  base64: string,
  filename: string,
): ResumeAttachOutcome {
  if (!/^af-\d+$/.test(fieldId)) return { attached: false, reason: "Invalid field id" }
  if (!base64 || base64.length > 24_000_000) {
    return { attached: false, reason: "The PDF is too large to attach here" }
  }
  const el = document.querySelector<HTMLInputElement>(
    `[data-rolespec-af="${fieldId}"]`,
  )
  if (!el || el.type !== "file") {
    return { attached: false, reason: "No file input was found" }
  }
  try {
    const binary = window.atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const file = new File([bytes], filename || "resume.pdf", {
      type: "application/pdf",
    })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    el.files = transfer.files
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    return { attached: el.files.length === 1 }
  } catch {
    return { attached: false, reason: "This form rejected the file attachment" }
  }
}
