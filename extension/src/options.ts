import { signInWithRoleSpec } from "./connect"
import { DEFAULT_APP_URL, loadSettings, normalizeAppUrl, saveSettings } from "./settings"

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

const form = el<HTMLFormElement>("form")
const appUrlInput = el<HTMLInputElement>("appUrl")
const tokenInput = el<HTMLInputElement>("apiToken")
const toggleButton = el<HTMLButtonElement>("toggle-token")
const signInButton = el<HTMLButtonElement>("sign-in")
const status = el<HTMLParagraphElement>("status")

function showStatus(message: string, ok: boolean) {
  status.textContent = message
  status.className = `notice ${ok ? "notice-ok" : "notice-error"}`
  status.hidden = false
}

toggleButton.addEventListener("click", () => {
  const revealed = tokenInput.type === "text"
  tokenInput.type = revealed ? "password" : "text"
  toggleButton.textContent = revealed ? "Show" : "Hide"
  toggleButton.setAttribute("aria-pressed", revealed ? "false" : "true")
})

let savedAppUrl = DEFAULT_APP_URL

async function onSignIn() {
  const appUrl = normalizeAppUrl(appUrlInput.value) || savedAppUrl || DEFAULT_APP_URL
  appUrlInput.value = appUrl

  signInButton.disabled = true
  signInButton.textContent = "Waiting for RoleSpec…"
  showStatus("Opening RoleSpec…", true)

  try {
    const apiToken = await signInWithRoleSpec(appUrl)
    await saveSettings({ appUrl, apiToken })
    savedAppUrl = appUrl
    tokenInput.type = "password"
    tokenInput.value = apiToken
    toggleButton.textContent = "Show"
    toggleButton.setAttribute("aria-pressed", "false")
    showStatus("Connected. Token saved.", true)
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Sign-in failed.", false)
  } finally {
    signInButton.disabled = false
    signInButton.textContent = "Sign in to RoleSpec"
  }
}

signInButton.addEventListener("click", () => void onSignIn())

form.addEventListener("submit", (event) => {
  event.preventDefault()
  const appUrl = normalizeAppUrl(appUrlInput.value)
  if (!appUrl) {
    showStatus("App URL is required.", false)
    return
  }
  appUrlInput.value = appUrl
  void saveSettings({ appUrl, apiToken: tokenInput.value })
    .then(() => {
      savedAppUrl = appUrl
      showStatus("Settings saved.", true)
    })
    .catch(() => showStatus("Could not save settings.", false))
})

void loadSettings().then((settings) => {
  savedAppUrl = settings.appUrl || DEFAULT_APP_URL
  appUrlInput.value = savedAppUrl
  tokenInput.value = settings.apiToken
})
