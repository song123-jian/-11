import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { ASSISTANT_SCHEMA_VERSION } from '../src/services/assistantTools.js'
import { DEFAULT_SUPABASE_URL, normalizeSupabaseUrl, readSupabaseConfig } from '../src/services/supabaseConfig.js'
import {
  SUPABASE_SESSION_STORAGE_KEY,
  SUPABASE_SYNC_NAMESPACES,
  createSupabaseSyncManager,
  mergeRemoteSyncState,
  sanitizeSyncPayload,
} from '../src/services/supabaseSync.js'

function createMemoryStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  }
}

function createWindowEvents() {
  const listeners = new Map()
  return {
    addEventListener(type, listener) {
      const current = listeners.get(type) || new Set()
      current.add(listener)
      listeners.set(type, current)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatch(type, detail) {
      listeners.get(type)?.forEach((listener) => listener({ type, detail }))
    },
  }
}

function jsonResponse(value, status = 200) {
  return new Response(value === null ? null : JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sampleAssistant(overrides = {}) {
  const now = Date.UTC(2026, 8, 19, 8, 0, 0)
  return {
    version: ASSISTANT_SCHEMA_VERSION,
    todos: [{
      id: 'todo-1', text: '同步待办', done: false, completedAt: null, priority: 'high', category: 'work', tags: ['同步'], dueAt: '',
      subtasks: [{ id: 'step-1', text: '检查', done: false }], focusMinutes: 0, order: 0, createdAt: now, updatedAt: now,
    }],
    reminders: [],
    focus: {},
    notes: [{ id: 'note-1', title: '本机便签', content: '便签正文-secret-note', category: 'memo', color: 'blue', order: 0, createdAt: now, updatedAt: now }],
    meetings: [{ id: 'meeting-1', title: '周会', attendees: '张三-secret-attendee', date: '2026-09-19T09:00', keyPoints: '核心要点-secret-point', actions: '行动项-secret-action', createdAt: now }],
    ...overrides,
  }
}

function sampleTasks() {
  return {
    schemaVersion: 1,
    items: [{
      id: '1700000000000-abcd', operation: 'pdf-merge', status: 'success', progress: 100,
      completedItems: 2, totalItems: 2, cancellable: true, createdTimestamp: 1_700_000_000_000,
      finishedTimestamp: 1_700_000_001_000, fileName: 'customer-secret.pdf', output: 'file-content-secret',
    }],
  }
}

function sampleUiPreferences() {
  return {
    sidebarCollapsed: true,
    density: 'compact',
    lastTool: 'translation',
    taskPanelPinned: true,
    translation: { sourceLanguage: 'en', targetLanguage: 'zh-CN', style: 'formal', preserveFormatting: false },
    apiKey: 'sk-secret',
    files: ['customer-secret.pdf'],
    diagnostics: { logs: 'private-log' },
  }
}

function session(expiresAt = Math.floor(Date.now() / 1000) + 3_600) {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: expiresAt,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' },
  }
}

function localState(namespace) {
  if (namespace === 'assistant') return sampleAssistant()
  if (namespace === 'tasks') return sampleTasks()
  return sampleUiPreferences()
}

test('Supabase config accepts the project API origin and publishable key aliases', () => {
  assert.equal(normalizeSupabaseUrl(`${DEFAULT_SUPABASE_URL}/`), DEFAULT_SUPABASE_URL)
  assert.equal(normalizeSupabaseUrl('https://supabase.com/dashboard/project/example/sql/new'), '')
  assert.equal(normalizeSupabaseUrl('javascript:alert(1)'), '')

  const publishable = readSupabaseConfig({ VITE_SUPABASE_URL: `${DEFAULT_SUPABASE_URL}/`, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb-publishable' })
  assert.deepEqual(publishable, { url: DEFAULT_SUPABASE_URL, publishableKey: 'sb-publishable', configured: true, source: 'environment' })
  assert.equal(readSupabaseConfig({ VITE_SUPABASE_ANON_KEY: 'anon-key' }).publishableKey, 'anon-key')
})

test('sync payloads keep only the three namespaces and remove local-only sensitive fields', () => {
  assert.deepEqual(SUPABASE_SYNC_NAMESPACES, ['assistant', 'tasks', 'ui-prefs'])
  assert.equal(sanitizeSyncPayload('relay-api-config', { apiKey: 'sk-secret' }), null)

  const assistant = sanitizeSyncPayload('assistant', sampleAssistant())
  const tasks = sanitizeSyncPayload('tasks', sampleTasks())
  const preferences = sanitizeSyncPayload('ui-prefs', sampleUiPreferences())
  const encoded = JSON.stringify({ assistant, tasks, preferences })

  assert.equal(assistant.todos[0].completedAt, null)
  assert.doesNotMatch(encoded, /1970-01-01/)
  assert.doesNotMatch(encoded, /secret-note|secret-attendee|secret-point|secret-action|customer-secret|file-content-secret|sk-secret|private-log/)
  assert.deepEqual(preferences.translation, { sourceLanguage: 'en', targetLanguage: 'zh-CN', style: 'formal', preserveFormatting: false })
  assert.deepEqual(Object.keys(tasks.items[0]).sort(), ['cancellable', 'completedItems', 'finishedTimestamp', 'id', 'operation', 'progress', 'status', 'totalItems', 'createdTimestamp'].sort())
})

test('sync payload size limit counts UTF-8 bytes rather than JavaScript characters', () => {
  const largeSubtaskText = '界'.repeat(100)
  const oversized = {
    version: ASSISTANT_SCHEMA_VERSION,
    todos: Array.from({ length: 300 }, (_, index) => ({
      id: `todo-${index}`,
      text: '同步条目',
      done: false,
      priority: 'medium',
      category: 'work',
      tags: [],
      dueAt: '',
      subtasks: Array.from({ length: 20 }, (_, subtaskIndex) => ({
        id: `step-${index}-${subtaskIndex}`,
        text: largeSubtaskText,
        done: false,
      })),
      focusMinutes: 0,
      order: index,
      createdAt: Date.UTC(2026, 8, 19, 8, 0, 0),
      updatedAt: Date.UTC(2026, 8, 19, 8, 0, 0),
    })),
    notes: [],
    reminders: [],
    focus: {},
    meetings: [],
  }

  assert.throws(() => sanitizeSyncPayload('assistant', oversized), /1\.5 MB/)
})

test('remote assistant restore preserves note and meeting bodies that only exist locally', () => {
  const local = sampleAssistant()
  const remote = sanitizeSyncPayload('assistant', sampleAssistant({
    notes: [{ ...local.notes[0], title: '云端标题', content: '' }],
    meetings: [{ ...local.meetings[0], title: '云端周会', attendees: '', keyPoints: '', actions: '' }],
  }))
  const merged = mergeRemoteSyncState('assistant', local, remote)

  assert.equal(merged.notes[0].title, '云端标题')
  assert.equal(merged.notes[0].content, '便签正文-secret-note')
  assert.equal(merged.meetings[0].title, '云端周会')
  assert.equal(merged.meetings[0].attendees, '张三-secret-attendee')
  assert.equal(merged.meetings[0].keyPoints, '核心要点-secret-point')
  assert.equal(merged.meetings[0].actions, '行动项-secret-action')
})

test('email sign-in sends Supabase headers, uploads initial state, and accepts second-based expiry', async () => {
  const requests = []
  let refreshCalls = 0
  const fetchImpl = async (url, options) => {
    requests.push({ url, options })
    if (url.includes('grant_type=refresh_token')) {
      refreshCalls += 1
      return jsonResponse(session())
    }
    if (url.includes('grant_type=password')) return jsonResponse(session())
    if (options.method === 'GET') return jsonResponse([])
    return jsonResponse(null, 201)
  }
  const manager = createSupabaseSyncManager({
    config: { url: DEFAULT_SUPABASE_URL, publishableKey: 'sb-publishable' },
    fetchImpl,
    storage: createMemoryStorage(),
    getLocalState: localState,
  })

  const result = await manager.signIn('OWNER@example.com', 'secret-pass')
  assert.equal(result.user.email, 'owner@example.com')
  assert.equal(refreshCalls, 0)
  assert.equal(requests.length, 3)
  assert.match(requests[0].url, /grant_type=password/)
  assert.equal(requests[0].options.headers.get('apikey'), 'sb-publishable')
  assert.equal(requests[0].options.headers.get('Authorization'), null)
  assert.equal(requests[1].options.headers.get('Authorization'), 'Bearer access-token')
  const uploaded = JSON.parse(requests[2].options.body)
  assert.deepEqual(uploaded.map((row) => row.namespace), SUPABASE_SYNC_NAMESPACES)
  assert.ok(uploaded.every((row) => row.user_id === result.user.id && row.schema_version === 1))
})

test('email sign-up confirmation keeps the UI signed out until verification', async () => {
  const manager = createSupabaseSyncManager({
    config: { url: DEFAULT_SUPABASE_URL, publishableKey: 'sb-publishable' },
    fetchImpl: async () => jsonResponse({ user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' } }),
    storage: createMemoryStorage(),
  })

  const result = await manager.signUp('OWNER@example.com', 'secret-pass')
  assert.equal(result.confirmationRequired, true)
  assert.equal(manager.getUser(), null)
  assert.equal(manager.getStatus().phase, 'confirmationRequired')
})

test('startup refreshes an expired second-based session before restoring remote rows', async () => {
  const expired = session(Math.floor(Date.now() / 1000) - 60)
  const storage = createMemoryStorage({ [SUPABASE_SESSION_STORAGE_KEY]: JSON.stringify(expired) })
  const requests = []
  const restored = []
  const remoteRows = SUPABASE_SYNC_NAMESPACES.map((namespace) => ({ namespace, payload: sanitizeSyncPayload(namespace, localState(namespace)), schema_version: 1, updated_at: new Date().toISOString() }))
  const fetchImpl = async (url, options) => {
    requests.push({ url, options })
    if (url.includes('grant_type=refresh_token')) return jsonResponse({ ...session(), access_token: 'refreshed-token' })
    if (options.method === 'GET') return jsonResponse(remoteRows)
    return jsonResponse(null, 201)
  }
  const manager = createSupabaseSyncManager({
    config: { url: DEFAULT_SUPABASE_URL, publishableKey: 'sb-publishable' },
    fetchImpl,
    storage,
    getLocalState: localState,
    applyRemoteState: (namespace, value) => restored.push({ namespace, value }),
  })

  await manager.start()
  assert.equal(requests.filter((request) => request.url.includes('grant_type=refresh_token')).length, 1)
  assert.equal(requests.find((request) => request.options.method === 'GET').options.headers.get('Authorization'), 'Bearer refreshed-token')
  assert.deepEqual(restored.map((item) => item.namespace), SUPABASE_SYNC_NAMESPACES)
  assert.deepEqual(manager.getStatus().phase, 'synced')
  manager.stop()
})

test('automatic sync waits for online consent and then uploads only the dirty namespace', async () => {
  const previousWindow = globalThis.window
  const fakeWindow = createWindowEvents()
  globalThis.window = fakeWindow
  let allowed = false
  const serverRows = new Map(SUPABASE_SYNC_NAMESPACES.map((namespace) => [namespace, sanitizeSyncPayload(namespace, localState(namespace))]))
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url, options })
    if (options.method === 'GET') {
      return jsonResponse([...serverRows].map(([namespace, payload]) => ({ namespace, payload, schema_version: 1, updated_at: new Date().toISOString() })))
    }
    const rows = JSON.parse(options.body)
    rows.forEach((row) => serverRows.set(row.namespace, row.payload))
    return jsonResponse(null, 201)
  }
  const storage = createMemoryStorage({ [SUPABASE_SESSION_STORAGE_KEY]: JSON.stringify(session()) })
  const manager = createSupabaseSyncManager({
    config: { url: DEFAULT_SUPABASE_URL, publishableKey: 'sb-publishable' },
    fetchImpl,
    storage,
    getLocalState: localState,
    canAutoSync: () => allowed,
    syncDelayMs: 0,
  })

  try {
    await manager.start()
    fakeWindow.dispatch('efficiency-state-change', { key: 'ui-prefs' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(requests.length, 0)

    allowed = true
    fakeWindow.dispatch('efficiency-state-change', { key: 'ui-prefs' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(requests.filter((request) => request.options.method === 'GET').length, 1)
    const uploadRequest = requests.find((request) => request.options.method === 'POST')
    assert.deepEqual(JSON.parse(uploadRequest.options.body).map((row) => row.namespace), ['ui-prefs'])
  } finally {
    manager.stop()
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('automatic sync keeps a local edit made during upload and schedules a follow-up', async () => {
  const previousWindow = globalThis.window
  const fakeWindow = createWindowEvents()
  globalThis.window = fakeWindow
  let allowed = false
  let changedDuringUpload = false
  const localValues = {
    assistant: sampleAssistant(),
    tasks: sampleTasks(),
    'ui-prefs': sampleUiPreferences(),
  }
  const serverRows = new Map()
  const uploads = []
  const fetchImpl = async (url, options) => {
    if (options.method === 'GET') {
      return jsonResponse([...serverRows].map(([namespace, payload]) => ({
        namespace,
        payload,
        schema_version: 1,
        updated_at: new Date().toISOString(),
      })))
    }
    const rows = JSON.parse(options.body)
    uploads.push(rows)
    rows.forEach((row) => serverRows.set(row.namespace, row.payload))
    if (!changedDuringUpload) {
      changedDuringUpload = true
      localValues['ui-prefs'] = { ...localValues['ui-prefs'], sidebarCollapsed: !localValues['ui-prefs'].sidebarCollapsed }
      fakeWindow.dispatch('efficiency-state-change', { key: 'ui-prefs' })
    }
    return jsonResponse(null, 201)
  }
  const storage = createMemoryStorage({ [SUPABASE_SESSION_STORAGE_KEY]: JSON.stringify(session()) })
  const manager = createSupabaseSyncManager({
    config: { url: DEFAULT_SUPABASE_URL, publishableKey: 'sb-publishable' },
    fetchImpl,
    storage,
    getLocalState: (namespace) => localValues[namespace],
    canAutoSync: () => allowed,
    syncDelayMs: 0,
  })

  try {
    await manager.start()
    allowed = true
    await manager.syncNow()
    await new Promise((resolve) => setTimeout(resolve, 25))

    const uiUploads = uploads.flat().filter((row) => row.namespace === 'ui-prefs')
    assert.ok(uiUploads.length >= 2)
    assert.equal(uiUploads.at(-1).payload.sidebarCollapsed, localValues['ui-prefs'].sidebarCollapsed)
    assert.equal(manager.getStatus().phase, 'synced')
  } finally {
    manager.stop()
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('cancelPendingRequests aborts an active Supabase request', async () => {
  const storage = createMemoryStorage({ [SUPABASE_SESSION_STORAGE_KEY]: JSON.stringify(session()) })
  let capturedSignal
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    capturedSignal = options.signal
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
  const manager = createSupabaseSyncManager({
    config: { url: DEFAULT_SUPABASE_URL, publishableKey: 'sb-publishable' },
    fetchImpl,
    storage,
    getLocalState: localState,
  })

  const pending = manager.syncNow()
  await Promise.resolve()
  manager.cancelPendingRequests()
  await assert.rejects(pending, (error) => error?.name === 'AbortError')
  assert.equal(capturedSignal.aborted, true)
  assert.equal(manager.getStatus().message, '同步已取消')
})

test('migration enforces authenticated ownership and desktop CSP allows only the project origin', async () => {
  const migration = await readFile(new URL('../supabase/migrations/202609190001_user_app_state.sql', import.meta.url), 'utf8')
  const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
  assert.match(migration, /primary key \(user_id, namespace\)/i)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /to authenticated[\s\S]+\(select auth\.uid\(\)\) = user_id/i)
  assert.match(migration, /octet_length\(payload::text\) <= 1500000/i)
  assert.match(migration, /revoke all on table public\.user_app_state from anon/i)
  assert.match(tauriConfig.app.security.csp, /connect-src[^;]+https:\/\/mdptlabjdscjusfmdczm\.supabase\.co/)
})
