<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Archive,
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Barcode,
  Bell,
  CalendarDays,
  Calculator,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  Command,
  Download,
  ExternalLink,
  FileArchive,
  FileImage,
  FileOutput,
  FileSpreadsheet,
  FileText,
  Gauge,
  Image as ImageIcon,
  KeyRound,
  LayoutGrid,
  Languages,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Pause,
  Pin,
  PinOff,
  Play,
  Power,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Upload,
  WandSparkles,
  X,
  Zap,
} from 'lucide-vue-next'
import { loadState, saveState } from './services/storage'
import { createJob } from './services/jobQueue'
import { downloadBlob, processImage, processImageToTarget } from './services/imageTools'
import { readQr, renderQr } from './services/qr'
import { BARCODE_FORMATS, renderBarcode } from './services/barcodeTools'
import { mergePdfs, splitPdf } from './services/pdfTools'
import { packageRenamedFiles, renderRenamePattern } from './services/renameTools'
import { getRuntimeInfo, isTauriRuntime } from './services/runtime'
import { createArchive, extractArchive } from './services/archiveTools'
import { createOfficeTemplate } from './services/templateTools'
import { calculateAnnualTax, calculateBmi, calculateMortgage, fetchExchangeRate } from './services/financeTools'
import { buildCalculatorResult, calculateExpression } from './services/calculatorTools'
import { calculateAge, calculateDateDifference } from './services/dateTools'
import { decryptFile, encryptFile } from './services/cryptoTools'
import { checkOcrRuntime, recognizeText } from './services/ocrTools'
import { queryPublicIp, testDownloadSpeed } from './services/networkTools'
import { captureLongScreen, captureScreen, stitchImages, watermarkImages } from './services/imageBatchTools'
import { cancelNetworkJob, convertOfficeToPdf, copyRenamedFiles, getDesktopCapabilities, pingHost, probePort, readCcSwitchProviders, selectCcSwitchConfigFile, selectOfficeFiles, selectOutputDirectory, selectRenameFiles } from './services/desktopTools'
import { normalizeTaskError } from './services/taskErrors'
import { restoreCompletedTasks, restoreTaskHistory, separateCompletedTasks, serializeTaskHistory } from './services/taskHistoryTools'
import { buildDiagnosticSnapshot, createDiagnosticBundle } from './services/diagnosticsTools'
import { buildDependencyStatus } from './services/dependencyTools'
import { describeDocumentSelection, formatDocumentFileSize, selectDocumentFiles } from './services/fileQueueTools'
import { authorizeOnlineAction, consentedScopes, createConsentDisclosure, grantConsent, isConsentGranted, normalizeConsent, revokeAllConsent } from './services/privacyConsent'
import { applyDeepSeekPreset, callRelayChat, clearRelayApiKey, DEEPSEEK_RELAY_PRESET, isDeepSeekPreset, loadRelayConfig, maskRelayApiKey, saveRelayConfig, testRelayConnection } from './services/relayApi'
import { TRANSLATION_LANGUAGES, TRANSLATION_MAX_CHARACTERS, TRANSLATION_STYLES, buildTranslationMessages, canSwapTranslationLanguages, normalizeTranslationPreferences, safeTranslationTitle, translationPreferenceSummary, validateTranslationText } from './services/translationTools'
import { buildCcSwitchProviderLink, ccSwitchProviderJson, parseCcSwitchProviderLink } from './services/ccSwitch.js'
import { filterSearchTools, normalizeSearchIndex, stepSearchIndex } from './services/searchTools'
import { normalizeRecentTools, normalizeTheme } from './services/localStateModels'
import { DEFAULT_UI_PREFS, normalizeDensity, normalizeUiPrefs } from './services/uiPreferences'
import { createToolRegistry } from './services/toolRegistry'
import { formatNetworkConnectionLabel, networkConnectionPresentation } from './services/networkStatus'
import AssistantWorkspace from './components/AssistantWorkspace.vue'
import ImageWorkspace from './components/ImageWorkspace.vue'
import ShutdownWorkspace from './components/ShutdownWorkspace.vue'
import PrintWorkspace from './components/PrintWorkspace.vue'
import ToolWorkspace from './components/ToolWorkspace.vue'
import ToolEntryCard from './components/ToolEntryCard.vue'
import TableWorkspace from './components/TableWorkspace.vue'

const modules = [
  { id: 'home', label: '首页', icon: LayoutGrid, description: '常用工具与最近任务' },
  { id: 'docs', label: '文档办公', icon: FileText, description: 'PDF、Office、打印与批处理' },
  { id: 'assistant', label: '效率助手', icon: Sparkles, description: '待办、番茄钟与便签' },
  { id: 'data', label: '数据计算', icon: Gauge, description: '换算、日期与公式' },
  { id: 'network', label: '网络工具', icon: Network, description: '二维码、条形码与网络诊断' },
  { id: 'image', label: '图片处理', icon: ImageIcon, description: '基础处理、AI 视觉与文字编辑' },
  { id: 'security', label: '安全隐私', icon: ShieldCheck, description: '密码、加密与脱敏' },
  { id: 'power', label: '定时关机', icon: Power, description: '倒计时或定点执行系统动作' },
]

const tools = [
  { id: 'pdf-merge', module: 'docs', label: 'PDF 合并', icon: Archive, level: 'P0', description: '合并多个 PDF 并预览顺序' },
  { id: 'pdf-split', module: 'docs', label: 'PDF 拆分', icon: FileText, level: 'P0', description: '按页码拆分为独立文件' },
  { id: 'rename', module: 'docs', label: '批量重命名', icon: WandSparkles, level: 'P0', description: '预览冲突后批量改名' },
  { id: 'image-compress', module: 'image', label: '图片压缩', icon: FileImage, level: 'P0', description: '本地压缩并下载结果' },
  { id: 'qr', module: 'network', label: '二维码生成 / 识别', icon: QrCode, level: 'P0', description: '生成二维码或读取图片' },
  { id: 'barcode', module: 'network', label: '条形码生成', icon: Barcode, description: '本地生成 Code 128 或 EAN-13' },
  { id: 'unit', module: 'data', label: '单位换算', icon: RefreshCw, level: 'P0', description: '长度、重量与温度换算' },
  { id: 'date', module: 'data', label: '日期 / 年龄', icon: CalendarDays, level: 'P0', description: '计算年龄与日期差' },
  { id: 'percentage', module: 'data', label: '百分比计算', icon: Gauge, level: 'P0', description: '增幅、占比与折扣' },
  { id: 'calculator', module: 'data', label: '计算器', icon: Calculator, level: 'P1', description: '四则运算并显示金额大小写' },
  { id: 'table-data', module: 'data', label: 'Excel / CSV 工具', icon: FileSpreadsheet, description: '合并、拆分、去重、转置与格式互转' },
  { id: 'password', module: 'security', label: '强密码生成', icon: KeyRound, level: 'P0', description: '本地生成，不保存口令' },
  { id: 'password-strength', module: 'security', label: '密码强度检测', icon: LockKeyhole, level: 'P0', description: '只在本机内存中检测' },
  { id: 'todo', module: 'assistant', label: '待办清单', icon: ClipboardList, level: 'P1', description: '本地保存与快速完成' },
  { id: 'pomodoro', module: 'assistant', label: '番茄钟', icon: Timer, level: 'P1', description: '专注与休息计时' },
  { id: 'redact', module: 'security', label: '敏感信息脱敏', icon: ShieldCheck, level: 'P1', description: '预览后导出脱敏副本' },
  { id: 'office-pdf', module: 'docs', label: 'Office 导出 PDF', icon: FileOutput, level: 'P1', description: '调用本机 LibreOffice 批量转换' },
  { id: 'archive', module: 'docs', label: '压缩 / 解压', icon: FileArchive, level: 'P1', description: '本地创建或提取 ZIP 归档' },
  { id: 'templates', module: 'docs', label: '办公模板', icon: FileText, level: 'P1', description: '生成会议纪要、报销和周报模板' },
  { id: 'ocr', module: 'docs', label: 'OCR 文字识别', icon: FileImage, level: 'P1', description: '本地引擎识别图片文字' },
  { id: 'print', module: 'docs', label: '文档打印', icon: Printer, description: '支持 A4、B4、A5、B5 与系统打印' },
  { id: 'reminder', module: 'assistant', label: '日历提醒', icon: CalendarDays, level: 'P1', description: '本机保存并按时间提醒' },
  { id: 'relay-assistant', module: 'assistant', label: '中转站 AI 助手', icon: Sparkles, level: 'P1', description: '调用已配置的 OpenAI-compatible API' },
  { id: 'exchange', module: 'data', label: '汇率换算', icon: RefreshCw, level: 'P1', description: '显式联网获取带日期的参考汇率' },
  { id: 'mortgage', module: 'data', label: '房贷计算', icon: Gauge, level: 'P1', description: '等额本息与等额本金测算' },
  { id: 'tax', module: 'data', label: '个税估算', icon: Gauge, level: 'P1', description: '按规则版本估算年度综合所得税' },
  { id: 'bmi', module: 'data', label: 'BMI 计算', icon: Gauge, level: 'P1', description: '按中国成人分类参考计算' },
  { id: 'speed', module: 'network', label: '网速测试', icon: Zap, level: 'P1', description: '用户触发的 2 MB 下载测速' },
  { id: 'ip', module: 'network', label: '公网 IP 查询', icon: Network, level: 'P1', description: '显式请求第三方 IP 服务' },
  { id: 'ping', module: 'network', label: 'Ping 检测', icon: Network, level: 'P1', description: '桌面版检测指定主机可达性' },
  { id: 'port', module: 'network', label: '端口检测', icon: Network, level: 'P1', description: '桌面版检测指定主机单个端口' },
  { id: 'screenshot', module: 'image', label: '截图', icon: Square, level: 'P1', description: '经授权捕获屏幕并另存 PNG' },
  { id: 'long-screenshot', module: 'image', label: '长截图', icon: FileImage, level: 'P1', description: '定时捕获滚动分段并纵向拼接' },
  { id: 'watermark', module: 'image', label: '批量加水印', icon: WandSparkles, level: 'P1', description: '本地预览参数并批量生成副本' },
  { id: 'stitch', module: 'image', label: '长图拼接', icon: ImageIcon, level: 'P1', description: '横向或纵向拼接多张图片' },
  { id: 'image-ai', module: 'image', label: 'AI 图片增强', icon: Sparkles, description: '本地智能增强与 AI 抠图' },
  { id: 'id-photo', module: 'image', label: '证件照裁剪', icon: FileImage, description: '按常用规格生成证件照' },
  { id: 'image-text-edit', module: 'image', label: '图片文字编辑', icon: WandSparkles, description: '在原图画布上消除、替换、复制和粘贴' },
  { id: 'crypto', module: 'security', label: '文件加密 / 解密', icon: LockKeyhole, level: 'P1', description: '使用 OpenPGP 口令加密副本' },
  { id: 'shutdown', module: 'power', label: '定时关机', icon: Power, description: '倒计时或定点执行关机、重启、休眠' },
]

// Built-ins and future plug-ins share one registry contract. A new tool only needs
// an id, module, label, description and icon to appear in search and the command palette.
const toolRegistry = createToolRegistry(tools)
const imageTools = tools.filter((tool) => tool.module === 'image')
const docToolIds = ['pdf-merge', 'pdf-split', 'rename', 'archive', 'office-pdf', 'print', 'templates', 'ocr']
const dataToolIds = ['unit', 'date', 'percentage', 'calculator', 'table-data', 'exchange', 'mortgage', 'tax', 'bmi']
const networkToolIds = ['qr', 'barcode', 'speed', 'ip', 'ping', 'port']
const imageToolIds = ['image-compress', 'screenshot', 'long-screenshot', 'watermark', 'stitch', 'image-ai', 'id-photo', 'image-text-edit']
const securityToolIds = ['password', 'password-strength', 'crypto', 'redact']
const advancedImageToolIds = new Set(['image-ai', 'id-photo', 'image-text-edit'])
const onlineBoundaryToolIds = new Set(['relay-assistant', 'exchange', 'speed', 'ip', 'ping', 'port'])

const storedUiPrefs = loadState('ui-prefs', DEFAULT_UI_PREFS)
const initialUiPrefs = normalizeUiPrefs(storedUiPrefs, toolRegistry.ids())
const initialTranslationPrefs = normalizeTranslationPreferences(storedUiPrefs?.translation)
const initialToolDefinition = toolRegistry.get(initialUiPrefs.lastTool)
const assistantToolTabs = {
  todo: 'todos',
  pomodoro: 'focus',
  reminder: 'reminders',
  'relay-assistant': 'ai',
}
const activeModule = ref(initialToolDefinition?.module || 'home')
const assistantActiveTab = ref(assistantToolTabs[initialToolDefinition?.id] || 'overview')
const searchText = ref('')
const searchFocused = ref(false)
const searchActiveIndex = ref(-1)
const taskPanelOpen = ref(false)
const taskPanelPinned = ref(initialUiPrefs.taskPanelPinned)
const sidebarCollapsed = ref(initialUiPrefs.sidebarCollapsed)
const uiDensity = ref(normalizeDensity(initialUiPrefs.density))
const commandPaletteOpen = ref(false)
const commandQuery = ref('')
const commandActiveIndex = ref(0)
const taskHistoryClearOpen = ref(false)
const onlineConsentRequest = ref(null)
const pendingTaskHistoryIds = ref([])
const clearedTaskHistory = ref([])
const mobileNavOpen = ref(false)
const settingsOpen = ref(false)
const settingsPanel = ref('api')
const diagnosticPreview = ref(null)
const diagnosticBusy = ref(false)
const ocrRuntimeBusy = ref(false)
const ocrRuntimeStatus = ref(null)
const toast = ref(null)
const announcement = ref('')
const defaultRecentTools = ['pdf-merge', 'image-compress', 'password']
const theme = ref(normalizeTheme(loadState('theme', 'light')))
const tasks = ref(restoreTaskHistory(loadState('tasks', [])))
let taskHistoryClearReturnFocus = null
let taskHistoryUndoTimer
let onlineConsentReturnFocus = null
let onlineConsentResolver = null
let commandPaletteReturnFocus = null
const recentTools = ref(normalizeRecentTools(loadState('recent-tools', defaultRecentTools), toolRegistry.ids(), defaultRecentTools))
const activeTool = ref(initialToolDefinition?.id || 'pdf-merge')
const runtimeMode = ref(isTauriRuntime ? 'tauri' : 'browser')
const desktopCapabilities = ref({ platform: isTauriRuntime ? 'desktop' : 'browser', libreoffice: null })
const networkOnline = ref(typeof navigator === 'undefined' ? null : navigator.onLine)
const onlineConsent = ref(normalizeConsent(loadState('online-consent', {})))
const relayConfig = ref(loadRelayConfig())
const relayTestBusy = ref(false)
const relayStatus = ref(null)
const relayModels = ref([])
const relayPrompt = ref('')
const relayResult = ref(null)
const relayBusy = ref(false)
const translationSourceLanguage = ref(initialTranslationPrefs.sourceLanguage)
const translationTargetLanguage = ref(initialTranslationPrefs.targetLanguage)
const translationStyle = ref(initialTranslationPrefs.style)
const translationPreserveFormatting = ref(initialTranslationPrefs.preserveFormatting)
const translationText = ref('')
const translationResult = ref(null)
const translationStatus = ref(null)
const translationBusy = ref(false)
const ccSwitchLinkInput = ref('')
const ccSwitchImportPreview = ref(null)
const ccSwitchImportError = ref('')
const ccSwitchFilePath = ref('')
const ccSwitchProviders = ref([])
const ccSwitchSelectedId = ref('')
const ccSwitchFileBusy = ref(false)
const ccSwitchExportApp = ref('codex')
const ccSwitchExportName = ref('效率百宝箱中转站')
const ccSwitchExportFormat = ref('link')
const ccSwitchExportOutput = ref('')
const ccSwitchExportError = ref('')
const stopJobs = new Map()
const retryJobs = new Map()
const onlineTaskDisclosures = new Map()

const toolSearchAliases = {
  'pdf-merge': ['PDF 拼接', '合并 PDF', '拼 PDF'],
  'pdf-split': ['PDF 分页', '拆分 PDF', '提取页面'],
  rename: ['文件改名', '文件重命名', '批量改名'],
  'image-compress': ['压缩图片', '图片瘦身', 'JPG 压缩'],
  qr: ['二维码', 'QR', '条码'],
  barcode: ['条形码', '一维码', 'Code 128', 'EAN-13', '商品条码'],
  unit: ['换算', '长度', '重量', '温度'],
  date: ['年龄', '生日', '日期差'],
  percentage: ['增幅', '折扣', '占比'],
  calculator: ['金额大小写', '大小写金额', '四则运算', '算式'],
  'table-data': ['Excel', 'CSV', 'XLSX', 'JSON', '多表合并', '按列拆分', '去重', '转置', '对账单', '客户表'],
  password: ['口令', '随机密码', '密码生成器'],
  'password-strength': ['口令强度', '密码检测'],
  todo: ['任务', '事项', '清单'],
  pomodoro: ['番茄', '专注', '25 分钟'],
  redact: ['脱敏', '隐私', '手机号'],
  'office-pdf': ['Word 转 PDF', 'Excel 转 PDF', 'PPT 转 PDF', 'DOCX'],
  archive: ['ZIP', '压缩包', '解压'],
  templates: ['会议纪要', '周报', '报销'],
  ocr: ['文字识别', '图片转文字', '扫描件'],
  print: ['打印', '打印预览', 'A4', 'B4', 'A5', 'B5', '纸张大小'],
  reminder: ['提醒', '日历', '计划'],
  'relay-assistant': ['AI', '大模型', 'ChatGPT', '中转站'],
  exchange: ['汇率', '货币', '外币'],
  mortgage: ['房贷', '贷款', '月供'],
  tax: ['个税', '所得税', '税后'],
  bmi: ['体重', '身高', '健康指数'],
  speed: ['测速', '带宽', '下载速度'],
  ip: ['IP 地址', '公网地址'],
  ping: ['网络延迟', '连通性'],
  port: ['端口', 'TCP', '连通测试'],
  screenshot: ['截屏', '屏幕截图'],
  'long-screenshot': ['滚动截图', '长图截屏'],
  watermark: ['水印', '批量图片'],
  stitch: ['图片拼接', '长图', '拼图'],
  'image-ai': ['AI 图片', '图片增强', '智能修图', 'AI 抠图', '背景移除'],
  'id-photo': ['证件照', '一寸', '二寸', '护照照片', '证件照规格'],
  'image-text-edit': ['图片文字', '文字编辑', '图片消除', '图片替换', '复制粘贴图片'],
  crypto: ['加密', '解密', 'OpenPGP'],
  shutdown: ['定时关机', '自动关机', '倒计时关机', '重启', '休眠'],
}

const searchResults = computed(() => {
  return filterSearchTools(toolRegistry.list(), searchText.value, recentTools.value, toolSearchAliases)
})
// 快速开始：最近使用的工具排在前面，其余工具按注册表顺序完整展示。
const quickTools = computed(() => {
  const ordered = []
  const seen = new Set()
  for (const id of recentTools.value) {
    const recent = tools.find((item) => item.id === id)
    if (recent && !seen.has(recent.id)) {
      seen.add(recent.id)
      ordered.push(recent)
    }
  }
  for (const tool of tools) {
    if (!seen.has(tool.id)) {
      seen.add(tool.id)
      ordered.push(tool)
    }
  }
  return ordered
})
const recentToolDefinitions = computed(() => recentTools.value.map((id) => toolRegistry.get(id)).filter(Boolean))
const commandDefinitions = computed(() => [
  { id: 'toggle-sidebar', label: sidebarCollapsed.value ? '展开侧栏' : '折叠侧栏', description: '在 234px 导航与 64px 图标轨之间切换', icon: sidebarCollapsed.value ? PanelLeftOpen : PanelLeftClose, keywords: ['sidebar', '导航', '图标轨'] },
  { id: 'toggle-task-panel', label: taskPanelPinned.value ? '取消固定任务中心' : '固定任务中心', description: '将任务中心作为右侧第三栏显示', icon: taskPanelPinned.value ? PinOff : Pin, keywords: ['任务', '第三栏', 'pin'] },
  { id: 'open-task-panel', label: taskPanelOpen.value ? '关闭任务中心' : '打开任务中心', description: '查看运行中与最近完成的任务', icon: PanelRight, keywords: ['任务', '工作流'] },
  { id: 'toggle-density', label: uiDensity.value === 'compact' ? '切换为舒适密度' : '切换为紧凑密度', description: '调整工作区信息密度并记住选择', icon: MoreHorizontal, keywords: ['密度', 'density'] },
  { id: 'open-settings', label: '打开设置', description: '管理 API、依赖、联网授权与隐私诊断', icon: Settings, keywords: ['设置', '偏好'] },
  ...toolRegistry.list().map((tool) => ({
    id: `tool:${tool.id}`,
    toolId: tool.id,
    label: `打开 ${tool.label}`,
    description: tool.description,
    icon: tool.icon || FileText,
    keywords: [tool.id, tool.label, tool.description, ...(toolSearchAliases[tool.id] || []), ...(tool.aliases || [])],
  })),
])
const commandResults = computed(() => {
  const query = commandQuery.value.trim().toLocaleLowerCase()
  const list = commandDefinitions.value
  if (!query) return list
  return list.filter((command) => [command.label, command.description, ...(command.keywords || [])].join(' ').toLocaleLowerCase().includes(query))
})
const currentModule = computed(() => modules.find((item) => item.id === activeModule.value) || modules[0])
const isAdvancedImageTool = computed(() => advancedImageToolIds.has(activeTool.value))
const runningTasks = computed(() => tasks.value.filter((task) => ['waiting', 'running', 'canceling'].includes(task.status)))
const completedTasks = computed(() => tasks.value.filter((task) => ['success', 'failed', 'canceled'].includes(task.status)).slice(0, 6))
const onlineConsentLabels = computed(() => consentedScopes(onlineConsent.value))
const onlineConsentSummary = computed(() => onlineConsentLabels.value.length ? `已授权：${onlineConsentLabels.value.join('、')}` : '尚未授权任何联网或模型下载')
const hasOnlineConsent = computed(() => onlineConsentLabels.value.length > 0)
const dependencyStatus = computed(() => buildDependencyStatus({
  runtimeMode: runtimeMode.value,
  capabilities: desktopCapabilities.value,
  online: networkOnline.value,
}))
const boundaryBarDismissed = ref(false)
const boundaryBar = computed(() => {
  if (activeModule.value === 'docs' && activeTool.value === 'office-pdf') {
    const missing = desktopCapabilities.value.libreoffice === false || runtimeMode.value !== 'tauri'
    return {
      title: missing ? 'Office 导出依赖未就绪' : 'Office 导出边界',
      detail: missing ? '需要桌面版与 LibreOffice；其他文档工具仍可继续使用。' : '由桌面桥接调用本机 LibreOffice，不上传文档内容。',
      attention: missing,
      icon: FileOutput,
    }
  }
  if (activeModule.value === 'docs' && activeTool.value === 'ocr') {
    return { title: 'OCR 依赖与边界', detail: '首次识别会按需下载语言模型；图片仍只在本机处理。', attention: networkOnline.value === false, icon: FileImage }
  }
  if (activeModule.value === 'docs') {
    return { title: '文档处理边界', detail: 'PDF、ZIP、模板和 OCR 均在本机处理；OCR 首次只下载模型，不发送图片内容。', attention: false, icon: ShieldCheck }
  }
  if (activeModule.value === 'data') {
    const isExchange = activeTool.value === 'exchange'
    return {
      title: isExchange ? '汇率联网边界' : '计算规则与数据边界',
      detail: isExchange ? '点击后才向 Frankfurter 获取 ECB 参考汇率，并显示服务数据日期。' : '个税、BMI 和贷款结果仅供办公测算，不替代机构意见；固定换算系数在本机计算。',
      attention: isExchange && networkOnline.value === false,
      icon: isExchange ? Network : Calculator,
    }
  }
  if (activeModule.value === 'power') {
    return { title: '系统动作边界', detail: runtimeMode.value === 'tauri' ? '仅桌面桥接执行固定动作；创建前需确认完整参数，默认保留保存缓冲且可在触发前取消。' : '当前为浏览器预览，系统关机、重启和休眠需要桌面版。', attention: runtimeMode.value !== 'tauri', icon: Power }
  }
  if (activeModule.value === 'network' || onlineBoundaryToolIds.has(activeTool.value)) {
    return { title: '联网权限边界', detail: '外部请求只在你点击并确认授权后执行；Ping 和端口检测由 Rust 白名单命令处理，不拼接 shell 字符串。', attention: networkOnline.value === false, icon: Network }
  }
  if (activeModule.value === 'image') {
    return { title: '图片处理边界', detail: '基础处理、AI 增强和文字编辑均生成新副本，原图不会被覆盖；超大图片会按尺寸保护处理。AI 视觉算法默认在本机 Canvas 内完成。', attention: false, icon: ImageIcon }
  }
  if (activeModule.value === 'security') {
    return { title: '安全边界', detail: '口令、OpenPGP 和脱敏结果只在本机内存中处理；OpenPGP 使用兼容格式，口令不会保存。', attention: false, icon: LockKeyhole }
  }
  return { title: '本地处理边界', detail: '当前工具默认在本机处理，结果另存且不会覆盖源文件。', attention: false, icon: ShieldCheck }
})
const boundaryBarVisible = computed(() => !boundaryBarDismissed.value && activeModule.value !== 'home' && activeModule.value !== 'assistant')
const relayConfigured = computed(() => Boolean(relayConfig.value.baseUrl && relayConfig.value.model && relayConfig.value.apiKey))
const relayKeySummary = computed(() => maskRelayApiKey(relayConfig.value.apiKey))
const deepSeekPresetActive = computed(() => isDeepSeekPreset(relayConfig.value))
const deepSeekApiKey = computed({
  get: () => deepSeekPresetActive.value ? relayConfig.value.apiKey : '',
  set: (apiKey) => {
    relayConfig.value = applyDeepSeekPreset({ ...relayConfig.value, apiKey })
    relayModels.value = []
    relayStatus.value = null
  },
})
const ccSwitchSelectedProvider = computed(() => ccSwitchProviders.value.find((provider) => provider.id === ccSwitchSelectedId.value) || null)

