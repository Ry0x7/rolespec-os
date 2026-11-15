"use client"

import { useCallback, useSyncExternalStore } from "react"
import {
  clearCustomNotificationSound,
  DEFAULT_NOTIFICATION_SOUND,
  getStoredNotificationSound,
  playNotificationSound,
  storeCustomNotificationSound,
  storeNotificationSound,
  type NotificationSoundId,
  type NotificationSoundSettings,
} from "@/shared/lib/notification-sound"

const listeners = new Set<() => void>()

// useSyncExternalStore compares snapshots by identity, so the object must be
// cached and replaced only when the stored preference actually changes.
let snapshot: NotificationSoundSettings =
  typeof window === "undefined"
    ? { sound: DEFAULT_NOTIFICATION_SOUND, customDataUrl: null }
    : getStoredNotificationSound()

function refreshSnapshot(): void {
  snapshot = getStoredNotificationSound()
}

function emit(): void {
  refreshSnapshot()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): NotificationSoundSettings {
  return snapshot
}

function getServerSnapshot(): NotificationSoundSettings {
  return { sound: DEFAULT_NOTIFICATION_SOUND, customDataUrl: null }
}

export function useNotificationSound() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setSound = useCallback((sound: NotificationSoundId) => {
    storeNotificationSound(sound)
    emit()
  }, [])

  const setCustomDataUrl = useCallback((dataUrl: string) => {
    storeCustomNotificationSound(dataUrl)
    emit()
  }, [])

  const removeCustomDataUrl = useCallback(() => {
    clearCustomNotificationSound()
    emit()
  }, [])

  const preview = useCallback(() => {
    playNotificationSound(snapshot)
  }, [])

  return {
    sound: settings.sound,
    customDataUrl: settings.customDataUrl,
    setSound,
    setCustomDataUrl,
    removeCustomDataUrl,
    preview,
  }
}
