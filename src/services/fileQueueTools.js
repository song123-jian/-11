const MAX_DOCUMENT_FILES = 500

const rejectionLabels = {
  duplicate: '重复文件',
  empty: '空文件',
  'unsupported-type': '当前操作不支持的格式',
  'output-conflict': '同名归档输出',
  'single-limit': '该操作仅支持一个文件',
  'file-limit': `超过 ${MAX_DOCUMENT_FILES} 个文件上限`,
  invalid: '无效文件',
}

function fileNameOf(candidate) {
  return String(candidate?.name || '').trim()
}

function fileSizeOf(candidate) {
  const size = Number(candidate?.size)
  return Number.isFinite(size) && size >= 0 ? size : 0
}

function fileTypeOf(candidate) {
  return String(candidate?.type || '').toLocaleLowerCase()
}

function pathKey(path) {
  return String(path || '').replace(/\//g, '\\').toLocaleLowerCase()
}

function fileKey(candidate) {
  if (candidate?.path) return `path:${pathKey(candidate.path)}`
  const file = candidate?.file || candidate
  return [
    'file',
    fileNameOf(file).toLocaleLowerCase(),
    fileSizeOf(file),
    Number(file?.lastModified) || 0,
    fileTypeOf(file),
  ].join(':')
}

function outputNameKey(candidate) {
  return fileNameOf(candidate).toLocaleLowerCase()
}

function allowedDocumentFile(candidate, mode, archiveMode) {
  const name = fileNameOf(candidate).toLocaleLowerCase()
  const type = fileTypeOf(candidate)
  if (mode === 'pdf-merge' || mode === 'pdf-split') return name.endsWith('.pdf') || type === 'application/pdf'
  if (mode === 'archive' && archiveMode === 'extract') return name.endsWith('.zip') || type === 'application/zip' || type === 'application/x-zip-compressed'
  if (mode === 'ocr') return type.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/.test(name)
  return true
}

function toEntry(candidate) {
  if (candidate?.path) {
    return {
      file: null,
      name: fileNameOf(candidate),
      size: fileSizeOf(candidate),
      path: String(candidate.path),
    }
  }
  const file = candidate?.file || candidate
  return { file, name: fileNameOf(file), size: fileSizeOf(file) }
}

function reject(rejected, candidate, reason) {
  rejected.push({ name: fileNameOf(candidate) || '未命名文件', reason })
}

export function selectDocumentFiles(candidates, {
  existing = [],
  mode = 'pdf-merge',
  archiveMode = 'compress',
  multiple = true,
} = {}) {
  const accepted = []
  const rejected = []
  const knownFiles = new Set(existing.map(fileKey))
  const requiresUniqueOutputName = mode === 'archive' && archiveMode === 'compress'
  const knownOutputNames = new Set(requiresUniqueOutputName ? existing.map(outputNameKey) : [])
  const fileLimit = multiple ? MAX_DOCUMENT_FILES : 1

  for (const candidate of Array.from(candidates || [])) {
    const entry = toEntry(candidate)
    if (!entry.name) {
      reject(rejected, candidate, 'invalid')
      continue
    }
    if (!entry.path && entry.size === 0) {
      reject(rejected, entry, 'empty')
      continue
    }
    if (!allowedDocumentFile(entry.file || entry, mode, archiveMode)) {
      reject(rejected, entry, 'unsupported-type')
      continue
    }
    const identity = fileKey(entry)
    if (knownFiles.has(identity)) {
      reject(rejected, entry, 'duplicate')
      continue
    }
    if (requiresUniqueOutputName && knownOutputNames.has(outputNameKey(entry))) {
      reject(rejected, entry, 'output-conflict')
      continue
    }
    if (existing.length + accepted.length >= fileLimit) {
      reject(rejected, entry, multiple ? 'file-limit' : 'single-limit')
      continue
    }
    knownFiles.add(identity)
    if (requiresUniqueOutputName) knownOutputNames.add(outputNameKey(entry))
    accepted.push(entry)
  }

  return { accepted, rejected }
}

export function describeDocumentSelection({ accepted = [], rejected = [] } = {}) {
  if (!accepted.length && !rejected.length) return ''
  const parts = []
  if (accepted.length) parts.push(`已加入 ${accepted.length} 个文件`)
  if (rejected.length) {
    const reasonCounts = rejected.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1
      return counts
    }, {})
    const detail = Object.entries(reasonCounts)
      .map(([reason, count]) => `${rejectionLabels[reason] || rejectionLabels.invalid} ${count} 个`)
      .join('、')
    parts.push(`已忽略 ${rejected.length} 个（${detail}）`)
  }
  return parts.join('；')
}

export function formatDocumentFileSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '大小未知'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
