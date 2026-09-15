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
      reject(new Error('图片无法读取'))
    }
    image.src = url
  })
}

function renderImageBlob(image, { scale = 1, quality = 0.82, format = 'image/jpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d', { alpha: format === 'image/png' })
    if (!context) {
      reject(new Error('当前浏览器不支持图片处理'))
      return
    }
    if (format !== 'image/png') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('无法生成图片结果'))
        return
      }
      resolve({ blob, width: canvas.width, height: canvas.height })
    }, format, quality)
  })
}

export function normalizeTargetImageOptions({ targetKb = 300, minQuality = 0.18, maxEdge = 2400, format = 'image/jpeg' } = {}) {
  const target = Number(targetKb)
  if (!Number.isFinite(target) || target < 10 || target > 20_000) throw new Error('目标大小必须是 10-20000 KB')
  const quality = Number(minQuality)
  if (!Number.isFinite(quality) || quality < 0.05 || quality > 0.95) throw new Error('最低质量必须在 5%-95% 之间')
  const edge = Number(maxEdge)
  if (!Number.isFinite(edge) || edge < 64 || edge > 8_000) throw new Error('最长边必须在 64-8000 px 之间')
  const normalizedFormat = ['image/jpeg', 'image/png', 'image/webp'].includes(format) ? format : 'image/jpeg'
  return { targetKb: Math.round(target), minQuality: quality, maxEdge: Math.round(edge), format: normalizedFormat }
}

export function processImage(file, { quality = 0.82, format = 'image/jpeg', maxEdge = 2400 } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d', { alpha: format === 'image/png' })
      if (!context) {
        URL.revokeObjectURL(url)
        reject(new Error('当前浏览器不支持图片处理'))
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url)
        if (!blob) {
          reject(new Error('无法生成图片结果'))
          return
        }
        resolve({ blob, width: canvas.width, height: canvas.height })
      }, format, quality)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片无法读取'))
    }
    image.src = url
  })
}

export async function processImageToTarget(file, options = {}) {
  const normalized = normalizeTargetImageOptions(options)
  const image = await loadImage(file)
  const originalScale = Math.min(1, normalized.maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
  const targetBytes = normalized.targetKb * 1024
  let scale = originalScale
  let bestUnderTarget = null
  let smallestOverall = null
  let bestScale = scale

  for (let scaleAttempt = 0; scaleAttempt < 10; scaleAttempt += 1) {
    const qualities = normalized.format === 'image/png' ? [1] : [normalized.minQuality, 0.35, 0.5, 0.65, 0.8, 0.95]
    let smallest = null
    for (const quality of qualities) {
      const candidate = await renderImageBlob(image, { scale, quality, format: normalized.format })
      candidate.quality = quality
      if (!smallest || candidate.blob.size < smallest.blob.size) smallest = candidate
      if (candidate.blob.size <= targetBytes && (!bestUnderTarget || candidate.blob.size > bestUnderTarget.blob.size)) {
        bestUnderTarget = candidate
        bestScale = scale
      }
    }
    if (smallest && (!smallestOverall || smallest.blob.size < smallestOverall.blob.size)) smallestOverall = smallest
    if (bestUnderTarget) {
      // Refine JPEG/WebP quality at the current dimensions to keep the clearest result under the target.
      if (normalized.format !== 'image/png') {
        let low = normalized.minQuality
        let high = 1
        for (let attempt = 0; attempt < 7; attempt += 1) {
          const quality = (low + high) / 2
          const candidate = await renderImageBlob(image, { scale: bestScale, quality, format: normalized.format })
          candidate.quality = quality
          if (candidate.blob.size <= targetBytes) {
            if (candidate.blob.size > bestUnderTarget.blob.size) bestUnderTarget = candidate
            low = quality
          } else {
            high = quality
          }
        }
      }
      break
    }
    if (!smallest) break
    if (smallest.blob.size <= targetBytes || scale <= 0.16) break
    scale = Math.max(0.16, scale * 0.78)
  }

  const best = bestUnderTarget || smallestOverall
  if (!best) throw new Error('无法生成图片结果')
  return {
    ...best,
    targetKb: normalized.targetKb,
    actualKb: best.blob.size / 1024,
    withinTarget: best.blob.size <= targetBytes,
    format: normalized.format,
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 500)
}
