import { redirect } from "next/navigation"

/** /settings is the tab shell only; Profile is the first tab. */
export default function SettingsPage() {
  redirect("/settings/profile")
}
