let pdfLibPromise

async function getPdfDocument() {
  pdfLibPromise ||= import('pdf-lib').then(({ PDFDocument }) => PDFDocument)
  return pdfLibPromise
}

function ensurePdf(file) {
  const name = file?.name?.toLowerCase() || ''
  if (!name.endsWith('.pdf') && file?.type !== 'application/pdf') {
    throw new Error('仅支持 PDF 文件，请移除其他格式后重试')
  }
}

async function loadPdf(file, isCanceled) {
  ensurePdf(file)
  try {
    const PDFDocument = await getPdfDocument()
    abortIfRequested(isCanceled)
    const bytes = await file.arrayBuffer()
    abortIfRequested(isCanceled)
    return await PDFDocument.load(bytes)
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new Error(`${file.name} 无法读取，文件可能损坏或已加密`)
  }
}

function abortIfRequested(isCanceled) {
  if (!isCanceled?.()) return
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  throw error
}

export async function mergePdfs(files, { onProgress, onStatus, isCanceled } = {}) {
  if (files.length < 2) throw new Error('PDF 合并至少需要两个文件')
  onProgress?.(2)
  onStatus?.({ stage: '加载 PDF', completed: 0, total: files.length })
  const PDFDocument = await getPdfDocument()
  const output = await PDFDocument.create()
  let pages = 0
  for (const [index, file] of files.entries()) {
    abortIfRequested(isCanceled)
    const source = await loadPdf(file, isCanceled)
    const copied = await output.copyPages(source, source.getPageIndices())
    copied.forEach((page) => output.addPage(page))
    pages += copied.length
    onProgress?.(Math.round(10 + ((index + 1) / files.length) * 75))
    onStatus?.({ stage: '合并页面', completed: index + 1, total: files.length })
  }
  abortIfRequested(isCanceled)
  onStatus?.({ stage: '生成 PDF' })
  const bytes = await output.save()
  onProgress?.(95)
  return {
    blob: new Blob([bytes], { type: 'application/pdf' }),
    filename: `merged-${Date.now()}.pdf`,
    summary: `已合并 ${files.length} 个文件，共 ${pages} 页`,
  }
}

function parsePageRange(value, pageCount) {
  const source = String(value || '').replace(/\s/g, '')
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(source)) {
    throw new Error('页码范围格式无效，请使用例如 1-2,4')
  }
  const pages = []
  for (const token of source.split(',')) {
    const [startText, endText = startText] = token.split('-')
    const start = Number(startText)
    const end = Number(endText)
    if (start < 1 || end < start || end > pageCount) {
      throw new Error(`页码超出范围，当前文件共 ${pageCount} 页`)
    }
    for (let page = start; page <= end; page += 1) {
      if (!pages.includes(page - 1)) pages.push(page - 1)
    }
  }
  return pages
}

export async function splitPdf(file, pageRange, { onProgress, onStatus, isCanceled } = {}) {
  onProgress?.(2)
  onStatus?.({ stage: '读取 PDF' })
  const PDFDocument = await getPdfDocument()
  const source = await loadPdf(file, isCanceled)
  const indices = parsePageRange(pageRange, source.getPageCount())
  const outputs = []
  onStatus?.({ stage: '拆分页码', completed: 0, total: indices.length })
  for (const [index, pageIndex] of indices.entries()) {
    abortIfRequested(isCanceled)
    const output = await PDFDocument.create()
    const [page] = await output.copyPages(source, [pageIndex])
    output.addPage(page)
    outputs.push({ name: `page-${pageIndex + 1}.pdf`, bytes: await output.save() })
    onProgress?.(Math.round(15 + ((index + 1) / indices.length) * 70))
    onStatus?.({ stage: '拆分页码', completed: index + 1, total: indices.length })
  }
  abortIfRequested(isCanceled)
  if (outputs.length === 1) {
    onStatus?.({ stage: '生成 PDF' })
    return {
      blob: new Blob([outputs[0].bytes], { type: 'application/pdf' }),
      filename: `split-${outputs[0].name}`,
      summary: `已拆分第 ${indices[0] + 1} 页，共 ${source.getPageCount()} 页`,
    }
  }
  const { default: JSZip } = await import('jszip')
  abortIfRequested(isCanceled)
  onStatus?.({ stage: '生成 ZIP' })
  const zip = new JSZip()
  outputs.forEach((item) => zip.file(item.name, item.bytes))
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE' },
    ({ percent }) => {
      abortIfRequested(isCanceled)
      onProgress?.(Math.round(85 + percent * 0.1))
    },
  )
  abortIfRequested(isCanceled)
  return {
    blob,
    filename: `split-${Date.now()}.zip`,
    summary: `已拆分 ${indices.length} 个独立 PDF，共 ${source.getPageCount()} 页`,
  }
}
