import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './runtime'

function requireDesktop() {
  if (!isTauriRuntime) throw new Error('此功能需要在 Tauri 桌面版中运行')
}

export async function getDesktopCapabilities() {
  if (!isTauriRuntime) return { libreoffice: null, platform: 'browser' }
  return invoke('dependency_status')
}

export async function selectOfficeFiles() {
  requireDesktop()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [{ name: 'Office 文档', extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'] }],
  })
  return Array.isArray(selected) ? selected : selected ? [selected] : []
}

export async function selectRenameFiles() {
  requireDesktop()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ multiple: true, directory: false })
  return Array.isArray(selected) ? selected : selected ? [selected] : []
}

export async function selectOutputDirectory() {
  requireDesktop()
  const { open } = await import('@tauri-apps/plugin-dialog')
  return open({ multiple: false, directory: true })
}

export async function selectCcSwitchConfigFile() {
  requireDesktop()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'CC Switch 数据库或 SQL 备份', extensions: ['db', 'sqlite', 'sqlite3', 'sql'] }],
  })
  return Array.isArray(selected) ? selected[0] || '' : selected || ''
}

export async function readCcSwitchProviders(path) {
  requireDesktop()
  if (!path) throw new Error('请选择 CC Switch 数据库或 SQL 备份文件')
  return invoke('read_ccswitch_providers', { filePath: path })
}

export async function convertOfficeToPdf(inputs, outputDirectory, conflictPolicy = 'stop') {
  requireDesktop()
  return invoke('office_to_pdf', { inputs, outputDirectory, conflictPolicy })
}

export async function copyRenamedFiles(inputs, outputDirectory, pattern, conflictPolicy = 'stop') {
  requireDesktop()
  return invoke('copy_renamed_files', { inputs, outputDirectory, pattern, conflictPolicy })
}

export async function pingHost(host, timeoutMs, requestId = null) {
  requireDesktop()
  return invoke('ping_host', { host, timeoutMs, requestId })
}

export async function probePort(host, port, timeoutMs, requestId = null) {
  requireDesktop()
  return invoke('probe_port', { host, port, timeoutMs, requestId })
}

export async function cancelNetworkJob(requestId) {
  if (!isTauriRuntime || !requestId) return false
  return invoke('cancel_network_job', { requestId })
}
