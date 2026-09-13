const MAX_EDGE = 2_400
const MAX_PIXELS = 12_000_000

export const AI_IMAGE_OPERATIONS = Object.freeze({
  enhance: 'enhance',
  removeBackground: 'remove-background',
})

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function abortIfRequested(isCanceled) {
  if (!isCanceled?.()) return
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  throw error
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('请先选择图片'))
      return
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片无法读取'))
    }
    image.src = url
  })
}

function canvasBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('无法生成 AI 图片结果'))
    }, type, quality)
  })
}

function fitDimensions(width, height, maxEdge = MAX_EDGE) {
  const sourceWidth = Math.max(1, Number(width) || 1)
  const sourceHeight = Math.max(1, Number(height) || 1)
  const edge = Math.max(128, Math.min(MAX_EDGE, Number(maxEdge) || MAX_EDGE))
  const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight), Math.sqrt(MAX_PIXELS / (sourceWidth * sourceHeight)))
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  }
}

export function normalizeAiOptions({ strength = 55, threshold = 42, maxEdge = MAX_EDGE, backgroundColor = '' } = {}) {
  return {
    strength: clamp(Number.isFinite(Number(strength)) ? Number(strength) : 55, 0, 100),
    threshold: clamp(Number.isFinite(Number(threshold)) ? Number(threshold) : 42, 8, 120),
    maxEdge: clamp(Number.isFinite(Number(maxEdge)) ? Number(maxEdge) : MAX_EDGE, 512, MAX_EDGE),
    backgroundColor: /^#[0-9a-f]{6}$/i.test(String(backgroundColor || '')) ? String(backgroundColor) : '',
  }
}

export function getLocalAiRuntime() {
  const canvasAvailable = typeof document !== 'undefined' && typeof document.createElement === 'function'
  return {
    available: canvasAvailable,
    engine: canvasAvailable ? 'Canvas Local Vision' : 'unavailable',
    modelLoaded: false,
    mode: 'local-heuristic',
    detail: canvasAvailable
      ? '本机启发式图像处理，不上传原图；未下载第三方模型'
      : '当前环境没有 Canvas 能力',
  }
}

export async function checkLocalAiRuntime() {
  const runtime = getLocalAiRuntime()
  if (!runtime.available) throw new Error('本地图片引擎未就绪')
  return runtime
}

function drawScaledImage(image, maxEdge) {
  const dimensions = fitDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器不支持图片像素处理')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { canvas, context, ...dimensions }
}

function enhancePixels(imageData, strength, isCanceled, onProgress) {
  const amount = strength / 100
  const contrast = 1 + amount * 0.24
  const brightness = 1 + amount * 0.045
  const saturation = 1 + amount * 0.16
  const { data, width, height } = imageData
  for (let y = 0; y < height; y += 1) {
    abortIfRequested(isCanceled)
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const red = data[offset] / 255
      const green = data[offset + 1] / 255
      const blue = data[offset + 2] / 255
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114
      const adjust = (luminance - 0.5) * contrast + 0.5
      data[offset] = clamp(Math.round((adjust + (red - luminance) * saturation) * 255 * brightness), 0, 255)
      data[offset + 1] = clamp(Math.round((adjust + (green - luminance) * saturation) * 255 * brightness), 0, 255)
      data[offset + 2] = clamp(Math.round((adjust + (blue - luminance) * saturation) * 255 * brightness), 0, 255)
    }
    if (y % 32 === 0) onProgress?.(Math.round(24 + (y / height) * 55))
  }
}

function sampleBackgroundColor(data, width, height) {
  const samples = []
  // Keep the sample near each corner; on tiny fixtures a radius of one would
  // include the centre pixel and skew the estimated backdrop.
  const radius = Math.min(8, Math.max(0, Math.floor(Math.min(width, height) / 120)))
  const points = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]
  points.forEach(([originX, originY]) => {
    for (let dy = 0; dy <= radius; dy += 1) {
      for (let dx = 0; dx <= radius; dx += 1) {
        const x = originX === 0 ? Math.min(width - 1, dx) : Math.max(0, originX - dx)
        const y = originY === 0 ? Math.min(height - 1, dy) : Math.max(0, originY - dy)
        const offset = (y * width + x) * 4
        samples.push([data[offset], data[offset + 1], data[offset + 2]])
      }
    }
  })
  const total = samples.reduce((sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]], [0, 0, 0])
  return total.map((value) => value / Math.max(1, samples.length))
}

function colorDistance(data, offset, background) {
  const red = data[offset] - background[0]
  const green = data[offset + 1] - background[1]
  const blue = data[offset + 2] - background[2]
  return Math.sqrt(red * red + green * green + blue * blue)
}

