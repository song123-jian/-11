export const BARCODE_FORMATS = Object.freeze({
  code128: Object.freeze({
    id: 'code128',
    label: 'Code 128',
    engineFormat: 'CODE128',
    hint: '适合文本、编号和物流单号',
  }),
  ean13: Object.freeze({
    id: 'ean13',
    label: 'EAN-13',
    engineFormat: 'EAN13',
    hint: '仅支持 12 或 13 位数字',
  }),
})

const MAX_BARCODE_LENGTH = 512
const HEX_COLOR = /^#[0-9a-f]{6}$/i

function normalizeFormat(format) {
  const value = String(format || '').trim().toLowerCase()
  if (!Object.hasOwn(BARCODE_FORMATS, value)) throw new Error('暂不支持该条形码格式')
  return value
}

function normalizeColor(value, fallback) {
  const color = String(value || '').trim()
  return HEX_COLOR.test(color) ? color : fallback
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

export function calculateEan13CheckDigit(value) {
  const digits = String(value ?? '').replace(/[\s-]/g, '')
  if (!/^\d{12}$/.test(digits)) throw new Error('EAN-13 校验位需要前 12 位数字')
  let sum = 0
  for (let index = 0; index < digits.length; index += 1) {
    sum += Number(digits[index]) * (index % 2 === 0 ? 1 : 3)
  }
  return (10 - (sum % 10)) % 10
}

export function normalizeBarcodeValue(input, format = 'code128') {
  const normalizedFormat = normalizeFormat(format)
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('请输入条形码内容')
  if (raw.length > MAX_BARCODE_LENGTH) throw new Error(`条形码内容不能超过 ${MAX_BARCODE_LENGTH} 个字符`)

  if (normalizedFormat === 'ean13') {
    const digits = raw.replace(/[\s-]/g, '')
    if (!/^\d{12,13}$/.test(digits)) throw new Error('EAN-13 仅支持 12 或 13 位数字')
    const body = digits.slice(0, 12)
    const checkDigit = calculateEan13CheckDigit(body)
    if (digits.length === 13 && Number(digits[12]) !== checkDigit) {
      throw new Error(`EAN-13 校验位错误，应为 ${checkDigit}`)
    }
    return {
      format: normalizedFormat,
      value: `${body}${checkDigit}`,
      autoCheckDigit: digits.length === 12,
    }
  }

  // Code 128 B is predictable across browsers when restricted to printable ASCII.
  if ([...raw].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) > 126)) {
    throw new Error('Code 128 当前仅支持可打印 ASCII 字符')
  }
  return { format: normalizedFormat, value: raw, autoCheckDigit: false }
}

export function normalizeBarcodeOptions(options = {}) {
  return {
    width: clampNumber(options.width, 1, 4, 2),
    height: clampNumber(options.height, 30, 180, 80),
    margin: clampNumber(options.margin, 0, 40, 10),
    displayValue: options.displayValue !== false,
    lineColor: normalizeColor(options.lineColor, '#17324d'),
    background: normalizeColor(options.background, '#ffffff'),
  }
}

function createBlobFromCanvas(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('当前浏览器不支持 PNG 导出'))
      return
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('无法生成条形码图片'))
    }, 'image/png')
  })
}

export async function renderBarcode(input, { format = 'code128', ...options } = {}) {
  const normalized = normalizeBarcodeValue(input, format)
  const renderOptions = normalizeBarcodeOptions(options)
  if (typeof document === 'undefined') throw new Error('条形码预览需要浏览器环境')
  const module = await import('jsbarcode')
  const JsBarcode = module.default || module
  const definition = BARCODE_FORMATS[normalized.format]
  const engineOptions = {
    format: definition.engineFormat,
    width: renderOptions.width,
    height: renderOptions.height,
    margin: renderOptions.margin,
    displayValue: renderOptions.displayValue,
    lineColor: renderOptions.lineColor,
    background: renderOptions.background,
  }

  const canvas = document.createElement('canvas')
  try {
    JsBarcode(canvas, normalized.value, engineOptions)
  } catch (error) {
    throw new Error(error?.message || '条形码内容无法编码')
  }
  const pngBlob = await createBlobFromCanvas(canvas)

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, normalized.value, engineOptions)
  const svgText = new XMLSerializer().serializeToString(svg)
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
  return {
    ...normalized,
    ...renderOptions,
    pngBlob,
    svgBlob,
    svgText,
    width: canvas.width,
    height: canvas.height,
  }
}
