const MAX_TODOS = 300
const MAX_NOTES = 120
const MAX_REMINDERS = 300
const MAX_MEETINGS = 60
const MAX_SESSIONS = 2_000
const MAX_TEXT = 20_000
const MAX_TITLE = 200

export const ASSISTANT_SCHEMA_VERSION = 1

export const TODO_PRIORITIES = Object.freeze([
  { id: 'high', label: '高', color: 'red', weight: 0 },
  { id: 'medium', label: '中', color: 'amber', weight: 1 },
  { id: 'low', label: '低', color: 'blue', weight: 2 },
])

export const TODO_CATEGORIES = Object.freeze([
  { id: 'work', label: '工作' },
  { id: 'life', label: '生活' },
  { id: 'project-a', label: '项目 A' },
  { id: 'project-b', label: '项目 B' },
  { id: 'other', label: '其他' },
])

export const NOTE_CATEGORIES = Object.freeze([
  { id: 'idea', label: '灵感', color: 'yellow' },
  { id: 'memo', label: '备忘', color: 'blue' },
  { id: 'follow-up', label: '待跟进', color: 'red' },
])

export const REMINDER_CATEGORIES = Object.freeze([
  { id: 'work', label: '工作' },
  { id: 'life', label: '生活' },
  { id: 'meeting', label: '会议' },
  { id: 'other', label: '其他' },
])

export const REMINDER_RECURRENCES = Object.freeze([
  { id: 'none', label: '不重复' },
  { id: 'daily', label: '每天' },
  { id: 'weekly', label: '每周' },
  { id: 'monthly', label: '每月' },
  { id: 'weekdays', label: '工作日' },
  { id: 'custom', label: '自定义周期' },
])

export const DEFAULT_FOCUS_PROFILES = Object.freeze([
  { id: 'classic', name: '经典专注', workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 },
  { id: 'deep-work', name: '深度工作', workMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 30, longBreakEvery: 4 },
])

const TODO_PRIORITY_IDS = new Set(TODO_PRIORITIES.map((item) => item.id))
const TODO_CATEGORY_IDS = new Set(TODO_CATEGORIES.map((item) => item.id))
const NOTE_CATEGORY_IDS = new Set(NOTE_CATEGORIES.map((item) => item.id))
const REMINDER_CATEGORY_IDS = new Set(REMINDER_CATEGORIES.map((item) => item.id))
const RECURRENCE_IDS = new Set(REMINDER_RECURRENCES.map((item) => item.id))
const REMINDER_DELIVERY_STATUSES = new Set(['pending', 'delivered', 'fallback', 'failed'])

function boundedText(value, maximum = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function positiveId(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  if (normalized && normalized.length <= 80 && /^[a-zA-Z0-9_-]+$/.test(normalized)) return normalized
  return fallback
}

function integer(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(number)))
}

function validTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function normalizeDateTime(value) {
  const raw = boundedText(value, 40)
  if (!raw || validTimestamp(raw) === null) return ''
  return raw
}

function localDateTime(timestamp) {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\s]+/) : []
  const tags = []
  for (const item of source) {
    const tag = boundedText(item, 24).replace(/^#/, '')
    if (!tag || tags.includes(tag)) continue
    tags.push(tag)
    if (tags.length >= 8) break
  }
  return tags
}

function normalizeSubtasks(value) {
  if (!Array.isArray(value)) return []
  const ids = new Set()
  const result = []
  for (const item of value) {
    const id = positiveId(item?.id, `${Date.now()}-${result.length}`)
    const text = boundedText(item?.text, 160)
    if (!text || ids.has(id)) continue
    ids.add(id)
    result.push({ id, text, done: item?.done === true })
    if (result.length >= 30) break
  }
  return result
}

