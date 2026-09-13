function requestController(milliseconds, externalSignal) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), milliseconds)
  const abort = () => controller.abort()
  externalSignal?.addEventListener('abort', abort, { once: true })
  if (externalSignal?.aborted) abort()
  return {
    signal: controller.signal,
    clear: () => {
      window.clearTimeout(timer)
      externalSignal?.removeEventListener('abort', abort)
    },
  }
}

export async function queryPublicIp({ signal } = {}) {
  if (signal?.aborted) {
    const error = new Error('任务已取消')
    error.name = 'AbortError'
    throw error
  }
  const request = requestController(8000, signal)
  try {
    const response = await fetch('https://api64.ipify.org?format=json', { signal: request.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`IP 服务返回 HTTP ${response.status}`)
    const data = await response.json()
    if (!data.ip) throw new Error('IP 服务未返回有效地址')
    return { value: data.ip, checkedAt: new Date().toLocaleString('zh-CN'), provider: 'ipify' }
  } catch (error) {
    if (error?.name === 'AbortError' && signal?.aborted) throw error
    if (error?.name === 'AbortError') throw new Error('IP 查询超时，请检查网络后重试')
    throw error
  } finally {
    request.clear()
  }
}

export async function testDownloadSpeed({ bytes = 2_000_000, onProgress, onStatus, isCanceled, signal } = {}) {
  if (isCanceled?.() || signal?.aborted) {
    const error = new Error('任务已取消')
    error.name = 'AbortError'
    throw error
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 20000)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const endpoint = `https://speed.cloudflare.com/__down?bytes=${bytes}&cache=${Date.now()}`
  const startedAt = performance.now()
  try {
    onStatus?.({ stage: '连接测速服务' })
    const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok || !response.body) throw new Error(`测速服务返回 HTTP ${response.status}`)
    const reader = response.body.getReader()
    let received = 0
    onStatus?.({ stage: '下载测试数据' })
    while (true) {
      if (isCanceled?.()) {
        controller.abort()
        const error = new Error('任务已取消')
        error.name = 'AbortError'
        throw error
      }
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      onProgress?.(Math.min(95, Math.round((received / bytes) * 95)))
    }
    const seconds = Math.max(0.001, (performance.now() - startedAt) / 1000)
    onStatus?.({ stage: '计算测速结果' })
    return { mbps: (received * 8) / seconds / 1_000_000, bytes: received, seconds, provider: 'Cloudflare speed endpoint' }
  } catch (error) {
    if (error?.name === 'AbortError' && !isCanceled?.()) throw new Error('测速超时，请检查网络后重试')
    throw error
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
