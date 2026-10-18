/**
 * Validation for the extension "sign in to connect" handshake.
 *
 * The extension calls `chrome.identity.launchWebAuthFlow` and opens
 * `/extension/connect?state=…&redirect_uri=…`. Both parameters are fully
 * attacker-controlled — any web page can link to that URL — and the flow ends in
 * a redirect that carries a freshly minted API token in the fragment. So the
 * redirect target has to be pinned to the one host Chrome will only ever hand back
 * to an extension: `<extension-id>.chromiumapp.org`. Anything else would be an
 * open redirect that leaks a live credential.
 *
 * `state` is echoed back untouched, so it is restricted to characters that are
 * safe in a URL fragment.
 *
 * Pure functions with no server dependencies, so the page, the server action and
 * the tests can all share exactly one definition of "valid".
 */

/** Extension ids are 32 characters; Chrome uses a–p, but a–z0–9 is the safer net. */
const REDIRECT_HOST = /^[a-z0-9]{32}\.chromiumapp\.org$/

/** Long enough to be unguessable, bounded so it cannot be used to stuff a URL. */
const STATE = /^[A-Za-z0-9_-]{8,256}$/

export function isValidExtensionState(value: unknown): value is string {
  return typeof value === "string" && STATE.test(value)
}

/**
 * True when `value` is an `https://<32-char id>.chromiumapp.org/…` URL.
 *
 * Parsed with `URL` rather than matched with a regex alone, so the host is the
 * host the browser would resolve: `https://evil.com/aaa….chromiumapp.org/` and
 * `https://aaa….chromiumapp.org@evil.com/` both fail on `url.host`. Userinfo is
 * rejected outright anyway, and a port is rejected because it is part of
 * `url.host`. An existing fragment is rejected because the token is appended as
 * one.
 */
export function isValidExtensionRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== "https:") return false
  if (url.username !== "" || url.password !== "") return false
  if (url.hash !== "") return false
  return REDIRECT_HOST.test(url.host)
}

export type ExtensionConnectParams = { state: string; redirectUri: string }

export type ExtensionConnectParseResult =
  | ({ ok: true } & ExtensionConnectParams)
  | { ok: false; error: string }

/**
 * Validates both parameters together. The messages are for the user staring at
 * the consent page, not for the extension — they say what is wrong without
 * echoing the untrusted value back into the document.
 */
export function parseExtensionConnectParams(
  state: unknown,
  redirectUri: unknown
): ExtensionConnectParseResult {
  if (!isValidExtensionRedirectUri(redirectUri)) {
    return {
      ok: false,
      error: "This link's redirect target isn't a Chrome extension address, so we can't continue.",
    }
  }
  if (!isValidExtensionState(state)) {
    return { ok: false, error: "This link is missing a valid security token. Try connecting again." }
  }

  // Re-serialised through `URL`, so what the action redirects to is the parsed
  // form rather than the raw string that was handed to us.
  return { ok: true, state, redirectUri: new URL(redirectUri).toString() }
}

/** Where the flow ends: the extension reads the token out of the fragment. */
export function buildExtensionRedirect(redirectUri: string, token: string, state: string): string {
  return `${redirectUri}#token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`
}
