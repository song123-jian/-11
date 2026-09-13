import { ERROR_DETAILS, OPERATION_LABELS } from './taskHistoryTools.js'

let zipPromise

export const DIAGNOSTIC_SCHEMA_VERSION = 3
export const DIAGNOSTIC_EVENT_LIMIT = 30

const DIAGNOSTIC_ENTRIES = Object.freeze(['manifest.json', 'task-events.json', 'privacy.txt'])
const DIAGNOSTIC_EXCLUSIONS = Object.freeze(['文档正文', '文件内容', '口令与密钥', '完整文件路径', '便签与提醒正文'])
const TASK_STATUSES = new Set(['waiting', 'running', 'canceling', 'success', 'failed', 'canceled'])
const DEPENDENCY_STATES = new Set(['available', 'missing', 'not-applicable', 'unknown'])
const PLATFORMS = new Set(['windows', 'linux', 'macos', 'browser', 'unknown'])
const DEFAULT_STAGES = Object.freeze({
  waiting: '等待执行',
  running: '处理中',
  canceling: '正在取消',
  success: '已完成',
  failed: '执行失败',
  canceled: '已取消',
  unknown: '未知阶段',
})
const SAFE_STAGES = new Set([
  ...Object.values(DEFAULT_STAGES),
  '会话已中断', '连接中转站', '读取模型列表', '整理连接结果', '校验输入',
  '加载 PDF', '合并页面', '生成 PDF', '读取 PDF', '拆分页码', '生成 ZIP',
  '写入重命名归档', '写入归档', '压缩归档', '提取文件', '加载 OCR 引擎',
  '初始化 OCR 引擎', '下载语言模型', '初始化语言模型', '识别文字', '整理识别结果',
  '复制文件副本', '整理逐项结果', '转换 Office 文件', '连接汇率服务', '读取最新汇率',
  '整理换算结果', '连接测速服务', '下载测试数据', '计算测速结果', '连接 IP 服务',
  '读取公网 IP', '整理检测结果', '连接桌面网络服务', '检测目标连通性', '检测目标端口',
  '等待屏幕授权', '等待开始', '捕获屏幕分段', '拼接屏幕分段', '生成截图结果',
  '生成水印', '读取图片', '绘制拼接结果', '加载加密引擎', '加密文件',
  '生成加密副本', '解密文件', '生成解密副本', '准备中转站请求', '等待中转站响应',
  '整理中转站结果',
])

async function getZip() {
  zipPromise ||= import('jszip').then(({ default: JSZip }) => JSZip)
  return zipPromise
}

function safeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function boundedInteger(value, maximum = Number.MAX_SAFE_INTEGER, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, Math.round(number))) : fallback
}

function safeAppVersion(value) {
  const version = String(value ?? '').trim()
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version) ? version : '0.1.0'
}

function safePlatform(value) {
  const platform = String(value ?? '').trim().toLocaleLowerCase()
  return PLATFORMS.has(platform) ? platform : 'unknown'
}

function safeStatus(value) {
  return TASK_STATUSES.has(value) ? value : 'unknown'
}

function safeOperation(value) {
  const operation = String(value || '').trim()
  return Object.hasOwn(OPERATION_LABELS, operation) ? operation : 'unknown'
}

function safeStage(value, status) {
  const stage = String(value || '').trim()
  return SAFE_STAGES.has(stage) ? stage : DEFAULT_STAGES[status]
}

function safeErrorCode(value, status) {
  if (status === 'canceled') return 'JOB_CANCELED'
  if (status !== 'failed') return null
  const code = String(value || '').trim()
  return Object.hasOwn(ERROR_DETAILS, code) ? code : 'JOB_FAILED'
}

