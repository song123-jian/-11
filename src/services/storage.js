const prefix = 'efficiency-toolbox:'
export const STATE_SCHEMA_VERSION = 1
export const PERSISTED_STATE_KEYS = Object.freeze([
  'theme',
  'tasks',
  'recent-tools',
  'online-consent',
  'todos',
  'quick-note',
  'reminders',
  'assistant',
  'print-settings',
  'ui-prefs',
])

const persistedStateKeys = new Set(PERSISTED_STATE_KEYS)

function allowedKey(key) {
  const normalized = String(key || '')
  return persistedStateKeys.has(normalized) ? normalized : null
}

function envelope(value) {
  return { schemaVersion: STATE_SCHEMA_VERSION, value }
}

export function loadState(key, fallback) {
  try {
    const normalizedKey = allowedKey(key)
    if (!normalizedKey) return fallback
    const storageKey = prefix + normalizedKey
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.hasOwn(parsed, 'schemaVersion')) {
      return parsed.schemaVersion === STATE_SCHEMA_VERSION && Object.hasOwn(parsed, 'value') ? parsed.value : fallback
    }
    return parsed
  } catch {
    return fallback
  }
}

export function saveState(key, value) {
  try {
    const normalizedKey = allowedKey(key)
    if (!normalizedKey) return false
    const storageKey = prefix + normalizedKey
    const current = window.localStorage.getItem(storageKey)
    if (current) {
      try {
        const parsed = JSON.parse(current)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.hasOwn(parsed, 'schemaVersion') && parsed.schemaVersion !== STATE_SCHEMA_VERSION) {
          return false
        }
      } catch {
        // A new valid value can replace malformed JSON from an interrupted write.
      }
    }
    window.localStorage.setItem(storageKey, JSON.stringify(envelope(value)))
    return true
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
    return false
  }
}

export function removeState(key) {
  try {
    const normalizedKey = allowedKey(key)
    if (!normalizedKey) return false
    window.localStorage.removeItem(prefix + normalizedKey)
    return true
  } catch {
    // Ignore storage failures; the UI remains usable for the current session.
    return false
  }
}
