import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { calculateAnnualTax, calculateBmi, calculateMortgage } from '../src/services/financeTools.js'
import { buildCalculatorResult, calculateExpression, formatChineseCurrency, formatLowercaseAmount } from '../src/services/calculatorTools.js'
import { calculateAge, calculateDateDifference } from '../src/services/dateTools.js'
import { createJob, normalizeJobStatus } from '../src/services/jobQueue.js'
import { buildDiagnosticSnapshot, createDiagnosticBundle, DIAGNOSTIC_EVENT_LIMIT, DIAGNOSTIC_SCHEMA_VERSION } from '../src/services/diagnosticsTools.js'
import { normalizeTaskError } from '../src/services/taskErrors.js'
import { normalizeLongCaptureOptions } from '../src/services/imageBatchTools.js'
import { checkOcrRuntime } from '../src/services/ocrTools.js'
import { renderRenamePattern } from '../src/services/renameTools.js'
import { authorizeOnlineAction, consentedScopes, createConsentDisclosure, grantConsent, isConsentGranted, normalizeConsent, ONLINE_CONSENT_POLICY_VERSION, ONLINE_CONSENT_SCHEMA_VERSION, revokeAllConsent } from '../src/services/privacyConsent.js'
import { applyDeepSeekPreset, callRelayChat, clearRelayApiKey, DEEPSEEK_RELAY_PRESET, isDeepSeekPreset, loadRelayConfig, maskRelayApiKey, normalizeRelayConfig, saveRelayConfig, testRelayConnection } from '../src/services/relayApi.js'
import { buildCcSwitchProviderLink, ccSwitchProviderJson, parseCcSwitchProviderLink } from '../src/services/ccSwitch.js'
import { filterSearchTools, normalizeSearchIndex, stepSearchIndex } from '../src/services/searchTools.js'
import { buildDependencyStatus } from '../src/services/dependencyTools.js'
import { describeDocumentSelection, formatDocumentFileSize, selectDocumentFiles } from '../src/services/fileQueueTools.js'
import { loadState, PERSISTED_STATE_KEYS, removeState, saveState, STATE_SCHEMA_VERSION } from '../src/services/storage.js'
import { restoreCompletedTasks, restoreTaskHistory, sanitizeTaskForStorage, separateCompletedTasks, serializeTaskHistory, TASK_HISTORY_SCHEMA_VERSION } from '../src/services/taskHistoryTools.js'
import { normalizeQuickNote, normalizeRecentTools, normalizeReminders, normalizeTheme, normalizeTodos } from '../src/services/localStateModels.js'
import { DEFAULT_UI_PREFS, normalizeDensity, normalizeUiPrefs } from '../src/services/uiPreferences.js'
import { createToolRegistry, filterRegisteredTools } from '../src/services/toolRegistry.js'

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('global search supports recent tools, aliases, and keyboard-safe result indexes', () => {
  const tools = [
    { id: 'pdf-merge', label: 'PDF 合并', description: '合并多个 PDF', level: 'P0' },
    { id: 'archive', label: '压缩 / 解压', description: '创建 ZIP', level: 'P1' },
    { id: 'ocr', label: 'OCR 文字识别', description: '识别图片文字', level: 'P1' },
  ]
  const aliases = { 'pdf-merge': ['PDF 拼接'], archive: ['压缩包'] }
  assert.deepEqual(filterSearchTools(tools, '', ['archive', 'archive', 'pdf-merge', 'missing'], aliases).map((tool) => tool.id), ['archive', 'pdf-merge', 'ocr'])
  assert.deepEqual(filterSearchTools(tools, '拼接', [], aliases).map((tool) => tool.id), ['pdf-merge'])
  assert.equal(normalizeSearchIndex(4, 3), 0)
  assert.equal(normalizeSearchIndex(0, 0), -1)
  assert.equal(stepSearchIndex(-1, 3, -1), 2)
  assert.equal(stepSearchIndex(2, 3, 1), 0)
})

test('ui preferences normalize safe values and tool registry accepts extension definitions', () => {
  assert.deepEqual(normalizeUiPrefs({ sidebarCollapsed: true, density: 'compact', lastTool: 'custom', taskPanelPinned: true }, ['custom']), {
    sidebarCollapsed: true,
    density: 'compact',
    lastTool: 'custom',
    taskPanelPinned: true,
  })
  assert.deepEqual(normalizeUiPrefs({ sidebarCollapsed: 'yes', density: 'wide', lastTool: 'missing' }, ['custom']), DEFAULT_UI_PREFS)
  assert.equal(normalizeDensity('compact'), 'compact')
  assert.equal(normalizeDensity('wide'), 'comfortable')

  const registry = createToolRegistry([{ id: 'alpha', module: 'custom', label: 'Alpha', description: '扩展工具', aliases: ['测试'] }])
  assert.equal(registry.register({ id: 'beta', module: 'custom', label: 'Beta' }), true)
  assert.equal(registry.register({ id: 'alpha', module: 'custom', label: 'Duplicate' }), false)
  assert.deepEqual(filterRegisteredTools(registry, '测试').map((tool) => tool.id), ['alpha'])
  assert.deepEqual(filterRegisteredTools(registry, '', ['beta']).map((tool) => tool.id), ['beta', 'alpha'])
})