export function normalizeAssistantTodos(value, fallback = []) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : []
  const ids = new Set()
  const result = []
  source.forEach((item, index) => {
    const id = positiveId(item?.id, `${Date.now()}-${index}`)
    const text = boundedText(item?.text, 200)
    if (!id || !text || ids.has(id)) return
    ids.add(id)
    const priority = TODO_PRIORITY_IDS.has(item?.priority) ? item.priority : 'medium'
    const category = TODO_CATEGORY_IDS.has(item?.category) ? item.category : 'other'
    const dueAt = normalizeDateTime(item?.dueAt || item?.deadline)
    const createdAt = validTimestamp(item?.createdAt) ?? Date.now()
    result.push({
      id,
      text,
      done: item?.done === true,
      completedAt: validTimestamp(item?.completedAt) ?? null,
      priority,
      category,
      tags: normalizeTags(item?.tags),
      dueAt,
      subtasks: normalizeSubtasks(item?.subtasks),
      focusMinutes: integer(item?.focusMinutes, 0, 0, 100_000),
      order: integer(item?.order, index, 0, MAX_TODOS),
      createdAt,
      updatedAt: validTimestamp(item?.updatedAt) ?? createdAt,
    })
    if (result.length >= MAX_TODOS) return
  })
  return result
}

export function normalizeAssistantNotes(value, fallback = []) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : []
  const ids = new Set()
  const result = []
  source.forEach((item, index) => {
    const raw = typeof item === 'string' ? { content: item } : item
    const id = positiveId(raw?.id, `${Date.now()}-${index}`)
    const content = boundedText(raw?.content ?? raw?.text, MAX_TEXT)
    if (!id || (!content && !boundedText(raw?.title, MAX_TITLE)) || ids.has(id)) return
    ids.add(id)
    const category = NOTE_CATEGORY_IDS.has(raw?.category) ? raw.category : 'memo'
    const categoryMeta = NOTE_CATEGORIES.find((entry) => entry.id === category)
    const color = ['yellow', 'blue', 'red', 'green', 'purple'].includes(raw?.color) ? raw.color : categoryMeta?.color || 'blue'
    const createdAt = validTimestamp(raw?.createdAt) ?? Date.now()
    result.push({
      id,
      title: boundedText(raw?.title, MAX_TITLE),
      content,
      category,
      color,
      order: integer(raw?.order, index, 0, MAX_NOTES),
      createdAt,
      updatedAt: validTimestamp(raw?.updatedAt) ?? createdAt,
    })
    if (result.length >= MAX_NOTES) return
  })
  return result
}

function normalizeRecurrence(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const type = RECURRENCE_IDS.has(raw.type) ? raw.type : 'none'
  const weekdays = Array.isArray(raw.weekdays)
    ? [...new Set(raw.weekdays.map((item) => integer(item, -1, -1, 6)).filter((item) => item >= 0))].slice(0, 7)
    : []
  return {
    type,
    interval: integer(raw.interval, 1, 1, 31),
    weekdays,
  }
}

export function normalizeAssistantReminders(value, fallback = []) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : []
  const ids = new Set()
  const result = []
  source.forEach((item, index) => {
    const id = positiveId(item?.id, `${Date.now()}-${index}`)
    const title = boundedText(item?.title, 120)
    const at = normalizeDateTime(item?.at)
    if (!id || !title || !at || ids.has(id)) return
    ids.add(id)
    result.push({
      id,
      title,
      at,
      notified: item?.notified === true,
      lastNotifiedAt: validTimestamp(item?.lastNotifiedAt) ?? null,
      lastAttemptAt: validTimestamp(item?.lastAttemptAt) ?? null,
      retryAfterAt: validTimestamp(item?.retryAfterAt) ?? null,
      deliveryStatus: REMINDER_DELIVERY_STATUSES.has(item?.deliveryStatus)
        ? item.deliveryStatus
        : item?.notified === true ? 'delivered' : 'pending',
      category: REMINDER_CATEGORY_IDS.has(item?.category) ? item.category : 'other',
      starred: item?.starred === true,
      advanceMinutes: [0, 10, 60, 1_440].includes(Number(item?.advanceMinutes)) ? Number(item.advanceMinutes) : 0,
      recurrence: normalizeRecurrence(item?.recurrence),
      linkedTodoId: positiveId(item?.linkedTodoId),
      order: integer(item?.order, index, 0, MAX_REMINDERS),
      createdAt: validTimestamp(item?.createdAt) ?? Date.now(),
    })
    if (result.length >= MAX_REMINDERS) return
  })
  return result
}

