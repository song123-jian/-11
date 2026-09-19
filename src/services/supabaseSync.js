import { normalizeAssistantState } from './assistantTools.js'
import { serializeTaskHistory } from './taskHistoryTools.js'
import { DEFAULT_UI_PREFS, normalizeUiPrefs } from './uiPreferences.js'
import { normalizeTranslationPreferences } from './translationTools.js'
import { normalizeSupabaseUrl } from './supabaseConfig.js'

export const SUPABASE_SYNC_NAMESPACES = Object.freeze(['assistant', 'tasks', 'ui-prefs'])
export const SUPABASE_SYNC_SCHEMA_VERSION = 1
export const SUPABASE_SESSION_STORAGE_KEY = 'efficiency-toolbox:supabase-session'

const MAX_PAYLOAD_BYTES = 1_500_000
const SESSION_REFRESH_MARGIN_MS = 30_000

function utf8ByteLength(value) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).byteLength
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
  }
  return bytes
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function boundedText(value, maximum = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function sanitizeAssistant(value) {
  const normalized = normalizeAssistantState(value)
  return {
    version: normalized.version,
    // Task labels and scheduling metadata are useful across devices. Unknown
    // fields are deliberately discarded before the payload reaches the API.
    todos: normalized.todos.map((todo) => ({
      id: todo.id,
      text: todo.text,
      done: todo.done,
      completedAt: normalizeTimestamp(todo.completedAt),
      priority: todo.priority,
      category: todo.category,
      tags: [...todo.tags],
      dueAt: todo.dueAt,
      subtasks: todo.subtasks.map((item) => ({ id: item.id, text: item.text, done: item.done })),
      focusMinutes: todo.focusMinutes,
      order: todo.order,
      createdAt: normalizeTimestamp(todo.createdAt),
      updatedAt: normalizeTimestamp(todo.updatedAt),
    })),
    reminders: normalized.reminders.map((reminder) => ({
      id: reminder.id,
      title: reminder.title,
      at: reminder.at,
      notified: reminder.notified,
      lastNotifiedAt: normalizeTimestamp(reminder.lastNotifiedAt),
      lastAttemptAt: normalizeTimestamp(reminder.lastAttemptAt),
      retryAfterAt: normalizeTimestamp(reminder.retryAfterAt),
      deliveryStatus: reminder.deliveryStatus,
      category: reminder.category,
      starred: reminder.starred,
      advanceMinutes: reminder.advanceMinutes,
      recurrence: clone(reminder.recurrence),
      linkedTodoId: reminder.linkedTodoId,
      order: reminder.order,
      createdAt: normalizeTimestamp(reminder.createdAt),
    })),
    focus: clone(normalized.focus),
    // Keep note/meeting labels and dates for cross-device navigation, but never
    // sync free-form bodies, attendee lists, or action text.
    notes: normalized.notes.map((note) => ({
      id: note.id,
      title: note.title,
      category: note.category,
      color: note.color,
      order: note.order,
      createdAt: normalizeTimestamp(note.createdAt),
      updatedAt: normalizeTimestamp(note.updatedAt),
    })),
    meetings: normalized.meetings.map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      date: meeting.date,
      createdAt: normalizeTimestamp(meeting.createdAt),
    })),
    redactedFields: ['notes.content', 'meetings.attendees', 'meetings.keyPoints', 'meetings.actions'],
  }
}

function sanitizeTasks(value) {
  return serializeTaskHistory(Array.isArray(value) ? value : value?.items, 30)
}

function sanitizeUiPreferences(value) {
  const source = plainObject(value) || DEFAULT_UI_PREFS
  return {
    ...normalizeUiPrefs({
      sidebarCollapsed: source.sidebarCollapsed,
      density: source.density,
      lastTool: source.lastTool,
      taskPanelPinned: source.taskPanelPinned,
    }),
    translation: normalizeTranslationPreferences(source.translation),
  }
}

export function sanitizeSyncPayload(namespace, value) {
  if (!SUPABASE_SYNC_NAMESPACES.includes(namespace)) return null
  const payload = namespace === 'assistant'
    ? sanitizeAssistant(value)
    : namespace === 'tasks'
      ? sanitizeTasks(value)
      : sanitizeUiPreferences(value)
  const encoded = JSON.stringify(payload)
  if (utf8ByteLength(encoded) > MAX_PAYLOAD_BYTES) throw new Error(`${namespace} 同步数据超过 1.5 MB 限制`)
  return payload
}

