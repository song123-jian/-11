const MAX_RECENT_TOOLS = 6
const MAX_TODOS = 200
const MAX_TODO_LENGTH = 200
const MAX_NOTE_LENGTH = 20_000
const MAX_REMINDERS = 200
const MAX_REMINDER_LENGTH = 120

function positiveInteger(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light'
}

export function normalizeRecentTools(value, allowedIds, fallback = []) {
  const allowed = new Set(Array.isArray(allowedIds) ? allowedIds : [])
  const source = Array.isArray(value) ? value : fallback
  const result = []
  for (const id of source) {
    if (typeof id !== 'string' || !allowed.has(id) || result.includes(id)) continue
    result.push(id)
    if (result.length === MAX_RECENT_TOOLS) break
  }
  return result
}

export function normalizeTodos(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback
  const result = []
  const ids = new Set()
  for (const item of source) {
    const id = positiveInteger(item?.id)
    const text = typeof item?.text === 'string' ? item.text.trim().slice(0, MAX_TODO_LENGTH) : ''
    if (!id || !text || ids.has(id)) continue
    ids.add(id)
    result.push({ id, text, done: item.done === true })
    if (result.length === MAX_TODOS) break
  }
  return result
}

export function normalizeQuickNote(value) {
  return typeof value === 'string' ? value.slice(0, MAX_NOTE_LENGTH) : ''
}

export function normalizeReminders(value) {
  const source = Array.isArray(value) ? value : []
  const result = []
  const ids = new Set()
  for (const item of source) {
    const id = positiveInteger(item?.id)
    const title = typeof item?.title === 'string' ? item.title.trim().slice(0, MAX_REMINDER_LENGTH) : ''
    const at = typeof item?.at === 'string' ? item.at : ''
    if (!id || !title || at.length > 40 || !Number.isFinite(new Date(at).getTime()) || ids.has(id)) continue
    ids.add(id)
    result.push({ id, title, at, notified: item.notified === true })
    if (result.length === MAX_REMINDERS) break
  }
  return result
}
