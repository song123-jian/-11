import { loadState, saveState } from './storage.js'
import { isTauriRuntime } from './runtime.js'
import {
  localDateTimeValue,
  nextReminderOccurrence,
  normalizeAssistantState,
} from './assistantTools.js'

export const REMINDER_SCHEDULER_INTERVAL_MS = 15_000
export const REMINDER_RETRY_DELAY_MS = 60_000

let schedulerTimer = null
let schedulerRunning = false
let listenersInstalled = false
let lastScheduleFingerprint = ''
let pendingScheduleFingerprint = ''
let reminderFirePromise = null
let nativePermissionRequested = false

function readAssistantState() {
  return normalizeAssistantState(loadState('assistant', null), {
    reminders: loadState('reminders', []),
  })
}

function persistAssistantState(state) {
  const snapshot = normalizeAssistantState(state)
  saveState('assistant', snapshot)
  saveState('reminders', snapshot.reminders.map(({ id, title, at, notified }) => ({ id, title, at, notified })))
  return snapshot
}

function emitReminderEvent(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent('efficiency:reminder', { detail }))
  } catch {
    // A notification failure must not stop the scheduler loop.
  }
}

async function sendNativeNotification(title, body) {
  if (!isTauriRuntime) return { sent: false, mode: 'browser', reason: 'browser-runtime' }
  try {
    const notification = await import('@tauri-apps/plugin-notification')
    let granted = await notification.isPermissionGranted()
    if (!granted && !nativePermissionRequested && typeof notification.requestPermission === 'function') {
      nativePermissionRequested = true
      granted = (await notification.requestPermission()) === 'granted'
    }
    if (!granted) return { sent: false, mode: 'fallback', reason: 'permission-denied' }
    await notification.sendNotification({ title, body })
    return { sent: true, mode: 'native' }
  } catch (error) {
    return { sent: false, mode: 'fallback', reason: String(error?.message || error) }
  }
}

function sendBrowserNotification(title, body) {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { sent: false, mode: 'fallback', reason: 'notification-api-unavailable' }
  }
  if (Notification.permission !== 'granted') {
    return { sent: false, mode: 'fallback', reason: `permission-${Notification.permission}` }
  }
  try {
    new Notification(title, { body })
    return { sent: true, mode: 'browser' }
  } catch (error) {
    return { sent: false, mode: 'fallback', reason: String(error?.message || error) }
  }
}

async function deliverReminder(reminder) {
  const title = '效率百宝箱提醒'
  const body = reminder.title
  emitReminderEvent({ type: 'attempt', reminder: { ...reminder } })
  const native = await sendNativeNotification(title, body)
  if (native.sent) return native
  const browser = sendBrowserNotification(title, body)
  if (browser.sent) return browser
  // The in-app event gives an already-mounted workspace a visible fallback.
  emitReminderEvent({ type: 'fallback', reminder: { ...reminder }, reason: native.reason || browser.reason })
  return {
    sent: true,
    mode: 'fallback',
    reason: native.reason || browser.reason,
  }
}

