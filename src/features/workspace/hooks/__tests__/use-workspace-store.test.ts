import { describe, it, expect } from "vitest"
import {
  migrateWorkspacePanels,
  reconcilePanelOrder,
  reconcilePanelSizes,
} from "../use-workspace-store"
import {
  DEFAULT_PANEL_ORDER,
  DEFAULT_PANEL_SIZES,
  type PanelId,
  type PanelSize,
} from "../../constants/panels"

describe("reconcilePanelSizes", () => {
  it("returns defaults when nothing was persisted (legacy clients)", () => {
    expect(reconcilePanelSizes(undefined)).toEqual(DEFAULT_PANEL_SIZES)
    expect(reconcilePanelSizes({})).toEqual(DEFAULT_PANEL_SIZES)
  })

  it("keeps persisted sizes for known panels", () => {
    const result = reconcilePanelSizes({ goal: "full", pipeline: "half" })
    expect(result.goal).toBe("full")
    expect(result.pipeline).toBe("half")
  })

  it("fills in defaults for panels missing from the persisted map", () => {
    const result = reconcilePanelSizes({ goal: "full" })
    expect(result.pipeline).toBe(DEFAULT_PANEL_SIZES.pipeline)
    expect(result.quickAdd).toBe(DEFAULT_PANEL_SIZES.quickAdd)
    expect(Object.keys(result).sort()).toEqual([...DEFAULT_PANEL_ORDER].sort())
  })

  it("drops entries for unknown/removed panel ids", () => {
    const persisted = {
      goal: "full",
      legacyPanel: "half",
    } as unknown as Partial<Record<PanelId, PanelSize>>
    const result = reconcilePanelSizes(persisted)
    expect(result).not.toHaveProperty("legacyPanel")
    expect(result.goal).toBe("full")
  })

  it("falls back to the default for an unrecognised size value", () => {
    const persisted = { goal: "gigantic" } as unknown as Partial<
      Record<PanelId, PanelSize>
    >
    expect(reconcilePanelSizes(persisted).goal).toBe(DEFAULT_PANEL_SIZES.goal)
  })

  it("does not mutate DEFAULT_PANEL_SIZES", () => {
    reconcilePanelSizes({ goal: "half" })
    expect(DEFAULT_PANEL_SIZES.goal).toBe("full")
  })
})

describe("reconcilePanelOrder", () => {
  it("drops removed panel ids from a stale persisted layout", () => {
    const persisted = [
      "coldEmail",
      "goal",
      "todos",
      "pipeline",
      "coverLetters",
      "quickAdd",
    ] as unknown as PanelId[]
    expect(reconcilePanelOrder(persisted)).toEqual([
      "goal",
      "pipeline",
      "quickAdd",
    ])
  })

  it("appends panels missing from the persisted order", () => {
    expect(reconcilePanelOrder(["pipeline"])).toEqual([
      "pipeline",
      "goal",
      "quickAdd",
    ])
  })
})

/** Mirrors what zustand's persist middleware hands to `merge` after migration. */
function hydrate(persisted: unknown, version: number) {
  const migrated = migrateWorkspacePanels(persisted, version) as {
    sizes?: Partial<Record<PanelId, PanelSize>>
  } | null
  return reconcilePanelSizes(migrated?.sizes)
}

describe("migrateWorkspacePanels", () => {
  it("drops a stale v0 half-width goal so the full-width default applies", () => {
    const persisted = {
      panelOrder: ["goal", "quickAdd", "pipeline"],
      collapsed: {},
      sizes: { goal: "half", quickAdd: "full", pipeline: "full" },
    }
    const migrated = migrateWorkspacePanels(persisted, 0) as {
      sizes: Record<string, PanelSize>
    }
    expect(migrated.sizes).not.toHaveProperty("goal")
    expect(hydrate(persisted, 0).goal).toBe("full")
  })

  it("leaves other persisted sizes untouched while migrating goal", () => {
    const persisted = {
      collapsed: { pipeline: true },
      panelOrder: ["pipeline", "goal", "quickAdd"],
      sizes: { goal: "half", pipeline: "half" },
    }
    const migrated = migrateWorkspacePanels(persisted, 0) as {
      collapsed: Record<string, boolean>
      panelOrder: PanelId[]
      sizes: Record<string, PanelSize>
    }
    expect(migrated.sizes.pipeline).toBe("half")
    expect(migrated.collapsed).toEqual({ pipeline: true })
    expect(migrated.panelOrder).toEqual(["pipeline", "goal", "quickAdd"])

    const sizes = hydrate(persisted, 0)
    expect(sizes.pipeline).toBe("half")
    expect(sizes.goal).toBe("full")
  })

  it("keeps an explicit v0 full-width goal", () => {
    const persisted = { sizes: { goal: "full" } }
    expect(migrateWorkspacePanels(persisted, 0)).toEqual(persisted)
    expect(hydrate(persisted, 0).goal).toBe("full")
  })

  it("does not mutate the persisted state it was given", () => {
    const persisted = { sizes: { goal: "half" as PanelSize } }
    migrateWorkspacePanels(persisted, 0)
    expect(persisted.sizes.goal).toBe("half")
  })

  it("does not throw on malformed or partial persisted state", () => {
    for (const persisted of [
      undefined,
      null,
      {},
      { sizes: undefined },
      { sizes: null },
      { sizes: "half" },
      { sizes: [] },
      { panelOrder: ["goal"] },
      "not-an-object",
      42,
    ]) {
      expect(() => migrateWorkspacePanels(persisted, 0)).not.toThrow()
    }
    expect(hydrate({}, 0)).toEqual(DEFAULT_PANEL_SIZES)
    expect(hydrate(null, 0)).toEqual(DEFAULT_PANEL_SIZES)
  })

  it("passes current-version state through unchanged", () => {
    const persisted = { sizes: { goal: "half" } }
    expect(migrateWorkspacePanels(persisted, 1)).toBe(persisted)
    expect(hydrate(persisted, 1).goal).toBe("half")
  })
})
