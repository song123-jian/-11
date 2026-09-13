import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MIN_POWER_DELAY_SECONDS,
  formatPowerDuration,
  normalizePowerScheduleStatus,
  parseLocalDateTime,
  validatePowerSchedule,
} from '../src/services/shutdownScheduler.js'

test('power schedule accepts fixed actions and enforces the safety buffer', () => {
  const now = Date.parse('2026-09-13T12:00:00')
  const schedule = validatePowerSchedule({
    mode: 'countdown',
    action: 'restart',
    countdownSeconds: MIN_POWER_DELAY_SECONDS,
    now,
  })
  assert.equal(schedule.action, 'restart')
  assert.equal(schedule.executeAtMs, now + MIN_POWER_DELAY_SECONDS * 1000)
  assert.throws(() => validatePowerSchedule({ mode: 'countdown', action: 'shutdown', countdownSeconds: 29, now }), /至少需要 30 秒/)
  assert.throws(() => validatePowerSchedule({ mode: 'countdown', action: 'shutdown', countdownSeconds: 30.5, now }), /整数秒/)
  assert.throws(() => validatePowerSchedule({ mode: 'countdown', action: 'shutdown', countdownSeconds: -1, now }), /至少需要 30 秒/)
  assert.throws(() => validatePowerSchedule({ mode: 'countdown', action: 'powershell', countdownSeconds: 60, now }), /有效的系统动作/)
})

test('point-in-time schedules reject invalid or stale local dates', () => {
  const now = Date.parse('2026-09-13T12:00:00')
  assert.equal(parseLocalDateTime('2026-09-13T12:30:00'), Date.parse('2026-09-13T12:30:00'))
  assert.equal(parseLocalDateTime('2026-02-30T12:00'), null)
  assert.throws(() => validatePowerSchedule({ mode: 'at-time', action: 'hibernate', targetAt: '2026-09-13T12:00', now }), /至少应晚于当前时间/)
  assert.throws(() => validatePowerSchedule({ mode: 'at-time', action: 'hibernate', targetAt: 'bad', now }), /有效的定点时间/)
  assert.throws(() => validatePowerSchedule({ mode: 'at-time', action: 'hibernate', targetAt: '2026-10-20T12:00', now }), /不能超过 31 天/)
})

test('power schedule status is normalized and terminal states are inactive', () => {
  assert.deepEqual(normalizePowerScheduleStatus({
    active: true,
    requestId: 'power-abc',
    action: 'shutdown',
    executeAtMs: '1234.4',
    status: 'scheduled',
  }), {
    active: true,
    requestId: 'power-abc',
    action: 'shutdown',
    executeAtMs: 1234,
    status: 'scheduled',
    error: null,
  })
  assert.equal(normalizePowerScheduleStatus({ status: 'executed', active: true }).active, false)
  assert.equal(normalizePowerScheduleStatus({ status: 'unknown', action: 'powershell' }).status, 'idle')
})

test('power duration formatting remains stable for long and short waits', () => {
  assert.equal(formatPowerDuration(0), '00:00:00')
  assert.equal(formatPowerDuration(61_001), '00:01:02')
  assert.equal(formatPowerDuration((2 * 86_400 + 3 * 3_600 + 4 * 60 + 5) * 1000), '2 天 03:04:05')
})
