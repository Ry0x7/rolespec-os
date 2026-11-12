/** Same-origin JSON transport for browser-only feature clients. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = "ApiError"
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init.headers },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(
      typeof data?.error === "string" ? data.error : `Request failed (${response.status}). Please retry.`,
      response.status,
      typeof data?.code === "string" ? data.code : undefined,
    )
  }
  if (data === null) throw new ApiError("The server returned an unreadable response. Please retry.", response.status)
  return data as T
}
