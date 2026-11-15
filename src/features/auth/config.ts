/**
 * Single-owner session entrypoint.
 *
 * Kept at this path because every page, action and API route already imports
 * `auth` from here. There is no Auth.js instance behind it any more — see
 * `session.ts` for the access policy and owner resolution.
 */
export {
  auth,
  canLockWorkspace,
  clearOwnerUnlockCookie,
  createOwnerToken,
  currentRequestPath,
  getAccessKey,
  getAccessMode,
  hasOwnerUnlockCookie,
  isLoopbackHost,
  isUnlockMode,
  requestAccessState,
  safeReturnPath,
  setOwnerUnlockCookie,
  verifyOwnerToken,
  type AccessMode,
  type AccessState,
  type OwnerSession,
} from "./session"
export { OWNER_COOKIE_NAME, OWNER_EMAIL, OWNER_NAME } from "./session"