const ccSwitchAppOptions = [
  { value: 'codex', label: 'Codex' },
  { value: 'claude', label: 'Claude' },
  { value: 'claude-desktop', label: 'Claude Desktop' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'grokbuild', label: 'Grok Build' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'openclaw', label: 'OpenClaw' },
  { value: 'hermes', label: 'Hermes' },
]

const pluginToolIds = new Set(['office-pdf', 'ocr'])
const desktopToolIds = new Set(['shutdown'])
const networkAccess = computed(() => networkConnectionPresentation(networkOnline.value))

function toolAccess(toolId) {
  if (desktopToolIds.has(toolId)) return { label: '桌面版', className: 'desktop' }
  if (pluginToolIds.has(toolId)) return { label: '需插件', className: 'plugin' }
  return networkAccess.value
}

function describeRelayProvider(config) {
  const rawBaseUrl = String(config?.baseUrl || '').trim().replace(/\/+$/, '')
  try {
    const url = new URL(rawBaseUrl)
    return { provider: url.host, providerKey: rawBaseUrl }
  } catch {
    return { provider: '已配置中转站', providerKey: rawBaseUrl }
  }
}

function relayConsentDisclosure(scope, config, overrides = {}) {
  return createConsentDisclosure(scope, { ...describeRelayProvider(config), ...overrides })
}

function probeConsentDisclosure(type, target, port) {
  const normalizedTarget = String(target || '').trim().toLocaleLowerCase()
  const suffix = type === 'port' ? `:${port}` : ''
  return createConsentDisclosure(type, {
    provider: type === 'port' ? `${normalizedTarget}:${port}` : normalizedTarget,
    providerKey: `${type}:${normalizedTarget}${suffix}`,
  })
}

function requestOnlineConsent(disclosure) {
  if (!disclosure || onlineConsentRequest.value) return Promise.resolve(false)
  onlineConsentReturnFocus = document.activeElement
  onlineConsentRequest.value = disclosure
  return new Promise((resolve) => {
    onlineConsentResolver = resolve
    void nextTick(() => {
      if (!onlineConsentRequest.value) return
      getFocusableElements(document.querySelector('.online-consent-modal'))[0]?.focus({ preventScroll: true })
    })
  })
}

function settleOnlineConsent(accepted) {
  const disclosure = onlineConsentRequest.value
  if (accepted && disclosure) {
    onlineConsent.value = grantConsent(onlineConsent.value, disclosure)
    saveState('online-consent', onlineConsent.value)
  }
  const resolve = onlineConsentResolver
  const restore = onlineConsentReturnFocus
  onlineConsentRequest.value = null
  onlineConsentResolver = null
  onlineConsentReturnFocus = null
  const authorized = Boolean(accepted && disclosure && isConsentGranted(onlineConsent.value, disclosure))
  resolve?.(authorized)
  void nextTick(() => {
    if (restore?.isConnected && typeof restore.focus === 'function') restore.focus({ preventScroll: true })
  })
}

function handleOnlineConsentKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    settleOnlineConsent(false)
    return
  }
  trapDialogFocus(event)
}

async function runAuthorizedOnlineAction(disclosure, action, { allowOffline = false } = {}) {
  if (allowOffline && networkOnline.value === false) {
    showToast('当前离线，将仅尝试使用本机已缓存资源；不会发出新的外部请求', 'info')
  }
  const result = await authorizeOnlineAction({
    disclosure,
    getConsent: () => onlineConsent.value,
    requestConsent: requestOnlineConsent,
    action,
    online: () => networkOnline.value !== false,
    allowOffline,
  })
  if (result.reason === 'offline') showToast('当前处于离线状态，未发送任何外部请求', 'error')
  if (result.reason === 'revoked') showToast('联网授权已撤回，未发送任何外部请求', 'info')
  if (result.reason === 'invalid') showToast('联网授权信息无效，未发送任何外部请求', 'error')
  return result
}

function revokeOnlineConsent() {
  onlineConsent.value = revokeAllConsent()
  saveState('online-consent', onlineConsent.value)
  let canceled = 0
  onlineTaskDisclosures.forEach((_disclosure, taskId) => {
    if (stopJobs.get(taskId)?.()) canceled += 1
  })
  const suffix = canceled ? `；已取消 ${canceled} 个联网任务` : ''
  showToast(`联网与模型下载授权已撤回${suffix}；后续请求必须重新确认`, 'info')
}

function persistRelaySettings() {
  try {
    relayConfig.value = saveRelayConfig(relayConfig.value)
    relayStatus.value = { type: 'success', message: '中转站配置已保存；API Key 仅保存在当前进程内存' }
    showToast('中转站配置已保存')
    return true
  } catch (error) {
    relayStatus.value = { type: 'error', message: error.message || '中转站配置无效' }
    showToast(relayStatus.value.message, 'error')
    return false
  }
}

function useDeepSeekPreset({ notify = true } = {}) {
  const apiKey = deepSeekPresetActive.value ? relayConfig.value.apiKey : ''
  relayConfig.value = applyDeepSeekPreset({ ...relayConfig.value, apiKey })
  relayModels.value = []
  relayStatus.value = { type: 'success', message: 'DeepSeek 默认地址与 deepseek-chat 模型已填入；Key 仍只保存在当前进程内存' }
  if (notify) showToast('已应用 DeepSeek API 预设')
}

async function checkDeepSeekConnection() {
  if (!deepSeekApiKey.value.trim()) {
    showToast('请先填写 DeepSeek Key', 'error')
    return
  }
  relayConfig.value = applyDeepSeekPreset(relayConfig.value)
  relayStatus.value = null
  await checkRelayConnection()
}

async function checkLocalOcrRuntime() {
  if (ocrRuntimeBusy.value) return
  ocrRuntimeBusy.value = true
  ocrRuntimeStatus.value = null
  try {
    const result = await checkOcrRuntime()
    ocrRuntimeStatus.value = { type: 'success', message: `${result.engine} 已就绪，无需 Token；语言模型仍按需下载` }
    showToast('本地 OCR 引擎已就绪')
  } catch (error) {
    ocrRuntimeStatus.value = { type: 'error', message: error.message || '本地 OCR 引擎检测失败' }
    showToast(ocrRuntimeStatus.value.message, 'error')
  } finally {
    ocrRuntimeBusy.value = false
  }
}

function forgetRelayApiKey() {
  clearRelayApiKey()
  relayConfig.value = { ...relayConfig.value, apiKey: '', rememberKey: false }
  relayModels.value = []
  relayStatus.value = { type: 'success', message: 'API Key 已从当前进程内存清除，并已移除旧版本机存储' }
  showToast('API Key 已清除')
}

function saveAndCloseSettings() {
  if (settingsPanel.value === 'api' && !persistRelaySettings()) return
  closeSettings()
}

let settingsReturnFocus = null

function getFocusableElements(container) {
  if (!container) return []
  return [...container.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })
}

async function openSettings(event, panel = settingsPanel.value) {
  settingsReturnFocus = event?.currentTarget || document.activeElement
  if (['api', 'tasks'].includes(panel)) settingsPanel.value = panel
  settingsOpen.value = true
  await nextTick()
  if (!settingsOpen.value) return
  document.querySelector('.settings-scroll')?.scrollTo({ top: 0 })
  document.querySelector('.settings-close-button')?.focus({ preventScroll: true })
}

async function selectSettingsPanel(panel, { focus = false } = {}) {
  if (!['api', 'tasks'].includes(panel)) return
  settingsPanel.value = panel
  await nextTick()
  document.querySelector('.settings-scroll')?.scrollTo({ top: 0 })
  if (focus) document.querySelector(`#settings-tab-${panel}`)?.focus({ preventScroll: true })
}

function handleSettingsTabKeydown(event) {
  const target = {
    ArrowDown: settingsPanel.value === 'api' ? 'tasks' : 'api',
    ArrowRight: settingsPanel.value === 'api' ? 'tasks' : 'api',
    ArrowUp: settingsPanel.value === 'api' ? 'tasks' : 'api',
    ArrowLeft: settingsPanel.value === 'api' ? 'tasks' : 'api',
    Home: 'api',
    End: 'tasks',
  }[event.key]
  if (!target) return
  event.preventDefault()
  void selectSettingsPanel(target, { focus: true })
}

function openApiSettings(event) {
  return openSettings(event, 'api')
}

function openTaskSettings(event) {
  return openSettings(event, 'tasks')
}

function closeSettings() {
  settingsOpen.value = false
  const restore = settingsReturnFocus
  settingsReturnFocus = null
  void nextTick(() => {
    if (restore?.isConnected && typeof restore.focus === 'function') restore.focus({ preventScroll: true })
  })
}

function trapDialogFocus(event) {
  if (event.key !== 'Tab') return
  const focusable = getFocusableElements(event.currentTarget)
  if (!focusable.length) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleSettingsKeydown(event) {
  trapDialogFocus(event)
}

function parseCcSwitchLinkInput() {
  ccSwitchImportError.value = ''
  ccSwitchImportPreview.value = null
  try {
    ccSwitchImportPreview.value = parseCcSwitchProviderLink(ccSwitchLinkInput.value)
    showToast('CC Switch 供应商链接解析成功')
  } catch (error) {
    ccSwitchImportError.value = error.message || 'CC Switch 链接解析失败'
  }
}

async function handleStartupCcSwitchLink(link) {
  if (typeof link !== 'string' || !link.trim()) return
  // Do not copy the raw protocol URL into a visible input or persistent state.
  ccSwitchLinkInput.value = ''
  ccSwitchImportError.value = ''
  ccSwitchImportPreview.value = null
  try {
    ccSwitchImportPreview.value = parseCcSwitchProviderLink(link)
    showToast('已从 ccswitch:// 协议唤起供应商预览', 'info')
  } catch (error) {
    ccSwitchImportError.value = error.message || 'CC Switch 深链接解析失败'
  }
  await openApiSettings()
}

function applyRelayConfigFromCcSwitch(value, source = 'CC Switch') {
  if (!value?.baseUrl || !value?.model || !value?.apiKey) {
    showToast('配置缺少 Base URL、模型名或 API Key', 'error')
    return false
  }
  relayConfig.value = {
    ...relayConfig.value,
    baseUrl: value.baseUrl,
    model: value.model,
    apiKey: value.apiKey,
  }
  relayStatus.value = { type: 'success', message: `${source} 配置已载入当前进程；保存后仅持久化非敏感连接配置` }
  showToast(`${source} 配置已载入`)
  return true
}

function applyCcSwitchLink() {
  if (!ccSwitchImportPreview.value) {
    parseCcSwitchLinkInput()
  }
  if (ccSwitchImportPreview.value) applyRelayConfigFromCcSwitch(ccSwitchImportPreview.value, 'CC Switch 链接')
}

async function loadCcSwitchFile() {
  if (ccSwitchFileBusy.value) return
  ccSwitchFileBusy.value = true
  try {
    const path = await selectCcSwitchConfigFile()
    if (!path) return
    ccSwitchFilePath.value = path
    ccSwitchProviders.value = await readCcSwitchProviders(path)
    ccSwitchSelectedId.value = ccSwitchProviders.value[0]?.id || ''
    showToast(`已读取 ${ccSwitchProviders.value.length} 个 CC Switch 供应商`)
  } catch (error) {
    ccSwitchProviders.value = []
    ccSwitchSelectedId.value = ''
    showToast(error.message || 'CC Switch 文件读取失败', 'error')
  } finally {
    ccSwitchFileBusy.value = false
  }
}

function applySelectedCcSwitchProvider() {
  const provider = ccSwitchSelectedProvider.value
  if (!provider) {
    showToast('请先选择 CC Switch 供应商', 'error')
    return
  }
  applyRelayConfigFromCcSwitch({
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: provider.apiKey,
  }, `CC Switch · ${provider.name || provider.appType}`)
}

function generateCcSwitchExport() {
  ccSwitchExportError.value = ''
  ccSwitchExportOutput.value = ''
  try {
    const value = {
      ...relayConfig.value,
      app: ccSwitchExportApp.value,
      name: ccSwitchExportName.value,
    }
    ccSwitchExportOutput.value = ccSwitchExportFormat.value === 'json'
      ? ccSwitchProviderJson(value)
      : buildCcSwitchProviderLink(value)
    showToast('CC Switch 导出内容已生成；内容包含 API Key，请谨慎复制', 'info')
  } catch (error) {
    ccSwitchExportError.value = error.message || 'CC Switch 导出失败'
  }
}

async function checkRelayConnection() {
  if (relayTestBusy.value) return
  relayStatus.value = null
  try {
    const saved = saveRelayConfig(relayConfig.value)
    relayConfig.value = saved
    if (!saved.baseUrl || !saved.apiKey) {
      showToast('请先填写中转站 Base URL 和 API Key', 'error')
      return
    }
    const disclosure = relayConsentDisclosure('relay-test', saved)
    await runAuthorizedOnlineAction(disclosure, () => {
      relayTestBusy.value = true
      startTask({
        operation: 'relay-test',
        label: '中转站连接测试',
        initialStage: '连接中转站',
        onlineDisclosure: disclosure,
        worker: async ({ signal, onProgress, reportStatus, requestId }) => {
          reportStatus({ stage: '读取模型列表' })
          onProgress(15)
          const cancelDesktopJob = () => { void cancelNetworkJob(requestId).catch(() => {}) }
          signal.addEventListener('abort', cancelDesktopJob, { once: true })
          try {
            const result = await testRelayConnection(saved, { signal, requestId })
            onProgress(95)
            reportStatus({ stage: '整理连接结果' })
            return result
          } finally {
            signal.removeEventListener('abort', cancelDesktopJob)
          }
        },
        resultMessage: '中转站连接测试成功',
        onSuccess: (result) => {
          relayModels.value = Array.isArray(result.models) ? result.models : []
          if (!saved.model && relayModels.value.length) {
            relayConfig.value = saveRelayConfig({ ...saved, model: relayModels.value[0] })
          }
          const selected = relayConfig.value.model ? ` · 当前模型 ${relayConfig.value.model}` : ''
          relayStatus.value = { type: 'success', message: `连接成功 · ${result.provider} · 可用模型 ${result.modelCount} 个${selected}` }
        },
        onFailure: (error) => {
          relayStatus.value = { type: 'error', message: error.message || '中转站连接失败' }
        },
        onSettled: (status) => {
          relayTestBusy.value = false
          if (status === 'canceled') relayStatus.value = { type: 'error', message: '连接测试已取消，未继续请求中转站' }
        },
      })
    })
  } catch (error) {
    relayStatus.value = { type: 'error', message: error.message || '中转站连接失败' }
    showToast(relayStatus.value.message, 'error')
  }
}

function showUpdateStatus() {
  showToast('自动更新未启用：当前构建未配置签名更新源', 'info')
}

function announce(message) {
  announcement.value = message
  window.setTimeout(() => {
    if (announcement.value === message) announcement.value = ''
  }, 3200)
}

function showToast(message, type = 'success') {
  toast.value = { message, type }
  announce(message)
  window.setTimeout(() => {
    toast.value = null
  }, 3200)
}

function persistUiPrefs() {
  saveState('ui-prefs', {
    sidebarCollapsed: sidebarCollapsed.value,
    density: uiDensity.value,
    lastTool: activeTool.value,
    taskPanelPinned: taskPanelPinned.value,
    translation: normalizeTranslationPreferences({
      sourceLanguage: translationSourceLanguage.value,
      targetLanguage: translationTargetLanguage.value,
      style: translationStyle.value,
      preserveFormatting: translationPreserveFormatting.value,
    }),
  })
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  persistUiPrefs()
  announce(sidebarCollapsed.value ? '侧栏已折叠为 64 像素图标轨' : '侧栏已展开为 234 像素导航')
}

function toggleTaskPanelPin() {
  taskPanelPinned.value = !taskPanelPinned.value
  taskPanelOpen.value = true
  persistUiPrefs()
  showToast(taskPanelPinned.value ? '任务中心已固定为第三栏' : '任务中心已取消固定', 'info')
}

function openCommandPalette() {
  commandPaletteReturnFocus = document.activeElement
  commandPaletteOpen.value = true
  commandQuery.value = ''
  commandActiveIndex.value = 0
  void nextTick(() => document.querySelector('#command-palette-input')?.focus({ preventScroll: true }))
}

function closeCommandPalette() {
  commandPaletteOpen.value = false
  commandQuery.value = ''
  commandActiveIndex.value = 0
  const target = commandPaletteReturnFocus
  commandPaletteReturnFocus = null
  void nextTick(() => {
    if (target?.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true })
  })
}

function runCommand(command) {
  if (!command) return
  if (command.toolId) {
    useToolById(command.toolId)
  } else if (command.id === 'toggle-sidebar') {
    toggleSidebar()
  } else if (command.id === 'toggle-task-panel') {
    toggleTaskPanelPin()
  } else if (command.id === 'open-task-panel') {
    taskPanelOpen.value = !taskPanelOpen.value
  } else if (command.id === 'toggle-density') {
    uiDensity.value = uiDensity.value === 'compact' ? 'comfortable' : 'compact'
    persistUiPrefs()
    showToast(uiDensity.value === 'compact' ? '已切换为紧凑密度' : '已切换为舒适密度', 'info')
  } else if (command.id === 'open-settings') {
    openApiSettings()
  }
  closeCommandPalette()
}

function handleCommandPaletteKeydown(event) {
  const count = commandResults.value.length
  if (event.key === 'Escape') {
    event.preventDefault()
    closeCommandPalette()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    commandActiveIndex.value = count ? (commandActiveIndex.value + 1) % count : 0
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    commandActiveIndex.value = count ? (commandActiveIndex.value - 1 + count) % count : 0
    return
  }
  if (event.key === 'Home' && count) {
    event.preventDefault()
    commandActiveIndex.value = 0
    return
  }
  if (event.key === 'End' && count) {
    event.preventDefault()
    commandActiveIndex.value = count - 1
    return
  }
  if (event.key === 'Enter' && count) {
    event.preventDefault()
    runCommand(commandResults.value[commandActiveIndex.value])
  }
}

function selectModule(id) {
  activeModule.value = id
  mobileNavOpen.value = false
  boundaryBarDismissed.value = false
  if (id !== 'home') {
    const first = tools.find((tool) => tool.module === id)
    if (first) {
      const nextToolId = id === 'docs' && docBusy.value ? docMode.value : first.id
      activeTool.value = nextToolId
      if (id === 'docs' && !docBusy.value) openDocMode(nextToolId)
      if (id === 'assistant') assistantActiveTab.value = assistantToolTabs[first.id] || 'overview'
    }
  }
}

function selectTool(tool) {
  if (tool.module === 'docs' && docBusy.value && tool.id !== docMode.value) {
    showToast('请等待当前文档任务完成，或先在任务中心取消', 'info')
    return
  }
  activeModule.value = tool.module
  activeTool.value = tool.id
  if (tool.module === 'assistant') assistantActiveTab.value = assistantToolTabs[tool.id] || 'overview'
  boundaryBarDismissed.value = false
  if (tool.module === 'docs') openDocMode(tool.id)
  searchFocused.value = false
  searchActiveIndex.value = -1
  mobileNavOpen.value = false
  recentTools.value = [tool.id, ...recentTools.value.filter((id) => id !== tool.id)].slice(0, 6)
  saveState('recent-tools', recentTools.value)
  persistUiPrefs()
}

// 模块内通过工具卡片切换时同样记录最近使用，但不触发模块跳转与忙碌拦截，
// 这样首页“快速开始 / 最近使用”在任意入口进入工具后都保持一致。
function rememberRecentTool(id) {
  if (!id) return
  activeTool.value = id
  if (recentTools.value[0] === id) return
  recentTools.value = [id, ...recentTools.value.filter((item) => item !== id)].slice(0, 6)
  saveState('recent-tools', recentTools.value)
}

