import { describe, it, expect } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { usePagedList } from "../use-paged-list"

const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1)

describe("usePagedList", () => {
  it("splits 23 items into 3 pages of 10", () => {
    const { result } = renderHook(() => usePagedList(range(23), { pageSize: 10 }))
    expect(result.current.pageCount).toBe(3)
    expect(result.current.page).toBe(1)
    expect(result.current.pageItems).toEqual(range(10))
    expect(result.current.rangeStart).toBe(1)
    expect(result.current.rangeEnd).toBe(10)
    expect(result.current.total).toBe(23)
    expect(result.current.hasPrev).toBe(false)
    expect(result.current.hasNext).toBe(true)
  })

  it("moves with next and prev and stops at both ends", () => {
    const { result } = renderHook(() => usePagedList(range(23), { pageSize: 10 }))
    act(() => result.current.prev())
    expect(result.current.page).toBe(1)

    act(() => result.current.next())
    expect(result.current.page).toBe(2)
    expect(result.current.pageItems[0]).toBe(11)

    act(() => result.current.next())
    expect(result.current.page).toBe(3)
    expect(result.current.pageItems).toEqual([21, 22, 23])
    expect(result.current.rangeStart).toBe(21)
    expect(result.current.rangeEnd).toBe(23)
    expect(result.current.hasNext).toBe(false)

    act(() => result.current.next())
    expect(result.current.page).toBe(3)

    act(() => result.current.prev())
    expect(result.current.page).toBe(2)
  })

  it("clamps setPage into range", () => {
    const { result } = renderHook(() => usePagedList(range(23), { pageSize: 10 }))
    act(() => result.current.setPage(99))
    expect(result.current.page).toBe(3)
    act(() => result.current.setPage(0))
    expect(result.current.page).toBe(1)
  })

  it("collapses to the previous page when the list shrinks", () => {
    const { result, rerender } = renderHook(
      ({ items }) => usePagedList(items, { pageSize: 10 }),
      { initialProps: { items: range(21) } }
    )
    act(() => result.current.setPage(3))
    expect(result.current.pageItems).toEqual([21])

    rerender({ items: range(20) })
    expect(result.current.page).toBe(2)
    expect(result.current.pageCount).toBe(2)
    expect(result.current.pageItems).toEqual(range(20).slice(10))
  })

  it("resets to page 1 when the reset key changes", () => {
    const { result, rerender } = renderHook(
      ({ resetKey }) => usePagedList(range(23), { pageSize: 10, resetKey }),
      { initialProps: { resetKey: "a" } }
    )
    act(() => result.current.setPage(3))
    expect(result.current.page).toBe(3)

    rerender({ resetKey: "b" })
    expect(result.current.page).toBe(1)

    // Back to the earlier key is still a change, not a return to page 3.
    rerender({ resetKey: "a" })
    expect(result.current.page).toBe(1)
  })

  it("keeps the page when the reset key is unchanged", () => {
    const { result, rerender } = renderHook(
      ({ resetKey }) => usePagedList(range(23), { pageSize: 10, resetKey }),
      { initialProps: { resetKey: "a" } }
    )
    act(() => result.current.setPage(2))
    rerender({ resetKey: "a" })
    expect(result.current.page).toBe(2)
  })

  it("reports one empty page for an empty list", () => {
    const { result } = renderHook(() => usePagedList([] as number[], { pageSize: 10 }))
    expect(result.current.pageCount).toBe(1)
    expect(result.current.pageItems).toEqual([])
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(0)
  })
})