export function replaceConnectedBackground(imageData, { threshold = 42, replacementColor = '', isCanceled, onProgress } = {}) {
  const { data, width, height } = imageData
  const background = sampleBackgroundColor(data, width, height)
  const candidates = new Uint8Array(width * height)
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let tail = 0
  const distanceLimit = threshold * 1.732
  for (let index = 0; index < width * height; index += 1) {
    if (index % Math.max(1, width * 32) === 0) {
      abortIfRequested(isCanceled)
      onProgress?.(18 + Math.round((index / (width * height)) * 18))
    }
    candidates[index] = colorDistance(data, index * 4, background) <= distanceLimit ? 1 : 0
  }
  const enqueue = (index) => {
    if (index < 0 || index >= width * height || !candidates[index] || visited[index]) return
    visited[index] = 1
    queue[tail] = index
    tail += 1
  }
  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }
  let head = 0
  while (head < tail) {
    abortIfRequested(isCanceled)
    const index = queue[head]
    head += 1
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) enqueue(index - 1)
    if (x < width - 1) enqueue(index + 1)
    if (y > 0) enqueue(index - width)
    if (y < height - 1) enqueue(index + width)
  }
  let replacement = null
  if (replacementColor) {
    const hex = replacementColor.slice(1)
    replacement = [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)]
  }
  for (let index = 0; index < width * height; index += 1) {
    if (visited[index]) {
      const offset = index * 4
      if (replacement) {
        data[offset] = replacement[0]
        data[offset + 1] = replacement[1]
        data[offset + 2] = replacement[2]
        data[offset + 3] = 255
      } else {
        data[offset + 3] = 0
      }
    }
  }
  return { background, removedPixels: tail, width, height }
}

export async function enhanceImage(file, options = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error('请选择 JPG、PNG、WebP 等图片')
  const normalized = normalizeAiOptions(options)
  abortIfRequested(options.isCanceled)
  options.onStatus?.({ stage: '加载本地图片引擎' })
  const image = await loadImage(file)
  const { canvas, context, width, height } = drawScaledImage(image, normalized.maxEdge)
  options.onStatus?.({ stage: '分析像素并增强' })
  const imageData = context.getImageData(0, 0, width, height)
  enhancePixels(imageData, normalized.strength, options.isCanceled, options.onProgress)
  context.putImageData(imageData, 0, 0)
  options.onProgress?.(90)
  const blob = await canvasBlob(canvas, 'image/jpeg', 0.94)
  abortIfRequested(options.isCanceled)
  return {
    blob,
    filename: `ai-enhanced-${Date.now()}.jpg`,
    width,
    height,
    operation: AI_IMAGE_OPERATIONS.enhance,
    summary: `已完成本地智能增强（${width}×${height}）；原图未修改`,
    engine: 'Canvas Local Vision',
  }
}

export async function removeImageBackground(file, options = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error('请选择 JPG、PNG、WebP 等图片')
  const normalized = normalizeAiOptions(options)
  abortIfRequested(options.isCanceled)
  options.onStatus?.({ stage: '加载本地图片引擎' })
  const image = await loadImage(file)
  const { canvas, context, width, height } = drawScaledImage(image, normalized.maxEdge)
  options.onStatus?.({ stage: '估计边缘背景' })
  const imageData = context.getImageData(0, 0, width, height)
  const result = replaceConnectedBackground(imageData, {
    threshold: normalized.threshold,
    replacementColor: normalized.backgroundColor,
    isCanceled: options.isCanceled,
    onProgress: options.onProgress,
  })
  context.putImageData(imageData, 0, 0)
  options.onProgress?.(90)
  const blob = await canvasBlob(canvas, normalized.backgroundColor ? 'image/jpeg' : 'image/png', 0.94)
  abortIfRequested(options.isCanceled)
  return {
    blob,
    filename: `ai-cutout-${Date.now()}.${normalized.backgroundColor ? 'jpg' : 'png'}`,
    width,
    height,
    operation: AI_IMAGE_OPERATIONS.removeBackground,
    summary: normalized.backgroundColor
      ? `已完成本地智能抠图并替换背景（${width}×${height}）；原图未修改`
      : `已完成本地智能抠图（透明背景，${width}×${height}）；原图未修改`,
    engine: 'Canvas Local Vision',
    removedPixels: result.removedPixels,
  }
}

export async function runLocalAiImage(file, operation, options = {}) {
  if (operation === AI_IMAGE_OPERATIONS.enhance) return enhanceImage(file, options)
  if (operation === AI_IMAGE_OPERATIONS.removeBackground) return removeImageBackground(file, options)
  throw new Error('不支持的本地 AI 图片操作')
}
