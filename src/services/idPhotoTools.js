import { getIdPhotoBackgroundColor, normalizeIdPhotoSpec } from './idPhotoSpecs.js'
import { replaceConnectedBackground } from './imageAiTools.js'

const MAX_OUTPUT_EDGE = 4_000

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function abortIfRequested(isCanceled) {
  if (!isCanceled?.()) return
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  throw error
}

export function calculateCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight, focalX = 0.5, focalY = 0.5) {
  const values = [sourceWidth, sourceHeight, targetWidth, targetHeight].map(Number)
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('图片尺寸必须是正数')
  }
  const [width, height, outputWidth, outputHeight] = values
  const scale = Math.max(outputWidth / width, outputHeight / height)
  const cropWidth = outputWidth / scale
  const cropHeight = outputHeight / scale
  const normalizedX = clamp(Number.isFinite(Number(focalX)) ? Number(focalX) : 0.5, 0, 1)
  const normalizedY = clamp(Number.isFinite(Number(focalY)) ? Number(focalY) : 0.5, 0, 1)
  return {
    sx: (width - cropWidth) * normalizedX,
    sy: (height - cropHeight) * normalizedY,
    sw: cropWidth,
    sh: cropHeight,
    scale,
  }
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

function canvasBlob(canvas, type = 'image/jpeg', quality = 0.95) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('无法生成证件照结果'))
    }, type, quality)
  })
}

export function normalizeIdPhotoRenderOptions({ spec = 'one-inch', backgroundColor = '#ffffff', focalX = 0.5, focalY = 0.5, quality = 0.95 } = {}) {
  const normalizedSpec = normalizeIdPhotoSpec(spec)
  const width = Math.min(MAX_OUTPUT_EDGE, Math.max(1, Math.round(normalizedSpec.widthPx)))
  const height = Math.min(MAX_OUTPUT_EDGE, Math.max(1, Math.round(normalizedSpec.heightPx)))
  const normalizedQuality = clamp(Number.isFinite(Number(quality)) ? Number(quality) : 0.95, 0.5, 1)
  return {
    spec: { ...normalizedSpec, widthPx: width, heightPx: height },
    backgroundColor: getIdPhotoBackgroundColor(backgroundColor),
    focalX: clamp(Number.isFinite(Number(focalX)) ? Number(focalX) : 0.5, 0, 1),
    focalY: clamp(Number.isFinite(Number(focalY)) ? Number(focalY) : 0.5, 0, 1),
    quality: normalizedQuality,
  }
}

export async function renderIdPhoto(file, options = {}) {
  const normalized = normalizeIdPhotoRenderOptions(options)
  abortIfRequested(options.isCanceled)
  if (!file?.type?.startsWith('image/')) throw new Error('请选择 JPG、PNG、WebP 等图片')
  options.onStatus?.({ stage: '读取原图', completed: 0, total: 1 })
  const image = await loadImage(file)
  abortIfRequested(options.isCanceled)
  const { spec, backgroundColor, focalX, focalY, quality } = normalized
  const canvas = document.createElement('canvas')
  canvas.width = spec.widthPx
  canvas.height = spec.heightPx
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  if (!context) throw new Error('当前浏览器不支持证件照裁剪')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = backgroundColor
  context.fillRect(0, 0, canvas.width, canvas.height)
  const crop = calculateCoverCrop(image.naturalWidth || image.width, image.naturalHeight || image.height, canvas.width, canvas.height, focalX, focalY)
  context.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height)
  // Replace only edge-connected pixels so a reasonably uniform source backdrop
  // can be changed without treating interior subject colors as background.
  options.onStatus?.({ stage: '匹配证件照背景' })
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  replaceConnectedBackground(imageData, {
    threshold: 42,
    replacementColor: backgroundColor,
    isCanceled: options.isCanceled,
  })
  context.putImageData(imageData, 0, 0)
  options.onProgress?.(88)
  options.onStatus?.({ stage: '生成证件照副本', completed: 1, total: 1 })
  const blob = await canvasBlob(canvas, 'image/jpeg', quality)
  abortIfRequested(options.isCanceled)
  const safeBase = String(file.name || 'photo').replace(/\.[^/.]+$/, '').replace(/[^\w\-\u4e00-\u9fa5]+/g, '-').slice(0, 60) || 'photo'
  return {
    blob,
    filename: `${safeBase}-${spec.id}-id-photo.jpg`,
    width: canvas.width,
    height: canvas.height,
    spec,
    backgroundColor,
    crop,
    summary: `已生成 ${spec.label} ${canvas.width}×${canvas.height} 证件照；原图未修改`,
  }
}
