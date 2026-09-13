export const TASK_HISTORY_SCHEMA_VERSION = 1

const ACTIVE_STATUSES = new Set(['waiting', 'running', 'canceling'])
const TERMINAL_STATUSES = new Set(['success', 'failed', 'canceled'])
const TASK_STATUSES = new Set([...ACTIVE_STATUSES, ...TERMINAL_STATUSES])

export const OPERATION_LABELS = Object.freeze({
  'pdf-merge': 'PDF 合并（本地处理）',
  'pdf-split': 'PDF 拆分（本地处理）',
  'rename-browser': '批量重命名（本地处理）',
  'rename-desktop': '批量重命名副本（桌面处理）',
  'archive-compress': 'ZIP 压缩（本地处理）',
  'archive-extract': 'ZIP 解压（本地处理）',
  ocr: 'OCR 文字识别（本地识别）',
  'office-pdf': 'Office 导出 PDF（LibreOffice）',
  exchange: '汇率换算（显式联网）',
  speed: '网速测试',
  ip: '公网 IP 查询',
  ping: 'Ping 检测',
  port: '端口检测',
  screenshot: '屏幕截图',
  'long-screenshot': '长截图定时分段捕获',
  watermark: '批量加水印',
  stitch: '长图拼接',
  'crypto-encrypt': 'OpenPGP 文件加密',
  'crypto-decrypt': 'OpenPGP 文件解密',
  'relay-test': '中转站连接测试',
  'relay-assistant': '中转站 AI 助手',
  unknown: '历史任务',
})

const LABEL_OPERATIONS = new Map(Object.entries(OPERATION_LABELS).map(([operation, label]) => [label, operation]))

export const ERROR_DETAILS = Object.freeze({
  SESSION_INTERRUPTED: ['上次会话结束前未完成', '重新选择输入后安全重试。'],
  INPUT_INVALID: ['输入或参数无效', '修正输入或参数后重新执行。'],
  PERMISSION_DENIED: ['权限或授权不足', '确认系统权限或服务授权后重新执行。'],
  DEPENDENCY_MISSING: ['所需依赖不可用', '安装或启用所需依赖后重新执行。'],
  OUTPUT_CONFLICT: ['输出位置存在冲突', '更换名称或输出位置后重新执行。'],
  STORAGE_FULL: ['目标磁盘空间不足', '释放目标磁盘空间后重新执行。'],
  INPUT_UNREADABLE: ['输入文件无法读取', '确认文件可访问且未损坏后重新执行。'],
  OPERATION_TIMEOUT: ['任务执行超时', '检查网络或外部依赖状态后重新执行。'],
  NETWORK_UNAVAILABLE: ['网络或外部服务不可用', '检查网络连接和服务状态后重新执行。'],
  JOB_CANCELED: ['任务已取消', '需要时重新执行，源文件未修改。'],
  JOB_FAILED: ['任务执行失败', '返回工具页重新选择输入后执行。'],
})

function taskTimestamp(task) {
  const timestamp = Number(task?.createdTimestamp)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function boundedInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, Math.round(number))) : 0
}

function taskOperation(task) {
  const operation = String(task?.operation || '').trim()
  if (Object.hasOwn(OPERATION_LABELS, operation)) return operation
  return LABEL_OPERATIONS.get(String(task?.label || '').trim()) || 'unknown'
}

function taskErrorCode(task, status) {
  if (status === 'success') return null
  if (ACTIVE_STATUSES.has(status)) return null
  if (status === 'canceled') return 'JOB_CANCELED'
  const code = String(task?.errorCode || '').trim()
  return Object.hasOwn(ERROR_DETAILS, code) ? code : 'JOB_FAILED'
}

export function sanitizeTaskForStorage(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return null
  const id = String(task.id || '').trim()
  if (!/^\d{10,16}-[a-f0-9]{4,32}$/i.test(id)) return null
  const status = String(task.status || '')
  if (!TASK_STATUSES.has(status)) return null
  const createdTimestamp = taskTimestamp(task)
  if (createdTimestamp <= 0) return null
  const totalItems = boundedInteger(task.totalItems) || null
  const completedItems = totalItems ? Math.min(totalItems, boundedInteger(task.completedItems, totalItems)) : null
  const record = {
    id,
    operation: taskOperation(task),
    status,
    progress: boundedInteger(task.progress, 100),
    completedItems,
    totalItems,
    cancellable: task.cancellable !== false,
    createdTimestamp,
  }
  const finishedTimestamp = Number(task.finishedTimestamp)
  if (TERMINAL_STATUSES.has(status) && Number.isFinite(finishedTimestamp) && finishedTimestamp > 0) {
    record.finishedTimestamp = finishedTimestamp
  }
  const errorCode = taskErrorCode(task, status)
  if (errorCode) record.errorCode = errorCode
  return record
}

export function serializeTaskHistory(tasks, limit = 30) {
  const maximum = Math.max(1, boundedInteger(limit) || 30)
  return {
    schemaVersion: TASK_HISTORY_SCHEMA_VERSION,
    items: (Array.isArray(tasks) ? tasks : []).map(sanitizeTaskForStorage).filter(Boolean).slice(0, maximum),
  }
}

function hydrateTask(record, now) {
  const wasActive = ACTIVE_STATUSES.has(record.status)
  const status = wasActive ? 'failed' : record.status
  const errorCode = wasActive ? 'SESSION_INTERRUPTED' : taskErrorCode(record, status)
  const details = errorCode ? ERROR_DETAILS[errorCode] : null
  return {
    ...record,
    label: OPERATION_LABELS[record.operation],
    status,
    stage: wasActive ? '会话已中断' : status === 'success' ? '已完成' : status === 'canceled' ? '已取消' : '执行失败',
    remainingItems: record.totalItems ? record.totalItems - record.completedItems : null,
    createdAt: new Date(record.createdTimestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    retryable: false,
    ...(wasActive ? { finishedTimestamp: now } : {}),
    ...(details ? { errorCode, error: details[0], recovery: details[1] } : {}),
  }
}

export function restoreTaskHistory(value, now = Date.now()) {
  const source = Array.isArray(value)
    ? value
    : value?.schemaVersion === TASK_HISTORY_SCHEMA_VERSION && Array.isArray(value.items) ? value.items : []
  return source
    .map(sanitizeTaskForStorage)
    .filter(Boolean)
    .slice(0, 30)
    .map((record) => hydrateTask(record, now))
}

export function separateCompletedTasks(tasks) {
  const source = Array.isArray(tasks) ? tasks : []
  return {
    running: source.filter((task) => ACTIVE_STATUSES.has(task?.status)),
    completed: source.filter((task) => TERMINAL_STATUSES.has(task?.status)),
  }
}

export function restoreCompletedTasks(currentTasks, clearedTasks, limit = 30) {
  const byId = new Map()
  for (const task of [...(Array.isArray(currentTasks) ? currentTasks : []), ...(Array.isArray(clearedTasks) ? clearedTasks : [])]) {
    if (task?.id && !byId.has(task.id)) byId.set(task.id, task)
  }
  return [...byId.values()]
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left))
    .slice(0, Math.max(1, Number(limit) || 30))
}