function normalizeProfiles(value) {
  const source = Array.isArray(value) ? value : DEFAULT_FOCUS_PROFILES
  const ids = new Set()
  const profiles = []
  source.forEach((item, index) => {
    const id = positiveId(item?.id, `profile-${index}`)
    const name = boundedText(item?.name, 40)
    if (!id || !name || ids.has(id)) return
    ids.add(id)
    profiles.push({
      id,
      name,
      workMinutes: integer(item?.workMinutes, 25, 1, 180),
      shortBreakMinutes: integer(item?.shortBreakMinutes, 5, 1, 60),
      longBreakMinutes: integer(item?.longBreakMinutes, 15, 1, 120),
      longBreakEvery: integer(item?.longBreakEvery, 4, 1, 12),
    })
  })
  return profiles.length ? profiles.slice(0, 20) : DEFAULT_FOCUS_PROFILES.map((item) => ({ ...item }))
}

function normalizeSessions(value) {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const startedAt = validTimestamp(item?.startedAt)
    const endedAt = validTimestamp(item?.endedAt)
    const durationMinutes = integer(item?.durationMinutes, 0, 0, 1_440)
    if (startedAt === null || durationMinutes <= 0) return null
    return {
      id: positiveId(item?.id, `${startedAt}-${index}`),
      startedAt,
      endedAt: endedAt || startedAt + durationMinutes * 60_000,
      durationMinutes,
      type: ['work', 'short', 'long'].includes(item?.type) ? item.type : 'work',
      todoId: positiveId(item?.todoId),
      completed: item?.completed !== false,
    }
  }).filter(Boolean).slice(-MAX_SESSIONS)
}

export function normalizeFocusState(value) {
  const source = value && typeof value === 'object' ? value : {}
  const profiles = normalizeProfiles(source.profiles)
  const activeProfileId = profiles.some((item) => item.id === source.activeProfileId) ? source.activeProfileId : profiles[0].id
  return {
    profiles,
    activeProfileId,
    sessions: normalizeSessions(source.sessions),
    settings: {
      autoCycle: source.settings?.autoCycle !== false,
      whiteNoise: source.settings?.whiteNoise === true,
      noiseType: ['rain', 'cafe'].includes(source.settings?.noiseType) ? source.settings.noiseType : 'rain',
    },
  }
}

export function normalizeMeetings(value) {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const id = positiveId(item?.id, `${Date.now()}-${index}`)
    const title = boundedText(item?.title, MAX_TITLE)
    if (!id || !title) return null
    return {
      id,
      title,
      attendees: boundedText(item?.attendees, 500),
      date: normalizeDateTime(item?.date) || localDateTime(Date.now()),
      keyPoints: boundedText(item?.keyPoints, 8_000),
      actions: boundedText(item?.actions, 8_000),
      createdAt: validTimestamp(item?.createdAt) ?? Date.now(),
    }
  }).filter(Boolean).slice(-MAX_MEETINGS)
}

