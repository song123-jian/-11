import { invoke } from '@tauri-apps/api/core'

export const isTauriRuntime = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)

export async function getRuntimeInfo() {
  if (!isTauriRuntime) return { mode: 'browser', version: 'web' }
  return invoke('runtime_info')
}
