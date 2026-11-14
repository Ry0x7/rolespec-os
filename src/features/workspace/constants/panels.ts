export type PanelId = "pipeline" | "quickAdd" | "goal"

// The board is the reason this page exists. Put it first so the first screen is
// the work, not two full-width setup panels stacked above it.
export const DEFAULT_PANEL_ORDER: PanelId[] = ["pipeline", "goal", "quickAdd"]

/** Panel width on the two-column workspace grid (lg and up). */
export type PanelSize = "half" | "full"

export const DEFAULT_PANEL_SIZES: Record<PanelId, PanelSize> = {
  // Pipeline owns the full row: it now fits all seven columns at desktop widths.
  // Goal is full width too, so the daily target reads as one page-wide strip
  // instead of a narrow column that forces extra scrolling.
  pipeline: "full",
  quickAdd: "half",
  goal: "full",
}

export const PANEL_TITLES: Record<PanelId, string> = {
  pipeline: "Pipeline",
  quickAdd: "Quick add",
  goal: "Goal",
}
