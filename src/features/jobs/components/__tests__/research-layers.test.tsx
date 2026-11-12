import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ResearchLayers } from "../research-layers"
import type { ThreeLayerResearch } from "../../services/three-layer-research.service"

afterEach(cleanup)
describe("three research evidence layers", () => {
  it("keeps posting statements distinct from verified sources and displays conflicts", () => {
    const layers = { researchedAt: "2026-11-12T00:00:00Z", cached: false, sourceSummary: { independentSources: 0, totalSources: 1, hosts: [] }, requirements: { required: ["TypeScript experience"], preferred: [], flags: [], uncertainty: ["Salary unknown"] }, culture: { confidence: "LOW", explanation: "No independent source", signals: [{ label: "Remote policy", value: null, state: "UNKNOWN", citations: [] }, { label: "Learning", value: "Mentorship", state: "STATED_IN_POSTING", citations: [{ url: "javascript:alert(1)", title: "Invalid source" }] }], conflicts: ["Remote and hybrid both stated"] } } as unknown as ThreeLayerResearch
    render(<ResearchLayers layers={layers} />)
    expect(screen.getByText("Posting statement")).toBeTruthy()
    expect(screen.getByText("Unknown")).toBeTruthy()
    expect(screen.getByText("Remote and hybrid both stated")).toBeTruthy()
    expect(screen.getByText("Salary unknown")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })
  it("recovers from an incomplete legacy payload without inventing evidence", () => {
    render(<ResearchLayers layers={{ requirements: {} } as ThreeLayerResearch} />)
    expect(screen.getByText(/Saved research layers are incomplete/)).toBeTruthy()
  })
})