function safeTaskEvent(task, source = 'task') {
  const status = safeStatus(task?.status)
  const totalValue = boundedInteger(task?.totalItems, 1_000_000)
  const totalItems = totalValue > 0 ? totalValue : null
  const completedItems = totalItems ? Math.min(totalItems, boundedInteger(task?.completedItems, totalItems, 0)) : null
  const inputValue = boundedInteger(task?.inputCount ?? totalItems, 1_000_000)
  const inputCount = inputValue > 0 ? inputValue : null
  const startedAt = safeTimestamp(source === 'task' ? task?.createdTimestamp : task?.startedAt)
  const finishedAt = safeTimestamp(source === 'task' ? task?.finishedTimestamp : task?.finishedAt)
  const startedMs = startedAt ? new Date(startedAt).getTime() : null
  const finishedMs = finishedAt ? new Date(finishedAt).getTime() : null
  const durationMs = startedMs !== null && finishedMs !== null && finishedMs >= startedMs
    ? Math.min(31 * 24 * 60 * 60 * 1000, finishedMs - startedMs)
    : null
  return {
    operation: safeOperation(task?.operation),
    status,
    stage: safeStage(task?.stage, status),
    progress: boundedInteger(task?.progress, 100, 0),
    inputCount,
    completedItems,
    totalItems,
    remainingItems: totalItems ? totalItems - completedItems : null,
    errorCode: safeErrorCode(task?.errorCode, status),
    startedAt,
    finishedAt,
    durationMs,
  }
}

function taskCounts(events) {
  const counts = events.reduce((result, event) => {
    result[event.status] = (result[event.status] || 0) + 1
    return result
  }, { waiting: 0, running: 0, canceling: 0, success: 0, failed: 0, canceled: 0, unknown: 0 })
  return counts
}

function diagnosticSnapshot(events, manifest = {}) {
  const runtimeMode = manifest.runtimeMode === 'tauri' ? 'tauri' : 'browser'
  const libreOffice = DEPENDENCY_STATES.has(manifest.dependencies?.libreOffice) ? manifest.dependencies.libreOffice : 'unknown'
  const webView2 = DEPENDENCY_STATES.has(manifest.dependencies?.webView2) ? manifest.dependencies.webView2 : 'unknown'
  return {
    manifest: {
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      app: '效率百宝箱',
      appVersion: safeAppVersion(manifest.appVersion),
      generatedAt: safeTimestamp(manifest.generatedAt) || new Date().toISOString(),
      runtimeMode,
      platform: safePlatform(manifest.platform),
      dependencies: { libreOffice, webView2 },
      taskCounts: taskCounts(events),
      retention: { storage: 'local-only', maxEvents: DIAGNOSTIC_EVENT_LIMIT },
      telemetry: { crashReporting: 'disabled', automaticUpload: 'disabled', exportMode: 'manual-download' },
    },
    taskEvents: events,
    entries: [...DIAGNOSTIC_ENTRIES],
    excluded: [...DIAGNOSTIC_EXCLUSIONS],
  }
}

export function buildDiagnosticSnapshot({ tasks = [], runtimeMode, capabilities = {}, appVersion = '0.1.0' } = {}) {
  const events = (Array.isArray(tasks) ? tasks : []).slice(0, DIAGNOSTIC_EVENT_LIMIT).map((task) => safeTaskEvent(task))
  return diagnosticSnapshot(events, {
    appVersion,
    generatedAt: new Date(),
    runtimeMode,
    platform: capabilities.platform,
    dependencies: {
      libreOffice: capabilities.libreoffice ? 'available' : 'missing',
      webView2: runtimeMode === 'tauri' ? 'available' : 'not-applicable',
    },
  })
}

export function normalizeDiagnosticSnapshot(snapshot) {
  const events = (Array.isArray(snapshot?.taskEvents) ? snapshot.taskEvents : [])
    .slice(0, DIAGNOSTIC_EVENT_LIMIT)
    .map((event) => safeTaskEvent(event, 'snapshot'))
  return diagnosticSnapshot(events, snapshot?.manifest)
}

export async function createDiagnosticBundle(snapshot) {
  if (snapshot?.manifest?.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION || !Array.isArray(snapshot?.taskEvents)) {
    throw new Error('请先预览诊断包')
  }
  const normalized = normalizeDiagnosticSnapshot(snapshot)
  const JSZip = await getZip()
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(normalized.manifest, null, 2))
  zip.file('task-events.json', JSON.stringify(normalized.taskEvents, null, 2))
  zip.file('privacy.txt', `诊断包主动排除：${normalized.excluded.join('、')}。\n诊断包仅在用户点击下载后保存在所选位置，不会自动上传。\n`)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const timestamp = normalized.manifest.generatedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return { blob, filename: `efficiency-toolbox-diagnostics-${timestamp}.zip` }
}