async function syncSystemSchedules(reminders, now) {
  if (!isTauriRuntime) return
  const schedules = (Array.isArray(reminders) ? reminders : [])
    .map((reminder) => ({ reminder, triggerAt: reminderTriggerAt(reminder) }))
    .filter(({ reminder, triggerAt }) => !reminder.notified && Number.isFinite(triggerAt) && triggerAt > now)
    .map(({ reminder, triggerAt }) => ({ id: reminder.id, executeAt: localDateTimeValue(triggerAt) }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const fingerprint = JSON.stringify(schedules)
  if (fingerprint === lastScheduleFingerprint || fingerprint === pendingScheduleFingerprint) return
  pendingScheduleFingerprint = fingerprint
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke('reconcile_reminder_schedules', { schedules })
    const unsupported = result?.supported === false
    const errors = Array.isArray(result?.errors) ? result.errors : []
    const responseShapeValid = typeof result?.supported === 'boolean' && errors.length === 0
    if ((errors.length || !responseShapeValid) && !unsupported) {
      console.error('[efficiency-diagnostic]', JSON.stringify({
        event: 'reminder-system-schedule-error',
        errors: errors.length ? errors : ['invalid scheduler response'],
      }))
    }
    if (responseShapeValid || unsupported) {
      // Only acknowledge a fingerprint after the native scheduler accepted the
      // complete set. Unsupported platforms are intentionally acknowledged;
      // the app-level scheduler remains the fallback there. Failed IPC calls
      // remain eligible for the next scan.
      lastScheduleFingerprint = fingerprint
    }
  } catch (error) {
    console.error('[efficiency-diagnostic]', JSON.stringify({
      event: 'reminder-system-scheduler-unavailable',
      message: String(error?.message || error).slice(0, 2_000),
    }))
  } finally {
    if (pendingScheduleFingerprint === fingerprint) pendingScheduleFingerprint = ''
  }
}

export function reminderTriggerAt(reminder) {
  const timestamp = new Date(reminder?.at).getTime()
  if (!Number.isFinite(timestamp)) return null
  return timestamp - Number(reminder?.advanceMinutes || 0) * 60_000
}

export async function runReminderSchedulerNow(now = Date.now(), { onlyId = '' } = {}) {
  if (schedulerRunning) return { changed: false, skipped: true }
  schedulerRunning = true
  try {
    const state = readAssistantState()
    void syncSystemSchedules(state.reminders, now)
    let changed = false
    const delivered = []
    for (const reminder of state.reminders) {
      if (onlyId && reminder.id !== onlyId) continue
      const triggerAt = reminderTriggerAt(reminder)
      if (reminder.notified || triggerAt === null || now < triggerAt) continue
      if (reminder.retryAfterAt && now < reminder.retryAfterAt) continue
      if (reminder.deliveryStatus === 'pending' && reminder.lastAttemptAt && now - reminder.lastAttemptAt < REMINDER_RETRY_DELAY_MS) continue

      reminder.lastAttemptAt = now
      reminder.deliveryStatus = 'pending'
      changed = true
      persistAssistantState(state)
      const result = await deliverReminder(reminder)
      if (!result.sent) {
        reminder.deliveryStatus = 'failed'
        reminder.retryAfterAt = now + REMINDER_RETRY_DELAY_MS
        continue
      }

      const next = nextReminderOccurrence(reminder, now)
      if (next) {
        reminder.at = localDateTimeValue(next)
        reminder.notified = false
      } else {
        reminder.notified = true
      }
      reminder.lastNotifiedAt = now
      reminder.retryAfterAt = null
      reminder.deliveryStatus = result.mode === 'fallback' ? 'fallback' : 'delivered'
      delivered.push({ id: reminder.id, mode: result.mode })
    }
    if (changed) {
      const snapshot = persistAssistantState(state)
      void syncSystemSchedules(snapshot.reminders, now)
      emitReminderEvent({ type: 'state', reminders: snapshot.reminders, delivered })
    }
    return { changed, delivered }
  } finally {
    schedulerRunning = false
  }
}

function handleSchedulerSignal() {
  void runReminderSchedulerNow().catch((error) => {
    console.error('[efficiency-diagnostic]', JSON.stringify({
      event: 'reminder-scheduler-error',
      message: String(error?.message || error).slice(0, 2_000),
    }))
  })
}

export function startReminderScheduler() {
  if (typeof window === 'undefined' || schedulerTimer) return
  void startReminderSchedulerInternal()
}

async function startReminderSchedulerInternal() {
  if (reminderFirePromise) return reminderFirePromise
  reminderFirePromise = (async () => {
    if (isTauriRuntime) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const reminderId = await invoke('reminder_fire_context')
        if (reminderId) {
          await runReminderSchedulerNow(Date.now(), { onlyId: reminderId })
          // Give the native notification bridge a moment to enqueue the toast
          // before the hidden Task Scheduler instance exits.
          await new Promise((resolve) => window.setTimeout(resolve, 500))
          await invoke('complete_reminder_fire')
          return
        }
      } catch (error) {
        console.error('[efficiency-diagnostic]', JSON.stringify({
          event: 'reminder-fire-mode-error',
          message: String(error?.message || error).slice(0, 2_000),
        }))
      }
    }
    handleSchedulerSignal()
    schedulerTimer = window.setInterval(handleSchedulerSignal, REMINDER_SCHEDULER_INTERVAL_MS)
    if (!listenersInstalled) {
      window.addEventListener('focus', handleSchedulerSignal)
      document.addEventListener('visibilitychange', handleSchedulerSignal)
      listenersInstalled = true
    }
  })().finally(() => {
    reminderFirePromise = null
  })
  return reminderFirePromise
}

export function stopReminderScheduler() {
  if (schedulerTimer && typeof window !== 'undefined') window.clearInterval(schedulerTimer)
  schedulerTimer = null
  if (listenersInstalled && typeof window !== 'undefined') {
    window.removeEventListener('focus', handleSchedulerSignal)
    document.removeEventListener('visibilitychange', handleSchedulerSignal)
    listenersInstalled = false
  }
}
