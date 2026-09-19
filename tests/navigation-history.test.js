import assert from 'node:assert/strict'
import test from 'node:test'
import { createNavigationHistory, normalizeNavigationSnapshot, sameNavigationSnapshot } from '../src/services/navigationHistory.js'

const home = { module: 'home', tool: 'pdf-merge', assistantTab: 'overview', docMode: 'pdf-merge' }
const network = { module: 'network', tool: 'barcode' }
const assistantTodos = { module: 'assistant', tool: 'todo', assistantTab: 'todos' }
const assistantFocus = { module: 'assistant', tool: 'pomodoro', assistantTab: 'focus' }

test('navigation snapshots normalize irrelevant state by module', () => {
  assert.deepEqual(normalizeNavigationSnapshot(home), {
    module: 'home',
    tool: '',
    assistantTab: '',
    docMode: '',
  })
  assert.equal(sameNavigationSnapshot(home, { module: 'home' }), true)
  assert.equal(sameNavigationSnapshot(network, { module: 'network', tool: 'barcode', assistantTab: 'focus' }), true)
})

test('navigation history commits distinct states and returns in reverse order', () => {
  const history = createNavigationHistory(home)
  assert.equal(history.canGoBack(), false)
  assert.equal(history.commit(network), true)
  assert.equal(history.commit(assistantTodos), true)
  assert.equal(history.commit(assistantFocus), true)
  assert.equal(history.size(), 3)
  assert.deepEqual(history.peekBack(), normalizeNavigationSnapshot(assistantTodos))
  assert.deepEqual(history.back(), normalizeNavigationSnapshot(assistantTodos))
  assert.deepEqual(history.back(), normalizeNavigationSnapshot(network))
  assert.deepEqual(history.back(), normalizeNavigationSnapshot(home))
  assert.equal(history.back(), null)
  assert.equal(history.canGoBack(), false)
})

test('repeated state does not add duplicate history entries and new navigation drops forward state', () => {
  const history = createNavigationHistory(home, 3)
  assert.equal(history.commit(network), true)
  assert.equal(history.commit(network), false)
  assert.equal(history.size(), 1)
  assert.deepEqual(history.back(), normalizeNavigationSnapshot(home))
  assert.equal(history.commit(assistantTodos), true)
  assert.deepEqual(history.back(), normalizeNavigationSnapshot(home))
  assert.equal(history.size(), 0)
})

test('history keeps only the configured number of previous states', () => {
  const history = createNavigationHistory(home, 2)
  history.commit({ module: 'docs', tool: 'pdf-merge', docMode: 'pdf-merge' })
  history.commit(network)
  history.commit(assistantTodos)
  assert.equal(history.size(), 2)
  assert.deepEqual(history.back(), normalizeNavigationSnapshot(network))
  assert.deepEqual(history.back(), { module: 'docs', tool: 'pdf-merge', assistantTab: '', docMode: 'pdf-merge' })
  assert.equal(history.back(), null)
})
