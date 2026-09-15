import { PAPER_SIZES } from './printSettings.js'
import { normalizeIdPhotoSpec } from './idPhotoSpecs.js'

const PAPER_KEYS = new Set(Object.keys(PAPER_SIZES))

export const PHOTO_SHEET_DEFAULTS = Object.freeze({
  paperSize: 'A4',
  orientation: 'portrait',
  copies: 8,
  marginMm: 10,
  gapMm: 4,
  dpi: 150,
  cropMarks: true,
})

export function normalizePhotoSheetOptions(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const copies = Number(source.copies)
  const marginMm = Number(source.marginMm)
  const gapMm = Number(source.gapMm)
  const dpi = Number(source.dpi)
  return {
    paperSize: PAPER_KEYS.has(source.paperSize) ? source.paperSize : PHOTO_SHEET_DEFAULTS.paperSize,
    orientation: source.orientation === 'landscape' ? 'landscape' : PHOTO_SHEET_DEFAULTS.orientation,
    copies: Number.isFinite(copies) ? Math.min(100, Math.max(1, Math.round(copies))) : PHOTO_SHEET_DEFAULTS.copies,
    marginMm: Number.isFinite(marginMm) ? Math.min(30, Math.max(0, marginMm)) : PHOTO_SHEET_DEFAULTS.marginMm,
    gapMm: Number.isFinite(gapMm) ? Math.min(20, Math.max(0, gapMm)) : PHOTO_SHEET_DEFAULTS.gapMm,
    dpi: Number.isFinite(dpi) ? Math.min(300, Math.max(96, Math.round(dpi))) : PHOTO_SHEET_DEFAULTS.dpi,
    cropMarks: source.cropMarks !== false,
  }
}

function physicalPhotoSize(spec) {
  const normalized = normalizeIdPhotoSpec(spec)
  const widthMm = Number(normalized.widthMm) > 0 ? Number(normalized.widthMm) : Number(normalized.widthPx) * 25.4 / 300
  const heightMm = Number(normalized.heightMm) > 0 ? Number(normalized.heightMm) : Number(normalized.heightPx) * 25.4 / 300
  return { spec: normalized, widthMm, heightMm }
}

export function calculatePhotoSheetLayout(spec, options = {}) {
  const normalizedOptions = normalizePhotoSheetOptions(options)
  const paper = PAPER_SIZES[normalizedOptions.paperSize]
  const paperWidthMm = normalizedOptions.orientation === 'landscape' ? paper.heightMm : paper.widthMm
  const paperHeightMm = normalizedOptions.orientation === 'landscape' ? paper.widthMm : paper.heightMm
  const photo = physicalPhotoSize(spec)
  const availableWidth = paperWidthMm - normalizedOptions.marginMm * 2
  const availableHeight = paperHeightMm - normalizedOptions.marginMm * 2
  const columns = Math.floor((availableWidth + normalizedOptions.gapMm) / (photo.widthMm + normalizedOptions.gapMm))
  const rows = Math.floor((availableHeight + normalizedOptions.gapMm) / (photo.heightMm + normalizedOptions.gapMm))
  const capacity = Math.max(0, columns * rows)
  if (!capacity) throw new Error(`当前纸张放不下${photo.spec.label}，请减小边距或更换纸张`) 
  if (normalizedOptions.copies > capacity) throw new Error(`当前版式最多排 ${capacity} 张，请减少份数或调整纸张/边距`)
  const pxPerMm = normalizedOptions.dpi / 25.4
  const paperWidthPx = Math.max(1, Math.round(paperWidthMm * pxPerMm))
  const paperHeightPx = Math.max(1, Math.round(paperHeightMm * pxPerMm))
  const photoWidthPx = Math.max(1, Math.round(photo.widthMm * pxPerMm))
  const photoHeightPx = Math.max(1, Math.round(photo.heightMm * pxPerMm))
  const gridWidthMm = columns * photo.widthMm + Math.max(0, columns - 1) * normalizedOptions.gapMm
  const gridHeightMm = rows * photo.heightMm + Math.max(0, rows - 1) * normalizedOptions.gapMm
  return {
    ...normalizedOptions,
    paper,
    paperWidthMm,
    paperHeightMm,
    paperWidthPx,
    paperHeightPx,
    photo: photo.spec,
    photoWidthMm: photo.widthMm,
    photoHeightMm: photo.heightMm,
    photoWidthPx,
    photoHeightPx,
    columns,
    rows,
    capacity,
    gridWidthMm,
    gridHeightMm,
    offsetXmm: (paperWidthMm - gridWidthMm) / 2,
    offsetYmm: (paperHeightMm - gridHeightMm) / 2,
  }
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('证件照结果无法读取'))
    }
    image.src = url
  })
}

