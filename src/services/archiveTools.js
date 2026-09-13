let zipPromise

const MAX_EXTRACTED_FILE_BYTES = 128 * 1024 * 1024
const MAX_EXTRACTED_TOTAL_BYTES = 256 * 1024 * 1024

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

function validateItems(items) {
  if (!items.length) throw new Error('请先选择至少一个文件')
  const names = items.map((item) => item.name.toLocaleLowerCase())
  if (new Set(names).size !== names.length) throw new Error('存在同名文件，请移除重复项后重试')
}

export async function createArchive(items, { onProgress, onStatus, isCanceled } = {}) {
  validateItems(items)
  const JSZip = await getZip()
  abortIfRequested(isCanceled)
  const zip = new JSZip()
  onStatus?.({ stage: '写入归档', completed: 0, total: items.length })
  for (const [index, item] of items.entries()) {
    abortIfRequested(isCanceled)
    zip.file(item.name, item.file)
    onProgress?.(Math.round(5 + ((index + 1) / items.length) * 20))
    onStatus?.({ stage: '写入归档', completed: index + 1, total: items.length })
  }
  onStatus?.({ stage: '压缩归档' })
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    ({ percent }) => {
      abortIfRequested(isCanceled)
      onProgress?.(Math.round(25 + percent * 0.7))
    },
  )
  abortIfRequested(isCanceled)
  return {
    blob,
    filename: `archive-${Date.now()}.zip`,
    summary: `已压缩 ${items.length} 个文件；源文件未修改`,
  }
}

export async function extractArchive(file, { onProgress, onStatus, isCanceled } = {}) {
  if (!file?.name?.toLowerCase().endsWith('.zip')) throw new Error('当前解压仅支持 ZIP 文件')
  const JSZip = await getZip()
  abortIfRequested(isCanceled)
  let zip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('ZIP 无法读取，文件可能损坏或已加密')
  }
  const sources = Object.values(zip.files).filter((entry) => !entry.dir)
  if (!sources.length) throw new Error('ZIP 中没有可提取的文件')
  if (sources.length > 500) throw new Error('单次最多提取 500 个文件')
  const declaredSizes = sources.map((entry) => Number(entry?._data?.uncompressedSize))
  if (declaredSizes.some((size) => Number.isFinite(size) && size > MAX_EXTRACTED_FILE_BYTES)) {
    throw new Error('ZIP 中存在超过 128 MB 的文件，已停止解压')
  }
  const declaredTotal = declaredSizes.reduce((total, size) => total + (Number.isFinite(size) ? size : 0), 0)
  if (declaredTotal > MAX_EXTRACTED_TOTAL_BYTES) throw new Error('ZIP 展开后超过 256 MB，已停止解压')
  const entries = []
  let extractedBytes = 0
  onStatus?.({ stage: '提取文件', completed: 0, total: sources.length })
  for (const [index, entry] of sources.entries()) {
    abortIfRequested(isCanceled)
    const blob = await entry.async('blob')
    if (blob.size > MAX_EXTRACTED_FILE_BYTES) throw new Error('ZIP 中存在超过 128 MB 的文件，已停止解压')
    extractedBytes += blob.size
    if (extractedBytes > MAX_EXTRACTED_TOTAL_BYTES) throw new Error('ZIP 展开后超过 256 MB，已停止解压')
    entries.push({ name: entry.name, blob, size: blob.size })
    onProgress?.(Math.round(10 + ((index + 1) / sources.length) * 85))
    onStatus?.({ stage: '提取文件', completed: index + 1, total: sources.length })
  }
  return {
    entries,
    summary: `已提取 ${entries.length} 个文件到内存，可逐项下载`,
  }
}