export function normalizeAssistantState(value, legacy = {}) {
  const source = value && typeof value === 'object' && value.version === ASSISTANT_SCHEMA_VERSION ? value : {}
  const legacyTodos = Array.isArray(legacy.todos) ? legacy.todos.map((item, index) => ({ ...item, id: String(item?.id ?? index + 1) })) : []
  const legacyNotes = legacy.note ? [{ id: 'legacy-note', title: '快速便签', content: legacy.note, category: 'memo', color: 'blue' }] : []
  return {
    version: ASSISTANT_SCHEMA_VERSION,
    todos: normalizeAssistantTodos(source.todos ?? legacyTodos),
    notes: normalizeAssistantNotes(source.notes ?? legacyNotes),
    reminders: normalizeAssistantReminders(source.reminders ?? legacy.reminders),
    focus: normalizeFocusState(source.focus),
    meetings: normalizeMeetings(source.meetings),
  }
}

export function priorityWeight(priority) {
  return TODO_PRIORITIES.find((item) => item.id === priority)?.weight ?? 1
}

export function isTodoOverdue(todo, now = Date.now()) {
  return !todo?.done && Boolean(todo?.dueAt) && (validTimestamp(todo.dueAt) ?? Number.POSITIVE_INFINITY) < Number(now)
}

export function sortTodos(items, mode = 'smart', now = Date.now()) {
  const source = Array.isArray(items) ? items : []
  return [...source].sort((left, right) => {
    if (mode === 'manual') return (left.order ?? 0) - (right.order ?? 0)
    if (left.done !== right.done) return left.done ? 1 : -1
    const leftOverdue = isTodoOverdue(left, now)
    const rightOverdue = isTodoOverdue(right, now)
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1
    if (mode === 'priority' || mode === 'smart') {
      const priorityDelta = priorityWeight(left.priority) - priorityWeight(right.priority)
      if (priorityDelta) return priorityDelta
    }
    if (mode === 'due' || mode === 'smart') {
      const leftDue = validTimestamp(left.dueAt) ?? Number.POSITIVE_INFINITY
      const rightDue = validTimestamp(right.dueAt) ?? Number.POSITIVE_INFINITY
      if (leftDue !== rightDue) return leftDue - rightDue
    }
    return (left.order ?? 0) - (right.order ?? 0) || (right.createdAt ?? 0) - (left.createdAt ?? 0)
  })
}

export function filterTodos(items, options = {}, now = Date.now()) {
  const query = boundedText(options.query).toLocaleLowerCase()
  const priority = TODO_PRIORITY_IDS.has(options.priority) ? options.priority : 'all'
  const category = TODO_CATEGORY_IDS.has(options.category) ? options.category : 'all'
  return sortTodos(items, options.sort || 'smart', now).filter((todo) => {
    if (options.showCompleted === false && todo.done) return false
    if (priority !== 'all' && todo.priority !== priority) return false
    if (category !== 'all' && todo.category !== category) return false
    if (query && !`${todo.text} ${todo.tags.join(' ')}`.toLocaleLowerCase().includes(query)) return false
    return true
  })
}

