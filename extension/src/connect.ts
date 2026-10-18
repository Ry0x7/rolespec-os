import { normalizeAppUrl } from "./settings"

/** Bytes of entropy behind the CSRF `state` value. */
const STATE_BYTES = 32

const TOKEN_PREFIX = "rspec_"

/**
 * Base64url (RFC 4648 §5) with no padding, so `state` stays inside the app's
 * `[A-Za-z0-9_-]{8,256}` contract without any URL escaping.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Pure so tests can pin the bytes. Production passes `crypto.getRandomValues`.
 */
export function generateState(
  fillRandom: (buffer: Uint8Array) => Uint8Array = (buffer) => crypto.getRandomValues(buffer),
): string {
  return toBase64Url(fillRandom(new Uint8Array(STATE_BYTES)))
}

/** `GET {appUrl}/extension/connect?state=…&redirect_uri=…` */
export function buildConnectUrl(appUrl: string, state: string, redirectUri: string): string {
  const base = normalizeAppUrl(appUrl)
  if (!base) throw new Error("Set your RoleSpec App URL first.")
  const params = new URLSearchParams({ state, redirect_uri: redirectUri })
  return `${base}/extension/connect?${params.toString()}`
}

/**
 * Reads the token out of the `#token=…&state=…` fragment Chrome hands back from
 * `launchWebAuthFlow`. Throws with a user-facing message on every failure path.
 */
export function parseConnectRedirect(redirectUrl: string | undefined, expectedState: string): string {
  if (!redirectUrl) throw new Error("Sign-in was cancelled before it finished.")

  const hashIndex = redirectUrl.indexOf("#")
  if (hashIndex === -1) throw new Error("RoleSpec did not return a token. Try signing in again.")

  const params = new URLSearchParams(redirectUrl.slice(hashIndex + 1))

  const error = params.get("error")
  if (error) throw new Error(`RoleSpec refused the connection: ${error}`)

  if (params.get("state") !== expectedState) {
    throw new Error("Sign-in response did not match this request. Try again.")
  }

  const token = params.get("token")
  if (!token) throw new Error("RoleSpec did not return a token. Try signing in again.")
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new Error("RoleSpec returned an unexpected token format.")
  }

  return token
}

/**
 * Thin wrapper: the only part that touches `chrome.identity`. Opens the RoleSpec
 * connect page in Chrome's auth window and resolves with the raw `rspec_…` token.
 */
export async function signInWithRoleSpec(appUrl: string): Promise<string> {
  const state = generateState()
  const redirectUri = chrome.identity.getRedirectURL()
  const url = buildConnectUrl(appUrl, state, redirectUri)

  let redirectUrl: string | undefined
  try {
    redirectUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message || "Sign-in was cancelled.")
  }

  return parseConnectRedirect(redirectUrl, state)
}
