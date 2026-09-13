export const PRINT_SETTINGS_SCHEMA_VERSION = 1

export const PAPER_SIZES = Object.freeze({
  A4: Object.freeze({ id: 'A4', label: 'A4', widthMm: 210, heightMm: 297 }),
  A5: Object.freeze({ id: 'A5', label: 'A5', widthMm: 148, heightMm: 210 }),
  B4_JIS: Object.freeze({ id: 'B4_JIS', label: 'B4（JIS）', widthMm: 257, heightMm: 364 }),
  B5_JIS: Object.freeze({ id: 'B5_JIS', label: 'B5（JIS）', widthMm: 182, heightMm: 257 }),
})

export const DEFAULT_PRINT_SETTINGS = Object.freeze({
  paperSize: 'A4',
  orientation: 'auto',
  copies: 1,
  colorMode: 'color',
  pageRange: 'all',
  customRange: '',
  oddEven: 'all',
  reverse: false,
  printMode: 'page-size',
  nUp: 1,
  scaleMode: 'fit',
  customScale: 100,
  duplex: 'off',
  duplexEdge: 'long-edge',
  printerId: '',
  watermark: false,
  watermarkText: '',
  pageNumbers: false,
  header: false,
  cropMarks: false,
  splitPages: false,
})

const PAPER_KEYS = new Set(Object.keys(PAPER_SIZES))
const ORIENTATIONS = new Set(['auto', 'portrait', 'landscape'])
const COLOR_MODES = new Set(['color', 'grayscale'])
const PAGE_RANGES = new Set(['all', 'current', 'custom'])
const ODD_EVEN = new Set(['all', 'odd', 'even'])
const PRINT_MODES = new Set(['page-size', 'n-up', 'booklet'])
const N_UP_VALUES = new Set([1, 2, 4, 6, 9, 16])
const SCALE_MODES = new Set(['fit', 'actual', 'shrink', 'custom'])
const DUPLEX_VALUES = new Set(['off', 'long-edge', 'short-edge'])

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback
}

function safeString(value, maximum = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

export function normalizePrintSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    ...DEFAULT_PRINT_SETTINGS,
    paperSize: PAPER_KEYS.has(source.paperSize) ? source.paperSize : DEFAULT_PRINT_SETTINGS.paperSize,
    orientation: ORIENTATIONS.has(source.orientation) ? source.orientation : DEFAULT_PRINT_SETTINGS.orientation,
    copies: boundedInteger(source.copies, 1, 99, DEFAULT_PRINT_SETTINGS.copies),
    colorMode: COLOR_MODES.has(source.colorMode) ? source.colorMode : DEFAULT_PRINT_SETTINGS.colorMode,
    pageRange: PAGE_RANGES.has(source.pageRange) ? source.pageRange : DEFAULT_PRINT_SETTINGS.pageRange,
    customRange: safeString(source.customRange, 120),
    oddEven: ODD_EVEN.has(source.oddEven) ? source.oddEven : DEFAULT_PRINT_SETTINGS.oddEven,
    reverse: source.reverse === true,
    printMode: PRINT_MODES.has(source.printMode) ? source.printMode : DEFAULT_PRINT_SETTINGS.printMode,
    nUp: N_UP_VALUES.has(Number(source.nUp)) ? Number(source.nUp) : DEFAULT_PRINT_SETTINGS.nUp,
    scaleMode: SCALE_MODES.has(source.scaleMode) ? source.scaleMode : DEFAULT_PRINT_SETTINGS.scaleMode,
    customScale: boundedInteger(source.customScale, 25, 400, DEFAULT_PRINT_SETTINGS.customScale),
    duplex: DUPLEX_VALUES.has(source.duplex) ? source.duplex : DEFAULT_PRINT_SETTINGS.duplex,
    duplexEdge: source.duplexEdge === 'short-edge' ? 'short-edge' : DEFAULT_PRINT_SETTINGS.duplexEdge,
    printerId: safeString(source.printerId, 240),
    watermark: source.watermark === true,
    watermarkText: safeString(source.watermarkText, 120),
    pageNumbers: source.pageNumbers === true,
    header: source.header === true,
    cropMarks: source.cropMarks === true,
    splitPages: source.splitPages === true,
  }
}

