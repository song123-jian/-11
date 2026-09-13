function normalizedCount(count) {
  return Number.isInteger(count) && count > 0 ? count : 0
}

export function normalizeSearchIndex(index, count) {
  const safeCount = normalizedCount(count)
  if (!safeCount) return -1
  return Number.isInteger(index) && index >= 0 && index < safeCount ? index : 0
}

export function stepSearchIndex(index, count, direction) {
  const safeCount = normalizedCount(count)
  if (!safeCount) return -1
  const current = Number.isInteger(index) && index >= 0 && index < safeCount ? index : null
  if (current === null) return direction < 0 ? safeCount - 1 : 0
  const delta = direction < 0 ? -1 : 1
  return (current + delta + safeCount) % safeCount
}

export function filterSearchTools(tools, query, recentToolIds = [], aliases = {}) {
  const safeTools = Array.isArray(tools) ? tools : []
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase()
  if (!normalizedQuery) {
    const byId = new Map(safeTools.map((tool) => [tool.id, tool]))
    const recent = []
    const seenIds = new Set()
    for (const id of Array.isArray(recentToolIds) ? recentToolIds : []) {
      const tool = byId.get(id)
      if (!tool || seenIds.has(tool.id)) continue
      seenIds.add(tool.id)
      recent.push(tool)
    }
    const fallback = safeTools.filter((tool) => !recent.some((item) => item.id === tool.id))
    return [...recent, ...fallback].slice(0, 6)
  }
  return safeTools.filter((tool) => {
    const searchable = [tool.label, tool.description, tool.level, tool.id, ...(aliases[tool.id] || [])]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
    return searchable.includes(normalizedQuery)
  })
}
