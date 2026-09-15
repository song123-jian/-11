function normalizeTool(definition) {
  if (!definition || typeof definition !== 'object') return null
  const id = typeof definition.id === 'string' ? definition.id.trim() : ''
  if (!id) return null
  return Object.freeze({
    ...definition,
    id,
    module: typeof definition.module === 'string' ? definition.module.trim() : 'home',
    label: typeof definition.label === 'string' && definition.label.trim() ? definition.label.trim() : id,
    description: typeof definition.description === 'string' ? definition.description.trim() : '',
    aliases: Array.isArray(definition.aliases) ? definition.aliases.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 16) : [],
  })
}

export function createToolRegistry(definitions = []) {
  const entries = new Map()
  const register = (definition) => {
    const normalized = normalizeTool(definition)
    if (!normalized || entries.has(normalized.id)) return false
    entries.set(normalized.id, normalized)
    return true
  }
  const registerMany = (items) => {
    let added = 0
    for (const item of Array.isArray(items) ? items : []) if (register(item)) added += 1
    return added
  }
  registerMany(definitions)
  return Object.freeze({
    register,
    registerMany,
    get: (id) => entries.get(id) || null,
    has: (id) => entries.has(id),
    list: () => [...entries.values()],
    ids: () => [...entries.keys()],
  })
}

export function filterRegisteredTools(registry, query = '', recentIds = []) {
  const tools = registry?.list?.() || []
  const normalized = String(query || '').trim().toLocaleLowerCase()
  if (!normalized) {
    const recent = []
    const seen = new Set()
    for (const id of Array.isArray(recentIds) ? recentIds : []) {
      const tool = registry.get(id)
      if (!tool || seen.has(tool.id)) continue
      seen.add(tool.id)
      recent.push(tool)
    }
    return [...recent, ...tools.filter((tool) => !seen.has(tool.id))]
  }
  return tools.filter((tool) => [tool.id, tool.label, tool.description, ...(tool.aliases || [])].join(' ').toLocaleLowerCase().includes(normalized))
}
