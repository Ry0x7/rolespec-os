/**
 * Notification sounds and their per-device preference.
 *
 * The built-in sounds are synthesised with the Web Audio API so there are no
 * binary assets to bundle. A custom sound is stored as a data URL in
 * localStorage, capped at 200 KB, and played with a plain <audio> element.
 */

export const NOTIFICATION_SOUNDS = [
  { id: "off", label: "Off", description: "No sound" },
  { id: "chime", label: "Chime", description: "Two soft notes" },
  { id: "ping", label: "Ping", description: "One short note" },
  { id: "soft", label: "Soft", description: "Quiet low notes" },
  { id: "custom", label: "Custom", description: "Your own audio file" },
] as const

export type NotificationSoundId = (typeof NOTIFICATION_SOUNDS)[number]["id"]

export const DEFAULT_NOTIFICATION_SOUND: NotificationSoundId = "chime"
export const NOTIFICATION_SOUND_STORAGE_KEY = "rolespec-notification-sound"
export const NOTIFICATION_CUSTOM_STORAGE_KEY = "rolespec-notification-custom"
/** localStorage is small; keep uploads well inside a typical 5 MB quota. */
export const MAX_CUSTOM_SOUND_BYTES = 200 * 1024

export interface NotificationSoundSettings {
  sound: NotificationSoundId
  customDataUrl: string | null
}

export function isNotificationSoundId(value: unknown): value is NotificationSoundId {
  return NOTIFICATION_SOUNDS.some((sound) => sound.id === value)
}

export function getStoredNotificationSound(): NotificationSoundSettings {
  if (typeof window === "undefined") {
    return { sound: DEFAULT_NOTIFICATION_SOUND, customDataUrl: null }
  }
  try {
    const stored = window.localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY)
    const custom = window.localStorage.getItem(NOTIFICATION_CUSTOM_STORAGE_KEY)
    return {
      sound: isNotificationSoundId(stored) ? stored : DEFAULT_NOTIFICATION_SOUND,
      customDataUrl: custom && custom.startsWith("data:audio/") ? custom : null,
    }
  } catch {
    return { sound: DEFAULT_NOTIFICATION_SOUND, customDataUrl: null }
  }
}

export function storeNotificationSound(sound: NotificationSoundId): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(NOTIFICATION_SOUND_STORAGE_KEY, sound)
  } catch {
    // Non-fatal: the choice still applies for this session.
  }
}

export function storeCustomNotificationSound(dataUrl: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(NOTIFICATION_CUSTOM_STORAGE_KEY, dataUrl)
  } catch {
    // Quota or private mode. The caller has already validated the size.
  }
}

export function clearCustomNotificationSound(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(NOTIFICATION_CUSTOM_STORAGE_KEY)
  } catch {
    // Non-fatal.
  }
}

type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext
}

function tone(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  peak: number
): void {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = "sine"
  oscillator.frequency.setValueAtTime(frequency, startAt)
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + duration + 0.02)
}

function playBuiltIn(sound: Exclude<NotificationSoundId, "off" | "custom">): void {
  const audioWindow = window as AudioWindow
  const AudioContextCtor =
    typeof AudioContext !== "undefined" ? AudioContext : audioWindow.webkitAudioContext
  if (!AudioContextCtor) return

  const ctx = new AudioContextCtor()
  const start = ctx.currentTime + 0.01
  if (ctx.state === "suspended") void ctx.resume()

  if (sound === "chime") {
    tone(ctx, 880, start, 0.16, 0.06)
    tone(ctx, 1318.5, start + 0.12, 0.22, 0.045)
  } else if (sound === "ping") {
    tone(ctx, 1046.5, start, 0.12, 0.05)
  } else {
    tone(ctx, 523.25, start, 0.2, 0.035)
    tone(ctx, 659.25, start + 0.1, 0.24, 0.03)
  }

  // Close the context after the tail so repeated notifications do not leak
  // audio contexts in a long-lived desktop session.
  window.setTimeout(() => {
    void ctx.close().catch(() => undefined)
  }, 700)
}

/**
 * Plays the selected notification sound. Called with no arguments it reads the
 * stored preference, which is what the toast observer uses.
 */
export function playNotificationSound(settings?: Partial<NotificationSoundSettings>): void {
  if (typeof window === "undefined") return
  const stored = getStoredNotificationSound()
  const sound = settings?.sound ?? stored.sound
  const customDataUrl = settings?.customDataUrl ?? stored.customDataUrl

  if (sound === "off") return
  try {
    if (sound === "custom") {
      if (!customDataUrl) return
      const audio = new Audio(customDataUrl)
      audio.volume = 0.7
      void audio.play().catch(() => undefined)
      return
    }
    playBuiltIn(sound)
  } catch {
    // Audio is a nicety; a blocked or unsupported context must never break a
    // toast or an action.
  }
}