function openSearchResults() {
  searchFocused.value = true
  searchActiveIndex.value = normalizeSearchIndex(searchActiveIndex.value, searchResults.value.length)
}

function handleSearchKeydown(event) {
  const count = searchResults.value.length
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    searchFocused.value = true
    searchActiveIndex.value = stepSearchIndex(searchActiveIndex.value, count, 1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    searchFocused.value = true
    searchActiveIndex.value = stepSearchIndex(searchActiveIndex.value, count, -1)
    return
  }
  if (event.key === 'Home' && count) {
    event.preventDefault()
    searchActiveIndex.value = 0
    return
  }
  if (event.key === 'End' && count) {
    event.preventDefault()
    searchActiveIndex.value = count - 1
    return
  }
  if (event.key === 'Enter') {
    const tool = searchResults.value[normalizeSearchIndex(searchActiveIndex.value, count)]
    if (!tool) return
    event.preventDefault()
    selectTool(tool)
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    searchFocused.value = false
    searchActiveIndex.value = -1
  }
}

function startTask(options) {
  const { operation, label, worker, resultMessage = `${label}已完成`, onSuccess, onFailure, onSettled, cancellable = true, allowRetry = true, allowOffline = false, onlineDisclosure = null, initialStage = '等待执行', totalItems } = options
  if (onlineDisclosure && !isConsentGranted(onlineConsent.value, onlineDisclosure)) {
    showToast('联网授权已失效，任务未开始', 'info')
    return null
  }
  const randomId = Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 32)
  const id = `${Date.now()}-${randomId}`
  const createdTimestamp = Date.now()
  const normalizedTotal = Number.isInteger(totalItems) && totalItems > 0 ? totalItems : null
  const task = {
    id,
    operation,
    label,
    progress: 0,
    status: 'waiting',
    stage: initialStage,
    completedItems: normalizedTotal ? 0 : null,
    totalItems: normalizedTotal,
    remainingItems: normalizedTotal,
    cancellable,
    createdTimestamp,
    createdAt: new Date(createdTimestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  }
  tasks.value = [task, ...tasks.value].slice(0, 30)
  taskPanelOpen.value = true
  persistTasks()
  const job = createJob({
    worker: (context) => {
      if (onlineDisclosure && !isConsentGranted(onlineConsent.value, onlineDisclosure)) {
        const error = new Error('联网授权已撤回')
        error.name = 'AbortError'
        throw error
      }
      return worker({ ...context, requestId: id })
    },
    onStart: () => {
      const current = tasks.value.find((item) => item.id === id)
      if (current?.status === 'waiting') current.status = 'running'
    },
    onProgress: (progress) => {
      const current = tasks.value.find((item) => item.id === id)
      if (current) {
        current.progress = progress
        if (current.stage === '等待执行' && progress > 0) current.stage = '处理中'
      }
    },
    onStatus: (status) => {
      const current = tasks.value.find((item) => item.id === id)
      if (!current) return
      current.stage = status.stage
      current.completedItems = status.completed
      current.totalItems = status.total
      current.remainingItems = status.remaining
    },
    onDone: (result) => {
      const current = tasks.value.find((item) => item.id === id)
      if (current) {
        current.progress = 100
        current.status = 'success'
        current.stage = '已完成'
        if (current.totalItems) {
          current.completedItems = current.totalItems
          current.remainingItems = 0
        }
        current.finishedTimestamp = Date.now()
      }
      persistTasks()
      onSuccess?.(result)
      showToast(resultMessage)
    },
    onError: (error) => {
      const normalized = normalizeTaskError(error)
      const current = tasks.value.find((item) => item.id === id)
      if (current) {
        current.status = 'failed'
        current.stage = '执行失败'
        current.error = normalized.message
        current.errorCode = normalized.code
        current.recovery = normalized.recovery
        current.retryable = normalized.retryable && allowRetry
        current.finishedTimestamp = Date.now()
      }
      if (normalized.retryable && allowRetry) {
        retryJobs.set(id, () => {
          if (onlineDisclosure) {
            void runAuthorizedOnlineAction(onlineDisclosure, () => startTask(options), { allowOffline })
          } else {
            startTask(options)
          }
        })
      }
      persistTasks()
      onFailure?.(error, normalized)
      showToast(`${normalized.message}（${normalized.code}）`, 'error')
    },
    onCanceling: () => {
      const current = tasks.value.find((item) => item.id === id)
      if (!current) return
      current.status = 'canceling'
      current.stage = '正在取消'
      persistTasks()
    },
    onCancel: () => {
      const current = tasks.value.find((item) => item.id === id)
      if (current) {
        current.status = 'canceled'
        current.stage = '已取消'
        current.progress = Math.min(current.progress, 99)
        current.errorCode = 'JOB_CANCELED'
        current.recovery = '需要时重新执行，源文件未修改。'
        current.finishedTimestamp = Date.now()
      }
      persistTasks()
      showToast(`${label}已取消`, 'info')
    },
    onSettled: (status, result) => {
      stopJobs.delete(id)
      onlineTaskDisclosures.delete(id)
      if (status !== 'failed') retryJobs.delete(id)
      onSettled?.(status, result)
    },
  })
  stopJobs.set(id, job.cancel)
  if (onlineDisclosure) onlineTaskDisclosures.set(id, onlineDisclosure)
  return { id, promise: job.promise }
}

function persistTasks() {
  saveState('tasks', serializeTaskHistory(tasks.value))
}

function cancelTask(task) {
  if (!['waiting', 'running'].includes(task.status)) return
  stopJobs.get(task.id)?.()
}

function canRetryTask(task) {
  return task.status === 'failed' && task.retryable && retryJobs.has(task.id)
}

function retryTask(task) {
  const retry = retryJobs.get(task.id)
  if (!retry) {
    showToast('此任务的敏感输入未持久化，请回到工具页重新选择输入', 'info')
    return
  }
  retryJobs.delete(task.id)
  retry()
}

async function requestClearCompletedTasks(event) {
  const { completed } = separateCompletedTasks(tasks.value)
  if (!completed.length) return
  taskHistoryClearReturnFocus = event?.currentTarget || document.activeElement
  pendingTaskHistoryIds.value = completed.map((task) => task.id)
  taskHistoryClearOpen.value = true
  await nextTick()
  getFocusableElements(document.querySelector('.task-history-clear-modal'))[0]?.focus({ preventScroll: true })
}

function closeTaskHistoryClear() {
  taskHistoryClearOpen.value = false
  pendingTaskHistoryIds.value = []
  const restore = taskHistoryClearReturnFocus
  taskHistoryClearReturnFocus = null
  void nextTick(() => {
    const target = restore?.isConnected ? restore : document.querySelector('.task-drawer .drawer-heading .icon-button')
    if (typeof target?.focus === 'function') target.focus({ preventScroll: true })
  })
}

function handleTaskHistoryClearKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeTaskHistoryClear()
    return
  }
  trapDialogFocus(event)
}

function clearCompletedTasks(taskIds) {
  const targetIds = new Set(taskIds || separateCompletedTasks(tasks.value).completed.map((task) => task.id))
  const cleared = tasks.value.filter((task) => task.status !== 'running' && targetIds.has(task.id))
  cleared.forEach((task) => retryJobs.delete(task.id))
  tasks.value = tasks.value.filter((task) => !targetIds.has(task.id))
  persistTasks()
  return cleared
}

function confirmClearCompletedTasks() {
  const cleared = clearCompletedTasks([...pendingTaskHistoryIds.value])
  closeTaskHistoryClear()
  if (!cleared.length) return
  if (taskHistoryUndoTimer) window.clearTimeout(taskHistoryUndoTimer)
  clearedTaskHistory.value = restoreCompletedTasks([], [...clearedTaskHistory.value, ...cleared])
  taskHistoryUndoTimer = window.setTimeout(() => {
    clearedTaskHistory.value = []
    taskHistoryUndoTimer = undefined
  }, 30_000)
  showToast(`已清除 ${cleared.length} 条任务记录；当前共 ${clearedTaskHistory.value.length} 条可在 30 秒内撤销`, 'info')
}

function restoreClearedTaskHistory() {
  if (!clearedTaskHistory.value.length) return
  tasks.value = restoreCompletedTasks(tasks.value, clearedTaskHistory.value)
  persistTasks()
  const restored = clearedTaskHistory.value.length
  clearedTaskHistory.value = []
  if (taskHistoryUndoTimer) window.clearTimeout(taskHistoryUndoTimer)
  taskHistoryUndoTimer = undefined
  showToast(`已恢复 ${restored} 条任务记录`)
}

function previewDiagnostics() {
  diagnosticPreview.value = buildDiagnosticSnapshot({
    tasks: tasks.value,
    runtimeMode: runtimeMode.value,
    capabilities: desktopCapabilities.value,
  })
  showToast('诊断包预览已生成，尚未写入磁盘')
}

async function exportDiagnostics() {
  if (!diagnosticPreview.value || diagnosticBusy.value) return
  diagnosticBusy.value = true
  try {
    const result = await createDiagnosticBundle(diagnosticPreview.value)
    downloadBlob(result.blob, result.filename)
    showToast('诊断包已下载，不会自动上传')
  } catch (error) {
    showToast(error.message || '诊断包生成失败', 'error')
  } finally {
    diagnosticBusy.value = false
  }
}

function useToolById(id) {
  const tool = toolRegistry.get(id) || tools.find((item) => item.id === id)
  if (tool) selectTool(tool)
}

function handleGlobalKeydown(event) {
  if (onlineConsentRequest.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      settleOnlineConsent(false)
    }
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
    event.preventDefault()
    if (commandPaletteOpen.value) closeCommandPalette()
    else openCommandPalette()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    document.querySelector('#global-search')?.focus()
  }
  if (event.key === 'Escape') {
    searchFocused.value = false
    if (commandPaletteOpen.value) closeCommandPalette()
    closeSettings()
  }
}

function focusMainContent(event) {
  event.preventDefault()
  const target = document.querySelector('#main-content')
  if (!target) return
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'start' })
}

function updateNetworkOnlineStatus() {
  networkOnline.value = typeof navigator === 'undefined' ? null : navigator.onLine
}

function openDependencyTool(toolId) {
  const tool = tools.find((item) => item.id === toolId)
  if (!tool) return
  settingsOpen.value = false
  settingsReturnFocus = null
  selectTool(tool)
  void nextTick(() => {
    document.querySelector('#main-content')?.focus({ preventScroll: true })
  })
}

watch(theme, (value) => {
  document.documentElement.dataset.theme = value
  saveState('theme', value)
})

watch(searchText, () => {
  searchActiveIndex.value = normalizeSearchIndex(-1, searchResults.value.length)
})

watch(commandQuery, () => {
  commandActiveIndex.value = 0
})

watch([sidebarCollapsed, uiDensity, taskPanelPinned, activeTool, translationSourceLanguage, translationTargetLanguage, translationStyle, translationPreserveFormatting], persistUiPrefs)

onMounted(() => {
  document.documentElement.dataset.theme = theme.value
  persistTasks()
  saveState('theme', theme.value)
  saveState('recent-tools', recentTools.value)
  saveState('online-consent', onlineConsent.value)
  persistUiPrefs()
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('online', updateNetworkOnlineStatus)
  window.addEventListener('offline', updateNetworkOnlineStatus)
  getRuntimeInfo().then((info) => {
    runtimeMode.value = info.mode
    if (info.ccSwitchLink) void handleStartupCcSwitchLink(info.ccSwitchLink)
  }).catch(() => {
    runtimeMode.value = 'browser'
  })
  getDesktopCapabilities().then((status) => {
    desktopCapabilities.value = status
  }).catch(() => {})
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('online', updateNetworkOnlineStatus)
  window.removeEventListener('offline', updateNetworkOnlineStatus)
  stopJobs.forEach((stop) => stop())
  onlineConsentResolver?.(false)
  onlineConsentResolver = null
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  if (imageBatchPreview.value) URL.revokeObjectURL(imageBatchPreview.value)
  if (barcodePreview.value) URL.revokeObjectURL(barcodePreview.value)
  if (taskHistoryUndoTimer) window.clearTimeout(taskHistoryUndoTimer)
  commandPaletteReturnFocus = null
})

// Document tools
const docMode = ref(initialToolDefinition?.module === 'docs' && docToolIds.includes(initialToolDefinition.id) ? initialToolDefinition.id : 'pdf-merge')
const docFiles = ref([])
const renamePattern = ref('文件-{n}')
const splitPage = ref('1-2')
const docBusy = ref(false)
const docResult = ref(null)
const docDropActive = ref(false)
const docSelectionFeedback = ref('')
const archiveMode = ref('compress')
const extractedEntries = ref([])
const officePaths = ref([])
const officeOutputDirectory = ref('')
const officeConflictPolicy = ref('stop')
const desktopFileResults = ref([])
const renameOutputDirectory = ref('')
const renameConflictPolicy = ref('stop')
const ocrLanguage = ref('chi_sim+eng')
const ocrResult = ref(null)
let docDragDepth = 0

const docModes = {
  'pdf-merge': { title: '合并多个 PDF', description: '文件只在当前会话中处理，输出默认另存为新文件。', action: '开始合并' },
  'pdf-split': { title: '按页码拆分 PDF', description: '多个页码会输出为包含独立 PDF 的 ZIP。', action: '开始拆分' },
  rename: { title: '批量重命名文件', description: '先预览名称变化，再生成新名称归档；源文件不修改。', action: '开始重命名' },
  archive: { title: 'ZIP 压缩与解压', description: '归档只在本机内存中处理，提取后可逐项下载。', action: '开始处理' },
  'office-pdf': { title: 'Office 导出 PDF', description: '桌面版调用本机 LibreOffice，转换结果写入所选目录。', action: '开始转换' },
  print: { title: '文档打印', description: '按纸张、范围、缩放和方向打开系统打印流程；设置会保存在本机。', action: '打印' },
  templates: { title: '办公模板', description: '即时生成标准 DOCX 模板，可在 Word 或 LibreOffice 中继续编辑。', action: '生成模板' },
  ocr: { title: 'OCR 文字识别', description: '图片内容不上传；首次使用需联网下载并缓存 OCR 语言模型。', action: '开始识别' },
}
const currentDocMode = computed(() => docModes[docMode.value] || docModes['pdf-merge'])
const docInputAccept = computed(() => {
  if (docMode.value.startsWith('pdf-')) return '.pdf,application/pdf'
  if (docMode.value === 'archive' && archiveMode.value === 'extract') return '.zip,application/zip'
  if (docMode.value === 'ocr') return 'image/*'
  return ''
})
const docInputMultiple = computed(() => ['pdf-merge', 'rename'].includes(docMode.value) || (docMode.value === 'archive' && archiveMode.value === 'compress'))
const docDropLabel = computed(() => {
  if (docDropActive.value) return '释放以加入文件'
  return docMode.value === 'rename' && runtimeMode.value === 'tauri' ? '拖入文件，或使用下方桌面选择器' : '拖入文件，或点击选择'
})
const docPreflightSummary = computed(() => {
  if (!docFiles.value.length) return ''
  const desktopCount = docFiles.value.filter((item) => item.path).length
  const browserFiles = docFiles.value.filter((item) => !item.path)
  const browserBytes = browserFiles.reduce((total, item) => total + Number(item.size || 0), 0)
  const inputSummary = desktopCount === docFiles.value.length
    ? `${desktopCount} 个桌面文件`
    : `${docFiles.value.length} 个文件${browserFiles.length ? `，${formatDocumentFileSize(browserBytes)}` : ''}`
  let outputSummary = '输出将在浏览器下载'
  if (docMode.value === 'rename') {
    outputSummary = desktopCount === docFiles.value.length && runtimeMode.value === 'tauri'
      ? `输出目录：${renameOutputDirectory.value || '尚未选择'}；同名：${renameConflictPolicy.value === 'rename' ? '自动添加序号' : '停止该文件'}`
      : '输出为 ZIP 下载；源文件不会修改'
  } else if (docMode.value === 'archive' && archiveMode.value === 'extract') {
    outputSummary = '提取结果将逐项提供下载'
  } else if (docMode.value === 'ocr') {
    outputSummary = '识别文本将在页面显示并可下载'
  }
  return `执行前汇总：${inputSummary}，按当前列表顺序处理；${outputSummary}`
})

function openDocMode(mode) {
  if (!docModes[mode]) return
  if (docBusy.value && mode !== docMode.value) {
    showToast('请等待当前文档任务完成，或先在任务中心取消', 'info')
    return
  }
  if (mode !== docMode.value) {
    docFiles.value = []
    extractedEntries.value = []
    ocrResult.value = null
    desktopFileResults.value = []
    docSelectionFeedback.value = ''
  }
  docMode.value = mode
  rememberRecentTool(mode)
  docResult.value = null
}

function setArchiveMode(mode) {
  if (docBusy.value || archiveMode.value === mode) return
  archiveMode.value = mode
  docFiles.value = []
  docResult.value = null
  extractedEntries.value = []
  docSelectionFeedback.value = ''
}

function addDocFiles(event) {
  const selected = Array.from(event.target.files || [])
  addDocumentSelection(selected)
  event.target.value = ''
}