function drawCover(context, image, x, y, width, height) {
  const sourceRatio = image.naturalWidth / image.naturalHeight
  const targetRatio = width / height
  let sourceWidth = image.naturalWidth
  let sourceHeight = image.naturalHeight
  let sourceX = 0
  let sourceY = 0
  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio
    sourceX = (image.naturalWidth - sourceWidth) / 2
  } else {
    sourceHeight = image.naturalWidth / targetRatio
    sourceY = (image.naturalHeight - sourceHeight) / 2
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height)
}

function drawCropMarks(context, x, y, width, height, length = 8) {
  context.save()
  context.strokeStyle = '#6f7c83'
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(x - length, y)
  context.lineTo(x - 2, y)
  context.moveTo(x, y - length)
  context.lineTo(x, y - 2)
  context.moveTo(x + width + 2, y)
  context.lineTo(x + width + length, y)
  context.moveTo(x + width, y - length)
  context.lineTo(x + width, y - 2)
  context.moveTo(x - length, y + height)
  context.lineTo(x - 2, y + height)
  context.moveTo(x, y + height + 2)
  context.lineTo(x, y + height + length)
  context.moveTo(x + width + 2, y + height)
  context.lineTo(x + width + length, y + height)
  context.moveTo(x + width, y + height + 2)
  context.lineTo(x + width, y + height + length)
  context.stroke()
  context.restore()
}

export async function renderPhotoSheet(source, spec, options = {}) {
  const layout = calculatePhotoSheetLayout(spec, options)
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = layout.paperWidthPx
  canvas.height = layout.paperHeightPx
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持相纸排版')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const pxPerMm = layout.dpi / 25.4
  const startX = layout.offsetXmm * pxPerMm
  const startY = layout.offsetYmm * pxPerMm
  const gapPx = layout.gapMm * pxPerMm
  for (let index = 0; index < layout.copies; index += 1) {
    const column = index % layout.columns
    const row = Math.floor(index / layout.columns)
    const x = startX + column * (layout.photoWidthPx + gapPx)
    const y = startY + row * (layout.photoHeightPx + gapPx)
    drawCover(context, image, x, y, layout.photoWidthPx, layout.photoHeightPx)
    if (layout.cropMarks) drawCropMarks(context, x, y, layout.photoWidthPx, layout.photoHeightPx, Math.max(5, Math.round(pxPerMm * 2)))
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('无法生成相纸排版结果')), 'image/png'))
  return {
    blob,
    filename: `id-photo-sheet-${layout.paper.id}-${Date.now()}.png`,
    layout,
    summary: `${layout.paper.label} 已排版 ${layout.copies} 张 ${layout.photo.label}，${layout.columns} 列 × ${layout.rows} 行 · ${layout.paperWidthPx}×${layout.paperHeightPx} px`,
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
}

export function buildPhotoSheetPrintMarkup(sourceUrl, options = {}) {
  const normalized = normalizePhotoSheetOptions(options)
  const paper = PAPER_SIZES[normalized.paperSize]
  const width = normalized.orientation === 'landscape' ? paper.heightMm : paper.widthMm
  const height = normalized.orientation === 'landscape' ? paper.widthMm : paper.heightMm
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${width}mm ${height}mm;margin:0}html,body{margin:0;padding:0;background:#fff}img{display:block;width:100vw;height:100vh;object-fit:contain}</style></head><body><img src="${escapeHtml(sourceUrl)}" alt="证件照相纸排版"></body></html>`
}

export function printPhotoSheet(blob, options = {}) {
  if (typeof document === 'undefined') throw new Error('当前环境不支持系统打印')
  const sourceUrl = URL.createObjectURL(blob)
  const frame = document.createElement('iframe')
  frame.setAttribute('title', '证件照相纸打印预览')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '1px'
  frame.style.height = '1px'
  frame.style.border = '0'
  frame.style.opacity = '0'
  document.body.appendChild(frame)
  const cleanup = () => {
    URL.revokeObjectURL(sourceUrl)
    frame.remove()
  }
  const frameDocument = frame.contentDocument
  if (!frameDocument) {
    cleanup()
    throw new Error('无法创建打印预览')
  }
  frameDocument.open()
  frameDocument.write(buildPhotoSheetPrintMarkup(sourceUrl, options))
  frameDocument.close()
  frame.contentWindow?.addEventListener('afterprint', cleanup, { once: true })
  window.setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
  }, 80)
  window.setTimeout(cleanup, 10_000)
}
