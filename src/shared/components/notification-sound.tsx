"use client"

import { useEffect } from "react"
import { playNotificationSound } from "@/shared/lib/notification-sound"

/**
 * Plays the owner's chosen sound when a new Sonner toast appears.
 *
 * The observer counts toast nodes instead of listening to each mutation: Sonner
 * updates toast text in place, which would otherwise fire on every keystroke-
 * driven status change. Existing toasts at mount time are baselined, so opening
 * the app never plays a sound on load.
 */
export function NotificationSound() {
  useEffect(() => {
    // Baseline the toasts already on screen so a page load or a hot reload
    // never plays a sound by itself.
    const seen = new WeakSet<Element>()
    document.querySelectorAll("[data-sonner-toast]").forEach((toast) => seen.add(toast))
    let lastPlayedAt = 0
    let frame = 0

    const observer = new MutationObserver(() => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        let hasNewToast = false
        document.querySelectorAll("[data-sonner-toast]").forEach((toast) => {
          if (seen.has(toast)) return
          seen.add(toast)
          hasNewToast = true
        })
        if (!hasNewToast) return
        const now = Date.now()
        if (now - lastPlayedAt < 250) return
        lastPlayedAt = now
        playNotificationSound()
      })
    })

    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  return null
}
