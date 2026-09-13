const MAX_EDITOR_EDGE = 2_400

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export const IMAGE_EDITOR_MODES = Object.freeze([
  Object.freeze({ id: 'select', label: '选择' }),
  Object.freeze({ id: 'erase', label: '消除' }),
  Object.freeze({ id: 'replace', label: '替换文字' }),
  Object.freeze({ id: 'text', label: '添加文字' }),
  Object.freeze({ id: 'paste', label: '粘贴' }),
])

export function fitEditorDimensions(width, height, maxEdge = MAX_EDITOR_EDGE) {
  const sourceWidth = Number(width)
  const sourceHeight = Number(height)
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new Error('编辑图片尺寸无效')
  }
  const edge = clamp(Number(maxEdge) || MAX_EDITOR_EDGE, 512, MAX_EDITOR_EDGE)
  const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight))
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  }
}

export function clampEditorPoint(point, width, height) {
  return {
    x: clamp(Number(point?.x) || 0, 0, Math.max(0, Number(width) - 1)),
    y: clamp(Number(point?.y) || 0, 0, Math.max(0, Number(height) - 1)),
  }
}

export function normalizeEditorRect(start, end, width, height) {
  const first = clampEditorPoint(start, width, height)
  const second = clampEditorPoint(end, width, height)
  const left = Math.min(first.x, second.x)
  const top = Math.min(first.y, second.y)
  const right = Math.max(first.x, second.x)
  const bottom = Math.max(first.y, second.y)
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top)),
  }
}

export function editorPointFromPointer(event, canvas) {
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / Math.max(1, rect.width)
  const scaleY = canvas.height / Math.max(1, rect.height)
  return clampEditorPoint({
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }, canvas.width, canvas.height)
}

export function wrapCanvasText(context, text, maxWidth) {
  const source = String(text || '').trim()
  if (!source) return []
  const lines = []
  let line = ''
  for (const character of source) {
    const candidate = line + character
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = character
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

export function copyCanvasSelection(canvas, rect) {
  if (!canvas || !rect) throw new Error('请先框选要复制的区域')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前环境不支持画布读取')
  const x = Math.max(0, Math.min(canvas.width - 1, Math.round(rect.x)))
  const y = Math.max(0, Math.min(canvas.height - 1, Math.round(rect.y)))
  const width = Math.max(1, Math.min(canvas.width - x, Math.round(rect.width)))
  const height = Math.max(1, Math.min(canvas.height - y, Math.round(rect.height)))
  const selection = document.createElement('canvas')
  selection.width = width
  selection.height = height
  selection.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height)
  return { canvas: selection, width, height }
}

export function drawEditorText(context, text, x, y, { fontSize = 28, color = '#1d2b38', maxWidth = 600, align = 'left' } = {}) {
  if (!context) throw new Error('当前环境不支持文字绘制')
  const size = clamp(Number(fontSize) || 28, 10, 240)
  context.save()
  context.font = `600 ${size}px "Microsoft YaHei", "Segoe UI", sans-serif`
  context.fillStyle = color
  context.textAlign = align
  context.textBaseline = 'top'
  const lines = wrapCanvasText(context, text, Math.max(size, maxWidth))
  const lineHeight = Math.round(size * 1.3)
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight))
  context.restore()
  return { lines, lineHeight, height: lines.length * lineHeight }
}

export function snapshotCanvas(canvas) {
  if (!canvas) return null
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

export function restoreCanvasSnapshot(canvas, snapshot) {
  if (!canvas || !snapshot) return false
  const context = canvas.getContext('2d')
  if (!context) return false
  context.putImageData(snapshot, 0, 0)
  return true
}