test('dependency status distinguishes desktop readiness, optional models, and offline recovery', () => {
  const desktop = buildDependencyStatus({ runtimeMode: 'tauri', capabilities: { libreoffice: 'C:/Program Files/LibreOffice/soffice.exe' }, online: true })
  assert.deepEqual(desktop.map((item) => [item.id, item.status]), [
    ['webview2', 'ready'], ['libreoffice', 'ready'], ['ocr', 'informational'], ['network', 'ready'],
  ])
  const browserOffline = buildDependencyStatus({ runtimeMode: 'browser', capabilities: {}, online: false })
  assert.equal(browserOffline.find((item) => item.id === 'webview2').statusLabel, '浏览器模式')
  assert.equal(browserOffline.find((item) => item.id === 'libreoffice').status, 'attention')
  assert.equal(browserOffline.find((item) => item.id === 'network').statusLabel, '系统离线')
  assert.equal(browserOffline.find((item) => item.id === 'ocr').toolId, 'ocr')
})

test('document input selection rejects invalid and colliding drop files before a task starts', () => {
  const makeFile = (name, size, type, lastModified) => ({ name, size, type, lastModified })
  const report = makeFile('report.pdf', 2_048, 'application/pdf', 1)
  const pdfSelection = selectDocumentFiles([
    report,
    makeFile('report.pdf', 2_048, 'application/pdf', 1),
    makeFile('empty.pdf', 0, 'application/pdf', 2),
    makeFile('photo.png', 512, 'image/png', 3),
  ], { mode: 'pdf-merge', multiple: true })
  assert.deepEqual(pdfSelection.accepted.map((item) => item.name), ['report.pdf'])
  assert.deepEqual(pdfSelection.rejected.map((item) => item.reason), ['duplicate', 'empty', 'unsupported-type'])
  assert.equal(describeDocumentSelection(pdfSelection), '已加入 1 个文件；已忽略 3 个（重复文件 1 个、空文件 1 个、当前操作不支持的格式 1 个）')

  const archiveSelection = selectDocumentFiles([
    makeFile('invoice.txt', 10, 'text/plain', 1),
    makeFile('invoice.txt', 11, 'text/plain', 2),
  ], { mode: 'archive', archiveMode: 'compress', multiple: true })
  assert.deepEqual(archiveSelection.accepted.map((item) => item.name), ['invoice.txt'])
  assert.deepEqual(archiveSelection.rejected.map((item) => item.reason), ['output-conflict'])

  const pathSelection = selectDocumentFiles([
    { path: 'C:/Inbox/report.txt', name: 'report.txt', size: 0 },
    { path: 'c:/inbox/REPORT.txt', name: 'REPORT.txt', size: 0 },
  ], { mode: 'rename', multiple: true })
  assert.deepEqual(pathSelection.accepted.map((item) => item.path), ['C:/Inbox/report.txt'])
  assert.deepEqual(pathSelection.rejected.map((item) => item.reason), ['duplicate'])
  assert.equal(formatDocumentFileSize(1_536), '1.5 KB')
})

test('finance calculations keep rule versions and stable sample results', () => {
  const bmi = calculateBmi(70, 175)
  assert.equal(bmi.category, '正常')
  assert.equal(Number(bmi.bmi.toFixed(2)), 22.86)
  assert.match(bmi.rule, /WS\/T 428-2013/)

  const mortgage = calculateMortgage({ principal: 1_000_000, years: 30, annualRate: 3.5, method: 'equal-payment' })
  assert.equal(Number(mortgage.firstPayment.toFixed(2)), 4490.45)
  assert.equal(mortgage.months, 360)

  const tax = calculateAnnualTax({ annualIncome: 200_000, annualDeduction: 20_000 })
  assert.equal(tax.taxable, 120_000)
  assert.equal(tax.tax, 9480)
  assert.match(tax.rule, /2019-01-01/)
})

test('calculator evaluates bounded arithmetic and displays lowercase/uppercase amounts', () => {
  assert.equal(calculateExpression('（12.5 - 2.5） * 3'), 30)
  assert.equal(calculateExpression('1 + 2 × 3'), 7)
  assert.equal(calculateExpression('-12 / 4'), -3)
  assert.deepEqual(buildCalculatorResult(1_600), {
    value: 1_600,
    lowercase: '1,600.00',
    uppercase: '人民币壹仟陆佰元整',
  })
  assert.equal(formatLowercaseAmount(1001.05), '1,001.05')
  assert.equal(formatChineseCurrency(1001.05), '人民币壹仟零壹元零伍分')
  assert.equal(formatChineseCurrency(0.05), '人民币零元伍分')
  assert.equal(formatChineseCurrency(-12.3), '负人民币壹拾贰元叁角')
  assert.throws(() => calculateExpression(''), /请输入计算表达式/)
  assert.throws(() => calculateExpression('1 / 0'), /不能除以 0/)
  assert.throws(() => calculateExpression('1 +'), /表达式格式无效/)
  assert.throws(() => calculateExpression('2 ** 3'), /表达式格式无效/)
  assert.throws(() => formatChineseCurrency(1_000_000_000_000), /不能超过/)
})

