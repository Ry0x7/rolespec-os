"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  DEFAULT_PANEL_ORDER,
  DEFAULT_PANEL_SIZES,
  type PanelId,
  type PanelSize,
} from "../constants/panels"

interface WorkspaceBoardUi {
  query: string
  statuses: string[]
  followUpOnly: boolean
  selectedIds: string[]
}

interface WorkspaceStore extends WorkspaceBoardUi {
  panelOrder: PanelId[]
  collapsed: Partial<Record<PanelId, boolean>>
  sizes: Record<PanelId, PanelSize>
  hasHydrated: boolean

  setOrder: (order: PanelId[]) => void
  toggleCollapsed: (id: PanelId) => void
  setPanelSize: (id: PanelId, size: PanelSize) => void
  togglePanelSize: (id: PanelId) => void
  setHasHydrated: (v: boolean) => void

  setQuery: (query: string) => void
  toggleStatus: (status: string) => void
  clearStatuses: () => void
  toggleFollowUpOnly: () => void
  toggleSelected: (id: string) => void
  setSelected: (ids: string[]) => void
  clearSelected: () => void
}

/**
 * Reconcile a persisted panel order with the current DEFAULT_PANEL_ORDER:
 * - keep only ids that still exist (drop unknown/removed panels)
 * - append any new default panels missing from the persisted order,
 *   preserving their relative position from DEFAULT_PANEL_ORDER,
 * so future panels never vanish for returning users.
 */
export function reconcilePanelOrder(persisted: PanelId[]): PanelId[] {
  const known = new Set<PanelId>(DEFAULT_PANEL_ORDER)
  const kept = persisted.filter((id) => known.has(id))
  const present = new Set(kept)
  const missing = DEFAULT_PANEL_ORDER.filter((id) => !present.has(id))
  return [...kept, ...missing]
}

/**
 * Reconcile persisted panel sizes with the current panel set:
 * - drop entries for unknown/removed panels
 * - fill in defaults for panels missing from the persisted map
 *   (older clients persisted no sizes at all)
 * - fall back to the default for any unrecognised size value
 */
export function reconcilePanelSizes(
  persisted: Partial<Record<PanelId, PanelSize>> | undefined,
): Record<PanelId, PanelSize> {
  const result = { ...DEFAULT_PANEL_SIZES }
  if (!persisted) return result

  for (const id of DEFAULT_PANEL_ORDER) {
    const size = persisted[id]
    if (size === "half" || size === "full") {
      result[id] = size
    }
  }
  return result
}

/** Current persisted-layout schema version for the "workspace-panels" store. */
export const WORKSPACE_PANELS_VERSION = 1

/**
 * Migrate a persisted workspace layout to WORKSPACE_PANELS_VERSION.
 *
 * v0 -> v1: `goal` defaulted to "half" before the panel became full-width, and
 * `reconcilePanelSizes` deliberately keeps any valid persisted value, so
 * returning users were pinned to the old half-width goal panel. Drop the stale
 * "half" override so reconciliation applies the current default instead.
 * Any explicit "full" (or any other panel's size) passes through untouched.
 *
 * Persisted state is untrusted input: it may be malformed or partial, so this
 * never throws and hands anything it cannot understand back unchanged for
 * `merge`/`reconcilePanelSizes` to sanitise.
 */
export function migrateWorkspacePanels(
  persisted: unknown,
  version: number,
): unknown {
  if (version >= 1) return persisted
  if (!persisted || typeof persisted !== "object") return persisted

  const state = persisted as { sizes?: unknown }
  const sizes = state.sizes
  if (!sizes || typeof sizes !== "object") return persisted
  if ((sizes as Record<string, unknown>).goal !== "half") return persisted

  const nextSizes = { ...(sizes as Record<string, unknown>) }
  delete nextSizes.goal
  return { ...state, sizes: nextSizes }
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      panelOrder: DEFAULT_PANEL_ORDER,
      collapsed: {},
      sizes: DEFAULT_PANEL_SIZES,
      hasHydrated: false,
      query: "",
      statuses: [],
      followUpOnly: false,
      selectedIds: [],

      setOrder: (order) => set({ panelOrder: order }),
      toggleCollapsed: (id) =>
        set((state) => ({
          collapsed: { ...state.collapsed, [id]: !state.collapsed[id] },
        })),
      setPanelSize: (id, size) =>
        set((state) => ({ sizes: { ...state.sizes, [id]: size } })),
      togglePanelSize: (id) =>
        set((state) => ({
          sizes: {
            ...state.sizes,
            [id]: state.sizes[id] === "full" ? "half" : "full",
          },
        })),
      setHasHydrated: (v) => set({ hasHydrated: v }),
      setQuery: (query) => set({ query }),
      toggleStatus: (status) =>
        set((state) => ({
          statuses: state.statuses.includes(status)
            ? state.statuses.filter((s) => s !== status)
            : [...state.statuses, status],
        })),
      clearStatuses: () => set({ statuses: [] }),
      toggleFollowUpOnly: () =>
        set((state) => ({ followUpOnly: !state.followUpOnly })),
      toggleSelected: (id) =>
        set((state) => ({
          selectedIds: state.selectedIds.includes(id)
            ? state.selectedIds.filter((s) => s !== id)
            : [...state.selectedIds, id],
        })),
      setSelected: (ids) => set({ selectedIds: ids }),
      clearSelected: () => set({ selectedIds: [] }),
    }),
    {
      name: "workspace-panels",
      version: WORKSPACE_PANELS_VERSION,
      migrate: migrateWorkspacePanels,
      partialize: (state) => ({
        panelOrder: state.panelOrder,
        collapsed: state.collapsed,
        sizes: state.sizes,
      }),
      merge: (persisted, current) => {
        const persistedState = (persisted ?? {}) as Partial<WorkspaceStore>
        return {
          ...current,
          ...persistedState,
          panelOrder: reconcilePanelOrder(
            persistedState.panelOrder ?? DEFAULT_PANEL_ORDER,
          ),
          sizes: reconcilePanelSizes(persistedState.sizes),
        }
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    },
  ),
)
