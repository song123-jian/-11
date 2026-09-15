export const DEFAULT_UI_PREFS = Object.freeze({
  sidebarCollapsed: false,
  density: 'comfortable',
  lastTool: '',
  taskPanelPinned: false,
})

const DENSITIES = new Set(['comfortable', 'compact'])

function allowedToolId(value, allowedToolIds) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id) return ''
  return Array.isArray(allowedToolIds) && allowedToolIds.length
    ? (allowedToolIds.includes(id) ? id : '')
    : id.slice(0, 80)
}

export function normalizeUiPrefs(value, allowedToolIds = [], fallback = DEFAULT_UI_PREFS) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const safeFallback = fallback && typeof fallback === 'object' ? fallback : DEFAULT_UI_PREFS
  const density = DENSITIES.has(source.density) ? source.density : (DENSITIES.has(safeFallback.density) ? safeFallback.density : DEFAULT_UI_PREFS.density)
  const fallbackLastTool = allowedToolId(safeFallback.lastTool, allowedToolIds)
  const lastTool = allowedToolId(source.lastTool, allowedToolIds) || fallbackLastTool
  return {
    sidebarCollapsed: source.sidebarCollapsed === true ? true : source.sidebarCollapsed === false ? false : safeFallback.sidebarCollapsed === true,
    density,
    lastTool,
    taskPanelPinned: source.taskPanelPinned === true ? true : source.taskPanelPinned === false ? false : safeFallback.taskPanelPinned === true,
  }
}

export function normalizeDensity(value) {
  return DENSITIES.has(value) ? value : DEFAULT_UI_PREFS.density
}
