export type PanelId = "pipeline" | "quickAdd" | "goal"

export const DEFAULT_PANEL_ORDER: PanelId[] = ["goal", "quickAdd", "pipeline"]

/** Panel width on the two-column workspace grid (lg and up). */
export type PanelSize = "half" | "full"

export const DEFAULT_PANEL_SIZES: Record<PanelId, PanelSize> = {
  // Pipeline hosts a 7-column kanban and quick add is a wide form. Goal is
  // full by default too: with only three panels a half-width goal would sit
  // alone in its grid row. Users can still narrow it with the size toggle.
  pipeline: "full",
  quickAdd: "full",
  goal: "full",
}

export const PANEL_TITLES: Record<PanelId, string> = {
  pipeline: "Pipeline",
  quickAdd: "Quick add",
  goal: "Goal",
}
