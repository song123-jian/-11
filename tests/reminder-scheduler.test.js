import assert from 'node:assert/strict'
import test from 'node:test'

const values = new Map()
const events = []
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  },
  dispatchEvent: (event) => {
    events.push(event)
    return true
  },
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.document = { addEventListener: () => {}, removeEventListener: () => {} }
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type
    this.detail = init.detail
  }
}

const { runReminderSchedulerNow, reminderTriggerAt } = await import('../src/services/reminderScheduler.js')
const { loadState, saveState } = await import('../src/services/storage.js')

test('reminder trigger time accounts for advance notification', () => {
  const timestamp = Date.parse('2026-09-18T10:00:00')
  assert.equal(reminderTriggerAt({ at: '2026-09-18T10:00:00', advanceMinutes: 10 }), timestamp - 600_000)
  assert.equal(reminderTriggerAt({ at: 'not-a-date' }), null)
})

test('due reminder is delivered once and persisted with delivery status', async () => {
  values.clear()
  events.length = 0
  saveState('assistant', {
    version: 1,
    todos: [],
    notes: [],
    focus: { profiles: [], sessions: [], activeProfileId: '', settings: {} },
    meetings: [],
    reminders: [{
      id: 'reminder-due',
      title: '检查诊断日志',
      at: '2026-09-18T09:00:00',
      notified: false,
      recurrence: { type: 'none', interval: 1, weekdays: [] },
    }],
  })

  const now = Date.parse('2026-09-18T10:00:00')
  const first = await runReminderSchedulerNow(now)
  const saved = loadState('assistant', null)
  assert.deepEqual(first.delivered, [{ id: 'reminder-due', mode: 'fallback' }])
  assert.equal(saved.reminders[0].notified, true)
  assert.equal(saved.reminders[0].deliveryStatus, 'fallback')
  assert.ok(events.some((event) => event.detail?.type === 'attempt'))

  const second = await runReminderSchedulerNow(now + 60_000)
  assert.deepEqual(second.delivered, [])
})

test('system fire mode can target one reminder without consuming its siblings', async () => {
  values.clear()
  events.length = 0
  saveState('assistant', {
    version: 1,
    todos: [],
    notes: [],
    focus: { profiles: [], sessions: [], activeProfileId: '', settings: {} },
    meetings: [],
    reminders: [
      { id: 'reminder-target', title: '目标提醒', at: '2026-09-18T09:00:00', notified: false, recurrence: { type: 'none', interval: 1, weekdays: [] } },
      { id: 'reminder-sibling', title: '同批提醒', at: '2026-09-18T09:00:00', notified: false, recurrence: { type: 'none', interval: 1, weekdays: [] } },
    ],
  })

  const now = Date.parse('2026-09-18T10:00:00')
  const result = await runReminderSchedulerNow(now, { onlyId: 'reminder-target' })
  const saved = loadState('assistant', null)
  assert.deepEqual(result.delivered, [{ id: 'reminder-target', mode: 'fallback' }])
  assert.equal(saved.reminders.find((item) => item.id === 'reminder-target').notified, true)
  assert.equal(saved.reminders.find((item) => item.id === 'reminder-sibling').notified, false)
})
