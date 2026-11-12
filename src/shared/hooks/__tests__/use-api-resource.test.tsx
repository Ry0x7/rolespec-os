import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useApiResource } from "../use-api-resource"

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const json = (data: unknown) => new Response(JSON.stringify(data))

describe("resource reads", () => {
  it("ignores an older response after changing resource and keeps current data on failed refresh", async () => {
    let first!: (value: Response) => void
    const fetch = vi.fn((url: string) => url === "/first" ? new Promise<Response>(resolve => { first = resolve }) : Promise.resolve(json({ id: "second" })))
    vi.stubGlobal("fetch", fetch)
    const { result, rerender } = renderHook(({ path }) => useApiResource<{ id: string }>(path), { initialProps: { path: "/first" } })
    rerender({ path: "/second" })
    await waitFor(() => expect(result.current.data?.id).toBe("second"))
    await act(async () => first(json({ id: "first" })))
    expect(result.current.data?.id).toBe("second")
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await act(async () => { await result.current.reload() })
    expect(result.current.data?.id).toBe("second")
    expect(result.current.error).toBe("Failed to fetch")
    expect(result.current.loading).toBe(false)
  })
  it("does not fetch a null resource and recovers on a genuine online event", async () => {
    const fetch = vi.fn(() => Promise.resolve(json({ ok: true })))
    vi.stubGlobal("fetch", fetch)
    const { result, rerender } = renderHook(({ path }) => useApiResource(path), { initialProps: { path: null as string | null } })
    expect(fetch).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    rerender({ path: "/active" })
    await waitFor(() => expect(result.current.data).toEqual({ ok: true }))
    act(() => window.dispatchEvent(new Event("offline")))
    expect(result.current.offline).toBe(true)
    act(() => window.dispatchEvent(new Event("online")))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(result.current.offline).toBe(false)
  })
})