function mergeById(localItems, remoteItems, mapRemote) {
  const local = Array.isArray(localItems) ? localItems : []
  const remote = Array.isArray(remoteItems) ? remoteItems : []
  const localById = new Map(local.map((item) => [item?.id, item]))
  return remote.map((item) => mapRemote(item, localById.get(item?.id))).concat(
    local.filter((item) => !remote.some((remoteItem) => remoteItem?.id === item?.id)),
  )
}

export function mergeRemoteSyncState(namespace, localValue, remoteValue) {
  if (namespace === 'assistant') {
    const local = normalizeAssistantState(localValue)
    const remote = normalizeAssistantState(remoteValue)
    return normalizeAssistantState({
      ...remote,
      notes: mergeById(local.notes, remote.notes, (item, previous) => ({ ...item, content: previous?.content || '' })),
      meetings: mergeById(local.meetings, remote.meetings, (item, previous) => ({
        ...item,
        attendees: previous?.attendees || '',
        keyPoints: previous?.keyPoints || '',
        actions: previous?.actions || '',
      })),
    })
  }
  if (namespace === 'tasks') return sanitizeTasks(remoteValue)
  if (namespace === 'ui-prefs') return sanitizeUiPreferences(remoteValue)
  return null
}

function sessionStorageFor(storage) {
  if (storage) return storage
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

function readSession(storage) {
  try {
    const raw = storage?.getItem(SUPABASE_SESSION_STORAGE_KEY)
    const value = raw ? JSON.parse(raw) : null
    return plainObject(value)
  } catch {
    return null
  }
}

function writeSession(storage, value) {
  try {
    if (!value) storage?.removeItem(SUPABASE_SESSION_STORAGE_KEY)
    else storage?.setItem(SUPABASE_SESSION_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Session persistence is optional; the current window remains usable.
  }
}

function authError(payload, fallback) {
  const message = payload?.error_description || payload?.msg || payload?.message || payload?.error
  return new Error(typeof message === 'string' && message.trim() ? message.trim() : fallback)
}

function normalizeUser(value) {
  const source = plainObject(value)
  if (!source?.id) return null
  return { id: String(source.id), email: boundedText(source.email, 320) }
}

function normalizeSession(value) {
  const source = plainObject(value)
  if (!source?.access_token || !source?.user?.id) return null
  const rawExpiry = Number(source.expires_at)
  const expiresAt = Number.isFinite(rawExpiry) && rawExpiry > 0
    ? (rawExpiry < 10_000_000_000 ? rawExpiry * 1000 : rawExpiry)
    : Date.now() + (Number(source.expires_in) || 3_600) * 1000
  return {
    access_token: String(source.access_token),
    refresh_token: String(source.refresh_token || ''),
    expires_at: expiresAt,
    user: normalizeUser(source.user),
  }
}

function statusCopy(status) {
  const defaults = {
    unconfigured: '未配置 Supabase 环境变量',
    signedOut: '未登录云同步',
    ready: '已登录，等待同步',
    syncing: '同步中…',
    synced: '同步完成',
    error: '同步失败',
    authPending: '正在验证账号',
    confirmationRequired: '注册成功，请查收确认邮件',
  }
  return defaults[status] || defaults.signedOut
}

export function createSupabaseSyncManager({
  config = {},
  fetchImpl = globalThis.fetch,
  storage = null,
  getLocalState = () => null,
  applyRemoteState = () => {},
  onStatus = () => {},
  canAutoSync = () => true,
  syncDelayMs = 1_200,
} = {}) {
  const normalizedConfig = {
    url: normalizeSupabaseUrl(config.url),
    publishableKey: String(config.publishableKey || '').trim(),
  }
  const sessionStore = sessionStorageFor(storage)
  const automaticSyncDelay = Number.isFinite(Number(syncDelayMs)) ? Math.max(0, Number(syncDelayMs)) : 1_200
  const dirtyNamespaces = new Set()
  const dirtyVersions = new Map()
  const activeRequests = new Set()
  let session = normalizeSession(readSession(sessionStore))
  let status = {
    phase: normalizedConfig.url && normalizedConfig.publishableKey ? (session ? 'ready' : 'signedOut') : 'unconfigured',
    message: normalizedConfig.url && normalizedConfig.publishableKey ? (session ? statusCopy('ready') : statusCopy('signedOut')) : statusCopy('unconfigured'),
    user: session?.user || null,
    lastSyncedAt: null,
    error: null,
  }
  let syncing = false
  let started = false
  let syncTimer = null
  let suppressStorageEvents = false

  function publish(patch = {}) {
    status = { ...status, ...patch }
    onStatus({ ...status })
  }

  function assertConfigured() {
    if (!normalizedConfig.url || !normalizedConfig.publishableKey) throw new Error('请先配置 VITE_SUPABASE_URL 与 VITE_SUPABASE_PUBLISHABLE_KEY')
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求')
  }

  function syncAllowed() {
    try {
      return canAutoSync() !== false
    } catch {
      return false
    }
  }

  function markNamespaceDirty(namespace) {
    if (!SUPABASE_SYNC_NAMESPACES.includes(namespace)) return
    dirtyNamespaces.add(namespace)
    dirtyVersions.set(namespace, (dirtyVersions.get(namespace) || 0) + 1)
  }

  function clearNamespaceDirty(namespace) {
    dirtyNamespaces.delete(namespace)
    dirtyVersions.delete(namespace)
  }

  function clearNamespaceDirtyIfUnchanged(namespace, version) {
    if ((dirtyVersions.get(namespace) || 0) !== version) return false
    clearNamespaceDirty(namespace)
    return true
  }

  function scheduleAutomaticSync() {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = null
    if (!started || !session || !syncAllowed()) return
    syncTimer = setTimeout(() => {
      syncTimer = null
      void syncNow().catch(() => {})
    }, automaticSyncDelay)
  }

  async function request(path, options = {}, { auth = true } = {}) {
    assertConfigured()
    const headers = new Headers(options.headers || {})
    headers.set('apikey', normalizedConfig.publishableKey)
    headers.set('Accept', 'application/json')
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    if (auth && session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
    const controller = new AbortController()
    activeRequests.add(controller)
    try {
      const response = await fetchImpl(`${normalizedConfig.url}${path}`, { ...options, headers, signal: controller.signal })
      let body = null
      try { body = await response.json() } catch { /* empty response */ }
      if (!response.ok) throw authError(body, `Supabase 请求失败（HTTP ${response.status}）`)
      return body
    } finally {
      activeRequests.delete(controller)
    }
  }

  async function refreshSession() {
    if (!session?.refresh_token) return null
    const response = await request(`/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    }, { auth: false })
    const next = normalizeSession(response)
    if (!next) throw new Error('Supabase 会话刷新响应无效')
    session = next
    writeSession(sessionStore, session)
    publish({ phase: 'ready', message: statusCopy('ready'), user: session.user, error: null })
    return session
  }

  async function ensureSession() {
    if (!session) throw new Error('请先登录云同步')
    if (Number(session.expires_at) - Date.now() <= SESSION_REFRESH_MARGIN_MS) await refreshSession()
    if (!session?.access_token) throw new Error('云同步会话已失效，请重新登录')
    return session
  }

  async function authenticate(path, email, password) {
    assertConfigured()
    const normalizedEmail = boundedText(email, 320).toLowerCase()
    const normalizedPassword = String(password || '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('请输入有效的邮箱地址')
    if (normalizedPassword.length < 6 || normalizedPassword.length > 256) throw new Error('密码长度需为 6 至 256 个字符')
    publish({ phase: 'authPending', message: statusCopy('authPending'), error: null })
    const response = await request(path, { method: 'POST', body: JSON.stringify({ email: normalizedEmail, password: normalizedPassword }) }, { auth: false })
    const next = normalizeSession(response)
    if (!next) {
      if (response?.user?.id && !response?.access_token) {
        publish({ phase: 'confirmationRequired', message: statusCopy('confirmationRequired'), user: null, error: null })
        return { confirmationRequired: true, user: normalizeUser(response.user) }
      }
      throw new Error('Supabase 未返回有效会话，请确认邮箱验证设置')
    }
    session = next
    writeSession(sessionStore, session)
    dirtyNamespaces.clear()
    dirtyVersions.clear()
    publish({ phase: 'ready', message: statusCopy('ready'), user: session.user, error: null })
    await syncNow({ initial: true })
    return { user: session.user }
  }

  async function signIn(email, password) {
    return authenticate('/auth/v1/token?grant_type=password', email, password)
  }

  async function signUp(email, password) {
    return authenticate('/auth/v1/signup', email, password)
  }

  async function signOut() {
    if (session?.access_token && normalizedConfig.url && typeof fetchImpl === 'function' && syncAllowed()) {
      try { await request('/auth/v1/logout', { method: 'POST' }) } catch { /* local sign-out still completes */ }
    }
    session = null
    dirtyNamespaces.clear()
    dirtyVersions.clear()
    writeSession(sessionStore, null)
    publish({ phase: normalizedConfig.url && normalizedConfig.publishableKey ? 'signedOut' : 'unconfigured', message: statusCopy(normalizedConfig.url && normalizedConfig.publishableKey ? 'signedOut' : 'unconfigured'), user: null, error: null })
  }

  async function fetchRemoteRows() {
    const query = '?select=namespace,payload,schema_version,updated_at&namespace=in.(assistant,tasks,ui-prefs)'
    const rows = await request(`/rest/v1/user_app_state${query}`, { method: 'GET' })
    return Array.isArray(rows) ? rows : []
  }

  async function upsertRows(rows) {
    if (!rows.length) return
    await request('/rest/v1/user_app_state?on_conflict=user_id,namespace', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    })
  }

  async function syncNow({ initial = false } = {}) {
    if (syncing) return { skipped: true, reason: 'busy' }
    if (!syncAllowed()) return { skipped: true, reason: 'unauthorized' }
    syncing = true
    try {
      await ensureSession()
      if (syncTimer) {
        clearTimeout(syncTimer)
        syncTimer = null
      }
      publish({ phase: 'syncing', message: statusCopy('syncing'), error: null })
      const rows = await fetchRemoteRows()
      const byNamespace = new Map(rows.filter((row) => SUPABASE_SYNC_NAMESPACES.includes(row?.namespace)).map((row) => [row.namespace, row]))
      const toUpload = []
      const uploadVersions = new Map()
      const downloaded = []
      for (const namespace of SUPABASE_SYNC_NAMESPACES) {
        const localValue = getLocalState(namespace)
        const localPayload = sanitizeSyncPayload(namespace, localValue)
        const remoteRow = byNamespace.get(namespace)
        const remotePayload = remoteRow ? sanitizeSyncPayload(namespace, remoteRow.payload) : null
        const preferLocal = dirtyNamespaces.has(namespace) && !initial
        if (remoteRow && !preferLocal) {
          suppressStorageEvents = true
          try { applyRemoteState(namespace, mergeRemoteSyncState(namespace, localValue, remotePayload)) } finally { suppressStorageEvents = false }
          clearNamespaceDirty(namespace)
          downloaded.push(namespace)
          continue
        }
        if (localPayload) {
          uploadVersions.set(namespace, dirtyVersions.get(namespace) || 0)
          toUpload.push({
            user_id: session.user.id,
            namespace,
            payload: localPayload,
            schema_version: SUPABASE_SYNC_SCHEMA_VERSION,
          })
        }
      }
      await upsertRows(toUpload)
      toUpload.forEach((row) => clearNamespaceDirtyIfUnchanged(row.namespace, uploadVersions.get(row.namespace) || 0))
      const syncedAt = new Date().toISOString()
      publish({ phase: 'synced', message: statusCopy('synced'), user: session.user, lastSyncedAt: syncedAt, error: null })
      return { uploaded: toUpload.map((row) => row.namespace), downloaded, syncedAt }
    } catch (error) {
      if (error?.name === 'AbortError') {
        publish({ phase: session ? 'ready' : 'signedOut', message: '同步已取消', error: null, user: session?.user || null })
      } else {
        publish({ phase: 'error', message: error.message || statusCopy('error'), error: error.message || statusCopy('error'), user: session?.user || null })
      }
      throw error
    } finally {
      syncing = false
      if (dirtyNamespaces.size) scheduleAutomaticSync()
    }
  }

  function handleStorageChange(event) {
    if (suppressStorageEvents || !session || !SUPABASE_SYNC_NAMESPACES.includes(event?.detail?.key)) return
    markNamespaceDirty(event.detail.key)
    if (syncTimer) clearTimeout(syncTimer)
    if (!syncAllowed()) return
    scheduleAutomaticSync()
  }

  async function start() {
    if (started) return
    started = true
    if (typeof window !== 'undefined') window.addEventListener('efficiency-state-change', handleStorageChange)
    if (!session || !syncAllowed()) return
    try {
      await ensureSession()
      await syncNow({ initial: true })
    } catch (error) {
      publish({ phase: 'error', message: error.message || statusCopy('error'), error: error.message || statusCopy('error'), user: session?.user || null })
    }
  }

  function stop() {
    started = false
    if (typeof window !== 'undefined') window.removeEventListener('efficiency-state-change', handleStorageChange)
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = null
    activeRequests.forEach((controller) => controller.abort())
    activeRequests.clear()
  }

  function cancelPendingRequests() {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = null
    activeRequests.forEach((controller) => controller.abort())
    activeRequests.clear()
  }

  return {
    getStatus: () => ({ ...status }),
    getConfig: () => ({ ...normalizedConfig, configured: Boolean(normalizedConfig.url && normalizedConfig.publishableKey) }),
    getUser: () => session?.user || null,
    signIn,
    signUp,
    signOut,
    syncNow,
    start,
    stop,
    cancelPendingRequests,
    markDirty: markNamespaceDirty,
  }
}