test('date tools cover age and ordered date differences with invalid-date boundaries', () => {
  assert.equal(calculateAge('1995-01-01', new Date('2026-01-01T12:00:00Z')).years, 31)
  assert.equal(calculateAge('2000-02-29', new Date('2021-02-28T12:00:00Z')).years, 20)
  assert.deepEqual(calculateDateDifference('2026-01-01', '2026-01-31'), { days: 30, signedDays: 30, direction: '正向' })
  assert.deepEqual(calculateDateDifference('2026-02-01', '2026-01-31'), { days: 1, signedDays: -1, direction: '倒序' })
  assert.throws(() => calculateDateDifference('2026-02-30', '2026-03-01'), /不是有效日期/)
  assert.throws(() => calculateAge('2027-01-01', new Date('2026-01-01T12:00:00Z')), /不能晚于/)
})

test('task errors map to stable codes without changing the original message', () => {
  const network = normalizeTaskError(new TypeError('Failed to fetch'))
  assert.deepEqual(network, {
    code: 'NETWORK_UNAVAILABLE',
    message: 'Failed to fetch',
    retryable: true,
    recovery: '检查网络连接和服务状态后安全重试。',
  })
  const invalid = normalizeTaskError(new Error('页码范围格式无效，请使用例如 1-2,4'))
  assert.equal(invalid.code, 'INPUT_INVALID')
  assert.equal(invalid.retryable, false)
  const conflict = normalizeTaskError(new Error('输出文件已存在，未执行覆盖'))
  assert.equal(conflict.code, 'OUTPUT_CONFLICT')
  const storageFull = normalizeTaskError(new Error('复制文件失败：磁盘空间不足，未完成该文件副本'))
  assert.deepEqual(storageFull, {
    code: 'STORAGE_FULL',
    message: '复制文件失败：磁盘空间不足，未完成该文件副本',
    retryable: true,
    recovery: '释放目标磁盘空间后安全重试；源文件不会被修改。',
  })
  assert.equal(normalizeTaskError(new Error('中转站接口不存在，请确认 Base URL')).code, 'INPUT_INVALID')
  assert.equal(normalizeTaskError(new Error('中转站鉴权失败，请检查 API Key')).code, 'PERMISSION_DENIED')
})

