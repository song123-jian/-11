const DEFAULT_MAX_ENTRIES = 30

function safeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 80) : fallback
}

export function normalizeNavigationSnapshot(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const module = safeText(source.module, 'home') || 'home'
  return Object.freeze({
    module,
    tool: module === 'home' ? '' : safeText(source.tool),
    assistantTab: module === 'assistant' ? (safeText(source.assistantTab, 'overview') || 'overview') : '',
    docMode: module === 'docs' ? safeText(source.docMode) : '',
  })
}

export function sameNavigationSnapshot(left, right) {
  const a = normalizeNavigationSnapshot(left)
  const b = normalizeNavigationSnapshot(right)
  return a.module === b.module
    && a.tool === b.tool
    && a.assistantTab === b.assistantTab
    && a.docMode === b.docMode
}

export function createNavigationHistory(initialSnapshot, maxEntries = DEFAULT_MAX_ENTRIES) {
  const limit = Number.isSafeInteger(maxEntries) && maxEntries > 0 ? maxEntries : DEFAULT_MAX_ENTRIES
  let current = normalizeNavigationSnapshot(initialSnapshot)
  const past = []

  function commit(nextSnapshot) {
    const next = normalizeNavigationSnapshot(nextSnapshot)
    if (sameNavigationSnapshot(current, next)) return false
    past.push(current)
    if (past.length > limit) past.shift()
    current = next
    return true
  }

  function peekBack() {
    return past.length ? past[past.length - 1] : null
  }

  function back() {
    if (!past.length) return null
    current = past.pop()
    return current
  }

  return Object.freeze({
    commit,
    peekBack,
    back,
    canGoBack: () => past.length > 0,
    current: () => current,
    size: () => past.length,
    clear: () => { past.length = 0 },
  })
}