function addDocumentSelection(candidates, { replace = false } = {}) {
  const canAppend = !replace && docInputMultiple.value && !docFiles.value.some((item) => item.path)
  const existing = canAppend ? docFiles.value : []
  const selection = selectDocumentFiles(candidates, {
    existing,
    mode: docMode.value,
    archiveMode: archiveMode.value,
    multiple: docInputMultiple.value,
  })
  if (!selection.accepted.length && !selection.rejected.length) return selection
  docFiles.value = [...existing, ...selection.accepted]
  docResult.value = null
  desktopFileResults.value = []
  extractedEntries.value = []
  ocrResult.value = null
  docSelectionFeedback.value = describeDocumentSelection(selection)
  if (selection.rejected.length) showToast(docSelectionFeedback.value, selection.accepted.length ? 'info' : 'error')
  return selection
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function handleDocDragEnter(event) {
  if (docBusy.value || !isFileDrag(event)) return
  docDragDepth += 1
  docDropActive.value = true
}

function handleDocDragOver(event) {
  if (docBusy.value || !isFileDrag(event)) return
  event.dataTransfer.dropEffect = 'copy'
  docDropActive.value = true
}

function handleDocDragLeave(event) {
  if (!isFileDrag(event)) return
  docDragDepth = Math.max(0, docDragDepth - 1)
  if (!docDragDepth) docDropActive.value = false
}

function handleDocDrop(event) {
  docDragDepth = 0
  docDropActive.value = false
  if (docBusy.value) {
    showToast('请等待当前文档任务完成后再添加文件', 'info')
    return
  }
  addDocumentSelection(Array.from(event.dataTransfer?.files || []))
}

async function chooseRenameInputs() {
  if (runtimeMode.value !== 'tauri' || docBusy.value) return
  try {
    const selected = await selectRenameFiles()
    if (selected.length) {
      addDocumentSelection(selected.map((path) => ({ file: null, name: displayPathName(path), path, size: 0 })), { replace: true })
    }
  } catch (error) {
    showToast(error.message || '无法选择文件', 'error')
  }
}

async function chooseRenameOutput() {
  if (runtimeMode.value !== 'tauri' || docBusy.value) return
  try {
    const selected = await selectOutputDirectory()
    if (selected) {
      renameOutputDirectory.value = selected
      desktopFileResults.value = []
      docResult.value = null
    }
  } catch (error) {
    showToast(error.message || '无法选择输出目录', 'error')
  }
}

function removeDocFile(index) {
  const [removed] = docFiles.value.splice(index, 1)
  docResult.value = null
  desktopFileResults.value = []
  if (removed) docSelectionFeedback.value = `已移除 ${removed.name}`
}

function moveDocFile(index, direction) {
  const target = index + direction
  if (target < 0 || target >= docFiles.value.length) return
  const [item] = docFiles.value.splice(index, 1)
  docFiles.value.splice(target, 0, item)
  docResult.value = null
  desktopFileResults.value = []
  docSelectionFeedback.value = `${item.name} 已${direction < 0 ? '上移' : '下移'}`
}

async function runDocTask() {
  if (docMode.value === 'print') return
  if (docMode.value === 'office-pdf') {
    runOfficeConversion()
    return
  }
  if (docMode.value === 'rename' && runtimeMode.value === 'tauri' && docFiles.value.some((item) => item.path)) {
    if (!docFiles.value.every((item) => item.path)) {
      showToast('桌面路径文件与浏览器文件不能混合处理，请重新选择', 'error')
      return
    }
    runDesktopRename()
    return
  }
  if (docMode.value === 'templates') return
  if (!docFiles.value.length) {
    showToast('请先选择至少一个文件', 'error')
    return
  }
  if (docMode.value === 'pdf-merge' && docFiles.value.length < 2) {
    showToast('PDF 合并至少需要两个文件', 'error')
    return
  }
  if (docMode.value === 'pdf-split' && docFiles.value.length !== 1) {
    showToast('PDF 拆分请选择一个源文件', 'error')
    return
  }
  if (docMode.value === 'archive' && archiveMode.value === 'extract' && docFiles.value.length !== 1) {
    showToast('ZIP 解压请选择一个归档文件', 'error')
    return
  }
  if (docMode.value === 'ocr' && docFiles.value.length !== 1) {
    showToast('OCR 请选择一张图片', 'error')
    return
  }
  const mode = docMode.value
  const files = docFiles.value.map((item) => ({ ...item }))
  const pageRange = splitPage.value
  const pattern = renamePattern.value
  const selectedArchiveMode = archiveMode.value
  const selectedOcrLanguage = ocrLanguage.value
  const onlineDisclosure = mode === 'ocr'
    ? createConsentDisclosure('ocr', { data: `语言代码 ${selectedOcrLanguage} 和语言模型下载请求；待识别图片不会发送` })
    : null
  const operationLabel = {
    'pdf-merge': 'PDF 合并',
    'pdf-split': 'PDF 拆分',
    rename: '批量重命名',
    archive: selectedArchiveMode === 'compress' ? 'ZIP 压缩' : 'ZIP 解压',
    ocr: 'OCR 文字识别',
  }[mode]
  const beginTask = () => {
    docBusy.value = true
    docResult.value = null
    extractedEntries.value = []
    ocrResult.value = null
    startTask({
      operation: mode === 'archive' ? `archive-${selectedArchiveMode}` : mode === 'rename' ? 'rename-browser' : mode,
      label: mode === 'ocr' ? `${operationLabel}（本地识别）` : `${operationLabel}（本地处理）`,
      initialStage: '校验输入',
      onlineDisclosure,
      allowOffline: mode === 'ocr',
      totalItems: mode === 'pdf-merge' || mode === 'rename' || (mode === 'archive' && selectedArchiveMode === 'compress') ? files.length : undefined,
      worker: ({ onProgress, reportStatus, isCanceled, signal }) => {
        const statusOptions = { onProgress, onStatus: reportStatus, isCanceled, signal }
        if (mode === 'pdf-merge') return mergePdfs(files.map((item) => item.file), statusOptions)
        if (mode === 'pdf-split') return splitPdf(files[0].file, pageRange, statusOptions)
        if (mode === 'rename') return packageRenamedFiles(files, pattern, statusOptions)
        if (mode === 'archive' && selectedArchiveMode === 'compress') return createArchive(files, statusOptions)
        if (mode === 'archive') return extractArchive(files[0].file, statusOptions)
        return recognizeText(files[0].file, selectedOcrLanguage, statusOptions)
      },
      resultMessage: `${operationLabel}已完成`,
      onSuccess: (result) => {
        if (mode === 'archive' && selectedArchiveMode === 'extract') {
          extractedEntries.value = result.entries
          docResult.value = { summary: result.summary }
        } else if (mode === 'ocr') {
          ocrResult.value = result
        } else {
          docResult.value = result
        }
      },
      onSettled: () => {
        docBusy.value = false
      },
    })
  }
  if (onlineDisclosure) {
    await runAuthorizedOnlineAction(onlineDisclosure, beginTask, { allowOffline: true })
  } else {
    beginTask()
  }
}

function runDesktopRename() {
  if (!renameOutputDirectory.value) {
    showToast('请选择重命名输出目录', 'error')
    return
  }
  const inputs = docFiles.value.map((item) => item.path).filter(Boolean)
  if (!inputs.length || inputs.length !== docFiles.value.length) {
    showToast('请通过桌面文件选择器重新选择文件', 'error')
    return
  }
  const pattern = renamePattern.value
  const policy = renameConflictPolicy.value
  docBusy.value = true
  docResult.value = null
  desktopFileResults.value = []
  startTask({
    operation: 'rename-desktop',
    label: '批量重命名副本（桌面处理）',
    cancellable: false,
    initialStage: '复制文件副本',
    totalItems: inputs.length,
    worker: async ({ onProgress, reportStatus }) => {
      onProgress(10)
      reportStatus({ stage: '复制文件副本', completed: 0, total: inputs.length })
      const results = await copyRenamedFiles(inputs, renameOutputDirectory.value, pattern, policy)
      onProgress(95)
      reportStatus({ stage: '整理逐项结果', completed: results.length, total: inputs.length })
      if (!results.some((item) => item.success)) {
        const error = new Error(results[0]?.error || '文件均未生成重命名副本')
        error.results = results
        throw error
      }
      return results
    },
    resultMessage: '批量重命名处理结束',
    onSuccess: (results) => {
      desktopFileResults.value = results
      const succeeded = results.filter((item) => item.success).length
      docResult.value = { summary: `成功 ${succeeded} 个，失败 ${results.length - succeeded} 个；源文件未修改` }
    },
    onFailure: (error) => {
      desktopFileResults.value = error?.results || []
      docResult.value = { summary: '未生成重命名副本；源文件未修改' }
    },
    onSettled: () => { docBusy.value = false },
  })
}

function downloadDocResult() {
  if (!docResult.value?.blob) return
  downloadBlob(docResult.value.blob, docResult.value.filename)
  showToast('结果文件已下载')
}

function downloadExtracted(entry) {
  downloadBlob(entry.blob, entry.name.split('/').pop() || `extracted-${Date.now()}`)
  showToast(`${entry.name} 已下载`)
}

function downloadOcrText() {
  if (!ocrResult.value?.text) return
  downloadBlob(new Blob([ocrResult.value.text], { type: 'text/plain;charset=utf-8' }), `ocr-${Date.now()}.txt`)
  showToast('OCR 文本已下载')
}

async function downloadOfficeTemplate(type) {
  try {
    const result = await createOfficeTemplate(type)
    downloadBlob(result.blob, result.filename)
    showToast(`${result.filename} 已生成`)
  } catch (error) {
    showToast(error.message || '模板生成失败', 'error')
  }
}

function displayPathName(path) {
  return String(path || '').split(/[\\/]/).pop() || path
}

async function chooseOfficeInputs() {
  try {
    const selected = await selectOfficeFiles()
    if (selected.length) {
      officePaths.value = selected
      desktopFileResults.value = []
    }
  } catch (error) {
    showToast(error.message || String(error), 'error')
  }
}

async function chooseOfficeOutput() {
  try {
    const selected = await selectOutputDirectory()
    if (selected) officeOutputDirectory.value = selected
  } catch (error) {
    showToast(error.message || String(error), 'error')
  }
}

function runOfficeConversion() {
  if (runtimeMode.value !== 'tauri') {
    showToast('Office 导出 PDF 需要在 Tauri 桌面版中运行', 'error')
    return
  }
  if (!desktopCapabilities.value.libreoffice) {
    showToast('未检测到 LibreOffice，请安装后重试', 'error')
    return
  }
  if (!officePaths.value.length || !officeOutputDirectory.value) {
    showToast('请选择 Office 文件和输出目录', 'error')
    return
  }
  const inputs = [...officePaths.value]
  const outputDirectory = officeOutputDirectory.value
  const policy = officeConflictPolicy.value
  docBusy.value = true
  desktopFileResults.value = []
  startTask({
    operation: 'office-pdf',
    label: 'Office 导出 PDF（LibreOffice）',
    cancellable: false,
    initialStage: '转换 Office 文件',
    totalItems: inputs.length,
    worker: async ({ onProgress, reportStatus }) => {
      onProgress(10)
      reportStatus({ stage: '转换 Office 文件', completed: 0, total: inputs.length })
      const results = await convertOfficeToPdf(inputs, outputDirectory, policy)
      onProgress(95)
      reportStatus({ stage: '整理逐项结果', completed: results.length, total: inputs.length })
      const succeeded = results.filter((item) => item.success).length
      if (!succeeded) {
        const error = new Error(results[0]?.error || 'Office 文件均转换失败')
        error.results = results
        throw error
      }
      return results
    },
    resultMessage: 'Office 批量转换处理结束',
    onSuccess: (results) => {
      desktopFileResults.value = results
      const succeeded = results.filter((item) => item.success).length
      docResult.value = { summary: `成功 ${succeeded} 个，失败 ${results.length - succeeded} 个；源文件未修改` }
    },
    onFailure: (error) => {
      desktopFileResults.value = error?.results || []
      docResult.value = { summary: '未生成 PDF；源文件未修改' }
    },
    onSettled: () => {
      docBusy.value = false
    },
  })
}

const renamedFiles = computed(() => docFiles.value.map((item, index) => ({
  key: `${index}-${item.name}`,
  before: item.name,
  after: renderRenamePattern(renamePattern.value, index) + extensionOf(item.name),
})))

function extensionOf(filename) {
  const index = filename.lastIndexOf('.')
  return index > -1 ? filename.slice(index) : ''
}

// Data calculators
const unitCategory = ref('length')
const unitValue = ref(1)
const fromUnit = ref('m')
const toUnit = ref('cm')
const unitTables = {
  length: { m: ['米', 1], cm: ['厘米', 0.01], km: ['千米', 1000], ft: ['英尺', 0.3048] },
  weight: { kg: ['千克', 1], g: ['克', 0.001], lb: ['磅', 0.45359237], t: ['吨', 1000] },
  temperature: { c: ['摄氏度', 'c'], f: ['华氏度', 'f'], k: ['开尔文', 'k'] },
}
const unitOptions = computed(() => Object.entries(unitTables[unitCategory.value]).map(([value, [label]]) => ({ value, label })))
const unitResult = computed(() => {
  const value = Number(unitValue.value) || 0
  if (unitCategory.value === 'temperature') {
    const celsius = fromUnit.value === 'c' ? value : fromUnit.value === 'f' ? (value - 32) * 5 / 9 : value - 273.15
    return toUnit.value === 'c' ? celsius : toUnit.value === 'f' ? celsius * 9 / 5 + 32 : celsius + 273.15
  }
  const base = value * unitTables[unitCategory.value][fromUnit.value][1]
  return base / unitTables[unitCategory.value][toUnit.value][1]
})

const percentageBase = ref(100)
const percentageValue = ref(125)
const percentageResult = computed(() => {
  const base = Number(percentageBase.value) || 0
  const value = Number(percentageValue.value) || 0
  return {
    ratio: base ? (value / base) * 100 : 0,
    change: base ? ((value - base) / base) * 100 : 0,
  }
})

const calculatorExpression = ref('1280 + 320')
const calculatorResult = ref(null)
const calculatorError = ref('')

function runCalculator() {
  try {
    const value = calculateExpression(calculatorExpression.value)
    calculatorResult.value = buildCalculatorResult(value)
    calculatorError.value = ''
  } catch (error) {
    calculatorResult.value = null
    calculatorError.value = error?.message || '表达式无法计算'
  }
}

function clearCalculator() {
  calculatorExpression.value = ''
  calculatorResult.value = null
  calculatorError.value = ''
}

runCalculator()

function localDateInputValue(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

const dateMode = ref('age')
const birthDate = ref('1995-01-01')
const dateStart = ref('2020-01-01')
const dateEnd = ref(localDateInputValue())
const ageResult = computed(() => {
  try {
    return calculateAge(birthDate.value, new Date()).label
  } catch {
    return '日期无效'
  }
})
const dateDifferenceResult = computed(() => {
  try {
    return calculateDateDifference(dateStart.value, dateEnd.value)
  } catch {
    return null
  }
})

function resetUnits() {
  const first = Object.keys(unitTables[unitCategory.value])
  fromUnit.value = first[0]
  toUnit.value = first[1] || first[0]
}

watch(unitCategory, resetUnits)

const exchangeAmount = ref(100)
const exchangeFrom = ref('CNY')
const exchangeTo = ref('USD')
const exchangeResult = ref(null)
const exchangeBusy = ref(false)
const mortgageInput = ref({ principal: 1_000_000, years: 30, annualRate: 3.1, method: 'equal-payment' })
const mortgageResult = ref(null)
const taxInput = ref({ annualIncome: 200_000, annualDeduction: 12_000 })
const taxResult = ref(null)
const bmiInput = ref({ weight: 70, height: 175 })
const bmiResult = ref(null)

async function runExchange() {
  const request = { amount: exchangeAmount.value, from: exchangeFrom.value, to: exchangeTo.value }
  const disclosure = createConsentDisclosure('exchange')
  await runAuthorizedOnlineAction(disclosure, () => {
    exchangeBusy.value = true
    exchangeResult.value = null
    startTask({
      operation: 'exchange',
      label: '汇率换算（显式联网）',
      initialStage: '连接汇率服务',
      onlineDisclosure: disclosure,
      worker: async ({ signal, onProgress, reportStatus }) => {
        reportStatus({ stage: '连接汇率服务' })
        onProgress(15)
        reportStatus({ stage: '读取最新汇率' })
        const result = await fetchExchangeRate({ ...request, signal })
        onProgress(95)
        reportStatus({ stage: '整理换算结果' })
        return result
      },
      resultMessage: '汇率已更新',
      onSuccess: (result) => {
        exchangeResult.value = result
      },
      onSettled: () => {
        exchangeBusy.value = false
      },
    })
  })
}

function runMortgage() {
  try {
    mortgageResult.value = calculateMortgage(mortgageInput.value)
    showToast('房贷测算已更新')
  } catch (error) {
    mortgageResult.value = null
    showToast(error.message, 'error')
  }
}

function runTax() {
  try {
    taxResult.value = calculateAnnualTax(taxInput.value)
    showToast('个税估算已更新')
  } catch (error) {
    taxResult.value = null
    showToast(error.message, 'error')
  }
}

function runBmi() {
  try {
    bmiResult.value = calculateBmi(bmiInput.value.weight, bmiInput.value.height)
    showToast('BMI 已计算')
  } catch (error) {
    bmiResult.value = null
    showToast(error.message, 'error')
  }
}

// QR tools
const qrText = ref('https://example.com/local-first')
const qrImage = ref('')
const qrReadResult = ref('')
const qrBusy = ref(false)
const barcodeValue = ref('123456789012')
const barcodeFormat = ref('ean13')
const barcodeDefinitions = Object.values(BARCODE_FORMATS)
const barcodeWidth = ref(2)
const barcodeHeight = ref(80)
const barcodeMargin = ref(10)
const barcodeDisplayValue = ref(true)
const barcodeLineColor = ref('#17324d')
const barcodeBackground = ref('#ffffff')
const barcodePreview = ref('')
const barcodeBusy = ref(false)
const barcodeResult = ref(null)

async function generateQr() {
  if (!qrText.value.trim()) {
    showToast('请输入要编码的内容', 'error')
    return
  }
  qrBusy.value = true
  try {
    qrImage.value = await renderQr(qrText.value.trim())
    showToast('二维码已生成')
  } catch {
    showToast('二维码生成失败', 'error')
  } finally {
    qrBusy.value = false
  }
}

async function recognizeQr(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  qrBusy.value = true
  try {
    const result = await readQr(file)
    qrReadResult.value = result || '未识别到二维码，请更换清晰图片'
    announce(qrReadResult.value)
  } catch (error) {
    showToast(error.message, 'error')
  } finally {
    qrBusy.value = false
  }
}

async function downloadQr() {
  if (!qrImage.value) return
  try {
    const response = await fetch(qrImage.value)
    downloadBlob(await response.blob(), 'efficiency-toolbox-qr.png')
    showToast('二维码已下载')
  } catch {
    showToast('二维码下载失败，请重新生成', 'error')
  }
}

function clearBarcodePreview() {
  if (barcodePreview.value) URL.revokeObjectURL(barcodePreview.value)
  barcodePreview.value = ''
  barcodeResult.value = null
}

async function generateBarcode() {
  barcodeBusy.value = true
  clearBarcodePreview()
  try {
    const result = await renderBarcode(barcodeValue.value, {
      format: barcodeFormat.value,
      width: barcodeWidth.value,
      height: barcodeHeight.value,
      margin: barcodeMargin.value,
      displayValue: barcodeDisplayValue.value,
      lineColor: barcodeLineColor.value,
      background: barcodeBackground.value,
    })
    barcodeResult.value = result
    barcodePreview.value = URL.createObjectURL(result.pngBlob)
    showToast(`${BARCODE_FORMATS[result.format].label} 已生成`)
  } catch (error) {
    showToast(error.message || '条形码生成失败', 'error')
  } finally {
    barcodeBusy.value = false
  }
}

function downloadBarcode(format = 'png') {
  const result = barcodeResult.value
  if (!result) return
  const blob = format === 'svg' ? result.svgBlob : result.pngBlob
  downloadBlob(blob, `barcode-${Date.now()}.${format}`)
  showToast(`条形码 ${format.toUpperCase()} 已下载`)
}

const networkTarget = ref('127.0.0.1')
const networkPort = ref(443)
const networkTimeout = ref(3000)
const networkBusy = ref(false)
const networkResult = ref(null)

async function runNetworkAction(type) {
  if (['ping', 'port'].includes(type) && runtimeMode.value !== 'tauri') {
    showToast('Ping 与端口检测需要在 Tauri 桌面版中运行', 'error')
    return
  }
  const labels = { speed: '网速测试', ip: '公网 IP 查询', ping: 'Ping 检测', port: '端口检测' }
  const target = networkTarget.value
  const port = Number(networkPort.value)
  const timeout = Number(networkTimeout.value)
  if (['ping', 'port'].includes(type) && !String(target).trim()) {
    showToast('请输入要检测的目标主机', 'error')
    return
  }
  if (type === 'port' && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    showToast('端口必须是 1-65535 之间的整数', 'error')
    return
  }
  const disclosure = ['speed', 'ip'].includes(type)
    ? createConsentDisclosure(type)
    : probeConsentDisclosure(type, target, port)
  await runAuthorizedOnlineAction(disclosure, () => {
    networkBusy.value = true
    networkResult.value = null
    startTask({
      operation: type,
      label: labels[type],
      cancellable: true,
      onlineDisclosure: disclosure,
      initialStage: type === 'speed' ? '连接测速服务' : type === 'ip' ? '连接 IP 服务' : '连接桌面网络服务',
      worker: async ({ onProgress, reportStatus, isCanceled, signal, requestId }) => {
        onProgress(5)
        if (type === 'speed') return testDownloadSpeed({ onProgress, onStatus: reportStatus, isCanceled, signal })
        if (type === 'ip') {
          reportStatus({ stage: '读取公网 IP' })
          const result = await queryPublicIp({ signal })
          onProgress(95)
          reportStatus({ stage: '整理检测结果' })
          return result
        }
        const cancelDesktopJob = () => { void cancelNetworkJob(requestId).catch(() => {}) }
        signal.addEventListener('abort', cancelDesktopJob, { once: true })
        try {
          reportStatus({ stage: type === 'ping' ? '检测目标连通性' : '检测目标端口' })
          const result = type === 'ping'
            ? await pingHost(target, timeout, requestId)
            : await probePort(target, port, timeout, requestId)
          onProgress(95)
          reportStatus({ stage: '整理检测结果' })
          return result
        } finally {
          signal.removeEventListener('abort', cancelDesktopJob)
        }
      },
      resultMessage: `${labels[type]}已完成`,
      onSuccess: (result) => {
        networkResult.value = { type, ...result }
      },
      onSettled: () => {
        networkBusy.value = false
      },
    })
  })
}

// Image processing
const imageFile = ref(null)
const imagePreview = ref('')
const imageQuality = ref(82)
const imageFormat = ref('image/jpeg')
const imageTargetEnabled = ref(false)
const imageTargetKb = ref(300)
const imageResult = ref(null)
const imageBusy = ref(false)
const imageBatchFiles = ref([])
const imageBatchBusy = ref(false)
const imageBatchResult = ref(null)
const imageBatchPreview = ref('')
const imageWorkspaceBusy = ref(false)
const tableWorkspaceBusy = ref(false)
const watermarkText = ref('仅供内部使用')
const watermarkOpacity = ref(40)
const stitchDirection = ref('vertical')
const longCaptureFrameCount = ref(3)
const longCaptureInterval = ref(3)
const longCaptureDelay = ref(3)

function chooseImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  imageFile.value = file
  imageResult.value = null
  imagePreview.value = URL.createObjectURL(file)
}

async function compressImage() {
  if (!imageFile.value) {
    showToast('请先选择图片', 'error')
    return
  }
  imageBusy.value = true
  try {
    imageResult.value = imageTargetEnabled.value
      ? await processImageToTarget(imageFile.value, { targetKb: imageTargetKb.value, format: imageFormat.value, maxEdge: 2400, minQuality: 0.18 })
      : await processImage(imageFile.value, { quality: imageQuality.value / 100, format: imageFormat.value })
    showToast('图片处理完成，可下载结果')
  } catch (error) {
    showToast(error.message, 'error')
  } finally {
    imageBusy.value = false
  }
}

function downloadImage() {
  if (!imageResult.value) return
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
  const extension = extensions[imageFormat.value] || 'jpg'
  downloadBlob(imageResult.value.blob, `compressed-${Date.now()}.${extension}`)
  showToast('图片已下载')
}

function openImageMode(mode) {
  if (imageBatchBusy.value || imageBusy.value || imageWorkspaceBusy.value) {
    showToast('请等待当前图片任务完成，或先在任务中心取消', 'info')
    return
  }
  rememberRecentTool(mode)
  imageBatchFiles.value = []
  setImageBatchResult(null)
}

function chooseBatchImages(event) {
  imageBatchFiles.value = Array.from(event.target.files || [])
  event.target.value = ''
  setImageBatchResult(null)
}

function setImageBatchResult(result) {
  if (imageBatchPreview.value) URL.revokeObjectURL(imageBatchPreview.value)
  imageBatchResult.value = result
  imageBatchPreview.value = result?.blob && !result.filename.endsWith('.zip') ? URL.createObjectURL(result.blob) : ''
}

function runImageBatch() {
  const mode = activeTool.value
  if (mode === 'screenshot') {
    imageBatchBusy.value = true
    startTask({
      operation: 'screenshot',
      label: '屏幕截图',
      cancellable: false,
      initialStage: '等待屏幕授权',
      totalItems: 1,
      worker: async ({ onProgress, reportStatus }) => {
        reportStatus({ stage: '等待屏幕授权', completed: 0, total: 1 })
        onProgress(10)
        const result = await captureScreen()
        onProgress(95)
        reportStatus({ stage: '生成截图结果', completed: 1, total: 1 })
        return { ...result, summary: `已捕获 ${result.width}×${result.height} 屏幕图像` }
      },
      resultMessage: '截图已生成，可下载另存',
      onSuccess: setImageBatchResult,
      onSettled: () => { imageBatchBusy.value = false },
    })
    return
  }
  if (mode === 'long-screenshot') {
    const frameCount = Number(longCaptureFrameCount.value)
    const intervalSeconds = Number(longCaptureInterval.value)
    const leadSeconds = Number(longCaptureDelay.value)
    imageBatchBusy.value = true
    setImageBatchResult(null)
    startTask({
      operation: 'long-screenshot',
      label: '长截图定时分段捕获',
      initialStage: '等待屏幕授权',
      totalItems: Number.isInteger(frameCount) && frameCount > 0 ? frameCount : undefined,
      worker: ({ onProgress, reportStatus, isCanceled }) => captureLongScreen({
        frameCount,
        intervalSeconds,
        leadSeconds,
        onProgress,
        onStatus: reportStatus,
        isCanceled,
      }),
      resultMessage: '长截图已生成，可下载另存',
      onSuccess: setImageBatchResult,
      onSettled: () => { imageBatchBusy.value = false },
    })
    return
  }
  if (!imageBatchFiles.value.length) {
    showToast('请先选择图片', 'error')
    return
  }
  const files = [...imageBatchFiles.value]
  const watermark = watermarkText.value
  const opacity = watermarkOpacity.value / 100
  const direction = stitchDirection.value
  imageBatchBusy.value = true
  setImageBatchResult(null)
  startTask({
    operation: mode,
    label: mode === 'watermark' ? '批量加水印' : '长图拼接',
    initialStage: mode === 'watermark' ? '生成水印' : '读取图片',
    totalItems: files.length,
    worker: ({ onProgress, reportStatus, isCanceled }) => mode === 'watermark'
      ? watermarkImages(files, watermark, { opacity, onProgress, onStatus: reportStatus, isCanceled })
      : stitchImages(files, direction, { onProgress, onStatus: reportStatus, isCanceled }),
    resultMessage: mode === 'watermark' ? '水印图片已生成' : '长图已生成',
    onSuccess: setImageBatchResult,
    onSettled: () => { imageBatchBusy.value = false },
  })
}

function downloadImageBatchResult() {
  if (!imageBatchResult.value) return
  downloadBlob(imageBatchResult.value.blob, imageBatchResult.value.filename)
  showToast('图片结果已下载')
}

// Security tools
const passwordLength = ref(20)
const passwordOptions = ref({ upper: true, lower: true, number: true, symbol: true })
const generatedPassword = ref('')
const passwordToCheck = ref('')
const redactText = ref('合同联系人：张三，电话 13800138000，邮箱 zhangsan@example.com。身份证 110101199001011234。')
const redactedText = ref('')
const cryptoMode = ref('encrypt')
const cryptoFile = ref(null)
const cryptoPassword = ref('')
const cryptoPasswordConfirm = ref('')
const cryptoBusy = ref(false)
const cryptoResult = ref(null)

const passwordStrength = computed(() => {
  const value = passwordToCheck.value
  let score = 0
  if (value.length >= 12) score += 2
  else if (value.length >= 8) score += 1
  if (/[a-z]/.test(value)) score += 1
  if (/[A-Z]/.test(value)) score += 1
  if (/\d/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1
  const labels = ['未检测', '较弱', '一般', '较强', '强', '很强']
  return { score, label: labels[Math.min(score, labels.length - 1)] }
})

function generatePassword() {
  const groups = []
  if (passwordOptions.value.upper) groups.push('ABCDEFGHJKLMNPQRSTUVWXYZ')
  if (passwordOptions.value.lower) groups.push('abcdefghijkmnopqrstuvwxyz')
  if (passwordOptions.value.number) groups.push('23456789')
  if (passwordOptions.value.symbol) groups.push('!@#$%^&*_-+=')
  if (!groups.length) {
    showToast('至少选择一种字符类型', 'error')
    return
  }
  const requestedLength = Number.parseInt(passwordLength.value, 10)
  const length = Number.isFinite(requestedLength) ? Math.min(64, Math.max(8, requestedLength)) : 20
  passwordLength.value = length
  const chars = groups.join('')
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  const password = Array.from(values, (value) => chars[value % chars.length])
  groups.forEach((group, index) => {
    password[index] = group[values[index] % group.length]
  })
  for (let index = password.length - 1; index > 0; index -= 1) {
    const swapIndex = values[index] % (index + 1)
    ;[password[index], password[swapIndex]] = [password[swapIndex], password[index]]
  }
  generatedPassword.value = password.join('')
  showToast('密码已在本机生成，不会保存')
}

async function copyText(value, message = '已复制') {
  try {
    await navigator.clipboard.writeText(value)
    showToast(message)
  } catch {
    showToast('当前环境禁止访问剪贴板，请手动复制', 'error')
  }
}

function redactSensitive() {
  redactedText.value = redactText.value
    .replace(/1[3-9]\d{9}/g, '***********')
    .replace(/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/g, '***@***')
    .replace(/\d{17}[\dXx]/g, '******************')
  showToast('已生成脱敏副本，原文未修改')
}

function chooseCryptoFile(event) {
  cryptoFile.value = event.target.files?.[0] || null
  event.target.value = ''
  cryptoResult.value = null
}

function openCryptoMode(mode) {
  if (cryptoBusy.value) return
  cryptoMode.value = mode
  cryptoFile.value = null
  cryptoPassword.value = ''
  cryptoPasswordConfirm.value = ''
  cryptoResult.value = null
}

function runCrypto() {
  if (!cryptoFile.value) {
    showToast('请先选择文件', 'error')
    return
  }
  if (cryptoMode.value === 'encrypt' && cryptoPassword.value !== cryptoPasswordConfirm.value) {
    showToast('两次输入的加密口令不一致', 'error')
    return
  }
  const file = cryptoFile.value
  const password = cryptoPassword.value
  const mode = cryptoMode.value
  cryptoBusy.value = true
  cryptoResult.value = null
  startTask({
    operation: `crypto-${mode}`,
    label: mode === 'encrypt' ? 'OpenPGP 文件加密' : 'OpenPGP 文件解密',
    allowRetry: false,
    initialStage: '加载加密引擎',
    totalItems: 1,
    worker: ({ onProgress, reportStatus, isCanceled }) => mode === 'encrypt'
      ? encryptFile(file, password, { onProgress, onStatus: reportStatus, isCanceled })
      : decryptFile(file, password, { onProgress, onStatus: reportStatus, isCanceled }),
    resultMessage: mode === 'encrypt' ? '加密副本已生成' : '文件已解密',
    onSuccess: (result) => {
      cryptoResult.value = result
      cryptoPassword.value = ''
      cryptoPasswordConfirm.value = ''
    },
    onSettled: () => {
      cryptoBusy.value = false
    },
  })
}

function downloadCryptoResult() {
  if (!cryptoResult.value) return
  downloadBlob(cryptoResult.value.blob, cryptoResult.value.filename)
  showToast('加密工具结果已下载')
}

async function runRelayAssistant() {
  const prompt = relayPrompt.value.trim()
  if (!prompt) {
    showToast('请输入需要中转站处理的内容', 'error')
    return
  }
  if (!relayConfigured.value) {
    openApiSettings()
    showToast('请先在设置中补全中转站 API 配置', 'error')
    return
  }
  const config = { ...relayConfig.value }
  const disclosure = relayConsentDisclosure('relay', config, {
    data: `API Key、模型名、固定系统提示、你输入的 ${prompt.length} 个字符及生成参数`,
  })
  await runAuthorizedOnlineAction(disclosure, () => {
    relayBusy.value = true
    relayResult.value = null
    startTask({
      operation: 'relay-assistant',
      label: '中转站 AI 助手',
      initialStage: '准备中转站请求',
      onlineDisclosure: disclosure,
      worker: async ({ signal, onProgress, reportStatus, requestId }) => {
        reportStatus({ stage: '准备中转站请求' })
        onProgress(10)
        const cancelDesktopJob = () => { void cancelNetworkJob(requestId).catch(() => {}) }
        signal.addEventListener('abort', cancelDesktopJob, { once: true })
        try {
          reportStatus({ stage: '等待中转站响应' })
          const result = await callRelayChat(config, {
            messages: [
              { role: 'system', content: '你是文档办公助手。请使用简洁、准确的中文回答，不编造未提供的事实。' },
              { role: 'user', content: prompt },
            ],
            signal,
            requestId,
          })
          onProgress(95)
          reportStatus({ stage: '整理中转站结果' })
          return result
        } finally {
          signal.removeEventListener('abort', cancelDesktopJob)
        }
      },
      resultMessage: '中转站请求已完成',
      onSuccess: (result) => {
        relayResult.value = result
      },
      onSettled: () => {
        relayBusy.value = false
      },
    })
  })
}

function swapTranslationLanguages() {
  if (!canSwapTranslationLanguages(translationSourceLanguage.value, translationTargetLanguage.value)) {
    showToast('自动识别语言后才能交换，请先手动选择源语言', 'info')
    return
  }
  const source = translationSourceLanguage.value
  translationSourceLanguage.value = translationTargetLanguage.value
  translationTargetLanguage.value = source
  translationResult.value = null
  translationStatus.value = null
}

function clearTranslation() {
  if (translationBusy.value) return
  translationText.value = ''
  translationResult.value = null
  translationStatus.value = null
}

async function runTranslation() {
  if (translationBusy.value) return
  let sourceText
  try {
    sourceText = validateTranslationText(translationText.value, TRANSLATION_MAX_CHARACTERS)
  } catch (error) {
    translationStatus.value = { type: 'error', message: error.message || '翻译原文无效' }
    showToast(translationStatus.value.message, 'error')
    return
  }
  if (!relayConfigured.value) {
    openApiSettings()
    showToast('请先在设置中补全中转站 API 配置', 'error')
    return
  }

  const preferences = {
    sourceLanguage: translationSourceLanguage.value,
    targetLanguage: translationTargetLanguage.value,
    style: translationStyle.value,
    preserveFormatting: translationPreserveFormatting.value,
  }
  const config = { ...relayConfig.value }
  const disclosure = relayConsentDisclosure('translation', config, {
    data: `API Key、模型名、${translationPreferenceSummary(preferences)} 及原文 ${sourceText.length} 个字符`,
    purpose: '调用已配置的 AI 模型生成翻译结果',
  })
  const authorization = await runAuthorizedOnlineAction(disclosure, () => {
    translationBusy.value = true
    translationResult.value = null
    translationStatus.value = { type: 'info', message: '正在准备翻译请求…' }
    const task = startTask({
      operation: 'translation',
      label: '翻译助手',
      initialStage: '准备翻译请求',
      onlineDisclosure: disclosure,
      worker: async ({ signal, onProgress, reportStatus, requestId }) => {
        reportStatus({ stage: '准备翻译请求' })
        onProgress(10)
        const cancelDesktopJob = () => { void cancelNetworkJob(requestId).catch(() => {}) }
        signal.addEventListener('abort', cancelDesktopJob, { once: true })
        try {
          reportStatus({ stage: '翻译中' })
          translationStatus.value = { type: 'info', message: '正在翻译…' }
          onProgress(25)
          const result = await callRelayChat(config, {
            messages: buildTranslationMessages({ text: sourceText, ...preferences }),
            temperature: 0.1,
            maxTokens: 4096,
            signal,
            requestId,
          })
          onProgress(95)
          reportStatus({ stage: '整理翻译结果' })
          return result
        } finally {
          signal.removeEventListener('abort', cancelDesktopJob)
        }
      },
      resultMessage: '翻译已完成',
      onSuccess: (result) => {
        translationResult.value = result
        translationStatus.value = { type: 'success', message: `翻译完成 · ${translationPreferenceSummary(preferences)}` }
      },
      onFailure: (error) => {
        translationStatus.value = { type: 'error', message: error.message || '翻译失败' }
      },
      onSettled: (status) => {
        translationBusy.value = false
        if (status === 'canceled') translationStatus.value = { type: 'info', message: '翻译已取消，未生成结果' }
      },
    })
    if (!task) translationBusy.value = false
  })
  if (!authorization.started && authorization.reason === 'denied') {
    translationStatus.value = { type: 'info', message: '未获得翻译联网授权，未发送任何请求' }
  }
}

const statusLabel = computed(() => {
  return formatNetworkConnectionLabel(networkOnline.value, runningTasks.value.length)
})
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'task-panel-pinned': taskPanelPinned && taskPanelOpen, 'density-compact': uiDensity === 'compact' }">
    <a class="skip-link" href="#main-content" @click="focusMainContent">跳到主要内容</a>
    <div class="sr-only" aria-live="polite">{{ announcement }}</div>
    <aside class="sidebar" :class="{ 'is-open': mobileNavOpen, 'is-collapsed': sidebarCollapsed }" :aria-hidden="onlineConsentRequest ? 'true' : undefined" :inert="onlineConsentRequest ? '' : undefined">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><Zap :size="18" /></div>
        <div class="brand-copy">
          <strong>效率百宝箱</strong>
          <span>本地优先 · 无广告</span>
        </div>
        <button class="icon-button sidebar-toggle" type="button" :aria-label="sidebarCollapsed ? '展开侧栏' : '折叠侧栏'" :title="sidebarCollapsed ? '展开侧栏' : '折叠侧栏'" @click="toggleSidebar"><component :is="sidebarCollapsed ? PanelLeftOpen : PanelLeftClose" :size="17" /></button>
        <button class="icon-button mobile-close" type="button" aria-label="关闭导航" @click="mobileNavOpen = false"><X :size="18" /></button>
      </div>
      <nav class="module-nav" aria-label="功能模块">
        <button
          v-for="item in modules"
          :key="item.id"
          class="nav-item"
          :class="{ active: activeModule === item.id }"
          type="button"
          :aria-current="activeModule === item.id ? 'page' : undefined"
          @click="selectModule(item.id)"
        >
          <component :is="item.icon" :size="17" stroke-width="1.8" aria-hidden="true" />
           <span class="nav-label">{{ item.label }}</span>
        </button>
      </nav>
       <div class="sidebar-footer">
         <div class="privacy-status" title="本地模式"><span class="status-dot"></span><span class="privacy-label">本地模式</span><span class="status-lock"><LockKeyhole :size="13" /></span></div>
         <button class="settings-link" type="button" aria-label="打开设置" title="打开设置" @click="openApiSettings"><Settings :size="16" /><span class="nav-label">设置</span></button>
       </div>
    </aside>

    <div class="app-content" :aria-hidden="onlineConsentRequest ? 'true' : undefined" :inert="onlineConsentRequest ? '' : undefined">
      <header class="topbar">
        <button class="icon-button mobile-menu" type="button" aria-label="打开导航" @click="mobileNavOpen = true"><Menu :size="20" /></button>
        <div class="search-wrap" :class="{ focused: searchFocused }">
          <Search :size="18" aria-hidden="true" />
          <input id="global-search" v-model="searchText" type="search" role="combobox" aria-label="全局搜索" aria-autocomplete="list" aria-controls="global-search-results" :aria-expanded="searchFocused" :aria-activedescendant="searchActiveIndex >= 0 ? `global-search-option-${searchResults[searchActiveIndex]?.id}` : undefined" placeholder="搜索功能、命令或最近任务" autocomplete="off" @focus="openSearchResults" @keydown="handleSearchKeydown" />
          <kbd>Ctrl K</kbd>
          <div v-if="searchFocused" id="global-search-results" class="search-popover" role="listbox" aria-label="功能搜索结果">
            <div class="popover-heading"><span>{{ searchText ? '搜索结果' : '常用功能' }}</span><span>{{ searchResults.length }} 项</span></div>
            <button v-for="(tool, index) in searchResults" :id="`global-search-option-${tool.id}`" :key="tool.id" class="search-result" :class="{ 'is-active': index === searchActiveIndex }" type="button" role="option" :aria-selected="index === searchActiveIndex" @mouseenter="searchActiveIndex = index" @focus="searchActiveIndex = index" @click="selectTool(tool)">
              <component :is="tool.icon" :size="16" aria-hidden="true" />
              <span class="result-copy"><strong>{{ tool.label }}</strong><small>{{ tool.description }}</small></span>
              <span class="access-tag" :class="toolAccess(tool.id).className">{{ toolAccess(tool.id).label }}</span>
              <ArrowRight :size="15" aria-hidden="true" />
            </button>
            <div v-if="!searchResults.length" class="empty-search">没有匹配功能，试试“PDF”“图片”或“密码”。</div>
          </div>
        </div>
         <div class="topbar-actions">
           <span class="connection-label" role="status" aria-live="polite"><span class="status-dot" :class="{ offline: networkOnline === false }"></span>{{ statusLabel }}</span>
           <button class="command-trigger" type="button" aria-label="打开命令面板" title="命令面板 · Ctrl Shift P" @click="openCommandPalette"><Command :size="16" /><span>命令</span><kbd>Ctrl ⇧ P</kbd></button>
           <button class="task-button" :class="{ active: taskPanelOpen }" type="button" :aria-label="taskPanelOpen ? '关闭任务中心' : '打开任务中心'" @click="taskPanelOpen = !taskPanelOpen">
             <PanelRight :size="18" /><span>任务中心</span><b v-if="runningTasks.length">{{ runningTasks.length }}</b>
           </button>
          <button class="avatar-button" type="button" aria-label="打开设置" @click="openApiSettings">S</button>
        </div>
      </header>

      <main id="main-content" class="main-content" tabindex="-1">
        <section v-if="activeModule === 'home'" class="page home-page" aria-labelledby="home-title">
          <div class="page-heading hero-heading">
            <div>
              <p class="eyebrow">工作台 / {{ new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) }}</p>
              <h1 id="home-title">把琐碎工作，收进一个安静的工作台。</h1>
              <p class="heading-subtitle">常用能力在本机完成，文件不默认离开设备。选择一个工具开始，长任务会在任务中心持续可见。</p>
            </div>
            <div class="hero-status"><ShieldCheck :size="18" /><span>隐私边界已启用</span></div>
          </div>

          <div class="section-header"><div><h2>快速开始</h2><p>最近使用的工具排在前面，其余功能按注册顺序完整展示；也可用 Ctrl+K 全局搜索。</p></div><span class="section-meta">全部功能</span></div>
          <div class="quick-grid">
            <ToolEntryCard
              v-for="tool in quickTools"
              :key="tool.id"
              :label="tool.label"
              :description="tool.description"
              :icon="tool.icon"
              :status="toolAccess(tool.id).label"
              :status-class="toolAccess(tool.id).className"
              @click="selectTool(tool)"
            />
          </div>

          <section class="image-zone" aria-labelledby="image-zone-title">
            <div class="image-zone-heading">
              <div>
                <p class="eyebrow">图像类专区</p>
                <h2 id="image-zone-title">图片处理与视觉素材</h2>
                <p>压缩、转换、AI 视觉、证件照和文字编辑，结果只在本机生成。</p>
              </div>
              <button class="outline-button" type="button" @click="selectModule('image')"><ImageIcon :size="15" aria-hidden="true" /> 打开图像工作台</button>
            </div>
            <div class="image-zone-grid">
              <ToolEntryCard
                v-for="tool in imageTools"
                :key="tool.id"
                :label="tool.label"
                :description="tool.description"
                :icon="tool.icon"
                :status="toolAccess(tool.id).label"
                :status-class="toolAccess(tool.id).className"
                @click="selectTool(tool)"
              />
            </div>
          </section>

          <div class="home-grid">
            <section class="content-card recent-card" aria-labelledby="recent-title">
              <div class="card-heading"><div><h2 id="recent-title">最近使用</h2><p>只保存工具元数据，不保存文档正文。</p></div><MoreHorizontal :size="18" aria-hidden="true" /></div>
              <div class="recent-list tool-entry-grid">
                <ToolEntryCard
                  v-for="tool in recentToolDefinitions"
                  :key="tool.id"
                  :label="tool.label"
                  :description="tool.description"
                  :icon="tool.icon"
                  :status="toolAccess(tool.id).label"
                  :status-class="toolAccess(tool.id).className"
                  @click="useToolById(tool.id)"
                />
              </div>
            </section>
            <section class="content-card offline-card" aria-labelledby="offline-title">
              <div class="card-heading"><div><h2 id="offline-title">离线能力</h2><p>本次工作区状态</p></div><span class="metric-value">80%+</span></div>
              <div class="meter"><span style="width: 84%"></span></div>
              <div class="metric-foot"><span>本地工具可直接使用</span><span>联网能力单独标识</span></div>
              <button class="text-button" type="button" @click="openTaskSettings">查看隐私设置 <ArrowRight :size="14" /></button>
            </section>
          </div>
        </section>

        <section v-else class="page module-page" :aria-labelledby="`${activeModule}-title`">
          <div class="page-heading compact-heading">
            <div><p class="eyebrow">模块 / {{ currentModule.label }}</p><h1 :id="`${activeModule}-title`">{{ currentModule.label }}</h1><p class="heading-subtitle">{{ currentModule.description }}<span v-if="activeModule === 'network'" class="inline-boundary"> · 部分能力需要桌面桥接或插件</span></p></div>
            <div class="module-actions"><button class="outline-button" type="button" @click="taskPanelOpen = true"><PanelRight :size="16" /> 任务中心</button></div>
          </div>

          <div v-if="boundaryBarVisible" class="dependency-bar" :class="{ attention: boundaryBar.attention }" role="status">
            <div class="dependency-bar-copy"><span class="dependency-bar-icon"><component :is="boundaryBar.icon" :size="16" /></span><span><strong>{{ boundaryBar.title }}</strong><small>{{ boundaryBar.detail }}</small></span></div>
            <button class="icon-button" type="button" aria-label="关闭边界提示" title="关闭边界提示" @click="boundaryBarDismissed = true"><X :size="15" /></button>
          </div>

          <div v-if="activeModule === 'docs'" class="workspace-grid">
            <ToolWorkspace aria-labelledby="doc-tool-title">
              <div class="tool-entry-grid module-tool-grid" role="tablist" aria-label="文档工具">
                <ToolEntryCard
                  v-for="mode in docToolIds"
                  :key="mode"
                  role="tab"
                  :aria-selected="docMode === mode"
                  :active="docMode === mode"
                  :disabled="docBusy"
                  :label="toolRegistry.get(mode)?.label || mode"
                  :description="toolRegistry.get(mode)?.description || ''"
                  :icon="toolRegistry.get(mode)?.icon || FileText"
                  :status="toolAccess(mode).label"
                  :status-class="toolAccess(mode).className"
                  @click="openDocMode(mode)"
                />
              </div>

              <div class="tool-title-row">
                <div><h2 id="doc-tool-title">{{ currentDocMode.title }}</h2><p>{{ currentDocMode.description }}</p></div>
                <span v-if="docMode === 'office-pdf'" class="plugin-chip"><FileOutput :size="13" /> 需插件 · {{ desktopCapabilities.libreoffice ? 'LibreOffice 已检测' : 'LibreOffice 未就绪' }}</span>
                <span v-else-if="docMode === 'ocr'" class="plugin-chip"><FileImage :size="13" /> 需插件 · 首次联网</span>
                <span v-else class="offline-chip"><LockKeyhole :size="13" /> 本地处理</span>
              </div>

              <PrintWorkspace v-if="docMode === 'print'" :runtime-mode="runtimeMode" :notify="showToast" @busy-change="docBusy = $event" />

              <div v-else-if="docMode === 'archive'" class="segmented-control" aria-label="压缩或解压模式">
                <button type="button" :class="{ active: archiveMode === 'compress' }" :aria-pressed="archiveMode === 'compress'" :disabled="docBusy" @click="setArchiveMode('compress')">创建 ZIP</button>
                <button type="button" :class="{ active: archiveMode === 'extract' }" :aria-pressed="archiveMode === 'extract'" :disabled="docBusy" @click="setArchiveMode('extract')">提取 ZIP</button>
              </div>

              <template v-if="docMode === 'office-pdf'">
                <div class="dependency-panel" :class="{ missing: !desktopCapabilities.libreoffice }">
                  <strong>{{ desktopCapabilities.libreoffice ? 'LibreOffice 可用' : '未检测到 LibreOffice' }}</strong>
                  <span>{{ desktopCapabilities.libreoffice || '请安装 LibreOffice 后重启桌面版；其他模块不受影响。' }}</span>
                </div>
                <div class="action-row">
                  <button class="outline-button" type="button" :disabled="runtimeMode !== 'tauri' || docBusy" @click="chooseOfficeInputs"><Upload :size="15" /> 选择 Office 文件</button>
                  <button class="outline-button" type="button" :disabled="runtimeMode !== 'tauri' || docBusy" @click="chooseOfficeOutput"><FileArchive :size="15" /> 选择输出目录</button>
                </div>
                <div v-if="officePaths.length" class="file-list" aria-label="已选择 Office 文件">
                  <div v-for="path in officePaths" :key="path" class="file-row"><FileText :size="16" /><span class="file-name">{{ displayPathName(path) }}</span></div>
                </div>
                <p v-if="officeOutputDirectory" class="path-line">输出目录：<code>{{ officeOutputDirectory }}</code></p>
                <div class="form-row"><label for="office-conflict-policy">同名输出</label><select id="office-conflict-policy" v-model="officeConflictPolicy" class="form-control"><option value="stop">停止该文件并提示</option><option value="rename">自动添加序号</option></select></div>
              </template>

              <div v-else-if="docMode === 'templates'" class="template-grid">
                <button type="button" class="template-choice" @click="downloadOfficeTemplate('meeting')"><FileText :size="20" /><strong>会议纪要</strong><span>议题、决策与行动项</span></button>
                <button type="button" class="template-choice" @click="downloadOfficeTemplate('expense')"><FileText :size="20" /><strong>报销清单</strong><span>费用明细与审批信息</span></button>
                <button type="button" class="template-choice" @click="downloadOfficeTemplate('weekly')"><FileText :size="20" /><strong>项目周报</strong><span>进展、风险与下周计划</span></button>
              </div>

              <template v-else-if="docMode !== 'office-pdf' && docMode !== 'print'">
                <template v-if="docMode === 'rename' && runtimeMode === 'tauri'">
                  <div class="action-row">
                    <button class="outline-button" type="button" :disabled="docBusy" @click="chooseRenameInputs"><Upload :size="15" /> 选择文件</button>
                    <button class="outline-button" type="button" :disabled="docBusy" @click="chooseRenameOutput"><FileArchive :size="15" /> 选择输出目录</button>
                  </div>
                  <p v-if="renameOutputDirectory" class="path-line">输出目录：<code>{{ renameOutputDirectory }}</code></p>
                  <div class="form-row"><label for="rename-conflict-policy">同名输出</label><select id="rename-conflict-policy" v-model="renameConflictPolicy" class="form-control"><option value="stop">停止该文件并提示</option><option value="rename">自动添加序号</option></select></div>
                </template>
                <label class="dropzone" :class="{ 'is-dragging': docDropActive, 'is-disabled': docBusy }" for="doc-files" :aria-disabled="docBusy" aria-describedby="doc-selection-feedback" @dragenter.prevent="handleDocDragEnter" @dragover.prevent="handleDocDragOver" @dragleave.prevent="handleDocDragLeave" @drop.prevent="handleDocDrop"><Upload :size="22" /><strong>{{ docDropLabel }}</strong><span>{{ docInputMultiple ? '支持多选' : '选择一个文件' }} · 选择时会校验格式、空文件和重复项</span><input id="doc-files" type="file" :disabled="docBusy" :multiple="docInputMultiple" :accept="docInputAccept" @change="addDocFiles" /></label>
                <p id="doc-selection-feedback" class="file-selection-feedback" aria-live="polite">{{ docSelectionFeedback }}</p>
                <div v-if="docFiles.length" class="file-list" aria-label="已选择文件">
                  <div v-for="(item, index) in docFiles" :key="`${item.name}-${index}`" class="file-row"><FileText :size="16" /><span class="file-name">{{ item.name }}</span><span class="file-size">{{ item.path ? '桌面文件' : `${(item.size / 1024).toFixed(0)} KB` }}</span><span v-if="docInputMultiple" class="file-actions"><button class="icon-button" type="button" :disabled="docBusy || index === 0" :aria-label="`上移 ${item.name}`" @click="moveDocFile(index, -1)"><ArrowUp :size="14" /></button><button class="icon-button" type="button" :disabled="docBusy || index === docFiles.length - 1" :aria-label="`下移 ${item.name}`" @click="moveDocFile(index, 1)"><ArrowDown :size="14" /></button></span><button class="icon-button" type="button" :disabled="docBusy" :aria-label="`移除 ${item.name}`" @click="removeDocFile(index)"><X :size="15" /></button></div>
                </div>
                <p v-if="docPreflightSummary" class="file-preflight" aria-live="polite"><ClipboardList :size="15" />{{ docPreflightSummary }}</p>
                <div v-if="docMode === 'rename'" class="form-row"><label for="rename-pattern">命名模板</label><input id="rename-pattern" v-model="renamePattern" class="form-control" /><span class="field-hint">使用 {n} 插入序号</span></div>
                <div v-if="docMode === 'pdf-split'" class="form-row"><label for="split-page">页码范围</label><input id="split-page" v-model="splitPage" class="form-control" placeholder="例如 1-2,4" /><span class="field-hint">输出为独立 PDF</span></div>
                <div v-if="docMode === 'ocr'" class="form-row"><label for="ocr-language">识别语言</label><select id="ocr-language" v-model="ocrLanguage" class="form-control"><option value="chi_sim+eng">简体中文 + 英文</option><option value="chi_tra+eng">繁体中文 + 英文</option><option value="eng">英文</option></select></div>
                <div v-if="docMode === 'ocr'" class="network-disclosure"><Network :size="16" /><span><strong>jsDelivr · 首次需联网</strong><small>仅请求所选语言模型，用于本机 OCR；不发送图片。可在任务中心取消，或在设置中撤回授权。</small></span></div>
                <div v-if="docMode === 'rename' && docFiles.length" class="preview-table"><div class="preview-head"><span>原名称</span><span>新名称预览</span></div><div v-for="item in renamedFiles" :key="item.key" class="preview-row"><span>{{ item.before }}</span><ArrowRight :size="14" /><span>{{ item.after }}</span></div></div>
              </template>

              <div v-if="docMode !== 'templates' && docMode !== 'print'" class="action-row"><button class="primary-button" type="button" :disabled="docBusy" @click="runDocTask"><Play :size="16" /> {{ docBusy ? '处理中...' : currentDocMode.action }}</button><span class="safe-hint"><ShieldCheck :size="14" /> 默认另存，不覆盖源文件</span></div>
              <div v-if="docResult" class="result-callout doc-result"><CheckCircle2 :size="16" /><span>{{ docResult.summary }}</span><button v-if="docResult.blob" class="outline-button" type="button" @click="downloadDocResult"><Download :size="15" /> 下载结果</button></div>
              <div v-if="extractedEntries.length" class="file-list result-list" aria-label="已提取文件"><div v-for="entry in extractedEntries" :key="entry.name" class="file-row"><FileText :size="15" /><span class="file-name">{{ entry.name }}</span><span class="file-size">{{ (entry.size / 1024).toFixed(1) }} KB</span><button class="icon-button" type="button" :aria-label="`下载 ${entry.name}`" @click="downloadExtracted(entry)"><Download :size="15" /></button></div></div>
              <div v-if="ocrResult" class="ocr-result"><div class="result-heading"><span>识别结果 · 置信度 {{ ocrResult.confidence.toFixed(1) }}%</span><div><button class="icon-button" type="button" aria-label="复制 OCR 文本" @click="copyText(ocrResult.text)"><Copy :size="15" /></button><button class="icon-button" type="button" aria-label="下载 OCR 文本" @click="downloadOcrText"><Download :size="15" /></button></div></div><textarea class="form-control" :value="ocrResult.text" rows="10" readonly></textarea></div>
              <div v-if="desktopFileResults.length" class="file-list result-list" aria-label="批量文件处理结果"><div v-for="(item, index) in desktopFileResults" :key="`${item.inputName}-${index}`" class="file-row"><CheckCircle2 v-if="item.success" :size="15" class="success-icon" /><X v-else :size="15" class="negative" /><span class="file-name">{{ item.inputName }}</span><span v-if="item.success && item.outputName" class="file-output-name" :title="item.outputName">{{ item.outputName }}</span><span class="file-path" :title="item.success ? item.outputPath : item.error">{{ item.success ? item.outputPath : item.error }}</span></div></div>
            </ToolWorkspace>
          </div>

          <div v-else-if="activeModule === 'data'" class="workspace-grid data-workspace">
            <ToolWorkspace>
              <div class="tool-entry-grid module-tool-grid" role="tablist" aria-label="计算工具">
                <ToolEntryCard
                  v-for="id in dataToolIds"
                  :key="id"
                  role="tab"
                  :aria-selected="activeTool === id"
                  :active="activeTool === id"
                  :label="toolRegistry.get(id)?.label || id"
                  :description="toolRegistry.get(id)?.description || ''"
                  :icon="toolRegistry.get(id)?.icon || Gauge"
                  :status="toolAccess(id).label"
                  :status-class="toolAccess(id).className"
                  @click="rememberRecentTool(id)"
                />
              </div>
              <div class="tool-title-row"><div><h2>{{ tools.find((tool) => tool.id === activeTool)?.label || '数据计算' }}</h2><p>{{ tools.find((tool) => tool.id === activeTool)?.description || '本地规则型结果标注依据；汇率仅在点击后联网并显示数据日期。' }}</p></div><span :class="activeTool === 'exchange' ? 'online-chip' : 'offline-chip'"><Gauge :size="13" /> {{ activeTool === 'exchange' ? '显式联网' : '离线可用' }}</span></div>

              <div v-if="activeTool === 'unit'" class="calculator"><div class="form-grid three"><label>类别<select v-model="unitCategory" class="form-control"><option value="length">长度</option><option value="weight">重量</option><option value="temperature">温度</option></select></label><label>数值<input v-model="unitValue" class="form-control" type="number" /></label><label>从<select v-model="fromUnit" class="form-control"><option v-for="item in unitOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><label>到<select v-model="toUnit" class="form-control"><option v-for="item in unitOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label></div><div class="result-panel"><span>换算结果</span><strong>{{ Number(unitResult).toLocaleString('zh-CN', { maximumFractionDigits: 8 }) }} {{ unitTables[unitCategory][toUnit][0] }}</strong><small>本地固定换算系数</small></div></div>
              <div v-else-if="activeTool === 'date'" class="calculator">
                <div class="segmented-control date-mode-switch" aria-label="日期计算模式">
                  <button type="button" :class="{ active: dateMode === 'age' }" :aria-pressed="dateMode === 'age'" @click="dateMode = 'age'">计算年龄</button>
                  <button type="button" :class="{ active: dateMode === 'difference' }" :aria-pressed="dateMode === 'difference'" @click="dateMode = 'difference'">日期差</button>
                </div>
                <div v-if="dateMode === 'age'" class="form-grid"><label for="birth-date">出生日期<input id="birth-date" v-model="birthDate" class="form-control" type="date" /></label><div class="result-panel compact"><span>周岁</span><strong>{{ ageResult }}</strong><small>按本机当前日期计算</small></div></div>
                <div v-else class="form-grid three"><label for="date-start">开始日期<input id="date-start" v-model="dateStart" class="form-control" type="date" /></label><label for="date-end">结束日期<input id="date-end" v-model="dateEnd" class="form-control" type="date" /></label><div class="result-panel compact"><span>相差天数</span><strong>{{ dateDifferenceResult ? `${dateDifferenceResult.days} 天` : '日期无效' }}</strong><small>{{ dateDifferenceResult ? `${dateDifferenceResult.direction} · 不含结束日` : '请检查日期范围' }}</small></div></div>
              </div>
              <div v-else-if="activeTool === 'percentage'" class="calculator"><div class="form-grid"><label>原数值<input v-model="percentageBase" class="form-control" type="number" /></label><label>新数值<input v-model="percentageValue" class="form-control" type="number" /></label></div><div class="result-grid"><div class="result-panel compact"><span>占原值</span><strong>{{ percentageResult.ratio.toFixed(2) }}%</strong></div><div class="result-panel compact"><span>变化幅度</span><strong :class="{ positive: percentageResult.change >= 0, negative: percentageResult.change < 0 }">{{ percentageResult.change >= 0 ? '+' : '' }}{{ percentageResult.change.toFixed(2) }}%</strong></div></div></div>
              <div v-else-if="activeTool === 'calculator'" class="calculator calculator-tool">
                <p class="calculator-help">支持加、减、乘、除和括号；结果同时按数字小写与人民币中文大写显示。</p>
                <label for="calculator-expression">计算表达式<input id="calculator-expression" v-model="calculatorExpression" class="form-control" type="text" autocomplete="off" spellcheck="false" placeholder="例如 1280.50 + 300" @keydown.enter.prevent="runCalculator" /></label>
                <div class="action-row"><button class="primary-button" type="button" @click="runCalculator"><Calculator :size="15" /> 计算</button><button class="outline-button" type="button" @click="clearCalculator"><Trash2 :size="15" /> 清空</button><span class="safe-hint"><ShieldCheck :size="14" /> 仅在本机计算，不发送数据</span></div>
                <p v-if="calculatorError" class="calculator-error" role="alert">{{ calculatorError }}</p>
                <div v-if="calculatorResult" class="result-grid calculator-result-grid"><div class="result-panel compact"><span>小写金额</span><strong>{{ calculatorResult.lowercase }} 元</strong><small>按两位小数显示</small></div><div class="result-panel compact"><span>大写金额</span><strong class="uppercase-amount">{{ calculatorResult.uppercase }}</strong><small>人民币中文金额</small></div></div>
              </div>
              <TableWorkspace v-else-if="activeTool === 'table-data'" :notify="showToast" @busy-change="tableWorkspaceBusy = $event" />
              <div v-else-if="activeTool === 'exchange'" class="calculator"><div class="form-grid three"><label>金额<input v-model="exchangeAmount" class="form-control" type="number" min="0.01" /></label><label>从<select v-model="exchangeFrom" class="form-control"><option v-for="code in ['CNY','USD','EUR','GBP','JPY']" :key="code" :value="code">{{ code }}</option></select></label><label>到<select v-model="exchangeTo" class="form-control"><option v-for="code in ['USD','CNY','EUR','GBP','JPY']" :key="code" :value="code">{{ code }}</option></select></label></div><div class="network-disclosure"><Network :size="16" /><span><strong>Frankfurter · ECB 参考汇率</strong><small>发送金额和币种以获取带日期的汇率；可在任务中心取消，或在设置中撤回授权。</small></span></div><div class="action-row"><button class="primary-button" type="button" :disabled="exchangeBusy" @click="runExchange"><RefreshCw :size="15" /> {{ exchangeBusy ? '查询中...' : '查询最新汇率' }}</button></div><div v-if="exchangeResult" class="result-panel"><span>换算结果</span><strong>{{ exchangeResult.amount.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) }} {{ exchangeTo }}</strong><small>1 {{ exchangeFrom }} = {{ exchangeResult.rate.toFixed(6) }} {{ exchangeTo }} · {{ exchangeResult.provider }} · 数据日期 {{ exchangeResult.date }}</small></div></div>
              <div v-else-if="activeTool === 'mortgage'" class="calculator"><div class="form-grid three"><label>贷款本金（元）<input v-model="mortgageInput.principal" class="form-control" type="number" min="1" /></label><label>期限（年）<input v-model="mortgageInput.years" class="form-control" type="number" min="1" max="50" /></label><label>年利率（%）<input v-model="mortgageInput.annualRate" class="form-control" type="number" min="0.01" step="0.01" /></label><label>还款方式<select v-model="mortgageInput.method" class="form-control"><option value="equal-payment">等额本息</option><option value="equal-principal">等额本金</option></select></label></div><div class="action-row"><button class="primary-button" type="button" @click="runMortgage"><Gauge :size="15" /> 计算房贷</button></div><div v-if="mortgageResult" class="result-grid"><div class="result-panel compact"><span>{{ mortgageInput.method === 'equal-payment' ? '月供' : '首月月供' }}</span><strong>¥{{ mortgageResult.firstPayment.toFixed(2) }}</strong><small v-if="mortgageInput.method === 'equal-principal'">末月 ¥{{ mortgageResult.lastPayment.toFixed(2) }}</small></div><div class="result-panel compact"><span>总利息 / 总还款</span><strong>¥{{ mortgageResult.totalInterest.toFixed(2) }}</strong><small>总还款 ¥{{ mortgageResult.totalPayment.toFixed(2) }} · {{ mortgageResult.months }} 期</small></div></div></div>
              <div v-else-if="activeTool === 'tax'" class="calculator"><div class="form-grid"><label>年度综合所得（元）<input v-model="taxInput.annualIncome" class="form-control" type="number" min="0" /></label><label>年度专项等扣除（元）<input v-model="taxInput.annualDeduction" class="form-control" type="number" min="0" /></label></div><div class="action-row"><button class="primary-button" type="button" @click="runTax"><Gauge :size="15" /> 估算个税</button></div><div v-if="taxResult" class="result-panel"><span>年度估算税额</span><strong>¥{{ taxResult.tax.toFixed(2) }}</strong><small>应纳税所得额 ¥{{ taxResult.taxable.toFixed(2) }} · 税率 {{ (taxResult.rate * 100).toFixed(0) }}% · {{ taxResult.rule }}</small></div></div>
              <div v-else class="calculator"><div class="form-grid"><label>体重（kg）<input v-model="bmiInput.weight" class="form-control" type="number" min="1" step="0.1" /></label><label>身高（cm）<input v-model="bmiInput.height" class="form-control" type="number" min="1" step="0.1" /></label></div><div class="action-row"><button class="primary-button" type="button" @click="runBmi"><Gauge :size="15" /> 计算 BMI</button></div><div v-if="bmiResult" class="result-panel"><span>BMI / 分类</span><strong>{{ bmiResult.bmi.toFixed(2) }} · {{ bmiResult.category }}</strong><small>{{ bmiResult.rule }}</small></div></div>
            </ToolWorkspace>
          </div>

          <div v-else-if="activeModule === 'network'" class="workspace-grid">
            <ToolWorkspace>
              <div class="tool-entry-grid module-tool-grid" role="tablist" aria-label="网络工具">
                <ToolEntryCard
                  v-for="id in networkToolIds"
                  :key="id"
                  role="tab"
                  :aria-selected="activeTool === id"
                  :active="activeTool === id"
                  :disabled="networkBusy || barcodeBusy"
                  :label="toolRegistry.get(id)?.label || id"
                  :description="toolRegistry.get(id)?.description || ''"
                  :icon="toolRegistry.get(id)?.icon || Network"
                  :status="toolAccess(id).label"
                  :status-class="toolAccess(id).className"
                  @click="rememberRecentTool(id)"
                />
              </div>

              <template v-if="activeTool === 'qr'">
                <div class="tool-title-row"><div><h2>二维码工具</h2><p>生成与识别均在本机完成，图片不会上传。</p></div><span class="offline-chip"><LockKeyhole :size="13" /> 本地处理</span></div>
                <div class="qr-layout"><div><label for="qr-text">编码内容</label><textarea id="qr-text" v-model="qrText" class="form-control qr-input" rows="7" placeholder="输入链接、文本或联系方式"></textarea><div class="action-row"><button class="primary-button" type="button" :disabled="qrBusy" @click="generateQr"><QrCode :size="16" /> {{ qrBusy ? '处理中...' : '生成二维码' }}</button><label class="outline-button file-button"><Upload :size="16" /> 识别图片<input type="file" accept="image/*" @change="recognizeQr" /></label></div><div v-if="qrReadResult" class="result-callout" role="status"><CheckCircle2 :size="16" /><span>{{ qrReadResult }}</span><button v-if="qrReadResult && !qrReadResult.startsWith('未')" class="icon-button" type="button" aria-label="复制识别结果" @click="copyText(qrReadResult)"><Copy :size="15" /></button></div></div><div class="qr-preview"><div v-if="qrImage" class="qr-art"><img :src="qrImage" alt="已生成的二维码" /><button class="text-button" type="button" @click="downloadQr"><Download :size="14" /> 下载 PNG</button></div><div v-else class="qr-empty"><QrCode :size="42" /><span>生成后在这里预览</span><small>内容仅保留在当前页面</small></div></div></div>
              </template>

              <template v-else-if="activeTool === 'barcode'">
                <div class="tool-title-row"><div><h2>条形码生成</h2><p>在本机生成 Code 128 或 EAN-13 条形码，内容不会上传。</p></div><span class="offline-chip"><Barcode :size="13" /> 本地处理</span></div>
                <div class="barcode-layout">
                  <div class="barcode-controls">
                    <label>条形码格式<select v-model="barcodeFormat" class="form-control"><option v-for="definition in barcodeDefinitions" :key="definition.id" :value="definition.id">{{ definition.label }}</option></select><span class="field-hint">{{ BARCODE_FORMATS[barcodeFormat].hint }}</span></label>
                    <label>编码内容<input v-model="barcodeValue" class="form-control" type="text" maxlength="512" autocomplete="off" spellcheck="false" placeholder="EAN-13 输入 12 位数字，Code 128 可输入编号" @keydown.enter.prevent="generateBarcode" /></label>
                    <div class="form-grid three barcode-options"><label>条宽<input v-model="barcodeWidth" class="form-control" type="number" min="1" max="4" step="0.5" /></label><label>条高<input v-model="barcodeHeight" class="form-control" type="number" min="30" max="180" /></label><label>留白<input v-model="barcodeMargin" class="form-control" type="number" min="0" max="40" /></label></div>
                    <label class="check-option"><input v-model="barcodeDisplayValue" type="checkbox" /> 显示底部编码文字</label>
                    <div class="barcode-color-row"><label>条形码颜色<input v-model="barcodeLineColor" class="color-input" type="color" aria-label="条形码颜色" /></label><label>背景颜色<input v-model="barcodeBackground" class="color-input" type="color" aria-label="背景颜色" /></label></div>
                    <div class="action-row"><button class="primary-button" type="button" :disabled="barcodeBusy" @click="generateBarcode"><Barcode :size="16" /> {{ barcodeBusy ? '生成中...' : '生成条形码' }}</button><button v-if="barcodeResult" class="outline-button" type="button" @click="clearBarcodePreview"><X :size="15" /> 清空</button></div>
                  </div>
                  <div class="barcode-preview" aria-live="polite"><div v-if="barcodePreview" class="barcode-art"><img :src="barcodePreview" alt="已生成的条形码" /><small>{{ BARCODE_FORMATS[barcodeResult.format].label }} · {{ barcodeResult.value }} · {{ barcodeResult.width }}×{{ barcodeResult.height }} px</small><div class="action-row"><button class="outline-button" type="button" @click="downloadBarcode('png')"><Download :size="15" /> PNG</button><button class="outline-button" type="button" @click="downloadBarcode('svg')"><Download :size="15" /> SVG</button></div></div><div v-else class="barcode-empty"><Barcode :size="42" /><span>生成后在这里预览</span><small>无效内容不会生成伪造条码</small></div></div>
                </div>
              </template>

              <template v-else>
                <div class="tool-title-row"><div><h2>{{ tools.find((tool) => tool.id === activeTool)?.label }}</h2><p>{{ activeTool === 'speed' ? '点击后从 Cloudflare 下载 2 MB 测试数据，仅测本次下载速率。' : activeTool === 'ip' ? '点击后向 ipify 发送网络请求，服务方会看到当前公网地址。' : '只检测下方指定目标；不扫描网段或端口范围。' }}</p></div><span class="online-chip"><Network :size="13" /> {{ activeTool === 'ping' || activeTool === 'port' ? (runtimeMode === 'tauri' ? '桌面联网' : '需桌面版联网') : '需联网' }}</span></div>
                <div v-if="activeTool === 'ping' || activeTool === 'port'" class="form-grid three network-form"><label>目标主机<input v-model="networkTarget" class="form-control" type="text" maxlength="253" placeholder="127.0.0.1 或 example.com" /></label><label v-if="activeTool === 'port'">端口<input v-model="networkPort" class="form-control" type="number" min="1" max="65535" /></label><label>超时（毫秒）<input v-model="networkTimeout" class="form-control" type="number" min="250" max="30000" /></label></div>
                <div class="network-disclosure"><Network :size="16" /><span><strong>{{ activeTool === 'speed' ? 'Cloudflare Speed' : activeTool === 'ip' ? 'ipify' : `指定目标 ${networkTarget}${activeTool === 'port' ? `:${networkPort}` : ''}` }}</strong><small>{{ activeTool === 'speed' ? '下载约 2 MB 测试数据，用于计算即时速率。' : activeTool === 'ip' ? '发送网络请求以显示公网 IP，服务方会看到该地址。' : activeTool === 'ping' ? '发送一次 ICMP 探测，用于检测可达性和耗时。' : '发起一次 TCP 连接，用于检测指定端口。' }} 可在任务中心取消，或在设置中撤回授权。</small></span></div>
                <div class="action-row"><button class="primary-button" type="button" :disabled="networkBusy || ((activeTool === 'ping' || activeTool === 'port') && runtimeMode !== 'tauri')" @click="runNetworkAction(activeTool)"><Play :size="15" /> {{ networkBusy ? '检测中...' : '开始检测' }}</button></div>
                <div v-if="networkResult" class="result-panel"><span>检测结果</span><strong v-if="networkResult.type === 'speed'">{{ networkResult.mbps.toFixed(2) }} Mbps</strong><strong v-else-if="networkResult.type === 'ip'">{{ networkResult.value }}</strong><strong v-else :class="networkResult.success ? 'positive' : 'negative'">{{ networkResult.detail }}</strong><small v-if="networkResult.type === 'speed'">接收 {{ (networkResult.bytes / 1000000).toFixed(2) }} MB · {{ networkResult.seconds.toFixed(2) }} 秒 · {{ networkResult.provider }}</small><small v-else-if="networkResult.type === 'ip'">{{ networkResult.provider }} · {{ networkResult.checkedAt }}</small><small v-else>耗时 {{ networkResult.elapsedMs }} ms · 用户指定目标</small></div>
              </template>
            </ToolWorkspace>
          </div>

          <div v-else-if="activeModule === 'image'" class="workspace-grid">
            <ToolWorkspace>
              <div class="tool-entry-grid module-tool-grid" role="tablist" aria-label="图片工具">
                <ToolEntryCard
                  v-for="id in imageToolIds"
                  :key="id"
                  role="tab"
                  :aria-selected="activeTool === id"
                  :active="activeTool === id"
                  :disabled="imageBusy || imageBatchBusy || imageWorkspaceBusy"
                  :label="toolRegistry.get(id)?.label || id"
                  :description="toolRegistry.get(id)?.description || ''"
                  :icon="toolRegistry.get(id)?.icon || ImageIcon"
                  :status="toolAccess(id).label"
                  :status-class="toolAccess(id).className"
                  @click="openImageMode(id)"
                />
              </div>

              <ImageWorkspace v-if="isAdvancedImageTool" :mode="activeTool" :runtime-mode="runtimeMode" :start-task="startTask" :run-online-action="runAuthorizedOnlineAction" @busy-change="imageWorkspaceBusy = $event" @notify="showToast" />

              <template v-else-if="activeTool === 'image-compress'">
                <div class="tool-title-row"><div><h2>图片压缩与格式转换</h2><p>Canvas 本地处理；原图不上传，结果另存为新文件。</p></div><span class="offline-chip"><LockKeyhole :size="13" /> 本地处理</span></div>
                <label class="dropzone image-drop" for="image-file"><ImageIcon :size="22" /><strong>{{ imageFile ? imageFile.name : '选择一张图片' }}</strong><span>支持 JPG、PNG、WebP · 处理前预览</span><input id="image-file" type="file" accept="image/*" @change="chooseImage" /></label><div v-if="imagePreview" class="image-workbench"><div class="image-preview"><img :src="imagePreview" alt="待处理图片预览" /></div><div class="image-controls"><label class="check-option image-target-toggle"><input v-model="imageTargetEnabled" type="checkbox" /> 压到指定 KB</label><label v-if="imageTargetEnabled">目标大小（KB）<input v-model="imageTargetKb" class="form-control" type="number" min="10" max="20000" step="1" /><span class="field-hint">系统会自动调整质量与尺寸，尽量不超过目标。</span></label><label v-else>质量 <strong>{{ imageQuality }}%</strong><input v-model="imageQuality" class="form-range" type="range" min="20" max="100" /></label><label>输出格式<select v-model="imageFormat" class="form-control"><option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></label><button class="primary-button" type="button" :disabled="imageBusy" @click="compressImage"><WandSparkles :size="16" /> {{ imageBusy ? '处理中...' : imageTargetEnabled ? '压缩到目标大小' : '开始处理' }}</button><button v-if="imageResult" class="outline-button" type="button" @click="downloadImage"><Download :size="16" /> 下载 {{ imageResult.width }}×{{ imageResult.height }}</button><div v-if="imageResult" class="result-callout"><CheckCircle2 :size="16" /><span>{{ (imageResult.blob.size / 1024).toFixed(0) }} KB · {{ imageResult.withinTarget === false ? `未达到 ${imageResult.targetKb} KB，已尽量压缩` : imageResult.targetKb ? `目标 ${imageResult.targetKb} KB 内` : '已生成结果' }}</span></div></div></div>
              </template>

              <template v-else>
                <div class="tool-title-row"><div><h2>{{ tools.find((tool) => tool.id === activeTool)?.label }}</h2><p>{{ activeTool === 'screenshot' ? '系统会显示屏幕或窗口授权选择器；未授权不会捕获任何内容。' : activeTool === 'long-screenshot' ? '授权同一屏幕或窗口后定时捕获；请在每次间隔内滚动目标内容。' : activeTool === 'watermark' ? '批量生成带文字水印的 PNG 副本；原图不修改。' : '按所选方向拼接多张图片，结果过大时会停止并提示。' }}</p></div><span class="offline-chip"><LockKeyhole :size="13" /> 本地处理</span></div>
                <label v-if="!['screenshot', 'long-screenshot'].includes(activeTool)" class="dropzone image-drop" for="image-batch-files"><ImageIcon :size="22" /><strong>{{ imageBatchFiles.length ? `已选择 ${imageBatchFiles.length} 张图片` : '选择图片' }}</strong><span>支持 JPG、PNG、WebP · 可多选</span><input id="image-batch-files" type="file" multiple accept="image/*" @change="chooseBatchImages" /></label>
                <div v-if="activeTool === 'watermark'" class="form-grid image-options"><label>水印文字<input v-model="watermarkText" class="form-control" type="text" maxlength="80" /></label><label>不透明度 {{ watermarkOpacity }}%<input v-model="watermarkOpacity" class="form-range" type="range" min="10" max="100" /></label></div>
                <div v-if="activeTool === 'stitch'" class="segmented-control" aria-label="拼接方向"><button type="button" :class="{ active: stitchDirection === 'vertical' }" :aria-pressed="stitchDirection === 'vertical'" @click="stitchDirection = 'vertical'">纵向</button><button type="button" :class="{ active: stitchDirection === 'horizontal' }" :aria-pressed="stitchDirection === 'horizontal'" @click="stitchDirection = 'horizontal'">横向</button></div>
                <div v-if="activeTool === 'long-screenshot'" class="form-grid three image-options"><label>分段数量<input v-model="longCaptureFrameCount" class="form-control" type="number" min="2" max="8" /></label><label>滚动间隔（秒）<input v-model="longCaptureInterval" class="form-control" type="number" min="1" max="10" /></label><label>开始延迟（秒）<input v-model="longCaptureDelay" class="form-control" type="number" min="1" max="10" /></label></div>
                <div class="action-row"><button class="primary-button" type="button" :disabled="imageBatchBusy" @click="runImageBatch"><Square v-if="['screenshot', 'long-screenshot'].includes(activeTool)" :size="15" /><WandSparkles v-else :size="15" />{{ imageBatchBusy ? '处理中...' : activeTool === 'screenshot' ? '选择屏幕并截图' : activeTool === 'long-screenshot' ? '选择目标并开始' : '开始处理' }}</button><span class="safe-hint"><ShieldCheck :size="14" /> 结果另存，原图不修改</span></div>
                <div v-if="imageBatchPreview" class="image-preview result-preview"><img :src="imageBatchPreview" alt="图片处理结果预览" /></div>
                <div v-if="imageBatchResult" class="result-callout doc-result"><CheckCircle2 :size="16" /><span>{{ imageBatchResult.summary }}</span><button class="outline-button" type="button" @click="downloadImageBatchResult"><Download :size="15" /> 下载{{ imageBatchResult.filename.endsWith('.zip') ? ' ZIP' : '图片' }}</button></div>
              </template>
            </ToolWorkspace>
          </div>

          <div v-else-if="activeModule === 'security'" class="workspace-grid">
            <section class="content-card tool-card">
              <div class="tool-entry-grid module-tool-grid" role="tablist" aria-label="安全隐私工具">
                <ToolEntryCard
                  v-for="id in securityToolIds"
                  :key="id"
                  role="tab"
                  :aria-selected="activeTool === id"
                  :active="activeTool === id"
                  :label="toolRegistry.get(id)?.label || id"
                  :description="toolRegistry.get(id)?.description || ''"
                  :icon="toolRegistry.get(id)?.icon || ShieldCheck"
                  :status="toolAccess(id).label"
                  :status-class="toolAccess(id).className"
                  @click="rememberRecentTool(id)"
                />
              </div>
              <div class="tool-title-row"><div><h2>{{ toolRegistry.get(activeTool)?.label || '安全隐私' }}</h2><p>{{ toolRegistry.get(activeTool)?.description || '口令与敏感内容只在本机内存中处理。' }}</p></div><span class="offline-chip"><ShieldCheck :size="13" /> 本地处理</span></div>

              <div v-if="activeTool === 'password'" class="security-section security-section-full"><div class="subheading"><KeyRound :size="16" /><h3>强密码生成</h3></div><div class="form-row"><label for="password-length">长度</label><input id="password-length" v-model="passwordLength" class="form-control short-input" type="number" min="8" max="64" /><span class="field-hint">8-64 位</span></div><div class="option-grid"><label v-for="(enabled, key) in passwordOptions" :key="key" class="check-option"><input v-model="passwordOptions[key]" type="checkbox" /><span>{{ { upper: '大写字母', lower: '小写字母', number: '数字', symbol: '符号' }[key] }}</span></label></div><div class="password-output"><code>{{ generatedPassword || '点击生成，密码不会保存' }}</code><button v-if="generatedPassword" class="icon-button" type="button" aria-label="复制密码" @click="copyText(generatedPassword, '密码已复制，请勿保存到不安全位置')"><Copy :size="16" /></button></div><button class="primary-button" type="button" @click="generatePassword"><KeyRound :size="16" /> 生成密码</button></div>

              <div v-else-if="activeTool === 'password-strength'" class="security-section security-section-full"><div class="subheading"><LockKeyhole :size="16" /><h3>密码强度检测</h3></div><label for="password-check">仅在本机内存中检测</label><input id="password-check" v-model="passwordToCheck" class="form-control" type="password" autocomplete="new-password" placeholder="输入待检测密码" /><div class="strength-meter"><span :style="{ width: `${Math.min(passwordStrength.score / 6 * 100, 100)}%` }" :class="`strength-${passwordStrength.score}`"></span></div><div class="strength-label"><span>强度：{{ passwordStrength.label }}</span><span>{{ passwordStrength.score }}/6</span></div><div class="security-note"><ShieldCheck :size="15" /> 不会记录输入内容，也不会上传到云端。</div></div>

              <div v-else-if="activeTool === 'crypto'" class="crypto-section"><div class="subheading"><LockKeyhole :size="16" /><h3>OpenPGP 文件加密 / 解密</h3></div><div class="segmented-control" aria-label="加密或解密模式"><button type="button" :class="{ active: cryptoMode === 'encrypt' }" :aria-pressed="cryptoMode === 'encrypt'" :disabled="cryptoBusy" @click="openCryptoMode('encrypt')">加密副本</button><button type="button" :class="{ active: cryptoMode === 'decrypt' }" :aria-pressed="cryptoMode === 'decrypt'" :disabled="cryptoBusy" @click="openCryptoMode('decrypt')">解密文件</button></div><label class="dropzone compact-drop" for="crypto-file"><LockKeyhole :size="20" /><strong>{{ cryptoFile?.name || (cryptoMode === 'encrypt' ? '选择待加密文件' : '选择 .pgp 文件') }}</strong><span>文件只在本机内存中处理</span><input id="crypto-file" type="file" :accept="cryptoMode === 'decrypt' ? '.pgp,application/pgp-encrypted' : ''" @change="chooseCryptoFile" /></label><div class="form-grid"><label>口令（至少 8 位）<input v-model="cryptoPassword" class="form-control" type="password" autocomplete="new-password" /></label><label v-if="cryptoMode === 'encrypt'">确认口令<input v-model="cryptoPasswordConfirm" class="form-control" type="password" autocomplete="new-password" /></label></div><div class="action-row"><button class="primary-button" type="button" :disabled="cryptoBusy" @click="runCrypto"><LockKeyhole :size="15" />{{ cryptoBusy ? '处理中...' : cryptoMode === 'encrypt' ? '生成加密副本' : '开始解密' }}</button><span class="safe-hint"><ShieldCheck :size="14" /> 口令不保存，忘记后无法恢复</span></div><div v-if="cryptoResult" class="result-callout doc-result"><CheckCircle2 :size="16" /><span>{{ cryptoResult.summary }}</span><button class="outline-button" type="button" @click="downloadCryptoResult"><Download :size="15" /> 下载结果</button></div></div>

              <div v-else class="redact-section"><div class="subheading"><ShieldCheck :size="16" /><h3>敏感信息脱敏副本</h3></div><div class="redact-grid"><div><label for="redact-source">原文</label><textarea id="redact-source" v-model="redactText" class="form-control" rows="5"></textarea></div><div><label for="redact-result">预览结果</label><textarea id="redact-result" :value="redactedText" class="form-control" rows="5" readonly placeholder="点击生成脱敏副本"></textarea></div></div><div class="action-row"><button class="outline-button" type="button" @click="redactSensitive"><ShieldCheck :size="16" /> 生成脱敏副本</button><span class="safe-hint">源文件与原文不会被覆盖</span></div></div>
            </section>
          </div>

          <div v-else-if="activeModule === 'power'" class="workspace-grid power-page">
            <ShutdownWorkspace :runtime-mode="runtimeMode" @notify="showToast" />
          </div>

          <div v-else-if="activeModule === 'assistant'" class="assistant-page">
            <AssistantWorkspace v-model:active-tab="assistantActiveTab" :network-online="networkOnline !== false" @open-tool="useToolById" @notify="showToast">
              <template #translation="{ saveNote }">
                <section class="content-card assistant-card translation-card" aria-labelledby="translation-assistant-title">
                  <div class="card-heading">
                    <div><h2 id="translation-assistant-title">翻译助手</h2><p>保留段落和常见格式，使用已配置的中转站生成译文。</p></div>
                    <Languages :size="18" aria-hidden="true" />
                  </div>
                  <div v-if="!relayConfigured" class="dependency-panel missing"><strong>尚未完成中转站配置</strong><span>请在设置中填写 Base URL、API Key 和模型名；翻译内容不会在未配置时发送。</span></div>
                  <div class="translation-controls">
                    <label>源语言<select v-model="translationSourceLanguage" class="form-select"><option v-for="language in TRANSLATION_LANGUAGES" :key="`source-${language.value}`" :value="language.value">{{ language.label }}</option></select></label>
                    <button class="icon-button translation-swap" type="button" :disabled="!canSwapTranslationLanguages(translationSourceLanguage, translationTargetLanguage) || translationBusy" aria-label="交换源语言和目标语言" title="交换源语言和目标语言" @click="swapTranslationLanguages"><ArrowLeftRight :size="16" /></button>
                    <label>目标语言<select v-model="translationTargetLanguage" class="form-select"><option v-for="language in TRANSLATION_LANGUAGES.filter((item) => item.value !== 'auto')" :key="`target-${language.value}`" :value="language.value">{{ language.label }}</option></select></label>
                    <label>翻译风格<select v-model="translationStyle" class="form-select"><option v-for="style in TRANSLATION_STYLES" :key="style.value" :value="style.value">{{ style.label }}</option></select></label>
                  </div>
                  <label class="translation-format-option"><input v-model="translationPreserveFormatting" type="checkbox" /> <span>保留换行和基础 Markdown 格式</span></label>
                  <div class="translation-grid">
                    <label class="translation-pane"><span>原文</span><textarea v-model="translationText" class="form-control" rows="12" :maxlength="TRANSLATION_MAX_CHARACTERS" placeholder="粘贴需要翻译的文本"></textarea><small>{{ translationText.length.toLocaleString() }} / {{ TRANSLATION_MAX_CHARACTERS.toLocaleString() }} 字符</small></label>
                    <label class="translation-pane"><span>译文</span><textarea class="form-control" rows="12" :value="translationResult?.content || ''" readonly placeholder="翻译完成后显示结果"></textarea><small>{{ translationResult ? `${translationResult.model || relayConfig.model} · ${translationResult.provider || describeRelayProvider(relayConfig).provider}` : '结果只保留在当前页面' }}</small></label>
                  </div>
                  <div class="network-disclosure"><Network :size="16" /><span><strong>{{ relayConfigured ? describeRelayProvider(relayConfig).provider : '未配置中转站' }}</strong><small>发送 API Key、模型名、语言选项和原文内容；可在任务中心取消，或在设置中撤回翻译授权。</small></span></div>
                  <p v-if="translationStatus" class="relay-status" :class="translationStatus.type" role="status" aria-live="polite">{{ translationStatus.message }}</p>
                  <div class="action-row translation-actions">
                    <button class="primary-button" type="button" :disabled="translationBusy" @click="runTranslation"><Languages :size="15" /> {{ translationBusy ? '翻译中...' : '开始翻译' }}</button>
                    <button class="outline-button" type="button" :disabled="translationBusy || (!translationText && !translationResult)" @click="clearTranslation"><X :size="15" /> 清空</button>
                    <button v-if="translationResult" class="outline-button" type="button" @click="copyText(translationResult.content, '译文已复制')"><Copy :size="15" /> 复制结果</button>
                    <button v-if="translationResult" class="outline-button" type="button" @click="saveNote({ title: safeTranslationTitle(translationSourceLanguage, translationTargetLanguage), content: translationResult.content, category: 'memo', color: 'blue' })"><FileText :size="15" /> 保存到便签</button>
                    <button class="outline-button" type="button" @click="openApiSettings"><Settings :size="15" /> 配置</button>
                    <span class="safe-hint"><Network :size="14" /> 显式联网</span>
                  </div>
                </section>
              </template>
              <template #ai>
                <section class="content-card assistant-card relay-card" aria-labelledby="relay-assistant-title">
                  <div class="card-heading"><div><h2 id="relay-assistant-title">中转站 AI 助手</h2><p>兼容 OpenAI Chat Completions；内容只在你点击后发送到已配置中转站。</p></div><Sparkles :size="18" /></div>
                  <div v-if="!relayConfigured" class="dependency-panel missing"><strong>尚未完成中转站配置</strong><span>请在设置中填写 Base URL 和 API Key；模型名可在连接测试后选择。</span></div>
                  <label class="relay-prompt">待处理内容<textarea v-model="relayPrompt" class="form-control" rows="7" maxlength="12000" placeholder="例如：将下面的会议记录整理为决策、负责人和行动项……"></textarea></label>
                  <div class="network-disclosure"><Network :size="16" /><span><strong>{{ describeRelayProvider(relayConfig).provider }}</strong><small>发送 API Key、模型名和输入文本以生成结果；可在任务中心取消，或在设置中撤回授权。</small></span></div>
                  <div class="action-row"><button class="primary-button" type="button" :disabled="relayBusy" @click="runRelayAssistant"><Sparkles :size="15" /> {{ relayBusy ? '请求中...' : '发送到中转站' }}</button><button class="outline-button" type="button" @click="openApiSettings"><Settings :size="15" /> 配置</button><span class="safe-hint"><Network :size="14" /> 显式联网</span></div>
                  <div v-if="relayResult" class="relay-output" role="status"><div><strong>{{ relayResult.model }}</strong><small>{{ relayResult.provider }}<template v-if="relayResult.usage?.total_tokens"> · {{ relayResult.usage.total_tokens }} tokens</template></small></div><p>{{ relayResult.content }}</p><button class="outline-button" type="button" @click="copyText(relayResult.content, '中转站结果已复制')"><Copy :size="15" /> 复制结果</button></div>
                </section>
              </template>
            </AssistantWorkspace>
          </div>

        </section>
      </main>
    </div>

    <aside v-if="taskPanelOpen" class="task-drawer" :class="{ 'is-pinned': taskPanelPinned }" aria-label="任务中心" :aria-hidden="onlineConsentRequest ? 'true' : undefined" :inert="onlineConsentRequest ? '' : undefined">
      <div class="drawer-heading"><div><p class="eyebrow">工作流</p><h2>任务中心</h2><small>{{ taskPanelPinned ? '已固定为第三栏' : '浮动抽屉' }}</small></div><div class="drawer-heading-actions"><button class="icon-button" type="button" :aria-label="taskPanelPinned ? '取消固定任务中心' : '固定任务中心'" :title="taskPanelPinned ? '取消固定任务中心' : '固定任务中心'" @click="toggleTaskPanelPin"><component :is="taskPanelPinned ? PinOff : Pin" :size="17" /></button><button class="icon-button" type="button" aria-label="关闭任务中心" title="关闭任务中心" @click="taskPanelOpen = false"><X :size="18" /></button></div></div>
      <div v-if="runningTasks.length" class="drawer-section"><div class="drawer-section-heading"><span>进行中</span><span>{{ runningTasks.length }}</span></div><div v-for="task in runningTasks" :key="task.id" class="task-row" :data-status="task.status"><div class="task-row-heading"><strong>{{ task.label }}</strong><button v-if="task.cancellable !== false && ['waiting', 'running'].includes(task.status)" class="icon-button" type="button" :aria-label="`取消 ${task.label}`" @click="cancelTask(task)"><Square :size="14" /></button></div><div class="task-status-line" role="status" aria-live="polite" aria-atomic="true"><span class="task-stage">{{ task.stage || '处理中' }}</span><span v-if="task.totalItems" class="task-count">已完成 {{ task.completedItems || 0 }}/{{ task.totalItems }} · 剩余 {{ task.remainingItems ?? task.totalItems }}</span></div><div class="progress-track" role="progressbar" :aria-label="`${task.label}进度`" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="task.progress"><span :style="{ width: `${task.progress}%` }"></span></div><div class="task-meta"><span>{{ task.progress }}%</span><span v-if="task.status === 'canceling'">取消请求已发送</span><span v-else-if="task.cancellable === false">当前原子阶段不可中途取消</span><span v-else>{{ task.createdAt }}</span></div></div></div>
      <div class="drawer-section">
        <div class="drawer-section-heading"><span>最近完成</span><button v-if="completedTasks.length" class="text-button small" type="button" @click="requestClearCompletedTasks">清除</button></div>
        <div v-if="completedTasks.length" class="task-history">
          <div v-for="task in completedTasks" :key="task.id" class="history-row">
            <CheckCircle2 v-if="task.status === 'success'" :size="16" class="success-icon" />
            <X v-else :size="16" class="muted-icon" />
            <div>
              <strong>{{ task.label }}</strong>
              <small>{{ task.status === 'success' ? '已完成' : task.status === 'failed' ? `失败：${task.error || '未知错误'}` : '已取消' }} · {{ task.createdAt }}</small>
              <small v-if="task.errorCode" class="error-detail">{{ task.errorCode }}<span v-if="task.recovery"> · {{ task.recovery }}</span></small>
            </div>
            <button v-if="canRetryTask(task)" class="icon-button" type="button" :aria-label="`重试 ${task.label}`" @click="retryTask(task)"><RotateCcw :size="15" /></button>
          </div>
        </div>
        <div v-else class="drawer-empty"><ClipboardList :size="25" /><span>完成的任务会出现在这里</span></div>
      </div>
      <div v-if="clearedTaskHistory.length" class="task-history-undo" role="status"><span>已清除 {{ clearedTaskHistory.length }} 条记录</span><button class="text-button small" type="button" @click="restoreClearedTaskHistory">撤销</button></div>
      <div class="drawer-boundary"><ShieldCheck :size="16" /><span>长任务状态只保存在本机，默认不上传文件内容。</span></div>
    </aside>

    <div v-if="commandPaletteOpen" class="command-palette-backdrop" @click.self="closeCommandPalette">
      <section class="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title" @keydown="handleCommandPaletteKeydown">
        <div class="command-palette-heading"><div><p class="eyebrow">工作台命令</p><h2 id="command-palette-title">命令面板</h2></div><button class="icon-button" type="button" aria-label="关闭命令面板" title="关闭命令面板" @click="closeCommandPalette"><X :size="17" /></button></div>
        <label class="command-palette-input"><Command :size="17" aria-hidden="true" /><input id="command-palette-input" v-model="commandQuery" type="search" placeholder="搜索命令或工具" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="command-palette-results" :aria-expanded="true" :aria-activedescendant="commandResults.length ? `command-option-${commandResults[commandActiveIndex]?.id}` : undefined" /></label>
        <div id="command-palette-results" class="command-palette-results" role="listbox" aria-label="命令列表">
          <button v-for="(command, index) in commandResults" :id="`command-option-${command.id}`" :key="command.id" class="command-option" :class="{ active: index === commandActiveIndex }" type="button" role="option" :aria-selected="index === commandActiveIndex" @mouseenter="commandActiveIndex = index" @click="runCommand(command)"><component :is="command.icon" :size="16" aria-hidden="true" /><span><strong>{{ command.label }}</strong><small>{{ command.description }}</small></span><ArrowRight :size="14" aria-hidden="true" /></button>
          <p v-if="!commandResults.length" class="command-empty">没有匹配命令或工具。</p>
        </div>
        <div class="command-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 执行</span><span><kbd>Esc</kbd> 关闭</span></div>
      </section>
    </div>

    <div v-if="settingsOpen" class="modal-backdrop" @click.self="closeSettings">
      <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" :aria-hidden="onlineConsentRequest ? 'true' : undefined" :inert="onlineConsentRequest ? '' : undefined" @keydown="handleSettingsKeydown">
        <div class="settings-shell">
          <nav class="settings-nav" aria-label="设置分类">
            <strong class="settings-nav-title">设置</strong>
            <div class="settings-tablist" role="tablist" aria-label="设置页面" aria-orientation="vertical" @keydown="handleSettingsTabKeydown">
              <button id="settings-tab-api" class="settings-nav-button" :class="{ active: settingsPanel === 'api' }" type="button" role="tab" :tabindex="settingsPanel === 'api' ? 0 : -1" :aria-selected="settingsPanel === 'api'" aria-controls="settings-panel-api" @click="selectSettingsPanel('api')"><KeyRound :size="17" /><span>API 设置</span></button>
              <button id="settings-tab-tasks" class="settings-nav-button" :class="{ active: settingsPanel === 'tasks' }" type="button" role="tab" :tabindex="settingsPanel === 'tasks' ? 0 : -1" :aria-selected="settingsPanel === 'tasks'" aria-controls="settings-panel-tasks" @click="selectSettingsPanel('tasks')"><ClipboardList :size="17" /><span>任务选项</span></button>
            </div>
          </nav>

          <div class="settings-content">
            <div class="modal-heading settings-heading">
              <div><p class="eyebrow">设置中心</p><h2 id="settings-title">{{ settingsPanel === 'api' ? 'API 设置' : '任务选项' }}</h2><p class="settings-description">{{ settingsPanel === 'api' ? '配置 OCR、DeepSeek、中转站地址与模型，保存后立即生效。' : '管理运行依赖、联网授权、更新状态与隐私诊断。' }}</p></div>
              <button class="icon-button settings-close-button" type="button" aria-label="关闭设置" title="关闭设置" @click="closeSettings"><X :size="19" /></button>
            </div>

            <div class="settings-scroll">
              <section v-if="settingsPanel === 'api'" id="settings-panel-api" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-api">
                <div class="api-provider-stack">
                  <section class="api-provider-panel" aria-labelledby="ocr-api-title">
                    <div class="api-provider-heading"><div><strong id="ocr-api-title">OCR</strong><small>本地 Tesseract.js 引擎，图片内容不上传</small></div><span class="provider-state ready"><LockKeyhole :size="14" /> 无需 Token</span></div>
                    <div class="api-readonly-field"><span><FileImage :size="18" /><span><strong>本地 OCR</strong><small>中文与英文模型按需下载并缓存在设备上</small></span></span><button class="outline-button" type="button" @click="openDependencyTool('ocr')">进入 OCR</button></div>
                    <div class="api-provider-actions"><button class="outline-button" type="button" :disabled="ocrRuntimeBusy" @click="checkLocalOcrRuntime"><RefreshCw :size="15" /> {{ ocrRuntimeBusy ? '检测中...' : '检测 OCR' }}</button><span v-if="ocrRuntimeStatus" class="api-check-status" :class="ocrRuntimeStatus.type" role="status">{{ ocrRuntimeStatus.message }}</span></div>
                  </section>

                  <section class="api-provider-panel" aria-labelledby="deepseek-api-title">
                    <div class="api-provider-heading"><div><strong id="deepseek-api-title">DeepSeek</strong><small>OpenAI-compatible 快捷预设</small></div><span class="provider-state" :class="deepSeekPresetActive ? 'ready' : 'idle'"><KeyRound :size="14" /> {{ deepSeekPresetActive ? '当前使用' : '未启用' }}</span></div>
                    <div class="api-credential-row"><label class="api-credential-field"><span>DeepSeek Key</span><input v-model="deepSeekApiKey" class="form-control" type="password" autocomplete="off" maxlength="512" placeholder="sk-..." /></label><a class="outline-button api-external-link" :href="DEEPSEEK_RELAY_PRESET.acquireUrl" target="_blank" rel="noreferrer"><ExternalLink :size="15" /> 获取 Key</a></div>
                    <div class="api-endpoint-summary"><div><span>Base URL</span><strong>{{ DEEPSEEK_RELAY_PRESET.baseUrl }}</strong></div><div><span>默认模型</span><strong>{{ DEEPSEEK_RELAY_PRESET.model }}</strong></div></div>
                    <div class="api-provider-actions"><button class="outline-button" type="button" @click="useDeepSeekPreset()"><Check :size="15" /> 应用预设</button><button class="primary-button" type="button" :disabled="relayTestBusy" @click="checkDeepSeekConnection"><Network :size="15" /> {{ relayTestBusy ? '检测中...' : '检测 DeepSeek' }}</button></div>
                  </section>
                </div>

                <section class="relay-settings" aria-labelledby="relay-settings-title">
                  <div class="relay-settings-heading"><span><strong id="relay-settings-title">自定义中转站 API</strong><small>OpenAI-compatible；支持自定义 /v1 地址</small></span><span class="setting-fixed"><KeyRound :size="16" /> {{ relayKeySummary }}</span></div>
                  <form class="relay-connection-form" @submit.prevent="persistRelaySettings">
                    <div class="form-grid">
                      <label>Base URL<input v-model="relayConfig.baseUrl" class="form-control" type="url" inputmode="url" autocomplete="url" placeholder="https://your-relay.example/v1" /></label>
                      <label>模型名<input v-model="relayConfig.model" class="form-control" type="text" list="relay-model-options" autocomplete="off" placeholder="可留空，连接测试后从模型列表选择" /><datalist id="relay-model-options"><option v-for="model in relayModels" :key="model" :value="model" /></datalist></label>
                      <label>API Key<input v-model="relayConfig.apiKey" class="form-control" type="password" autocomplete="off" maxlength="512" placeholder="例如 APIsk-... 或 sk-..." /></label>
                      <label>请求超时（毫秒）<input v-model="relayConfig.timeoutMs" class="form-control" type="number" min="5000" max="120000" step="1000" /></label>
                    </div>
                    <div class="diagnostic-actions"><button class="outline-button" type="submit"><Check :size="15" /> 保存当前配置</button><button class="outline-button" type="button" :disabled="relayTestBusy" @click="checkRelayConnection"><Network :size="15" /> {{ relayTestBusy ? '测试中...' : '测试连接' }}</button><button class="outline-button" type="button" :disabled="!relayConfig.apiKey" @click="forgetRelayApiKey"><Trash2 :size="15" /> 清除 API Key</button></div>
                  </form>
                  <p v-if="relayStatus" class="relay-status" :class="relayStatus.type" role="status">{{ relayStatus.message }}</p>
                  <p class="relay-disclosure">连接测试会向当前 Base URL 所属服务商发送 API Key 和模型列表查询，不发送文档或输入正文；可在任务中心取消，或在“任务选项”中撤回联网授权。AI 助手会另行确认文本发送授权。API Key 仅保存在当前进程内存，不写入本机存储、任务记录或诊断包。</p>
                  <div class="ccswitch-panel" aria-labelledby="ccswitch-title">
                    <div class="ccswitch-heading"><div><strong id="ccswitch-title">CC Switch 互通</strong><small>支持供应商深链接导入、SQLite/SQL 读取和导出</small></div><span class="setting-fixed"><Network :size="15" /> A+B+C</span></div>
                    <div class="ccswitch-block">
                      <label for="ccswitch-link-input">A · 导入供应商深链接</label>
                      <textarea id="ccswitch-link-input" v-model="ccSwitchLinkInput" class="form-control" rows="3" spellcheck="false" placeholder="粘贴 ccswitch://v1/import?resource=provider... 链接"></textarea>
                      <div class="diagnostic-actions"><button class="outline-button" type="button" :disabled="!ccSwitchLinkInput.trim()" @click="parseCcSwitchLinkInput"><Search :size="15" /> 解析链接</button><button class="primary-button" type="button" :disabled="!ccSwitchImportPreview" @click="applyCcSwitchLink"><Check :size="15" /> 应用到中转站</button></div>
                      <p v-if="ccSwitchImportError" class="relay-status error" role="alert">{{ ccSwitchImportError }}</p>
                      <div v-if="ccSwitchImportPreview" class="ccswitch-preview" role="status">
                        <div><span>供应商</span><strong>{{ ccSwitchImportPreview.name }} · {{ ccSwitchImportPreview.app }}</strong></div>
                        <div><span>端点</span><strong>{{ ccSwitchImportPreview.baseUrl }}</strong></div>
                        <div><span>模型</span><strong>{{ ccSwitchImportPreview.model || '未提供（需手动补全）' }}</strong></div>
                        <div><span>API Key</span><strong>{{ maskRelayApiKey(ccSwitchImportPreview.apiKey) }}</strong></div>
                      </div>
                    </div>
                    <div class="ccswitch-block">
                      <div class="ccswitch-block-heading"><label>B · 读取本地配置</label><span v-if="!isTauriRuntime" class="field-hint">仅 Tauri 桌面版可用</span></div>
                      <div class="diagnostic-actions"><button class="outline-button" type="button" :disabled="ccSwitchFileBusy || !isTauriRuntime" @click="loadCcSwitchFile"><Upload :size="15" /> {{ ccSwitchFileBusy ? '读取中...' : '选择 .db / .sql 文件' }}</button><span v-if="ccSwitchFilePath" class="ccswitch-file-name" :title="ccSwitchFilePath">{{ ccSwitchFilePath }}</span></div>
                      <div v-if="ccSwitchProviders.length" class="ccswitch-provider-picker">
                        <label for="ccswitch-provider-select">供应商</label>
                        <select id="ccswitch-provider-select" v-model="ccSwitchSelectedId" class="form-control">
                          <option v-for="provider in ccSwitchProviders" :key="provider.id" :value="provider.id">{{ provider.name || provider.appType }} · {{ provider.appType }}</option>
                        </select>
                        <div v-if="ccSwitchSelectedProvider" class="ccswitch-preview">
                          <div><span>端点</span><strong>{{ ccSwitchSelectedProvider.baseUrl || '未提取' }}</strong></div>
                          <div><span>模型</span><strong>{{ ccSwitchSelectedProvider.model || '未提取' }}</strong></div>
                          <div><span>API Key</span><strong>{{ ccSwitchSelectedProvider.apiKey ? maskRelayApiKey(ccSwitchSelectedProvider.apiKey) : '未提取' }}</strong></div>
                        </div>
                        <button class="primary-button" type="button" :disabled="!ccSwitchSelectedProvider?.baseUrl || !ccSwitchSelectedProvider?.model || !ccSwitchSelectedProvider?.apiKey" @click="applySelectedCcSwitchProvider"><Check :size="15" /> 应用选中供应商</button>
                      </div>
                    </div>
                    <div class="ccswitch-block">
                      <div class="ccswitch-block-heading"><label>C · 导出到 CC Switch</label><span class="field-hint">导出内容包含 API Key</span></div>
                      <div class="form-grid ccswitch-export-grid">
                        <label>应用<select v-model="ccSwitchExportApp" class="form-control"><option v-for="option in ccSwitchAppOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                        <label>供应商名称<input v-model="ccSwitchExportName" class="form-control" type="text" maxlength="120" /></label>
                        <label>格式<select v-model="ccSwitchExportFormat" class="form-control"><option value="link">ccswitch:// 深链接</option><option value="json">JSON 配置</option></select></label>
                      </div>
                      <div class="diagnostic-actions"><button class="primary-button" type="button" @click="generateCcSwitchExport"><Download :size="15" /> 生成导出内容</button><button v-if="ccSwitchExportOutput" class="outline-button" type="button" @click="copyText(ccSwitchExportOutput, 'CC Switch 导出内容已复制；请仅粘贴到可信位置')"><Copy :size="15" /> 复制</button></div>
                      <p v-if="ccSwitchExportError" class="relay-status error" role="alert">{{ ccSwitchExportError }}</p>
                      <textarea v-if="ccSwitchExportOutput" class="form-control ccswitch-export-output" rows="5" :value="ccSwitchExportOutput" readonly spellcheck="false" aria-label="CC Switch 导出内容"></textarea>
                      <p class="ccswitch-warning"><ShieldCheck :size="14" /> 导出链接和 JSON 会明文携带 API Key；仅在确认目标是你信任的 CC Switch 实例时复制或导入。</p>
                    </div>
                  </div>
                </section>
              </section>

              <section v-else id="settings-panel-tasks" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-tasks">
                 <div class="settings-list">
                   <label class="setting-row"><span><strong>外观</strong><small>适合长时间办公的低对比度工作区</small></span><select v-model="theme" class="form-select"><option value="light">浅色</option><option value="dark">深色</option></select></label>
                   <label class="setting-row"><span><strong>工作区密度</strong><small>记住列表、工具卡片和间距的显示密度</small></span><select v-model="uiDensity" class="form-select"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
                  <div class="setting-row"><span><strong>匿名崩溃统计</strong><small>当前版本未接入远程上报，保持关闭</small></span><span class="setting-fixed"><LockKeyhole :size="16" /> 已关闭</span></div>
                  <div class="setting-row"><span><strong>云端能力提示</strong><small>内容发送前始终显示供应商与用途</small></span><span class="setting-fixed"><CheckCircle2 :size="16" /> 已启用</span></div>
                  <div class="setting-row"><span><strong>联网授权</strong><small>{{ onlineConsentSummary }}；按用途和供应商绑定</small></span><button class="outline-button" type="button" :disabled="!hasOnlineConsent" @click="revokeOnlineConsent"><RotateCcw :size="15" /> 撤回授权</button></div>
                  <section class="dependency-settings" aria-labelledby="dependency-settings-title">
                    <div class="dependency-settings-heading"><span><strong id="dependency-settings-title">运行依赖</strong><small>启动后异步检测；缺失依赖不会阻塞其他模块</small></span></div>
                    <div class="dependency-status-list" role="list">
                      <div v-for="dependency in dependencyStatus" :key="dependency.id" class="dependency-status-item" role="listitem">
                        <span><strong>{{ dependency.label }}</strong><small>{{ dependency.detail }}</small></span>
                        <div class="dependency-status-actions"><span class="dependency-state" :class="dependency.status">{{ dependency.statusLabel }}</span><button v-if="dependency.toolId" class="text-button small" type="button" @click="openDependencyTool(dependency.toolId)">查看工具</button></div>
                      </div>
                    </div>
                  </section>
                  <div class="setting-row"><span><strong>可选插件</strong><small>OCR 模型按需缓存；AI 图片能力暂未加载</small></span><span class="setting-fixed"><LockKeyhole :size="16" /> 按需加载</span></div>
                  <div class="setting-row"><span><strong>更新通道</strong><small>当前 NSIS 安装器未签名，自动更新源未配置</small></span><button class="outline-button" type="button" @click="showUpdateStatus"><RefreshCw :size="15" /> 检查状态</button></div>
                </div>
                <section class="diagnostic-panel" aria-labelledby="diagnostic-title">
                  <div class="diagnostic-heading"><div><strong id="diagnostic-title">隐私诊断包</strong><small>先预览字段，再由你决定是否下载</small></div><ShieldCheck :size="17" /></div>
                  <div class="diagnostic-actions">
                    <button class="outline-button" type="button" @click="previewDiagnostics"><Search :size="15" /> 预览诊断包</button>
                    <button v-if="diagnosticPreview" class="primary-button" type="button" :disabled="diagnosticBusy" @click="exportDiagnostics"><Download :size="15" /> {{ diagnosticBusy ? '生成中...' : '下载诊断包' }}</button>
                  </div>
                  <div v-if="diagnosticPreview" class="diagnostic-preview" role="status">
                    <div><span>运行环境</span><strong>{{ diagnosticPreview.manifest.runtimeMode }} / {{ diagnosticPreview.manifest.platform }}</strong></div>
                    <div><span>本地滚动日志</span><strong>{{ diagnosticPreview.taskEvents.length }}/{{ diagnosticPreview.manifest.retention.maxEvents }} 条</strong></div>
                    <div><span>事件字段</span><strong>操作、状态、阶段、耗时、输入数量、错误码</strong></div>
                    <div><span>自动上传</span><strong>已关闭 · 仅手动下载</strong></div>
                    <div><span>文件清单</span><strong>{{ diagnosticPreview.entries.join('、') }}</strong></div>
                    <p>主动排除：{{ diagnosticPreview.excluded.join('、') }}</p>
                  </div>
                </section>
                <div class="modal-note"><LockKeyhole :size="15" /><span>密码、密钥和文档正文不会写入本地历史。诊断包只在点击下载后保存在所选位置，不会自动上传。</span></div>
              </section>
            </div>

            <div class="modal-actions settings-footer"><button class="outline-button" type="button" @click="closeSettings">关闭</button><button class="primary-button" type="button" @click="saveAndCloseSettings"><Check :size="16" /> 保存设置</button></div>
          </div>
        </div>
      </section>
    </div>

    <div v-if="onlineConsentRequest" class="modal-backdrop consent-backdrop" @click.self="settleOnlineConsent(false)">
      <section class="online-consent-modal" role="dialog" aria-modal="true" aria-labelledby="online-consent-title" aria-describedby="online-consent-note" @keydown="handleOnlineConsentKeydown">
        <div class="modal-heading"><div><p class="eyebrow">联网授权</p><h2 id="online-consent-title">允许{{ onlineConsentRequest.label }}？</h2></div><Network :size="20" aria-hidden="true" /></div>
        <div v-if="networkOnline === false" class="consent-offline" role="status"><Network :size="16" /><span>当前处于离线状态，只会尝试本机缓存；不会发出新的外部请求。</span></div>
        <dl class="consent-details">
          <div><dt>供应商</dt><dd>{{ onlineConsentRequest.provider }}</dd></div>
          <div><dt>发送数据</dt><dd>{{ onlineConsentRequest.data }}</dd></div>
          <div><dt>用途</dt><dd>{{ onlineConsentRequest.purpose }}</dd></div>
          <div><dt>取消方式</dt><dd>{{ onlineConsentRequest.cancel }}</dd></div>
        </dl>
        <p id="online-consent-note" class="consent-note">确认后会在本机记住此用途与供应商的授权，直到你在设置中撤回；供应商地址变化时会重新询问。</p>
        <div class="modal-actions"><button class="outline-button" type="button" @click="settleOnlineConsent(false)">取消</button><button class="primary-button" type="button" @click="settleOnlineConsent(true)"><Check :size="15" /> {{ networkOnline === false ? '授权并尝试缓存' : '同意并继续' }}</button></div>
      </section>
    </div>

    <div v-if="taskHistoryClearOpen" class="modal-backdrop" @click.self="closeTaskHistoryClear">
      <section class="task-history-clear-modal" role="alertdialog" aria-modal="true" aria-labelledby="task-history-clear-title" aria-describedby="task-history-clear-description" @keydown="handleTaskHistoryClearKeydown">
        <div class="modal-heading"><div><p class="eyebrow">本地任务历史</p><h2 id="task-history-clear-title">清除已完成任务？</h2></div><Trash2 :size="20" aria-hidden="true" /></div>
        <p id="task-history-clear-description">将清除 {{ pendingTaskHistoryIds.length }} 条已完成任务记录。正在运行的任务、文件和设置不会受影响；确认后可在 30 秒内撤销。</p>
        <div class="modal-actions"><button class="outline-button" type="button" @click="closeTaskHistoryClear">取消</button><button class="danger-button" type="button" @click="confirmClearCompletedTasks"><Trash2 :size="15" /> 确认清除</button></div>
      </section>
    </div>

    <div v-if="toast" class="toast" :class="toast.type" role="status"><CheckCircle2 v-if="toast.type === 'success'" :size="17" /><Bell v-else-if="toast.type === 'info'" :size="17" /><X v-else :size="17" /><span>{{ toast.message }}</span></div>
  </div>
</template>