test('local state reads legacy values, writes a versioned envelope, and preserves future schemas', () => {
  const previousWindow = globalThis.window
  const localStorage = createMemoryStorage()
  globalThis.window = { localStorage }
  try {
    localStorage.setItem('efficiency-toolbox:theme', JSON.stringify('dark'))
    assert.equal(loadState('theme', 'light'), 'dark')
    assert.equal(localStorage.getItem('efficiency-toolbox:theme'), JSON.stringify('dark'))
    assert.equal(saveState('theme', 'dark'), true)
    assert.deepEqual(JSON.parse(localStorage.getItem('efficiency-toolbox:theme')), {
      schemaVersion: STATE_SCHEMA_VERSION,
      value: 'dark',
    })
    assert.equal(saveState('theme', 'light'), true)
    assert.equal(loadState('theme', 'dark'), 'light')
    localStorage.setItem('efficiency-toolbox:theme', JSON.stringify({ schemaVersion: 99, value: 'dark' }))
    assert.equal(loadState('theme', 'light'), 'light')
    assert.equal(saveState('theme', 'light'), false)
    assert.deepEqual(JSON.parse(localStorage.getItem('efficiency-toolbox:theme')), { schemaVersion: 99, value: 'dark' })
    assert.equal(PERSISTED_STATE_KEYS.includes('tasks'), true)
    assert.equal(PERSISTED_STATE_KEYS.includes('ui-prefs'), true)
    assert.equal(saveState('api-key', 'must-not-persist'), false)
    assert.equal(localStorage.getItem('efficiency-toolbox:api-key'), null)
    assert.equal(loadState('api-key', 'fallback'), 'fallback')
    assert.equal(removeState('api-key'), false)
    assert.equal(removeState('theme'), true)
    assert.equal(localStorage.getItem('efficiency-toolbox:theme'), null)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('typed local state normalizes corrupt values and removes unowned fields', () => {
  assert.equal(normalizeTheme('purple'), 'light')
  assert.deepEqual(normalizeRecentTools(['ocr', 'missing', 'ocr', 'pdf-merge'], ['ocr', 'pdf-merge']), ['ocr', 'pdf-merge'])
  assert.deepEqual(normalizeTodos([
    { id: 1, text: '  合法待办  ', done: true, apiKey: 'discard' },
    { id: 1, text: '重复项', done: false },
    { id: 2, text: '', done: false },
    { id: 'invalid', text: '无效 ID', done: false },
  ]), [{ id: 1, text: '合法待办', done: true }])
  assert.equal(normalizeQuickNote(42), '')
  assert.equal(normalizeQuickNote('x'.repeat(20_001)).length, 20_000)
  assert.deepEqual(normalizeReminders([
    { id: 1, title: '  提交周报  ', at: '2026-09-13T09:00', notified: true, password: 'discard' },
    { id: 1, title: '重复', at: '2026-09-14T09:00', notified: false },
    { id: 2, title: '无效时间', at: 'not-a-date', notified: false },
  ]), [{ id: 1, title: '提交周报', at: '2026-09-13T09:00', notified: true }])
})

test('task history persists only versioned metadata and scrubs legacy sensitive fields', () => {
  const createdTimestamp = Date.UTC(2026, 8, 12)
  const marker = 'SENSITIVE_MARKER_DO_NOT_STORE'
  const legacy = [
    {
      id: `${createdTimestamp}-abcd1234`,
      label: 'PDF 合并（本地处理）',
      status: 'failed',
      stage: `读取 ${marker}`,
      progress: 35,
      completedItems: 2,
      totalItems: 5,
      errorCode: 'INPUT_UNREADABLE',
      error: `C:/private/${marker}/contract.pdf 无法读取`,
      recovery: marker,
      password: marker,
      apiKey: marker,
      content: marker,
      inputPath: marker,
      createdTimestamp,
      finishedTimestamp: createdTimestamp + 1_000,
    },
    {
      id: `${createdTimestamp + 1}-beef5678`,
      label: marker,
      status: 'running',
      progress: 10,
      createdTimestamp: createdTimestamp + 1,
    },
  ]
  const stored = serializeTaskHistory(legacy)
  assert.equal(stored.schemaVersion, TASK_HISTORY_SCHEMA_VERSION)
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(marker))
  assert.deepEqual(Object.keys(stored.items[0]).sort(), [
    'cancellable', 'completedItems', 'createdTimestamp', 'errorCode', 'finishedTimestamp', 'id', 'operation', 'progress', 'status', 'totalItems',
  ])
  assert.equal(sanitizeTaskForStorage({ ...legacy[0], id: marker }), null)

  const restored = restoreTaskHistory(stored, createdTimestamp + 2_000)
  assert.equal(restored[0].label, 'PDF 合并（本地处理）')
  assert.equal(restored[0].error, '输入文件无法读取')
  assert.equal(restored[0].remainingItems, 3)
  assert.equal(restored[0].retryable, false)
  assert.equal(restored[1].label, '历史任务')
  assert.equal(restored[1].status, 'failed')
  assert.equal(restored[1].errorCode, 'SESSION_INTERRUPTED')
  assert.equal(restored[1].finishedTimestamp, createdTimestamp + 2_000)
  assert.deepEqual(restoreTaskHistory({ schemaVersion: 99, items: legacy }), [])
})

test('completed task history can be cleared by snapshot and restored without duplicates', () => {
  const source = [
    { id: 'waiting', status: 'waiting', createdTimestamp: 35 },
    { id: 'running', status: 'running', createdTimestamp: 30 },
    { id: 'canceling', status: 'canceling', createdTimestamp: 25 },
    { id: 'completed', status: 'success', createdTimestamp: 20 },
    { id: 'failed', status: 'failed', createdTimestamp: 10 },
  ]
  const { running, completed } = separateCompletedTasks(source)
  assert.deepEqual(running.map((task) => task.id), ['waiting', 'running', 'canceling'])
  assert.deepEqual(completed.map((task) => task.id), ['completed', 'failed'])
  const restored = restoreCompletedTasks(
    [...running, { id: 'new', status: 'success', createdTimestamp: 40 }],
    [...completed, { id: 'new', status: 'failed', createdTimestamp: 5 }],
    5,
  )
  assert.deepEqual(restored.map((task) => task.id), ['new', 'waiting', 'running', 'canceling', 'completed'])
  assert.equal(restored.find((task) => task.id === 'new').status, 'success')
})

test('job status is monotonic, bounded, and preserves item totals across stages', () => {
  const initial = normalizeJobStatus({ stage: '加载输入', completed: 0, total: 3 })
  assert.deepEqual(initial, { stage: '加载输入', completed: 0, total: 3, remaining: 3 })
  const progressed = normalizeJobStatus({ stage: '处理文件', completed: 2 }, initial)
  assert.deepEqual(progressed, { stage: '处理文件', completed: 2, total: 3, remaining: 1 })
  assert.deepEqual(normalizeJobStatus({ completed: 1 }, progressed), progressed)
  assert.deepEqual(normalizeJobStatus({ stage: '生成结果', completed: 9 }, progressed), {
    stage: '生成结果', completed: 3, total: 3, remaining: 0,
  })
  assert.deepEqual(normalizeJobStatus({ stage: '忽略变化总数', completed: 2, total: 1 }, progressed), {
    stage: '忽略变化总数', completed: 2, total: 3, remaining: 1,
  })
})

test('job queue reports success, failure, and cancel exactly once', async () => {
  const successEvents = []
  const statusEvents = []
  const lifecycleEvents = []
  const success = createJob({
    worker: async ({ onProgress, reportStatus }) => {
      lifecycleEvents.push('worker')
      reportStatus({ stage: '处理输入', completed: 1, total: 2 })
      reportStatus({ stage: '处理输入', completed: 1, total: 2 })
      onProgress(55)
      return 'ok'
    },
    onStart: () => lifecycleEvents.push('running'),
    onProgress: (value) => successEvents.push(['progress', value]),
    onStatus: (status) => statusEvents.push(status),
    onDone: (value) => successEvents.push(['done', value]),
    onSettled: (status) => successEvents.push(['settled', status]),
  })
  assert.equal(await success.promise, 'ok')
  assert.deepEqual(successEvents, [['progress', 55], ['progress', 100], ['done', 'ok'], ['settled', 'success']])
  assert.deepEqual(statusEvents, [{ stage: '处理输入', completed: 1, total: 2, remaining: 1 }])
  assert.deepEqual(lifecycleEvents, ['running', 'worker'])

  const failureEvents = []
  const failure = createJob({
    worker: async () => { throw new Error('failed') },
    onError: (error) => failureEvents.push(['error', error.message]),
    onSettled: (status) => failureEvents.push(['settled', status]),
  })
  await failure.promise
  assert.deepEqual(failureEvents, [['error', 'failed'], ['settled', 'failed']])

  let immediateWorkerCalled = false
  let immediateStartCalled = false
  const immediate = createJob({
    worker: async () => { immediateWorkerCalled = true },
    onStart: () => { immediateStartCalled = true },
  })
  assert.equal(immediate.cancel(), true)
  await immediate.promise
  assert.equal(immediateWorkerCalled, false)
  assert.equal(immediateStartCalled, false)

  let cancelCount = 0
  const cancellationEvents = []
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const canceled = createJob({
    worker: ({ signal }) => {
      markStarted()
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancel'), { name: 'AbortError' })), { once: true }))
    },
    onCanceling: () => cancellationEvents.push('canceling'),
    onCancel: () => { cancelCount += 1; cancellationEvents.push('canceled') },
  })
  await started
  assert.equal(canceled.cancel(), true)
  assert.equal(canceled.cancel(), false)
  await canceled.promise
  assert.equal(cancelCount, 1)
  assert.deepEqual(cancellationEvents, ['canceling', 'canceled'])
})

test('diagnostic bundle exposes only reviewed metadata fields', async () => {
  const secretToken = `sk-${'x'.repeat(48)}`
  const snapshot = buildDiagnosticSnapshot({
    runtimeMode: 'tauri',
    capabilities: { platform: 'windows', libreoffice: 'C:/private/path/soffice.exe' },
    tasks: [
      {
        operation: 'pdf-merge',
        label: `PDF 合并 ${secretToken}`,
        status: 'failed',
        stage: '合并页面',
        progress: 35,
        completedItems: 2,
        totalItems: 5,
        error: 'C:/private/contracts/customer.docx 无法读取',
        errorCode: 'INPUT_UNREADABLE',
        createdTimestamp: Date.UTC(2026, 8, 6),
        finishedTimestamp: Date.UTC(2026, 8, 6, 0, 0, 1),
      },
      {
        operation: 'ocr',
        status: 'canceling',
        stage: '正在取消',
        progress: 40,
        createdTimestamp: Date.UTC(2026, 8, 6, 0, 0, 2),
      },
      {
        operation: 'office-pdf',
        status: 'waiting',
        stage: '等待执行',
        progress: 0,
        createdTimestamp: Date.UTC(2026, 8, 6, 0, 0, 3),
      },
    ],
  })
  const serialized = JSON.stringify(snapshot)
  assert.doesNotMatch(serialized, /private|customer\.docx|soffice\.exe|sk-x/)
  assert.equal(snapshot.manifest.dependencies.libreOffice, 'available')
  assert.equal(snapshot.taskEvents[0].errorCode, 'INPUT_UNREADABLE')
  assert.equal(snapshot.taskEvents[0].operation, 'pdf-merge')
  assert.equal(snapshot.taskEvents[0].stage, '合并页面')
  assert.equal(snapshot.taskEvents[0].inputCount, 5)
  assert.equal(snapshot.taskEvents[0].durationMs, 1000)
  assert.equal(snapshot.taskEvents[0].completedItems, 2)
  assert.equal(snapshot.taskEvents[0].remainingItems, 3)
  assert.equal(snapshot.manifest.taskCounts.failed, 1)
  assert.equal(snapshot.manifest.taskCounts.canceling, 1)
  assert.equal(snapshot.manifest.taskCounts.waiting, 1)

  assert.equal(snapshot.manifest.retention.maxEvents, DIAGNOSTIC_EVENT_LIMIT)
  assert.equal(snapshot.manifest.telemetry.crashReporting, 'disabled')
  assert.equal(snapshot.manifest.telemetry.automaticUpload, 'disabled')

  const tampered = structuredClone(snapshot)
  tampered.manifest.app = secretToken
  tampered.manifest.appVersion = secretToken
  tampered.manifest.platform = 'C:/private/device-name'
  tampered.taskEvents[0].operation = secretToken
  tampered.taskEvents[0].stage = 'C:/private/contracts/customer.docx'
  tampered.taskEvents[0].errorCode = secretToken
  tampered.excluded = [secretToken]
  const bundle = await createDiagnosticBundle(tampered)
  const zip = await JSZip.loadAsync(await bundle.blob.arrayBuffer())
  assert.deepEqual(Object.keys(zip.files).sort(), ['manifest.json', 'privacy.txt', 'task-events.json'])
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'))
  const events = JSON.parse(await zip.file('task-events.json').async('string'))
  const privacy = await zip.file('privacy.txt').async('string')
  assert.equal(manifest.schemaVersion, DIAGNOSTIC_SCHEMA_VERSION)
  assert.equal(manifest.app, '效率百宝箱')
  assert.equal(manifest.appVersion, '0.1.0')
  assert.equal(manifest.platform, 'unknown')
  assert.equal(events[0].operation, 'unknown')
  assert.equal(events[0].stage, '执行失败')
  assert.equal(events[0].errorCode, 'JOB_FAILED')
  assert.doesNotMatch(JSON.stringify({ manifest, events, privacy }), /private|customer\.docx|sk-x/)
  assert.deepEqual(Object.keys(events[0]).sort(), ['completedItems', 'durationMs', 'errorCode', 'finishedAt', 'inputCount', 'operation', 'progress', 'remainingItems', 'stage', 'startedAt', 'status', 'totalItems'])

  const rolling = buildDiagnosticSnapshot({
    tasks: Array.from({ length: DIAGNOSTIC_EVENT_LIMIT + 5 }, (_, index) => ({
      operation: 'pdf-merge',
      status: 'success',
      stage: '已完成',
      createdTimestamp: Date.UTC(2026, 8, 6, 0, 0, index),
      finishedTimestamp: Date.UTC(2026, 8, 6, 0, 0, index, 100),
    })),
  })
  assert.equal(rolling.taskEvents.length, DIAGNOSTIC_EVENT_LIMIT)
})

test('long screenshot options enforce bounded capture work', () => {
  assert.deepEqual(normalizeLongCaptureOptions({ frameCount: 4, intervalSeconds: 2, leadSeconds: 3 }), {
    frameCount: 4,
    intervalSeconds: 2,
    leadSeconds: 3,
  })
  assert.throws(() => normalizeLongCaptureOptions({ frameCount: 1 }), /2-8/)
  assert.throws(() => normalizeLongCaptureOptions({ intervalSeconds: 11 }), /1-10/)
  assert.throws(() => normalizeLongCaptureOptions({ leadSeconds: 1.5 }), /整数/)
})

test('rename preview expands every sequence placeholder consistently', () => {
  assert.equal(renderRenamePattern('归档-{n}-副本-{n}', 2), '归档-03-副本-03')
})

test('privacy consent is versioned, provider-bound, purpose-scoped, and revocable', () => {
  const empty = { schemaVersion: ONLINE_CONSENT_SCHEMA_VERSION, grants: {} }
  const exchange = createConsentDisclosure('exchange')
  const granted = grantConsent({ ...empty, unknown: true }, exchange, '2026-09-12T08:00:00.000Z')

  assert.deepEqual(normalizeConsent({ exchange: true, unknown: true }), empty)
  assert.equal(isConsentGranted(granted, exchange), true)
  assert.equal(isConsentGranted(granted, createConsentDisclosure('exchange', { providerKey: 'https://other.example' })), false)
  assert.deepEqual(consentedScopes(granted), ['汇率服务'])
  assert.deepEqual(granted.grants.exchange, {
    providerKey: 'https://api.frankfurter.dev/v1',
    policyVersion: ONLINE_CONSENT_POLICY_VERSION,
    grantedAt: '2026-09-12T08:00:00.000Z',
  })

  const relayProvider = { provider: 'relay.example', providerKey: 'https://relay.example/v1' }
  const relayTest = createConsentDisclosure('relay-test', relayProvider)
  const relayChat = createConsentDisclosure('relay', relayProvider)
  const withRelayTest = grantConsent(granted, relayTest, '2026-09-12T08:01:00.000Z')
  assert.equal(isConsentGranted(withRelayTest, relayTest), true)
  assert.equal(isConsentGranted(withRelayTest, relayChat), false)
  assert.deepEqual(consentedScopes(withRelayTest), ['汇率服务', '中转站连接测试'])
  assert.deepEqual(revokeAllConsent(), empty)
})

test('online authorization blocks mocked fetch when offline, denied, or concurrently revoked', async () => {
  const originalFetch = globalThis.fetch
  const disclosure = createConsentDisclosure('exchange')
  let consent = normalizeConsent()
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const action = () => fetch('https://api.frankfurter.dev/v1/latest')

  try {
    const offline = await authorizeOnlineAction({ disclosure, getConsent: () => consent, requestConsent: async () => true, action, online: false })
    assert.deepEqual(offline, { started: false, reason: 'offline' })

    const denied = await authorizeOnlineAction({ disclosure, getConsent: () => consent, requestConsent: async () => false, action })
    assert.deepEqual(denied, { started: false, reason: 'denied' })

    const revoked = await authorizeOnlineAction({
      disclosure,
      getConsent: () => consent,
      requestConsent: async (request) => {
        consent = grantConsent(consent, request, '2026-09-12T08:02:00.000Z')
        consent = revokeAllConsent()
        return true
      },
      action,
    })
    assert.deepEqual(revoked, { started: false, reason: 'revoked' })
    assert.equal(fetchCalls, 0)

    const authorized = await authorizeOnlineAction({
      disclosure,
      getConsent: () => consent,
      requestConsent: async (request) => {
        consent = grantConsent(consent, request, '2026-09-12T08:03:00.000Z')
        return true
      },
      action,
    })
    assert.equal(authorized.started, true)
    assert.equal(authorized.reason, 'authorized')
    assert.equal(fetchCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('relay config normalizes safe defaults and masks credentials', async () => {
  assert.deepEqual(normalizeRelayConfig({ baseUrl: ' https://relay.example/v1/// ', model: ' gpt-test ', apiKey: 'secret', timeoutMs: 1 }), {
    baseUrl: 'https://relay.example/v1', model: 'gpt-test', apiKey: 'secret', rememberKey: false, timeoutMs: 5000,
  })
  assert.equal(maskRelayApiKey('sk-1234567890'), 'sk-1••••••••7890')
  assert.equal(maskRelayApiKey(''), '未配置')
  const deepSeek = applyDeepSeekPreset({ apiKey: 'session-key', timeoutMs: 12_000 })
  assert.deepEqual(deepSeek, {
    baseUrl: DEEPSEEK_RELAY_PRESET.baseUrl,
    model: DEEPSEEK_RELAY_PRESET.model,
    apiKey: 'session-key',
    rememberKey: false,
    timeoutMs: 12_000,
  })
  assert.equal(isDeepSeekPreset(deepSeek), true)
  assert.equal(isDeepSeekPreset({ ...deepSeek, model: 'deepseek-reasoner' }), false)
  assert.match(DEEPSEEK_RELAY_PRESET.acquireUrl, /^https:\/\/platform\.deepseek\.com\//)
  assert.deepEqual(normalizeRelayConfig({ baseUrl: 'javascript:alert(1)' }).baseUrl, 'javascript:alert(1)')
  await assert.rejects(() => callRelayChat({ baseUrl: 'javascript:alert(1)', model: 'x', apiKey: 'key' }, { messages: [{ role: 'user', content: 'x' }] }), /仅支持/)
})

test('OCR runtime check reports a real local engine without requiring a token', async () => {
  const ready = await checkOcrRuntime(async () => ({ createWorker() {} }))
  assert.deepEqual(ready, { available: true, engine: 'Tesseract.js', requiresToken: false })
  await assert.rejects(() => checkOcrRuntime(async () => ({})), /本地 OCR 引擎未就绪/)
})

test('relay API keys remain memory-only and remove legacy persisted keys', () => {
  const previousWindow = globalThis.window
  const localStorage = createMemoryStorage()
  const sessionStorage = createMemoryStorage()
  globalThis.window = { localStorage, sessionStorage }
  try {
    clearRelayApiKey()
    localStorage.setItem('relay-api-config', JSON.stringify({ baseUrl: 'https://relay.example', model: 'legacy', apiKey: 'sk-legacy-config', timeoutMs: 8000 }))
    assert.equal(loadRelayConfig().apiKey, '')
    assert.equal(JSON.parse(localStorage.getItem('relay-api-config')).apiKey, undefined)
    localStorage.setItem('relay-api-key', JSON.stringify('sk-legacy-local'))
    sessionStorage.setItem('relay-api-key', JSON.stringify('sk-legacy-session'))
    const saved = saveRelayConfig({ baseUrl: 'https://relay.example', model: 'gpt-test', apiKey: 'sk-session', rememberKey: true })
    assert.equal(saved.rememberKey, false)
    assert.equal(localStorage.getItem('relay-api-key'), null)
    assert.equal(sessionStorage.getItem('relay-api-key'), null)
    assert.equal(loadRelayConfig().apiKey, 'sk-session')
    localStorage.setItem('relay-api-key', JSON.stringify('sk-legacy'))
    sessionStorage.setItem('relay-api-key', JSON.stringify('sk-legacy-session'))
    assert.equal(loadRelayConfig().apiKey, 'sk-session')
    assert.equal(localStorage.getItem('relay-api-key'), null)
    assert.equal(sessionStorage.getItem('relay-api-key'), null)
    saveRelayConfig({ baseUrl: 'https://relay.example', model: 'gpt-test', apiKey: 'sk-next', rememberKey: true })
    assert.equal(localStorage.getItem('relay-api-key'), null)
    assert.equal(sessionStorage.getItem('relay-api-key'), null)
    assert.equal(loadRelayConfig().apiKey, 'sk-next')
    clearRelayApiKey()
    assert.equal(loadRelayConfig().apiKey, '')
    assert.equal(localStorage.getItem('relay-api-key'), null)
    assert.equal(sessionStorage.getItem('relay-api-key'), null)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('relay chat sends OpenAI-compatible request and parses text response', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ model: 'gpt-test', choices: [{ message: { content: '整理完成' } }], usage: { total_tokens: 9 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await callRelayChat({ baseUrl: 'https://relay.example/v1', model: 'gpt-test', apiKey: 'sk-test', timeoutMs: 5000 }, { messages: [{ role: 'user', content: '整理会议记录' }] })
    assert.equal(request.url, 'https://relay.example/v1/chat/completions')
    assert.equal(request.options.headers.Authorization, 'Bearer sk-test')
    assert.deepEqual(JSON.parse(request.options.body), { model: 'gpt-test', messages: [{ role: 'user', content: '整理会议记录' }], temperature: 0.2, max_tokens: 1024 })
    assert.deepEqual(result, { content: '整理完成', model: 'gpt-test', usage: { total_tokens: 9 }, provider: 'relay.example' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('relay connection discovers models without requiring a model name', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ data: [{ id: 'gpt-test' }, { id: '  ' }, { id: 'qwen-test' }, { id: 'x'.repeat(201) }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await testRelayConnection({ baseUrl: 'https://relay.example/v1', apiKey: 'sk-test', model: '' })
    assert.equal(request.url, 'https://relay.example/v1/models')
    assert.equal(request.options.headers.Authorization, 'Bearer sk-test')
    assert.deepEqual(result.models, ['gpt-test', 'qwen-test'])
    assert.equal(result.modelCount, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('relay model discovery retries a transient response with a bounded delay', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: { message: 'temporary' } }), { status: 503 })
    }
    return new Response(JSON.stringify({ data: [{ id: 'gpt-recovered' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await testRelayConnection({ baseUrl: 'https://relay.example/v1', apiKey: 'sk-test', model: '' })
    assert.equal(attempts, 2)
    assert.deepEqual(result.models, ['gpt-recovered'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('relay root URLs use the standard /v1 API prefix', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  globalThis.fetch = async (url) => {
    requestUrl = url
    return new Response(JSON.stringify({ data: [{ id: 'gpt-test' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    await testRelayConnection({ baseUrl: 'https://catbee.online', apiKey: 'sk-test' })
    assert.equal(requestUrl, 'https://catbee.online/v1/models')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('relay requests do not fetch when the supplied signal is already canceled', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  let fetchCalls = 0
  controller.abort()
  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    await assert.rejects(
      () => testRelayConnection(
        { baseUrl: 'https://relay.example/v1', apiKey: 'sk-test' },
        { signal: controller.signal },
      ),
      (error) => error?.name === 'AbortError',
    )
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('relay base URLs reject query parameters and fragments', async () => {
  await assert.rejects(() => testRelayConnection({ baseUrl: 'https://relay.example/v1?token=secret', apiKey: 'sk-test' }), /查询参数或片段/)
  await assert.rejects(() => testRelayConnection({ baseUrl: 'https://relay.example/v1#fragment', apiKey: 'sk-test' }), /查询参数或片段/)
})

test('relay chat maps transient provider failures without leaking response details', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    return new Response(JSON.stringify({ error: { message: 'upstream detail should stay hidden' } }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
    })
  }
  try {
    await assert.rejects(
      () => callRelayChat({ baseUrl: 'https://relay.example/v1', model: 'gpt-test', apiKey: 'sk-test', timeoutMs: 5000 }, { messages: [{ role: 'user', content: '测试' }] }),
      (error) => error?.message === '中转站服务暂时不可用（HTTP 503）' && !error.message.includes('upstream detail'),
    )
    assert.equal(attempts, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('relay chat retries once only with a bounded idempotency key', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0
  let retryOptions
  globalThis.fetch = async (_url, options) => {
    attempts += 1
    retryOptions = options
    if (attempts === 1) return new Response('{}', { status: 503, headers: { 'retry-after': '0' } })
    return new Response(JSON.stringify({ model: 'gpt-test', choices: [{ message: { content: '已恢复' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await callRelayChat(
      { baseUrl: 'https://relay.example/v1', model: 'gpt-test', apiKey: 'sk-test', timeoutMs: 5000 },
      { messages: [{ role: 'user', content: '测试重试' }], requestId: 'job-retry-1' },
    )
    assert.equal(attempts, 2)
    assert.equal(retryOptions.headers['Idempotency-Key'], 'job-retry-1')
    assert.equal(result.content, '已恢复')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('CC Switch deep links import supported provider fields and bounded endpoints', () => {
  const imported = parseCcSwitchProviderLink('ccswitch://v1/import?resource=provider&app=codex&name=猫%20中转&endpoint=https%3A%2F%2Fa.example%2Fv1%2Chttps%3A%2F%2Fb.example%2Fv1&apiKey=sk-test&model=gpt-test')
  assert.deepEqual(imported, {
    app: 'codex', name: '猫 中转', homepage: '', baseUrl: 'https://a.example/v1', model: 'gpt-test', apiKey: 'sk-test', enabled: false,
  })

  const config = { env: { ANTHROPIC_BASE_URL: 'https://claude.example/v1', ANTHROPIC_API_KEY: 'sk-claude', ANTHROPIC_MODEL: 'claude-test' } }
  const encoded = Buffer.from(JSON.stringify(config), 'utf8').toString('base64url')
  const fromConfig = parseCcSwitchProviderLink(`ccswitch://v1/import?resource=provider&app=claude&config=${encoded}`)
  assert.equal(fromConfig.baseUrl, 'https://claude.example/v1')
  assert.equal(fromConfig.apiKey, 'sk-claude')
  assert.equal(fromConfig.model, 'claude-test')
})

test('CC Switch deep links reject invalid resources, schemes, and missing secrets', () => {
  assert.throws(() => parseCcSwitchProviderLink('https://v1/import?resource=provider&endpoint=https%3A%2F%2Frelay.example%2Fv1&apiKey=sk-test&model=gpt-test'), /仅支持/)
  assert.throws(() => parseCcSwitchProviderLink('ccswitch://v1/import?resource=plugin&endpoint=https%3A%2F%2Frelay.example%2Fv1&apiKey=sk-test&model=gpt-test'), /供应商资源/)
  assert.throws(() => parseCcSwitchProviderLink('ccswitch://v1/import?resource=provider&endpoint=https%3A%2F%2Frelay.example%2Fv1&model=gpt-test'), /API Key/)
  assert.throws(() => parseCcSwitchProviderLink('ccswitch://v1/import?resource=provider&endpoint=javascript%3Aalert(1)&apiKey=sk-test&model=gpt-test'), /安全的 http/)
})

test('CC Switch export emits importable link and JSON without undefined fields', () => {
  const value = { app: 'codex', name: '效率百宝箱', baseUrl: 'https://relay.example/v1', apiKey: 'sk-export', model: 'gpt-test' }
  const link = buildCcSwitchProviderLink(value)
  const parsed = parseCcSwitchProviderLink(link)
  assert.equal(parsed.baseUrl, value.baseUrl)
  assert.equal(parsed.apiKey, value.apiKey)
  assert.equal(parsed.model, value.model)
  const json = JSON.parse(ccSwitchProviderJson(value))
  assert.deepEqual(json, { version: 'v1', resource: 'provider', app: 'codex', name: '效率百宝箱', endpoint: 'https://relay.example/v1', apiKey: 'sk-export', model: 'gpt-test', enabled: false })
})
