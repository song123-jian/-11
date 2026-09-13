let zipPromise

async function getZip() {
  zipPromise ||= import('jszip').then(({ default: JSZip }) => JSZip)
  return zipPromise
}

function abortIfRequested(isCanceled) {
  if (!isCanceled?.()) return
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  throw error
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`${file.name} 无法读取`))
    }
    image.src = url
  })
}

function canvasBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('无法生成图片结果')),
    type,
    quality,
  ))
}

function ensureImages(files) {
  if (!files.length) throw new Error('请先选择至少一张图片')
  if (files.some((file) => !file.type?.startsWith('image/'))) throw new Error('请选择 JPG、PNG 或 WebP 图片')
}

export function normalizeLongCaptureOptions({ frameCount = 3, intervalSeconds = 3, leadSeconds = 3 } = {}) {
  const normalized = {
    frameCount: Number(frameCount),
    intervalSeconds: Number(intervalSeconds),
    leadSeconds: Number(leadSeconds),
  }
  if (!Number.isInteger(normalized.frameCount) || normalized.frameCount < 2 || normalized.frameCount > 8) {
    throw new Error('分段数量必须是 2-8 的整数')
  }
  if (!Number.isInteger(normalized.intervalSeconds) || normalized.intervalSeconds < 1 || normalized.intervalSeconds > 10) {
    throw new Error('滚动间隔必须是 1-10 秒的整数')
  }
  if (!Number.isInteger(normalized.leadSeconds) || normalized.leadSeconds < 1 || normalized.leadSeconds > 10) {
    throw new Error('开始延迟必须是 1-10 秒的整数')
  }
  return normalized
}

async function waitForCapture(milliseconds, isCanceled) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    abortIfRequested(isCanceled)
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())))
  }
  abortIfRequested(isCanceled)
}

async function waitForVideo(video) {
  await video.play()
  if (video.videoWidth && video.videoHeight) return
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('屏幕画面初始化超时')), 5_000)
    video.onloadedmetadata = () => {
      clearTimeout(timeout)
      resolve()
    }
  })
}

async function captureVideoFrame(video, index) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('捕获目标画面不可用')
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d').drawImage(video, 0, 0)
  const blob = await canvasBlob(canvas)
  return new File([blob], `long-screenshot-frame-${index + 1}.png`, { type: 'image/png' })
}

export async function watermarkImages(files, text, { opacity = 0.4, onProgress, onStatus, isCanceled } = {}) {
  ensureImages(files)
  if (!String(text || '').trim()) throw new Error('水印文字不能为空')
  const outputs = []
  onStatus?.({ stage: '生成水印', completed: 0, total: files.length })
  for (const [index, file] of files.entries()) {
    abortIfRequested(isCanceled)
    const image = await loadImage(file)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const fontSize = Math.max(18, Math.round(Math.min(canvas.width, canvas.height) / 18))
    const padding = Math.max(16, Math.round(fontSize * 0.75))
    context.save()
    context.globalAlpha = Math.min(1, Math.max(0.1, Number(opacity) || 0.4))
    context.font = `600 ${fontSize}px system-ui, sans-serif`
    context.textAlign = 'right'
    context.textBaseline = 'bottom'
    context.shadowColor = 'rgba(0,0,0,.75)'
    context.shadowBlur = 4
    context.fillStyle = '#ffffff'
    context.fillText(text.trim(), canvas.width - padding, canvas.height - padding)
    context.restore()
    outputs.push({ name: `watermarked-${index + 1}.png`, blob: await canvasBlob(canvas) })
    onProgress?.(Math.round(10 + ((index + 1) / files.length) * 75))
    onStatus?.({ stage: '生成水印', completed: index + 1, total: files.length })
  }
  abortIfRequested(isCanceled)
  if (outputs.length === 1) {
    return { blob: outputs[0].blob, filename: outputs[0].name, summary: '已生成 1 张水印图片；原图未修改' }
  }
  const JSZip = await getZip()
  onStatus?.({ stage: '生成 ZIP' })
  const zip = new JSZip()
  outputs.forEach((item) => zip.file(item.name, item.blob))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, ({ percent }) => onProgress?.(Math.round(85 + percent * 0.1)))
  return { blob, filename: `watermarked-${Date.now()}.zip`, summary: `已生成 ${outputs.length} 张水印图片；原图未修改` }
}

