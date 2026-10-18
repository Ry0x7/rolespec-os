"use client"

import { useState } from "react"

export interface PagedList<T> {
  /** The slice of `items` on the current page. */
  pageItems: T[]
  /** 1-based, always within 1..pageCount. */
  page: number
  /** At least 1, so an empty list still reads "page 1 of 1". */
  pageCount: number
  setPage: (page: number) => void
  next: () => void
  prev: () => void
  hasPrev: boolean
  hasNext: boolean
  /** 1-based index of the first item on the page; 0 when the list is empty. */
  rangeStart: number
  /** 1-based index of the last item on the page; 0 when the list is empty. */
  rangeEnd: number
  total: number
}

/**
 * Client-side paging for a bounded list. The page is clamped to the current
 * page count, so a list that shrinks under the user (a delete, a confirm that
 * drops the row out of a filter) lands on the previous page instead of an
 * empty one. A change of `resetKey` (typically the active filter) goes back to
 * page 1.
 */
export function usePagedList<T>(
  items: T[],
  { pageSize, resetKey }: { pageSize: number; resetKey?: unknown }
): PagedList<T> {
  const [state, setState] = useState({ page: 1, resetKey })

  let storedPage = state.page
  if (!Object.is(state.resetKey, resetKey)) {
    // Adjusting state during render (not in an effect) so the first paint
    // after the key change already shows page 1.
    storedPage = 1
    setState({ page: 1, resetKey })
  }

  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, storedPage), pageCount)
  const start = (page - 1) * pageSize
  const pageItems = items.slice(start, start + pageSize)

  function setPage(nextPage: number) {
    setState({ page: Math.min(Math.max(1, Math.trunc(nextPage)), pageCount), resetKey })
  }

  return {
    pageItems,
    page,
    pageCount,
    setPage,
    next: () => setPage(page + 1),
    prev: () => setPage(page - 1),
    hasPrev: page > 1,
    hasNext: page < pageCount,
    rangeStart: total === 0 ? 0 : start + 1,
    rangeEnd: start + pageItems.length,
    total,
  }
}
