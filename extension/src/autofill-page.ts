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
}

export interface FillAssignment {
  id: string
  value: string
}

export interface FillOutcome {
  filled: number
  missed: number
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

  function labelFor(el: HTMLElement): string {
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

    const label = labelFor(el)
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

    // A group of radios shares a label; one review row per group is enough.
    const duplicate = fields.find(
      (existing) =>
        existing.label === field.label &&
        existing.type === field.type &&
        existing.name === field.name,
    )
    if (!duplicate) fields.push(field)
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
      continue
    }
    const el = document.querySelector<HTMLElement>(
      `[data-rolespec-af="${assignment.id}"]`,
    )
    if (!el) {
      missed += 1
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
        continue
      }
      el.value = option.value
    } else if (el instanceof HTMLInputElement) {
      if (["radio", "checkbox", "file", "hidden", "password"].includes(el.type)) {
        missed += 1
        continue
      }
      setNativeValue(el, assignment.value)
    } else if (el instanceof HTMLTextAreaElement) {
      setNativeValue(el, assignment.value)
    } else {
      missed += 1
      continue
    }

    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    el.dispatchEvent(new Event("blur", { bubbles: true }))
    el.setAttribute("data-rolespec-filled", "1")
    el.style.outline = "2px solid #7c5cff"
    el.style.outlineOffset = "1px"
    filled += 1
  }

  // The highlight is a review aid, not a permanent page change.
  window.setTimeout(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-rolespec-filled]"))) {
      el.style.outline = ""
      el.style.outlineOffset = ""
      el.removeAttribute("data-rolespec-filled")
    }
  }, 5000)

  return { filled, missed }
}
