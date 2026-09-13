<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Check, ChevronLeft, ChevronRight, FileOutput, Printer, RotateCcw, ShieldCheck, Upload, X } from 'lucide-vue-next'
import { loadState, saveState } from '../services/storage'
import { downloadBlob } from '../services/imageTools'
import {
  DEFAULT_PRINT_SETTINGS,
  PAPER_SIZES,
  buildPrintPageStyle,
  getPaperSize,
  loadPrintSettings,
  normalizePrintSettings,
  resolvePrintPages,
  savePrintSettings,
} from '../services/printSettings'

const props = defineProps({
  runtimeMode: { type: String, default: 'browser' },
  notify: { type: Function, default: null },
})

const emit = defineEmits(['busy-change'])

const paperSizes = Object.values(PAPER_SIZES)
const settings = reactive(loadPrintSettings(loadState))
const settingsHydrated = ref(false)
const sourceFile = ref(null)
const sourceUrl = ref('')
const sourceKind = ref('sample')
const sourceText = ref('')
const sourceName = ref('示例文档')
const pageCount = ref(1)
const currentPage = ref(1)
const loadingSource = ref(false)
const printBusy = ref(false)
const printError = ref('')
const previewFrame = ref(null)
let sourceToken = 0
let printFrame = null

const selectedPaper = computed(() => getPaperSize(settings))
const effectiveOrientation = computed(() => settings.orientation === 'landscape' ? 'landscape' : 'portrait')
const previewSourceUrl = computed(() => {
  if (!sourceUrl.value) return ''
  return sourceKind.value === 'pdf' ? `${sourceUrl.value}#page=${currentPage.value}` : sourceUrl.value
})
const selectedPages = computed(() => {
  try {
    return resolvePrintPages(settings, pageCount.value, currentPage.value)
  } catch {
    return []
  }
})
const pageSummary = computed(() => {
  if (!selectedPages.value.length) return '页码范围无效'
  if (selectedPages.value.length === pageCount.value && settings.pageRange === 'all' && settings.oddEven === 'all') return `共 ${pageCount.value} 页`
  return `将打印 ${selectedPages.value.length} 页`
})
const previewPaperStyle = computed(() => ({
  '--print-paper-width': `${effectiveOrientation.value === 'landscape' ? selectedPaper.value.heightMm : selectedPaper.value.widthMm}mm`,
  '--print-paper-height': `${effectiveOrientation.value === 'landscape' ? selectedPaper.value.widthMm : selectedPaper.value.heightMm}mm`,
}))
const printStatusLabel = computed(() => props.runtimeMode === 'tauri' ? '桌面系统打印' : '浏览器系统打印')

function notify(message, type = 'info') {
  props.notify?.(message, type)
}

function updateSetting(key, value) {
  const next = normalizePrintSettings({ ...settings, [key]: value })
  Object.assign(settings, next)
  // The hydration guard prevents a mount-time read from becoming a write.
  if (settingsHydrated.value) savePrintSettings(settings, saveState)
}

function resetSettings() {
  Object.assign(settings, normalizePrintSettings(DEFAULT_PRINT_SETTINGS))
  savePrintSettings(settings, saveState)
  notify('打印设置已恢复默认值')
}

function revokeSourceUrl() {
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
  sourceUrl.value = ''
}

function classifyFile(file) {
  const name = String(file?.name || '').toLowerCase()
  const type = String(file?.type || '').toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('text/') || name.endsWith('.html') || name.endsWith('.htm')) return 'text'
  return ''
}

async function chooseSource(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const kind = classifyFile(file)
  if (!kind) {
    printError.value = '当前支持 PDF、图片和文本文件；Office 文件请先导出为 PDF'
    notify(printError.value, 'error')
    return
  }

  const token = ++sourceToken
  loadingSource.value = true
  printError.value = ''
  revokeSourceUrl()
  sourceFile.value = file
  sourceName.value = file.name
  sourceKind.value = kind
  sourceText.value = ''
  pageCount.value = 1
  currentPage.value = 1
  try {
    sourceUrl.value = URL.createObjectURL(file)
    if (kind === 'text') {
      sourceText.value = (await file.text()).slice(0, 1_000_000)
    } else if (kind === 'pdf') {
      const { PDFDocument } = await import('pdf-lib')
      const document = await PDFDocument.load(await file.arrayBuffer())
      pageCount.value = Math.max(1, document.getPageCount())
    }
    if (token !== sourceToken) return
    notify(`已载入 ${file.name}`)
  } catch (error) {
    if (token !== sourceToken) return
    revokeSourceUrl()
    sourceFile.value = null
    sourceKind.value = 'sample'
    sourceName.value = '示例文档'
    printError.value = error?.message || '文档无法读取'
    notify(printError.value, 'error')
  } finally {
    if (token === sourceToken) loadingSource.value = false
  }
}

