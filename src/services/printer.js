import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './runtime'

export const MAX_NATIVE_PRINT_BYTES = 64 * 1024 * 1024

function encodeBase64(bytes) {
  if (typeof btoa !== 'function') throw new Error('当前环境不支持本地打印数据编码')
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}
export async function listLocalPrinters() {
  if (!isTauriRuntime) return []
  return invoke('list_printers')
}

export async function printLocalFile({ file, fileName, printerName = '' } = {}) {
  if (!isTauriRuntime) throw new Error('本地打印接口需要在 Windows 桌面版中运行')
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('没有可打印的本地文件')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!bytes.length) throw new Error('打印文件不能为空')
  if (bytes.length > MAX_NATIVE_PRINT_BYTES) throw new Error('打印文件超过 64 MB 限制，请先压缩或拆分')
  return invoke('print_file', {
    fileName: String(fileName || file.name || 'document.bin'),
    contentBase64: encodeBase64(bytes),
    printerName: printerName || null,
  })
}