function startOfDay(timestamp) {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function startOfWeek(timestamp) {
  const date = new Date(startOfDay(timestamp))
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return date.getTime()
}

function startOfMonth(timestamp) {
  const date = new Date(timestamp)
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function dateKey(value) {
  const timestamp = validTimestamp(value)
  if (timestamp === null) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function buildFocusStats(sessions, now = Date.now()) {
  const source = Array.isArray(sessions) ? sessions.filter((session) => session?.completed !== false) : []
  const todayStart = startOfDay(now)
  const weekStart = startOfWeek(now)
  const monthStart = startOfMonth(now)
  const inRange = (session, start) => session.startedAt >= start && session.startedAt <= now
  const sum = (list) => list.reduce((total, session) => total + Number(session.durationMinutes || 0), 0)
  const today = source.filter((session) => inRange(session, todayStart))
  const week = source.filter((session) => inRange(session, weekStart))
  const month = source.filter((session) => inRange(session, monthStart))
  const trend = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const dayStart = todayStart - offset * 86_400_000
    const dayEnd = dayStart + 86_400_000
    const daySessions = source.filter((session) => session.startedAt >= dayStart && session.startedAt < dayEnd)
    trend.push({ key: dateKey(dayStart), label: new Date(dayStart).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }), minutes: sum(daySessions), pomodoros: daySessions.length })
  }
  const byTodo = {}
  for (const session of source) {
    if (!session.todoId) continue
    byTodo[session.todoId] = (byTodo[session.todoId] || 0) + Number(session.durationMinutes || 0)
  }
  return {
    todayMinutes: sum(today),
    weekMinutes: sum(week),
    monthMinutes: sum(month),
    todayPomodoros: today.length,
    weekPomodoros: week.length,
    monthPomodoros: month.length,
    trend,
    byTodo,
  }
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function nextReminderOccurrence(reminder, from = Date.now()) {
  const initialTimestamp = validTimestamp(reminder?.at)
  if (initialTimestamp === null) return null
  const recurrence = normalizeRecurrence(reminder?.recurrence)
  if (recurrence.type === 'none') return null
  const initial = new Date(initialTimestamp)
  const fromDate = new Date(from)
  let cursor = new Date(initial)
  const interval = recurrence.interval
  if (recurrence.type === 'daily' || recurrence.type === 'custom') {
    while (cursor.getTime() <= fromDate.getTime()) cursor = addDays(cursor, interval)
    return cursor.getTime()
  }
  if (recurrence.type === 'weekdays') {
    while (cursor.getTime() <= fromDate.getTime() || cursor.getDay() === 0 || cursor.getDay() === 6) cursor = addDays(cursor, 1)
    return cursor.getTime()
  }
  if (recurrence.type === 'weekly') {
    const weekdays = recurrence.weekdays.length ? recurrence.weekdays : [initial.getDay()]
    const anchorWeek = startOfWeek(initial)
    for (let offset = 1; offset <= 370; offset += 1) {
      const candidate = addDays(initial, offset)
      if (!weekdays.includes(candidate.getDay()) || candidate.getTime() <= fromDate.getTime()) continue
      const weeks = Math.floor((startOfWeek(candidate) - anchorWeek) / (7 * 86_400_000))
      if (weeks % interval === 0) return candidate.getTime()
    }
    return null
  }
  if (recurrence.type === 'monthly') {
    const day = initial.getDate()
    const candidate = new Date(initial)
    do {
      candidate.setMonth(candidate.getMonth() + interval, 1)
      const lastDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate()
      candidate.setDate(Math.min(day, lastDay))
    } while (candidate.getTime() <= fromDate.getTime())
    return candidate.getTime()
  }
  return null
}

export function reminderRecurrenceLabel(reminder) {
  const recurrence = normalizeRecurrence(reminder?.recurrence)
  const base = REMINDER_RECURRENCES.find((item) => item.id === recurrence.type)?.label || '不重复'
  if (recurrence.type === 'custom') return `每 ${recurrence.interval} 天`
  if (recurrence.type === 'weekly' && recurrence.weekdays.length) return `${base}（${recurrence.weekdays.map((day) => ['日', '一', '二', '三', '四', '五', '六'][day]).join('、')}）`
  return recurrence.interval > 1 ? `${base}（每 ${recurrence.interval} 个周期）` : base
}

export function formatDuration(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0))
  if (value < 60) return `${value} 分钟`
  const hours = Math.floor(value / 60)
  const remainder = value % 60
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`
}

function csvEscape(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportTodosCsv(todos) {
  const rows = [
    ['id', 'text', 'done', 'priority', 'category', 'tags', 'dueAt', 'focusMinutes'],
    ...(Array.isArray(todos) ? todos : []).map((todo) => [todo.id, todo.text, todo.done ? 'true' : 'false', todo.priority, todo.category, todo.tags.join(' '), todo.dueAt, todo.focusMinutes]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}`
}

export function localDateTimeValue(value, fallback = Date.now()) {
  const timestamp = validTimestamp(value)
  return localDateTime(timestamp ?? fallback)
}