function clearSource() {
  sourceToken += 1
  revokeSourceUrl()
  sourceFile.value = null
  sourceKind.value = 'sample'
  sourceText.value = ''
  sourceName.value = '示例文档'
  pageCount.value = 1
  currentPage.value = 1
  printError.value = ''
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]))
}

function printMarkup() {
  const paperStyle = buildPrintPageStyle(settings)
  const paperClass = settings.printMode === 'n-up' ? ' print-n-up' : ''
  let body
  if (sourceKind.value === 'image' && sourceUrl.value) {
    body = `<img class="print-image" src="${escapeHtml(sourceUrl.value)}" alt="${escapeHtml(sourceName.value)}">`
  } else if (sourceKind.value === 'text') {
    body = `<pre class="print-text">${escapeHtml(sourceText.value)}</pre>`
  } else {
    body = '<h1>文档办公打印预览</h1><p>请在打印前确认纸张、方向、缩放和页码范围。</p>'
  }
  const watermark = settings.watermark && settings.watermarkText
    ? `<div class="print-watermark">${escapeHtml(settings.watermarkText)}</div>`
    : ''
  const pageNumber = settings.pageNumbers ? '<div class="print-page-number">1</div>' : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>${paperStyle}
    html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,"Microsoft YaHei",sans-serif}
    .print-page{box-sizing:border-box;position:relative;width:100vw;min-height:100vh;padding:14mm;overflow:hidden}
    .print-image{display:block;max-width:100%;max-height:calc(100vh - 28mm);margin:auto;object-fit:contain}
    .print-text{white-space:pre-wrap;word-break:break-word;font:11pt/1.6 Consolas,"Microsoft YaHei",sans-serif}
    .print-watermark{position:absolute;inset:45% 0 auto;text-align:center;transform:rotate(-24deg);font-size:28pt;color:rgba(0,0,0,.14)}
    .print-page-number{position:absolute;right:12mm;bottom:7mm;font-size:9pt;color:#555}
    .print-n-up{display:grid;grid-template-columns:repeat(${Math.sqrt(settings.nUp) >= 2 ? 2 : 1},1fr);gap:6mm}
    @media print{.print-page{min-height:0;height:100%;padding:14mm}}
  </style></head><body><main class="print-page${paperClass}">${body}${watermark}${pageNumber}</main></body></html>`
}

function cleanupPrintFrame() {
  if (!printFrame) return
  printFrame.remove()
  printFrame = null
}

function printHtmlSource() {
  cleanupPrintFrame()
  printFrame = document.createElement('iframe')
  printFrame.setAttribute('title', '打印预览')
  printFrame.style.position = 'fixed'
  printFrame.style.right = '0'
  printFrame.style.bottom = '0'
  printFrame.style.width = '1px'
  printFrame.style.height = '1px'
  printFrame.style.border = '0'
  printFrame.style.opacity = '0'
  document.body.appendChild(printFrame)
  const frameDocument = printFrame.contentDocument
  if (!frameDocument) throw new Error('无法创建打印文档')
  frameDocument.open()
  frameDocument.write(printMarkup())
  frameDocument.close()
  const printWindow = printFrame.contentWindow
  printWindow?.addEventListener('afterprint', cleanupPrintFrame, { once: true })
  window.setTimeout(() => {
    printWindow?.focus()
    printWindow?.print()
  }, 80)
  window.setTimeout(cleanupPrintFrame, 10_000)
}

function printDocument() {
  if (loadingSource.value || printBusy.value) return
  if (!selectedPages.value.length) {
    printError.value = '请修正页码范围后再打印'
    notify(printError.value, 'error')
    return
  }
  printBusy.value = true
  emit('busy-change', true)
  printError.value = ''
  try {
    if (sourceKind.value === 'pdf' && previewFrame.value?.contentWindow) {
      previewFrame.value.contentWindow.focus()
      previewFrame.value.contentWindow.print()
    } else {
      printHtmlSource()
    }
    notify(`已提交打印：${selectedPaper.value.label} · ${pageSummary.value}`)
  } catch (error) {
    printError.value = error?.message || '无法打开系统打印对话框'
    notify(printError.value, 'error')
  } finally {
    window.setTimeout(() => {
      printBusy.value = false
      emit('busy-change', false)
    }, 400)
  }
}

function exportPreview() {
  const html = printMarkup()
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `print-preview-${Date.now()}.html`)
  notify('打印预览已导出')
}

function movePage(direction) {
  currentPage.value = Math.min(pageCount.value, Math.max(1, currentPage.value + direction))
}

function setPage(value) {
  const page = Number(value)
  if (Number.isInteger(page)) currentPage.value = Math.min(pageCount.value, Math.max(1, page))
}

onMounted(() => {
  // The loaded snapshot is intentionally not written back during mount.
  settingsHydrated.value = true
})

onBeforeUnmount(() => {
  sourceToken += 1
  revokeSourceUrl()
  cleanupPrintFrame()
  emit('busy-change', false)
})
</script>

<template>
  <section class="print-workspace" aria-labelledby="print-workspace-title">
    <div class="print-layout">
      <aside class="print-controls" aria-label="打印设置">
        <div class="print-controls-heading">
          <div>
            <p class="eyebrow">文档办公</p>
            <h2 id="print-workspace-title">打印</h2>
            <p>纸张、页面范围和缩放设置会保存在本机。</p>
          </div>
          <Printer :size="19" aria-hidden="true" />
        </div>

        <div class="print-source-row">
          <label class="outline-button file-button"><Upload :size="15" /> 选择文档<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.html,.htm,application/pdf,image/*,text/plain,text/html" @change="chooseSource" /></label>
          <button class="icon-button" type="button" :disabled="!sourceFile" aria-label="清除文档" title="清除文档" @click="clearSource"><X :size="15" /></button>
        </div>
        <p class="print-source-name" :title="sourceName">{{ sourceName }} · {{ pageCount }} 页</p>

        <section class="print-setting-group" aria-labelledby="print-basic-title">
          <h3 id="print-basic-title">基本设置</h3>
          <div class="print-printer-row">
            <label>打印机<select :value="settings.printerId" class="form-control" @change="updateSetting('printerId', $event.target.value)"><option value="">系统默认打印机</option></select></label>
            <button class="outline-button" type="button" @click="notify('打印机属性由系统打印对话框提供')">属性</button>
          </div>
          <div class="form-grid print-two-col">
            <label>打印份数<input :value="settings.copies" class="form-control" type="number" min="1" max="99" @input="updateSetting('copies', $event.target.value)" /></label>
            <label>颜色<select :value="settings.colorMode" class="form-control" @change="updateSetting('colorMode', $event.target.value)"><option value="color">彩色</option><option value="grayscale">灰度打印</option></select></label>
          </div>
        </section>

        <section class="print-setting-group" aria-labelledby="print-range-title">
          <h3 id="print-range-title">页面范围</h3>
          <div class="print-radio-grid">
            <label><input type="radio" name="print-range" value="current" :checked="settings.pageRange === 'current'" @change="updateSetting('pageRange', 'current')" /> 当前页</label>
            <label><input type="radio" name="print-range" value="all" :checked="settings.pageRange === 'all'" @change="updateSetting('pageRange', 'all')" /> 所有页面</label>
            <label><input type="radio" name="print-range" value="custom" :checked="settings.pageRange === 'custom'" @change="updateSetting('pageRange', 'custom')" /> 页码选择</label>
            <input :value="settings.customRange" class="form-control print-range-input" type="text" inputmode="numeric" placeholder="例如 1-2,4" :disabled="settings.pageRange !== 'custom'" @input="updateSetting('customRange', $event.target.value)" />
          </div>
          <div class="print-inline-options">
            <label>奇偶页面<select :value="settings.oddEven" class="form-control" @change="updateSetting('oddEven', $event.target.value)"><option value="all">范围中所有页面</option><option value="odd">仅奇数页</option><option value="even">仅偶数页</option></select></label>
            <label class="check-option"><input type="checkbox" :checked="settings.reverse" @change="updateSetting('reverse', $event.target.checked)" /> 逆序打印</label>
          </div>
        </section>

        <section class="print-setting-group" aria-labelledby="print-mode-title">
          <h3 id="print-mode-title">打印方式</h3>
          <div class="segmented-control print-mode-switch" role="group" aria-label="打印方式">
            <button type="button" :class="{ active: settings.printMode === 'page-size' }" :aria-pressed="settings.printMode === 'page-size'" @click="updateSetting('printMode', 'page-size')">页面大小</button>
            <button type="button" :class="{ active: settings.printMode === 'n-up' }" :aria-pressed="settings.printMode === 'n-up'" @click="updateSetting('printMode', 'n-up')">一张多页</button>
            <button type="button" :class="{ active: settings.printMode === 'booklet' }" :aria-pressed="settings.printMode === 'booklet'" @click="updateSetting('printMode', 'booklet')">小册子</button>
          </div>
          <label v-if="settings.printMode === 'n-up'">每张纸页数<select :value="settings.nUp" class="form-control" @change="updateSetting('nUp', Number($event.target.value))"><option v-for="value in [2, 4, 6, 9, 16]" :key="value" :value="value">{{ value }} 页</option></select></label>
          <div class="print-radio-grid scale-grid">
            <label><input type="radio" name="print-scale" value="fit" :checked="settings.scaleMode === 'fit'" @change="updateSetting('scaleMode', 'fit')" /> 适合打印边距</label>
            <label><input type="radio" name="print-scale" value="actual" :checked="settings.scaleMode === 'actual'" @change="updateSetting('scaleMode', 'actual')" /> 实际大小</label>
            <label><input type="radio" name="print-scale" value="shrink" :checked="settings.scaleMode === 'shrink'" @change="updateSetting('scaleMode', 'shrink')" /> 缩小过大页面</label>
            <label><input type="radio" name="print-scale" value="custom" :checked="settings.scaleMode === 'custom'" @change="updateSetting('scaleMode', 'custom')" /> 自定义比例</label>
            <div class="scale-input"><input :value="settings.customScale" class="form-control" type="number" min="25" max="400" :disabled="settings.scaleMode !== 'custom'" @input="updateSetting('customScale', $event.target.value)" /><span>%</span></div>
          </div>
          <label class="check-option"><input type="checkbox" :checked="settings.duplex !== 'off'" @change="updateSetting('duplex', $event.target.checked ? 'long-edge' : 'off')" /> 使用双面打印</label>
          <select v-if="settings.duplex !== 'off'" :value="settings.duplexEdge" class="form-control" aria-label="双面翻页方向" @change="updateSetting('duplexEdge', $event.target.value)"><option value="long-edge">长边翻页</option><option value="short-edge">短边翻页</option></select>
        </section>

        <section class="print-setting-group" aria-labelledby="print-page-title">
          <h3 id="print-page-title">页面设置</h3>
          <div class="print-paper-row">
            <label>纸张大小<select :value="settings.paperSize" class="form-control" @change="updateSetting('paperSize', $event.target.value)"><option v-for="paper in paperSizes" :key="paper.id" :value="paper.id">{{ paper.label }} · {{ paper.widthMm }}×{{ paper.heightMm }} mm</option></select></label>
            <button class="outline-button" type="button" @click="notify('页边距按当前缩放模式交由系统打印对话框处理')">页边距</button>
          </div>
          <div class="print-radio-grid orientation-grid">
            <label><input type="radio" name="print-orientation" value="auto" :checked="settings.orientation === 'auto'" @change="updateSetting('orientation', 'auto')" /> 自动横向/纵向</label>
            <label><input type="radio" name="print-orientation" value="portrait" :checked="settings.orientation === 'portrait'" @change="updateSetting('orientation', 'portrait')" /> 纵向</label>
            <label><input type="radio" name="print-orientation" value="landscape" :checked="settings.orientation === 'landscape'" @change="updateSetting('orientation', 'landscape')" /> 横向</label>
          </div>
        </section>

        <section class="print-setting-group print-advanced-group" aria-labelledby="print-advanced-title">
          <h3 id="print-advanced-title">辅助选项</h3>
          <div class="print-check-list">
            <label class="check-option"><input type="checkbox" :checked="settings.watermark" @change="updateSetting('watermark', $event.target.checked)" /> 水印</label>
            <label class="check-option"><input type="checkbox" :checked="settings.pageNumbers" @change="updateSetting('pageNumbers', $event.target.checked)" /> 页码</label>
            <label class="check-option"><input type="checkbox" :checked="settings.header" @change="updateSetting('header', $event.target.checked)" /> 页眉</label>
            <label class="check-option"><input type="checkbox" :checked="settings.cropMarks" @change="updateSetting('cropMarks', $event.target.checked)" /> 裁剪标记</label>
            <label class="check-option"><input type="checkbox" :checked="settings.splitPages" @change="updateSetting('splitPages', $event.target.checked)" /> 分割页面</label>
          </div>
          <input v-if="settings.watermark" :value="settings.watermarkText" class="form-control" type="text" maxlength="120" placeholder="输入水印文字" @input="updateSetting('watermarkText', $event.target.value)" />
        </section>

        <p v-if="printError" class="print-error" role="alert">{{ printError }}</p>
        <p class="print-privacy-note"><ShieldCheck :size="14" /> 设置仅保存在本机；文档不会上传。</p>
      </aside>

      <section class="print-preview" aria-label="打印预览">
        <div class="print-preview-heading">
          <div><span class="eyebrow">预览</span><strong>{{ sourceName }}</strong><small>{{ printStatusLabel }} · {{ selectedPaper.label }} · {{ pageSummary }}</small></div>
          <span class="print-preview-badge"><FileOutput :size="14" /> {{ selectedPaper.widthMm }}×{{ selectedPaper.heightMm }} mm</span>
        </div>
        <div class="print-preview-stage">
          <div v-if="sourceKind === 'pdf' && previewSourceUrl" class="print-pdf-frame"><iframe ref="previewFrame" :src="previewSourceUrl" title="PDF 文档预览"></iframe></div>
          <div v-else class="print-paper" :style="previewPaperStyle">
            <img v-if="sourceKind === 'image' && sourceUrl" :src="sourceUrl" :alt="`${sourceName} 预览`" />
            <pre v-else-if="sourceKind === 'text'" class="print-paper-text">{{ sourceText }}</pre>
            <div v-else class="print-sample-content"><strong>文档办公打印预览</strong><span>选择 PDF、图片或文本文件后在此查看。</span><small>{{ selectedPaper.label }} · {{ effectiveOrientation === 'landscape' ? '横向' : '纵向' }}</small></div>
            <span v-if="settings.watermark && settings.watermarkText" class="print-paper-watermark">{{ settings.watermarkText }}</span>
            <span v-if="settings.pageNumbers" class="print-paper-page-number">{{ currentPage }}</span>
          </div>
        </div>
        <div class="print-page-nav" aria-label="预览页码控制">
          <button class="icon-button" type="button" :disabled="currentPage <= 1" aria-label="第一页" title="第一页" @click="setPage(1)"><ChevronLeft :size="15" /><ChevronLeft :size="15" class="double-chevron" /></button>
          <button class="icon-button" type="button" :disabled="currentPage <= 1" aria-label="上一页" title="上一页" @click="movePage(-1)"><ChevronLeft :size="15" /></button>
          <input :value="currentPage" class="form-control page-number-input" type="number" min="1" :max="pageCount" aria-label="当前页码" @change="setPage($event.target.value)" />
          <span>/ {{ pageCount }}</span>
          <button class="icon-button" type="button" :disabled="currentPage >= pageCount" aria-label="下一页" title="下一页" @click="movePage(1)"><ChevronRight :size="15" /></button>
          <button class="icon-button" type="button" :disabled="currentPage >= pageCount" aria-label="最后一页" title="最后一页" @click="setPage(pageCount)"><ChevronRight :size="15" /><ChevronRight :size="15" class="double-chevron" /></button>
        </div>
        <div class="print-preview-footer">
          <span>{{ loadingSource ? '正在读取文档...' : `纸张 ${selectedPaper.label} · ${effectiveOrientation === 'landscape' ? '横向' : '纵向'} · ${settings.scaleMode === 'custom' ? `${settings.customScale}%` : settings.scaleMode === 'actual' ? '实际大小' : '自动缩放'}` }}</span>
          <div><button class="outline-button" type="button" @click="exportPreview"><FileOutput :size="15" /> 导出预览</button><button class="primary-button" type="button" :disabled="loadingSource || printBusy" @click="printDocument"><Printer :size="15" /> {{ printBusy ? '提交中...' : '打印' }}</button></div>
        </div>
        <div class="print-bottom-actions"><button class="text-button" type="button" @click="resetSettings"><RotateCcw :size="14" /> 恢复默认</button><span><Check :size="14" /> 设置已自动保存，重新打开不会改变选择</span></div>
      </section>
    </div>
  </section>
</template>