export async function stitchImages(files, direction = 'vertical', { onProgress, onStatus, isCanceled } = {}) {
  ensureImages(files)
  if (files.length < 2) throw new Error('长图拼接至少需要两张图片')
  const images = []
  onStatus?.({ stage: '读取图片', completed: 0, total: files.length })
  for (const [index, file] of files.entries()) {
    abortIfRequested(isCanceled)
    images.push(await loadImage(file))
    onProgress?.(Math.round(5 + ((index + 1) / files.length) * 30))
    onStatus?.({ stage: '读取图片', completed: index + 1, total: files.length })
  }
  const vertical = direction !== 'horizontal'
  const width = vertical ? Math.max(...images.map((image) => image.naturalWidth)) : images.reduce((sum, image) => sum + image.naturalWidth, 0)
  const height = vertical ? images.reduce((sum, image) => sum + image.naturalHeight, 0) : Math.max(...images.map((image) => image.naturalHeight))
  if (width > 16_384 || height > 16_384 || width * height > 80_000_000) throw new Error('拼接结果尺寸过大，请减少图片数量或先压缩图片')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  onStatus?.({ stage: '绘制拼接结果' })
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  let offset = 0
  images.forEach((image, index) => {
    abortIfRequested(isCanceled)
    context.drawImage(image, vertical ? 0 : offset, vertical ? offset : 0)
    offset += vertical ? image.naturalHeight : image.naturalWidth
    onProgress?.(Math.round(35 + ((index + 1) / images.length) * 50))
  })
  const blob = await canvasBlob(canvas)
  abortIfRequested(isCanceled)
  return { blob, filename: `stitched-${Date.now()}.png`, summary: `已按${vertical ? '纵向' : '横向'}拼接 ${images.length} 张图片，尺寸 ${width}×${height}` }
}

export async function captureScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('当前环境不支持屏幕捕获')
  let stream
  const video = document.createElement('video')
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false })
    video.srcObject = stream
    await video.play()
    if (!video.videoWidth) await new Promise((resolve) => { video.onloadedmetadata = resolve })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    return { blob: await canvasBlob(canvas), filename: `screenshot-${Date.now()}.png`, width: canvas.width, height: canvas.height }
  } catch (error) {
    if (error?.name === 'NotAllowedError') throw new Error('屏幕捕获已取消或未授权')
    throw error
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
    video.srcObject = null
  }
}

export async function captureLongScreen(options = {}) {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('当前环境不支持屏幕捕获')
  const { frameCount, intervalSeconds, leadSeconds } = normalizeLongCaptureOptions(options)
  const { onProgress, onStatus, isCanceled } = options
  let stream
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  try {
    onStatus?.({ stage: '等待屏幕授权' })
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false })
    video.srcObject = stream
    await waitForVideo(video)
    onStatus?.({ stage: '等待开始' })
    await waitForCapture(leadSeconds * 1_000, isCanceled)

    const frames = []
    onStatus?.({ stage: '捕获屏幕分段', completed: 0, total: frameCount })
    for (let index = 0; index < frameCount; index += 1) {
      abortIfRequested(isCanceled)
      if (stream.getVideoTracks()[0]?.readyState === 'ended') throw new Error('屏幕共享已结束，长截图未完成')
      frames.push(await captureVideoFrame(video, index))
      onProgress?.(Math.round(8 + ((index + 1) / frameCount) * 57))
      onStatus?.({ stage: '捕获屏幕分段', completed: index + 1, total: frameCount })
      if (index < frameCount - 1) await waitForCapture(intervalSeconds * 1_000, isCanceled)
    }

    onStatus?.({ stage: '拼接屏幕分段' })
    const result = await stitchImages(frames, 'vertical', {
      isCanceled,
      onProgress: (progress) => onProgress?.(Math.round(65 + progress * 0.3)),
    })
    return {
      ...result,
      filename: `long-screenshot-${Date.now()}.png`,
      summary: `已定时捕获并纵向拼接 ${frameCount} 个屏幕分段；原始内容未修改`,
    }
  } catch (error) {
    if (error?.name === 'NotAllowedError') throw new Error('屏幕捕获已取消或未授权')
    throw error
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
    video.srcObject = null
  }
}
