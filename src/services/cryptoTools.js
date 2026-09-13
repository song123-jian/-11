let openPgpPromise

async function getOpenPgp() {
  openPgpPromise ||= import('openpgp')
  return openPgpPromise
}

function validate(file, password) {
  if (!file) throw new Error('请先选择文件')
  if (String(password || '').length < 8) throw new Error('加密口令至少需要 8 位')
}

function abortIfRequested(isCanceled) {
  if (!isCanceled?.()) return
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  throw error
}

export async function encryptFile(file, password, { onProgress, onStatus, isCanceled } = {}) {
  validate(file, password)
  onProgress?.(5)
  onStatus?.({ stage: '加载加密引擎' })
  const openpgp = await getOpenPgp()
  abortIfRequested(isCanceled)
  const bytes = new Uint8Array(await file.arrayBuffer())
  onProgress?.(30)
  onStatus?.({ stage: '加密文件' })
  const message = await openpgp.createMessage({ binary: bytes, filename: file.name })
  abortIfRequested(isCanceled)
  const encrypted = await openpgp.encrypt({ message, passwords: [password], format: 'binary' })
  abortIfRequested(isCanceled)
  onProgress?.(95)
  onStatus?.({ stage: '生成加密副本' })
  return {
    blob: new Blob([encrypted], { type: 'application/pgp-encrypted' }),
    filename: `${file.name}.pgp`,
    summary: `已生成 OpenPGP 加密副本；源文件 ${file.name} 未修改`,
  }
}

export async function decryptFile(file, password, { onProgress, onStatus, isCanceled } = {}) {
  validate(file, password)
  if (!file.name.toLowerCase().endsWith('.pgp')) throw new Error('解密仅支持本工具生成的 .pgp 文件')
  onProgress?.(5)
  onStatus?.({ stage: '加载加密引擎' })
  const openpgp = await getOpenPgp()
  abortIfRequested(isCanceled)
  try {
    const message = await openpgp.readMessage({ binaryMessage: new Uint8Array(await file.arrayBuffer()) })
    onProgress?.(35)
    onStatus?.({ stage: '解密文件' })
    const { data } = await openpgp.decrypt({ message, passwords: [password], format: 'binary' })
    abortIfRequested(isCanceled)
    const originalName = message.getFilename?.() || file.name.replace(/\.pgp$/i, '') || `decrypted-${Date.now()}`
    onProgress?.(95)
    onStatus?.({ stage: '生成解密副本' })
    return {
      blob: new Blob([data], { type: 'application/octet-stream' }),
      filename: originalName,
      summary: `已解密为 ${originalName}；加密文件未修改`,
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new Error('解密失败，口令错误或文件已损坏')
  }
}
