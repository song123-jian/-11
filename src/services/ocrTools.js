let tesseractPromise

async function getTesseract() {
  tesseractPromise ||= import('tesseract.js')
  return tesseractPromise
}

function abortError() {
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  return error
}

function ocrStage(status) {
  const stages = {
    'loading tesseract core': '加载 OCR 引擎',
    'initializing tesseract': '初始化 OCR 引擎',
    'loading language traineddata': '下载语言模型',
    'initializing api': '初始化语言模型',
    'recognizing text': '识别文字',
  }
  return stages[String(status || '').toLocaleLowerCase()] || '识别文字'
}

export async function checkOcrRuntime(loadModule = getTesseract) {
  try {
    const module = await loadModule()
    if (typeof module?.createWorker !== 'function') throw new Error('OCR 引擎入口缺失')
    return { available: true, engine: 'Tesseract.js', requiresToken: false }
  } catch {
    throw new Error('本地 OCR 引擎未就绪，请检查应用依赖后重试')
  }
}

export async function recognizeText(file, language = 'chi_sim+eng', { onProgress, onStatus, isCanceled } = {}) {
  if (!file) throw new Error('请先选择待识别图片')
  if (!file.type?.startsWith('image/')) throw new Error('当前 OCR 支持 JPG、PNG、WebP 等图片格式')
  let worker
  try {
    onStatus?.({ stage: '加载 OCR 引擎' })
    const { createWorker } = await getTesseract()
    if (isCanceled?.()) throw abortError()
    worker = await createWorker(language, undefined, {
      logger: ({ progress = 0, status }) => {
        onProgress?.(Math.round(5 + progress * 90))
        onStatus?.({ stage: ocrStage(status) })
        if (isCanceled?.()) worker?.terminate()
      },
    })
    if (isCanceled?.()) throw abortError()
    const result = await worker.recognize(file)
    if (isCanceled?.()) throw abortError()
    const text = result.data.text.trim()
    if (!text) throw new Error('未识别到文字，请更换更清晰的图片')
    onStatus?.({ stage: '整理识别结果' })
    return { text, confidence: result.data.confidence, language }
  } catch (error) {
    if (isCanceled?.() || error?.name === 'AbortError') throw abortError()
    if (error?.message?.startsWith('未识别到')) throw error
    throw new Error('OCR 初始化或识别失败，请检查网络后重试；图片内容不会上传')
  } finally {
    await worker?.terminate().catch(() => {})
  }
}
