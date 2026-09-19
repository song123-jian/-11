const MEASUREMENT_UNITS = {
  mm: { label: '毫米', perInch: 25.4 },
  cm: { label: '厘米', perInch: 2.54 },
  in: { label: '英寸', perInch: 1 },
}

export function normalizeMeasurementDpi(value = 96) {
  const dpi = Number(value)
  if (!Number.isFinite(dpi) || dpi < 1 || dpi > 2400) {
    throw new Error('DPI 必须是 1-2400 之间的数字')
  }
  return Math.round(dpi * 100) / 100
}

export function normalizeMeasurementUnit(value = 'mm') {
  return Object.hasOwn(MEASUREMENT_UNITS, value) ? value : 'mm'
}

function normalizePixelDimension(value, label) {
  const dimension = Number(value)
  if (!Number.isFinite(dimension) || dimension <= 0) {
    throw new Error(`${label}必须是大于 0 的数字`)
  }
  return Math.round(dimension)
}

function gcd(a, b) {
  let left = Math.abs(a)
  let right = Math.abs(b)
  while (right) {
    const remainder = left % right
    left = right
    right = remainder
  }
  return left || 1
}

export function formatAspectRatio(width, height) {
  const normalizedWidth = normalizePixelDimension(width, '图片宽度')
  const normalizedHeight = normalizePixelDimension(height, '图片高度')
  const divisor = gcd(normalizedWidth, normalizedHeight)
  return `${normalizedWidth / divisor}:${normalizedHeight / divisor}`
}

export function formatMeasurementValue(value, maximumFractionDigits = 2) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })
}

export function calculateImageMeasurement({ width, height, fileSize = 0, dpi = 96, unit = 'mm' } = {}) {
  const widthPx = normalizePixelDimension(width, '图片宽度')
  const heightPx = normalizePixelDimension(height, '图片高度')
  const safeDpi = normalizeMeasurementDpi(dpi)
  const safeUnit = normalizeMeasurementUnit(unit)
  const unitDefinition = MEASUREMENT_UNITS[safeUnit]
  const size = Number(fileSize)
  const fileSizeBytes = Number.isFinite(size) && size >= 0 ? Math.round(size) : 0
  const physicalWidth = (widthPx / safeDpi) * unitDefinition.perInch
  const physicalHeight = (heightPx / safeDpi) * unitDefinition.perInch

  return {
    widthPx,
    heightPx,
    aspectRatio: formatAspectRatio(widthPx, heightPx),
    dpi: safeDpi,
    unit: safeUnit,
    unitLabel: unitDefinition.label,
    physicalWidth,
    physicalHeight,
    fileSizeBytes,
    fileSizeKb: fileSizeBytes / 1024,
  }
}

export const MEASUREMENT_UNITS_LIST = Object.entries(MEASUREMENT_UNITS).map(([value, definition]) => ({
  value,
  label: definition.label,
}))
