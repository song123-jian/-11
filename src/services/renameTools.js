let zipPromise

async function getZip() {
  zipPromise ||= import('jszip').then(({ default: JSZip }) => JSZip)
  return zipPromise
}

function extensionOf(filename) {
  const index = filename.lastIndexOf('.')
  return index > -1 ? filename.slice(index) : ''
}

function abortIfRequested(isCanceled) {
  if (!isCanceled?.()) return
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  throw error
}

export function renderRenamePattern(pattern, index) {
  return String(pattern || '').split('{n}').join(String(index + 1).padStart(2, '0'))
}

export async function packageRenamedFiles(items, pattern, { onProgress, onStatus, isCanceled } = {}) {
  if (!items.length) throw new Error('请先选择至少一个文件')
  if (!String(pattern || '').trim()) throw new Error('命名模板不能为空')
  if (/[<>:"/\\|?*\u0000-\u001F]/.test(pattern)) throw new Error('命名模板包含 Windows 不允许的字符')
  const names = items.map((item, index) => `${renderRenamePattern(pattern, index)}${extensionOf(item.name)}`)
  const normalized = names.map((name) => name.toLocaleLowerCase())
  if (new Set(normalized).size !== normalized.length) throw new Error('新名称存在重复，请修改命名模板')
  const JSZip = await getZip()
  abortIfRequested(isCanceled)
  const zip = new JSZip()
  onStatus?.({ stage: '写入重命名归档', completed: 0, total: items.length })
  for (const [index, item] of items.entries()) {
    abortIfRequested(isCanceled)
    zip.file(names[index], item.file)
    onProgress?.(Math.round(5 + ((index + 1) / items.length) * 25))
    onStatus?.({ stage: '写入重命名归档', completed: index + 1, total: items.length })
  }
  onStatus?.({ stage: '生成 ZIP' })
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE' },
    ({ percent }) => {
      abortIfRequested(isCanceled)
      onProgress?.(Math.round(30 + percent * 0.65))
    },
  )
  abortIfRequested(isCanceled)
  return {
    blob,
    filename: `renamed-${Date.now()}.zip`,
    summary: `已生成 ${items.length} 个文件的新名称归档；源文件未修改`,
  }
}
