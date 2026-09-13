import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './runtime.js'

export const POWER_SAFETY_BUFFER_SECONDS = 30
export const MIN_POWER_DELAY_SECONDS = POWER_SAFETY_BUFFER_SECONDS
export const MAX_POWER_DELAY_SECONDS = 31 * 24 * 60 * 60

export const POWER_ACTIONS = Object.freeze([
  Object.freeze({ id: 'shutdown', label: '关机', description: '关闭 Windows' }),
  Object.freeze({ id: 'restart', label: '重启', description: '重新启动 Windows' }),
  Object.freeze({ id: 'hibernate', label: '休眠', description: '保存会话并进入休眠' }),
])

const POWER_ACTION_IDS = new Set(POWER_ACTIONS.map((item) => item.id))
const POWER_STATUSES = new Set(['idle', 'scheduled', 'executing', 'executed', 'canceled', 'failed'])

function asFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function pad(value) {
  return String(value).padStart(2, '0')
}

export function normalizePowerAction(value) {
  const action = String(value || '').trim().toLowerCase()
  return POWER_ACTION_IDS.has(action) ? action : null
}

export function powerActionLabel(value) {
  return POWER_ACTIONS.find((item) => item.id === value)?.label || '系统动作'
}

export function parseLocalDateTime(value) {
  const raw = String(value || '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw)
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0'] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const date = new Date(year, month - 1, day, hour, minute, second, 0)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
    || date.getSeconds() !== second
  ) return null
  const timestamp = date.getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

export function toLocalDateTimeValue(timestamp = Date.now()) {
  const date = new Date(Number(timestamp))
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatPowerDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (days) return `${days} 天 ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

export function validatePowerSchedule({ mode = 'countdown', action, countdownSeconds, targetAt, now = Date.now() } = {}) {
  const normalizedAction = normalizePowerAction(action)
  if (!normalizedAction) throw new Error('请选择有效的系统动作')
  const nowMs = asFiniteNumber(now)
  if (nowMs === null) throw new Error('当前时间无效，无法创建定时任务')

  let executeAtMs
  let normalizedCountdownSeconds = null
  if (mode === 'countdown') {
    const seconds = asFiniteNumber(countdownSeconds)
    if (seconds === null || !Number.isInteger(seconds)) throw new Error('倒计时必须是整数秒')
    if (seconds < MIN_POWER_DELAY_SECONDS) throw new Error(`倒计时至少需要 ${MIN_POWER_DELAY_SECONDS} 秒`) 
    if (seconds > MAX_POWER_DELAY_SECONDS) throw new Error('倒计时不能超过 31 天')
    normalizedCountdownSeconds = seconds
    executeAtMs = nowMs + seconds * 1000
  } else if (mode === 'at-time') {
    executeAtMs = parseLocalDateTime(targetAt)
    if (executeAtMs === null) throw new Error('请输入有效的定点时间')
    if (executeAtMs - nowMs > MAX_POWER_DELAY_SECONDS * 1000) throw new Error('定点时间不能超过 31 天')
  } else {
    throw new Error('未知的定时模式')
  }

  if (executeAtMs < nowMs + MIN_POWER_DELAY_SECONDS * 1000) {
    throw new Error(`执行时间至少应晚于当前时间 ${MIN_POWER_DELAY_SECONDS} 秒`)
  }
  return {
    mode,
    action: normalizedAction,
    executeAtMs: Math.round(executeAtMs),
    countdownSeconds: normalizedCountdownSeconds,
  }
}

export function normalizePowerScheduleStatus(value = {}) {
  const status = POWER_STATUSES.has(String(value.status || '')) ? String(value.status) : 'idle'
  const executeAtMs = asFiniteNumber(value.executeAtMs)
  const requestId = String(value.requestId || '').trim()
  const action = normalizePowerAction(value.action)
  return {
    active: status === 'scheduled' || status === 'executing',
    requestId: requestId || null,
    action,
    executeAtMs: executeAtMs === null ? null : Math.round(executeAtMs),
    status,
    error: String(value.error || '').trim() || null,
  }
}

export function createPowerRequestId(now = Date.now()) {
  const stamp = Math.max(0, Math.round(Number(now) || Date.now())).toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `power-${stamp}-${random}`
}

export async function getPowerCapabilities() {
  if (!isTauriRuntime) {
    return {
      platform: 'browser',
      scheduler: false,
      supportedActions: [],
      safetyBufferSeconds: POWER_SAFETY_BUFFER_SECONDS,
    }
  }
  return invoke('power_capabilities')
}

export async function schedulePowerAction({ action, executeAtMs, requestId }) {
  if (!isTauriRuntime) throw new Error('浏览器模式仅支持预览，真实定时关机请使用 Tauri 桌面版')
  return invoke('schedule_power_action', {
    action,
    executeAtMs,
    requestId,
  })
}

export async function cancelPowerSchedule(requestId = null) {
  if (!isTauriRuntime) return normalizePowerScheduleStatus({ status: 'canceled', requestId })
  return invoke('cancel_power_schedule', { requestId })
}

export async function getPowerScheduleStatus() {
  if (!isTauriRuntime) return normalizePowerScheduleStatus()
  return invoke('power_schedule_status')
}
