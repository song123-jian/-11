import assert from 'node:assert/strict'
import test from 'node:test'
import { formatNetworkConnectionLabel, networkConnectionPresentation } from '../src/services/networkStatus.js'

test('network connection presentation follows the browser online state', () => {
  assert.deepEqual(networkConnectionPresentation(true), { label: '在线', className: 'available' })
  assert.deepEqual(networkConnectionPresentation(false), { label: '离线', className: 'offline' })
  assert.equal(formatNetworkConnectionLabel(true), '在线')
  assert.equal(formatNetworkConnectionLabel(false), '离线')
  assert.equal(formatNetworkConnectionLabel(true, 2), '在线 · 2 个任务进行中')
  assert.equal(formatNetworkConnectionLabel(false, 1), '离线 · 1 个任务进行中')
})