export function loadPrintSettings(load = null) {
  if (typeof load !== 'function') return normalizePrintSettings(DEFAULT_PRINT_SETTINGS)
  return normalizePrintSettings(load('print-settings', DEFAULT_PRINT_SETTINGS))
}

export function savePrintSettings(settings, save = null) {
  if (typeof save !== 'function') return false
  return save('print-settings', normalizePrintSettings(settings))
}

export function getPaperSize(settingsOrId) {
  const id = typeof settingsOrId === 'string' ? settingsOrId : settingsOrId?.paperSize
  return PAPER_SIZES[PAPER_KEYS.has(id) ? id : DEFAULT_PRINT_SETTINGS.paperSize]
}

export function paperSizePoints(settingsOrId, orientation = 'auto') {
  const paper = getPaperSize(settingsOrId)
  const isLandscape = orientation === 'landscape'
  const widthMm = isLandscape ? paper.heightMm : paper.widthMm
  const heightMm = isLandscape ? paper.widthMm : paper.heightMm
  return { width: (widthMm / 25.4) * 72, height: (heightMm / 25.4) * 72, widthMm, heightMm }
}

export function buildPrintPageStyle(settings) {
  const normalized = normalizePrintSettings(settings)
  const paper = getPaperSize(normalized)
  const landscape = normalized.orientation === 'landscape'
  const width = landscape ? paper.heightMm : paper.widthMm
  const height = landscape ? paper.widthMm : paper.heightMm
  return `@page { size: ${width}mm ${height}mm; margin: 0; }`
}

function parseRangeToken(token, pageCount) {
  const [startText, endText = startText] = token.split('-')
  const start = Number(startText)
  const end = Number(endText)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > pageCount) {
    throw new Error(`页码超出范围，当前文件共 ${pageCount} 页`)
  }
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

export function parsePrintPageRange(value, pageCount, currentPage = 1) {
  const count = boundedInteger(pageCount, 1, 100000, 1)
  const current = boundedInteger(currentPage, 1, count, 1)
  const sourceValue = value && typeof value === 'object' ? value : null
  const mode = String(sourceValue?.pageRange || value || 'all')
  let pages
  if (mode === 'all') pages = Array.from({ length: count }, (_, index) => index + 1)
  else if (mode === 'current') pages = [current]
  else {
    const source = String(sourceValue?.customRange || (mode === 'custom' ? '' : mode)).replace(/\s/g, '')
    if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(source)) throw new Error('页码范围格式无效，请使用例如 1-2,4')
    pages = []
    for (const token of source.split(',')) {
      for (const page of parseRangeToken(token, count)) if (!pages.includes(page)) pages.push(page)
    }
  }
  return pages
}

export function resolvePrintPages(settings, pageCount, currentPage = 1) {
  const normalized = normalizePrintSettings(settings)
  let pages
  if (normalized.pageRange === 'custom') {
    const source = normalized.customRange.replace(/\s/g, '')
    if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(source)) throw new Error('页码范围格式无效，请使用例如 1-2,4')
    pages = []
    for (const token of source.split(',')) {
      for (const page of parseRangeToken(token, pageCount)) if (!pages.includes(page)) pages.push(page)
    }
  } else {
    pages = normalized.pageRange === 'current'
      ? [boundedInteger(currentPage, 1, Math.max(1, pageCount), 1)]
      : Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1)
  }
  if (normalized.oddEven === 'odd') pages = pages.filter((page) => page % 2 === 1)
  if (normalized.oddEven === 'even') pages = pages.filter((page) => page % 2 === 0)
  if (normalized.reverse) pages.reverse()
  return pages
}
