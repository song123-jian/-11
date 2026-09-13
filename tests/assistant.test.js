import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFocusStats,
  exportTodosCsv,
  nextReminderOccurrence,
  normalizeAssistantState,
  normalizeFocusState,
  normalizeAssistantTodos,
  sortTodos,
} from '../src/services/assistantTools.js'

test('assistant state migrates legacy todos, notes, and reminders into the versioned shape', () => {
  const state = normalizeAssistantState(null, {
    todos: [{ id: 7, text: '  迁移待办  ', done: true }],
    note: '旧便签内容',
    reminders: [{ id: 8, title: '旧提醒', at: '2099-01-01T09:00' }],
  })

  assert.equal(state.version, 1)
  assert.deepEqual(state.todos.map(({ id, text, done }) => ({ id, text, done })), [{ id: '7', text: '迁移待办', done: true }])
  assert.deepEqual(state.notes.map(({ title, content, category }) => ({ title, content, category })), [{ title: '快速便签', content: '旧便签内容', category: 'memo' }])
  assert.equal(state.reminders[0].title, '旧提醒')
  assert.equal(state.focus.profiles.length, 2)
})

test('assistant todo normalization strips unknown fields and smart sorting prioritizes overdue work', () => {
  const now = Date.parse('2026-09-13T12:00:00')
  const todos = normalizeAssistantTodos([
    { id: 'overdue', text: '逾期低优先级', priority: 'low', dueAt: '2026-09-12T10:00', apiKey: 'must-remove' },
    { id: 'urgent', text: '未来高优先级', priority: 'high', dueAt: '2026-09-14T10:00' },
    { id: 'done', text: '已完成', priority: 'high', dueAt: '2026-09-01T10:00', done: true },
  ])
  assert.equal('apiKey' in todos[0], false)
  assert.deepEqual(sortTodos(todos, 'smart', now).map((todo) => todo.id), ['overdue', 'urgent', 'done'])
})

test('recurring reminders calculate the next daily, weekly, weekday, and monthly occurrence', () => {
  const from = Date.parse('2026-09-13T12:00:00')
  assert.equal(
    nextReminderOccurrence({ at: '2026-09-13T09:00', recurrence: { type: 'daily', interval: 1 } }, from),
    Date.parse('2026-09-14T09:00'),
  )
  assert.equal(
    nextReminderOccurrence({ at: '2026-09-14T09:00', recurrence: { type: 'weekly', interval: 1, weekdays: [1, 3, 5] } }, from),
    Date.parse('2026-09-16T09:00'),
  )
  assert.equal(
    nextReminderOccurrence({ at: '2026-09-12T09:00', recurrence: { type: 'weekdays' } }, from),
    Date.parse('2026-09-14T09:00'),
  )
  assert.equal(
    nextReminderOccurrence({ at: '2026-01-31T09:00', recurrence: { type: 'monthly', interval: 1 } }, Date.parse('2026-01-31T12:00')),
    Date.parse('2026-02-28T09:00'),
  )
})

test('focus statistics aggregate periods, seven-day trend, and per-todo minutes', () => {
  const now = Date.parse('2026-09-13T12:00:00')
  const sessions = [
    { id: 'today-a', startedAt: Date.parse('2026-09-13T09:00:00'), durationMinutes: 25, todoId: 'todo-a', completed: true },
    { id: 'today-b', startedAt: Date.parse('2026-09-13T10:00:00'), durationMinutes: 50, todoId: 'todo-a', completed: true },
    { id: 'week', startedAt: Date.parse('2026-09-10T09:00:00'), durationMinutes: 30, todoId: 'todo-b', completed: true },
    { id: 'old', startedAt: Date.parse('2026-08-01T09:00:00'), durationMinutes: 99, completed: true },
    { id: 'incomplete', startedAt: Date.parse('2026-09-13T11:00:00'), durationMinutes: 60, completed: false },
  ]
  const stats = buildFocusStats(sessions, now)
  assert.equal(stats.todayMinutes, 75)
  assert.equal(stats.weekMinutes, 105)
  assert.equal(stats.monthMinutes, 105)
  assert.equal(stats.todayPomodoros, 2)
  assert.equal(stats.weekPomodoros, 3)
  assert.equal(stats.byTodo['todo-a'], 75)
  assert.equal(stats.byTodo['todo-b'], 30)
  assert.equal(stats.trend.length, 7)
  assert.equal(stats.trend.at(-1).minutes, 75)
})

test('todo CSV export preserves the UTF-8 marker and escapes commas, quotes, and newlines', () => {
  const csv = exportTodosCsv([
    { id: '1', text: '整理, "报告"', done: false, priority: 'high', category: 'work', tags: ['本周'], dueAt: '', focusMinutes: 5 },
    { id: '2', text: '第二行\n待办', done: true, priority: 'low', category: 'life', tags: [], dueAt: '2099-01-01T09:00', focusMinutes: 0 },
  ])
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(csv, /"整理, ""报告"""/)
  assert.match(csv, /"第二行\n待办"/)
  assert.match(csv, /high,work,本周,,5/)
})

test('focus normalization keeps an epoch-start session instead of treating timestamp zero as missing', () => {
  const focus = normalizeFocusState({
    sessions: [{ id: 'epoch', startedAt: 0, endedAt: 60_000, durationMinutes: 1 }],
  })
  assert.equal(focus.sessions.length, 1)
  assert.equal(focus.sessions[0].startedAt, 0)
})
