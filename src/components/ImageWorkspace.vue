<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileImage,
  Image as ImageIcon,
  LockKeyhole,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
} from 'lucide-vue-next'
import { downloadBlob } from '../services/imageTools.js'
import { createConsentDisclosure } from '../services/privacyConsent.js'
import { inspectImageModelRuntime } from '../services/imageModelRuntime.js'
import { AI_IMAGE_OPERATIONS, checkLocalAiRuntime, runLocalAiImage } from '../services/imageAiTools.js'
import {
  ID_PHOTO_BACKGROUND_COLORS,
  ID_PHOTO_SPEC_SOURCE,
  ID_PHOTO_SPEC_UPDATED_AT,
  ID_PHOTO_SPECS,
  getIdPhotoBackgroundColor,
  getIdPhotoSpec,
  normalizeCustomIdPhotoSpec,
} from '../services/idPhotoSpecs.js'
import { renderIdPhoto } from '../services/idPhotoTools.js'
import {
  IMAGE_EDITOR_MODES,
  clampEditorPoint,
  copyCanvasSelection,
  drawEditorText,
  editorPointFromPointer,
  fitEditorDimensions,
  normalizeEditorRect,
  restoreCanvasSnapshot,
  snapshotCanvas,
} from '../services/imageEditorTools.js'
import { recognizeText } from '../services/ocrTools.js'
import { PAPER_SIZES } from '../services/printSettings.js'
import {
  PHOTO_SHEET_DEFAULTS,
  calculatePhotoSheetLayout,
  printPhotoSheet as printPhotoSheetResult,
  renderPhotoSheet,
} from '../services/photoPrintTools.js'

const props = defineProps({
  mode: { type: String, required: true },
  runtimeMode: { type: String, default: 'browser' },
  startTask: { type: Function, required: true },
  runOnlineAction: { type: Function, default: null },
})

const emit = defineEmits(['notify', 'busy-change'])

function notify(message, type = 'success') {
  emit('notify', message, type)
}

const busy = ref(false)
watch(busy, (value) => emit('busy-change', value))

function revokeObjectUrl(value) {
  if (value && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(value)
}

function createObjectUrl(file) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return ''
  return URL.createObjectURL(file)
}

// Local AI image operations
const aiFile = ref(null)
const aiPreview = ref('')
const aiResult = ref(null)
const aiResultPreview = ref('')
const aiOperation = ref(AI_IMAGE_OPERATIONS.enhance)
const aiStrength = ref(55)
const aiThreshold = ref(42)
const aiBackgroundColor = ref('')
const aiRuntime = ref(null)
const aiRuntimeBusy = ref(false)

const aiOperationLabel = computed(() => aiOperation.value === AI_IMAGE_OPERATIONS.removeBackground ? 'AI 抠图' : '智能增强')
const aiBackgroundModeLabel = computed(() => aiBackgroundColor.value ? '替换为指定背景色' : '输出透明背景 PNG')

function chooseAiImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (busy.value) return
  if (!file) return
  if (!file.type?.startsWith('image/')) {
    notify('请选择 JPG、PNG、WebP 等图片', 'error')
    return
  }
  revokeObjectUrl(aiPreview.value)
  revokeObjectUrl(aiResultPreview.value)
  aiFile.value = file
  aiPreview.value = createObjectUrl(file)
  aiResult.value = null
  aiResultPreview.value = ''
}

async function inspectAiRuntime() {
  if (aiRuntimeBusy.value) return
  aiRuntimeBusy.value = true
  try {
    aiRuntime.value = await inspectImageModelRuntime()
    if (aiRuntime.value.available) notify('本地图片引擎已就绪', 'info')
    else notify(aiRuntime.value.detail || '本地图片引擎未就绪', 'error')
  } finally {
    aiRuntimeBusy.value = false
  }
}

function runAiImage() {
  if (!aiFile.value) {
    notify('请先选择一张图片', 'error')
    return
  }
  const file = aiFile.value
  const operation = aiOperation.value
  const strength = Number(aiStrength.value)
  const threshold = Number(aiThreshold.value)
  const backgroundColor = operation === AI_IMAGE_OPERATIONS.removeBackground ? aiBackgroundColor.value : ''
  busy.value = true
  aiResult.value = null
  revokeObjectUrl(aiResultPreview.value)
  aiResultPreview.value = ''
  const task = props.startTask({
    operation: operation === AI_IMAGE_OPERATIONS.removeBackground ? 'image-ai-cutout' : 'image-ai-enhance',
    label: operation === AI_IMAGE_OPERATIONS.removeBackground ? 'AI 图片抠图' : 'AI 图片增强',
    initialStage: '加载本地图片引擎',
    totalItems: 1,
    worker: ({ onProgress, reportStatus, isCanceled }) => runLocalAiImage(file, operation, {
      strength,
      threshold,
      backgroundColor,
      onProgress,
      onStatus: reportStatus,
      isCanceled,
    }),
    resultMessage: operation === AI_IMAGE_OPERATIONS.removeBackground ? 'AI 抠图已完成' : 'AI 图片增强已完成',
    onSuccess: (result) => {
      aiResult.value = result
      aiResultPreview.value = createObjectUrl(result.blob)
    },
    onFailure: () => {},
    onSettled: () => { busy.value = false },
  })
  if (!task) busy.value = false
}

function downloadAiResult() {
  if (!aiResult.value) return
  downloadBlob(aiResult.value.blob, aiResult.value.filename)
  notify('AI 图片结果已下载')
}

// ID-photo crop and output
const idPhotoFile = ref(null)
const idPhotoPreview = ref('')
const idPhotoResult = ref(null)
const idPhotoResultPreview = ref('')
const idPhotoSpecId = ref('one-inch')
const idPhotoBackground = ref('#ffffff')
const idPhotoFocalX = ref(0.5)
const idPhotoFocalY = ref(0.46)
const customWidthPx = ref(295)
const customHeightPx = ref(413)
const photoSheetPaperSize = ref(PHOTO_SHEET_DEFAULTS.paperSize)
const photoSheetOrientation = ref(PHOTO_SHEET_DEFAULTS.orientation)
const photoSheetCopies = ref(PHOTO_SHEET_DEFAULTS.copies)
const photoSheetMarginMm = ref(PHOTO_SHEET_DEFAULTS.marginMm)
const photoSheetGapMm = ref(PHOTO_SHEET_DEFAULTS.gapMm)
const photoSheetDpi = ref(PHOTO_SHEET_DEFAULTS.dpi)
const photoSheetCropMarks = ref(PHOTO_SHEET_DEFAULTS.cropMarks)
const photoSheetResult = ref(null)
const photoSheetPreview = ref('')
const paperSizes = Object.values(PAPER_SIZES)

const selectedIdPhotoSpec = computed(() => {
  if (idPhotoSpecId.value !== 'custom') return getIdPhotoSpec(idPhotoSpecId.value)
  try {
    return normalizeCustomIdPhotoSpec({ widthPx: customWidthPx.value, heightPx: customHeightPx.value })
  } catch {
    return { id: 'custom', label: '自定义规格', widthPx: 295, heightPx: 413, widthMm: 0, heightMm: 0, backgroundColors: ['white', 'blue', 'red'], usage: '输入有效像素后生成' }
  }
})

const availableIdPhotoBackgrounds = computed(() => {
  const allowed = new Set(selectedIdPhotoSpec.value.backgroundColors || [])
  return ID_PHOTO_BACKGROUND_COLORS.filter((item) => allowed.has(item.id))
})

watch(availableIdPhotoBackgrounds, (items) => {
  if (!items.some((item) => item.value === idPhotoBackground.value)) idPhotoBackground.value = items[0]?.value || '#ffffff'
}, { immediate: true })

function chooseIdPhoto(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (busy.value) return
  if (!file) return
  if (!file.type?.startsWith('image/')) {
    notify('请选择 JPG、PNG、WebP 等图片', 'error')
    return
  }
  revokeObjectUrl(idPhotoPreview.value)
  revokeObjectUrl(idPhotoResultPreview.value)
  idPhotoFile.value = file
  idPhotoPreview.value = createObjectUrl(file)
  idPhotoResult.value = null
  idPhotoResultPreview.value = ''
  photoSheetResult.value = null
  revokeObjectUrl(photoSheetPreview.value)
  photoSheetPreview.value = ''
}

function runIdPhotoCrop() {
  if (!idPhotoFile.value) {
    notify('请先选择原始照片', 'error')
    return
  }
  let spec
  try {
    spec = idPhotoSpecId.value === 'custom'
      ? normalizeCustomIdPhotoSpec({ widthPx: customWidthPx.value, heightPx: customHeightPx.value })
      : getIdPhotoSpec(idPhotoSpecId.value)
  } catch (error) {
    notify(error.message, 'error')
    return
  }
  const file = idPhotoFile.value
  const backgroundColor = getIdPhotoBackgroundColor(idPhotoBackground.value)
  const focalX = Number(idPhotoFocalX.value)
  const focalY = Number(idPhotoFocalY.value)
  busy.value = true
  idPhotoResult.value = null
  revokeObjectUrl(idPhotoResultPreview.value)
  idPhotoResultPreview.value = ''
  photoSheetResult.value = null
  revokeObjectUrl(photoSheetPreview.value)
  photoSheetPreview.value = ''
  const task = props.startTask({
    operation: 'id-photo',
    label: '证件照裁剪',
    initialStage: '读取原图',
    totalItems: 1,
    worker: ({ onProgress, reportStatus, isCanceled }) => renderIdPhoto(file, {
      spec,
      backgroundColor,
      focalX,
      focalY,
      onProgress,
      onStatus: reportStatus,
      isCanceled,
    }),
    resultMessage: '证件照已生成',
    onSuccess: (result) => {
      idPhotoResult.value = result
      idPhotoResultPreview.value = createObjectUrl(result.blob)
    },
    onFailure: () => {},
    onSettled: () => { busy.value = false },
  })
  if (!task) busy.value = false
}

function downloadIdPhoto() {
  if (!idPhotoResult.value) return
  downloadBlob(idPhotoResult.value.blob, idPhotoResult.value.filename)
  notify('证件照结果已下载')
}

const photoSheetLayout = computed(() => {
  try {
    return calculatePhotoSheetLayout(selectedIdPhotoSpec.value, {
      paperSize: photoSheetPaperSize.value,
      orientation: photoSheetOrientation.value,
      copies: photoSheetCopies.value,
      marginMm: photoSheetMarginMm.value,
      gapMm: photoSheetGapMm.value,
      dpi: photoSheetDpi.value,
      cropMarks: photoSheetCropMarks.value,
    })
  } catch (error) {
    return { error: error?.message || '版式参数无效' }
  }
})

function currentPhotoSheetOptions() {
  return {
    paperSize: photoSheetPaperSize.value,
    orientation: photoSheetOrientation.value,
    copies: photoSheetCopies.value,
    marginMm: photoSheetMarginMm.value,
    gapMm: photoSheetGapMm.value,
    dpi: photoSheetDpi.value,
    cropMarks: photoSheetCropMarks.value,
  }
}

async function runPhotoSheet() {
  if (!idPhotoResult.value?.blob) {
    notify('请先生成证件照，再进行相纸排版', 'error')
    return
  }
  busy.value = true
  try {
    const result = await renderPhotoSheet(idPhotoResult.value.blob, selectedIdPhotoSpec.value, currentPhotoSheetOptions())
    revokeObjectUrl(photoSheetPreview.value)
    photoSheetResult.value = result
    photoSheetPreview.value = createObjectUrl(result.blob)
    notify('证件照相纸排版已生成')
  } catch (error) {
    notify(error?.message || '相纸排版失败', 'error')
  } finally {
    busy.value = false
  }
}

function downloadPhotoSheet() {
  if (!photoSheetResult.value) return
  downloadBlob(photoSheetResult.value.blob, photoSheetResult.value.filename)
  notify('相纸排版图已下载')
}

function printPhotoSheetNow() {
  if (!photoSheetResult.value) return
  try {
    printPhotoSheetResult(photoSheetResult.value.blob, currentPhotoSheetOptions())
    notify('已打开系统打印流程')
  } catch (error) {
    notify(error?.message || '无法打开打印流程', 'error')
  }
}

// In-canvas text editing
const editorFile = ref(null)
const editorSourceUrl = ref('')
const editorCanvas = ref(null)
const editorReady = ref(false)
const editorWidth = ref(0)
const editorHeight = ref(0)
const editorMode = ref('select')
const editorBrushSize = ref(24)
const editorEraseColor = ref('#ffffff')
const editorTransparent = ref(true)
const editorReplaceText = ref('')
const editorAddText = ref('')
const editorTextColor = ref('#1d2b38')
const editorTextSize = ref(28)
const editorSelection = ref(null)
const editorOcrText = ref('')
const editorOcrBusy = ref(false)
const editorStatus = ref('选择图片后可直接在画布上编辑')
const editorClipboard = ref(null)
const editorHistory = ref([])
const editorHistoryIndex = ref(-1)
const pointerState = { drawing: false, selecting: false, last: null, start: null }

const editorHistoryCanUndo = computed(() => editorHistoryIndex.value > 0)
const editorHistoryCanRedo = computed(() => editorHistoryIndex.value >= 0 && editorHistoryIndex.value < editorHistory.value.length - 1)
const editorSelectionStyle = computed(() => {
  const rect = editorSelection.value
  const canvas = editorCanvas.value
  if (!rect || !canvas?.width || !canvas?.height) return {}
  return {
    left: `${(rect.x / canvas.width) * 100}%`,
    top: `${(rect.y / canvas.height) * 100}%`,
    width: `${(rect.width / canvas.width) * 100}%`,
    height: `${(rect.height / canvas.height) * 100}%`,
  }
})

function resetEditorHistory() {
  editorHistory.value = []
  editorHistoryIndex.value = -1
  const snapshot = snapshotCanvas(editorCanvas.value)
  if (snapshot) {
    editorHistory.value = [snapshot]
    editorHistoryIndex.value = 0
  }
}

function commitEditorHistory() {
  const snapshot = snapshotCanvas(editorCanvas.value)
  if (!snapshot) return
  const next = editorHistory.value.slice(0, editorHistoryIndex.value + 1)
  next.push(snapshot)
  while (next.length > 18) next.shift()
  editorHistory.value = next
  editorHistoryIndex.value = next.length - 1
}

function restoreEditorHistory(index) {
  if (index < 0 || index >= editorHistory.value.length || !editorCanvas.value) return
  if (restoreCanvasSnapshot(editorCanvas.value, editorHistory.value[index])) {
    editorHistoryIndex.value = index
    editorSelection.value = null
    editorStatus.value = index === 0 ? '已恢复原图' : '已恢复编辑步骤'
  }
}

function undoEditor() {
  if (editorHistoryCanUndo.value) restoreEditorHistory(editorHistoryIndex.value - 1)
}

function redoEditor() {
  if (editorHistoryCanRedo.value) restoreEditorHistory(editorHistoryIndex.value + 1)
}

function loadEditorImage(file, url) {
  const image = new Image()
  image.onload = () => {
    if (url !== editorSourceUrl.value) return
    const dimensions = fitEditorDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height)
    const canvas = editorCanvas.value
    if (!canvas) return
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      editorStatus.value = '当前环境不支持画布编辑'
      return
    }
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    editorWidth.value = canvas.width
    editorHeight.value = canvas.height
    editorReady.value = true
    editorSelection.value = null
    editorClipboard.value = null
    editorStatus.value = `已载入 ${canvas.width}×${canvas.height} 图片；源文件不会被覆盖`
    resetEditorHistory()
  }
  image.onerror = () => { editorStatus.value = '图片无法读取' }
  image.src = url
  void file
}

function chooseEditorImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type?.startsWith('image/')) {
    notify('请选择 JPG、PNG、WebP 等图片', 'error')
    return
  }
  revokeObjectUrl(editorSourceUrl.value)
  editorFile.value = file
  editorSourceUrl.value = createObjectUrl(file)
  editorReady.value = false
  editorStatus.value = '正在载入图片...'
  void nextTick(() => loadEditorImage(file, editorSourceUrl.value))
}

function editorPoint(event) {
  return editorPointFromPointer(event, editorCanvas.value)
}

function drawEraseStroke(from, to) {
  const context = editorCanvas.value?.getContext('2d')
  if (!context) return
  context.save()
  context.globalCompositeOperation = editorTransparent.value ? 'destination-out' : 'source-over'
  context.strokeStyle = editorEraseColor.value
  context.lineWidth = Math.max(2, Number(editorBrushSize.value) || 24)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.stroke()
  context.restore()
}

function applyReplacement(rect) {
  const text = editorReplaceText.value.trim()
  if (!text) {
    notify('请输入要替换的文字', 'error')
    return
  }
  const context = editorCanvas.value?.getContext('2d')
  if (!context) return
  context.save()
  context.fillStyle = editorEraseColor.value
  context.fillRect(rect.x, rect.y, rect.width, rect.height)
  context.restore()
  drawEditorText(context, text, rect.x + 8, rect.y + 7, {
    fontSize: editorTextSize.value,
    color: editorTextColor.value,
    maxWidth: Math.max(20, rect.width - 16),
  })
  commitEditorHistory()
  editorStatus.value = '文字已替换；可继续调整或撤销'
  editorSelection.value = null
}

function addEditorTextAt(point) {
  const text = editorAddText.value.trim()
  if (!text) {
    notify('请输入要添加的文字', 'error')
    return
  }
  const context = editorCanvas.value?.getContext('2d')
  if (!context) return
  drawEditorText(context, text, point.x, point.y, {
    fontSize: editorTextSize.value,
    color: editorTextColor.value,
    maxWidth: Math.max(80, editorCanvas.value.width - point.x - 12),
  })
  commitEditorHistory()
  editorStatus.value = '文字已添加；可用撤销恢复'
}

function pasteClipboardAt(point) {
  if (!editorClipboard.value?.canvas) {
    notify('请先框选并复制一块区域', 'error')
    return
  }
  const canvas = editorCanvas.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return
  const source = editorClipboard.value.canvas
  const x = clampEditorPoint(point, canvas.width, canvas.height).x
  const y = clampEditorPoint(point, canvas.width, canvas.height).y
  const drawX = Math.min(x, Math.max(0, canvas.width - source.width))
  const drawY = Math.min(y, Math.max(0, canvas.height - source.height))
  context.drawImage(source, drawX, drawY)
  commitEditorHistory()
  editorSelection.value = { x: drawX, y: drawY, width: source.width, height: source.height }
  editorStatus.value = '选区已粘贴；可继续移动或撤销'
  editorMode.value = 'select'
}

function handleEditorPointerDown(event) {
  if (!editorReady.value || event.button !== 0) return
  event.preventDefault()
  const point = editorPoint(event)
  if (editorMode.value === 'erase') {
    pointerState.drawing = true
    pointerState.last = point
    drawEraseStroke(point, point)
  } else if (editorMode.value === 'text') {
    addEditorTextAt(point)
  } else if (editorMode.value === 'paste') {
    pasteClipboardAt(point)
  } else {
    pointerState.selecting = true
    pointerState.start = point
    editorSelection.value = normalizeEditorRect(point, point, editorWidth.value, editorHeight.value)
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function handleEditorPointerMove(event) {
  if (!editorReady.value) return
  const point = editorPoint(event)
  if (pointerState.drawing && pointerState.last) {
    drawEraseStroke(pointerState.last, point)
    pointerState.last = point
  }
  if (pointerState.selecting && pointerState.start) {
    editorSelection.value = normalizeEditorRect(pointerState.start, point, editorWidth.value, editorHeight.value)
  }
}

function handleEditorPointerUp(event) {
  if (pointerState.drawing) {
    pointerState.drawing = false
    pointerState.last = null
    commitEditorHistory()
    editorStatus.value = editorTransparent.value ? '已消除为透明区域' : '已用选定颜色覆盖区域'
  }
  if (pointerState.selecting) {
    pointerState.selecting = false
    const rect = editorSelection.value
    pointerState.start = null
    if (rect && rect.width > 3 && rect.height > 3 && editorMode.value === 'replace') applyReplacement(rect)
  }
  event.currentTarget.releasePointerCapture?.(event.pointerId)
}

function copyEditorSelection() {
  try {
    editorClipboard.value = copyCanvasSelection(editorCanvas.value, editorSelection.value)
    editorMode.value = 'paste'
    editorStatus.value = `已复制 ${editorClipboard.value.width}×${editorClipboard.value.height} 选区；点击画布粘贴`
    notify('选区已复制到编辑器剪贴板', 'info')
  } catch (error) {
    notify(error.message, 'error')
  }
}

function pasteEditorAtCenter() {
  if (!editorClipboard.value?.canvas || !editorCanvas.value) {
    notify('请先框选并复制一块区域', 'error')
    return
  }
  pasteClipboardAt({
    x: (editorCanvas.value.width - editorClipboard.value.width) / 2,
    y: (editorCanvas.value.height - editorClipboard.value.height) / 2,
  })
}

function exportEditorImage() {
  const canvas = editorCanvas.value
  if (!canvas || !editorReady.value) return
  canvas.toBlob((blob) => {
    if (!blob) {
      notify('无法生成编辑结果', 'error')
      return
    }
    downloadBlob(blob, `edited-${Date.now()}.png`)
    notify('图片文字编辑结果已下载')
  }, 'image/png')
}

async function runEditorOcr() {
  if (!editorFile.value) {
    notify('请先选择图片', 'error')
    return
  }
  if (editorOcrBusy.value) return
  const file = editorFile.value
  const disclosure = createConsentDisclosure('ocr')
  const launch = () => {
    editorOcrBusy.value = true
    const task = props.startTask({
      operation: 'image-text-ocr',
      label: '图片文字识别',
      initialStage: '加载 OCR 引擎',
      totalItems: 1,
      worker: ({ onProgress, reportStatus, isCanceled }) => recognizeText(file, 'chi_sim+eng', {
        onProgress,
        onStatus: reportStatus,
        isCanceled,
      }),
      resultMessage: '图片文字识别已完成',
      onSuccess: (result) => {
        editorOcrText.value = result.text
        editorStatus.value = `识别到约 ${result.text.length} 个字符；可复制后用于替换`
      },
      onFailure: () => {},
      onSettled: () => { editorOcrBusy.value = false },
    })
    if (!task) editorOcrBusy.value = false
    return task
  }
  if (props.runOnlineAction && disclosure) await props.runOnlineAction(disclosure, launch)
  else await launch()
}

function copyOcrText() {
  if (!editorOcrText.value) return
  navigator.clipboard?.writeText(editorOcrText.value).then(() => notify('OCR 文字已复制')).catch(() => notify('当前环境禁止访问剪贴板，请手动复制', 'error'))
}

const imageEditorModeLabel = computed(() => IMAGE_EDITOR_MODES.find((item) => item.id === editorMode.value)?.label || '选择')

onMounted(() => {
  void checkLocalAiRuntime().then((runtime) => {
    aiRuntime.value = { ...runtime, version: 'local-vision-1', status: 'ready', remoteVision: false }
  }).catch(() => {
    aiRuntime.value = { available: false, status: 'unavailable', detail: '本地图片引擎未就绪' }
  })
})

onBeforeUnmount(() => {
  revokeObjectUrl(aiPreview.value)
  revokeObjectUrl(aiResultPreview.value)
  revokeObjectUrl(idPhotoPreview.value)
  revokeObjectUrl(idPhotoResultPreview.value)
  revokeObjectUrl(photoSheetPreview.value)
  revokeObjectUrl(editorSourceUrl.value)
  busy.value = false
})
</script>

<template>
  <div class="image-advanced-workspace">
    <template v-if="mode === 'image-ai'">
      <div class="tool-title-row image-advanced-title">
        <div><h2>AI 图片能力</h2><p>本机智能增强与背景移除；默认不上传图片，导出为新的结果副本。</p></div>
        <span class="offline-chip"><LockKeyhole :size="13" /> 本地视觉</span>
      </div>
      <div class="image-advanced-grid">
        <div>
          <label class="dropzone image-drop" :class="{ 'is-disabled': busy }" :aria-disabled="busy" for="ai-image-file"><Sparkles :size="22" /><strong>{{ aiFile ? aiFile.name : '选择图片开始 AI 处理' }}</strong><span>支持 JPG、PNG、WebP · 原图不会被覆盖</span><input id="ai-image-file" type="file" accept="image/*" :disabled="busy" @change="chooseAiImage" /></label>
          <div v-if="aiPreview" class="image-preview ai-preview"><img :src="aiPreview" alt="AI 图片原图预览" /></div>
        </div>
        <div class="image-control-panel">
          <div class="segmented-control" aria-label="AI 图片操作"><button type="button" :class="{ active: aiOperation === 'enhance' }" :aria-pressed="aiOperation === 'enhance'" @click="aiOperation = 'enhance'"><WandSparkles :size="14" /> 智能增强</button><button type="button" :class="{ active: aiOperation === 'remove-background' }" :aria-pressed="aiOperation === 'remove-background'" @click="aiOperation = 'remove-background'"><ImageIcon :size="14" /> AI 抠图</button></div>
          <label v-if="aiOperation === 'enhance'" class="image-control-field">增强强度 <strong>{{ aiStrength }}%</strong><input v-model="aiStrength" class="form-range" type="range" min="0" max="100" /></label>
          <template v-else>
            <label class="image-control-field">背景相似度阈值 <strong>{{ aiThreshold }}</strong><input v-model="aiThreshold" class="form-range" type="range" min="8" max="120" /></label>
            <label class="image-control-field">抠图输出背景<select v-model="aiBackgroundColor" class="form-control"><option value="">透明背景 PNG</option><option value="#ffffff">白底 JPG</option><option value="#438edb">蓝底 JPG</option><option value="#d93025">红底 JPG</option></select></label>
            <small class="field-hint">{{ aiBackgroundModeLabel }}；适合背景颜色较均匀的图片。</small>
          </template>
          <div class="ai-runtime-status" :class="aiRuntime?.available ? 'ready' : 'idle'" role="status"><ShieldCheck :size="15" /><span><strong>{{ aiRuntime?.available ? '本地引擎已就绪' : '正在检测本地引擎' }}</strong><small>{{ aiRuntime?.detail || 'Canvas Local Vision · 无需 Token' }}</small></span><button class="icon-button" type="button" :disabled="aiRuntimeBusy" aria-label="重新检测本地图片引擎" title="重新检测" @click="inspectAiRuntime"><RefreshCw :size="15" /></button></div>
          <button class="primary-button" type="button" :disabled="busy || !aiFile" @click="runAiImage"><Sparkles :size="15" /> {{ busy ? '处理中...' : `开始${aiOperationLabel}` }}</button>
        </div>
      </div>
      <div v-if="aiResult" class="image-result-block"><div class="result-callout"><CheckCircle2 :size="16" /><span>{{ aiResult.summary }} · {{ aiResult.engine }}</span><button class="outline-button" type="button" @click="downloadAiResult"><Download :size="15" /> 下载结果</button></div><div v-if="aiResultPreview" class="image-preview result-preview ai-result-preview"><img :src="aiResultPreview" alt="AI 图片处理结果预览" /></div></div>
    </template>

    <template v-else-if="mode === 'id-photo'">
      <div class="tool-title-row image-advanced-title">
        <div><h2>证件照裁剪</h2><p>按常用规格生成新证件照；尺寸为参考数据，最终以办证机构要求为准。</p></div>
        <span class="offline-chip"><LockKeyhole :size="13" /> 本地处理</span>
      </div>
      <div class="id-photo-layout">
        <div>
          <label class="dropzone image-drop" :class="{ 'is-disabled': busy }" :aria-disabled="busy" for="id-photo-file"><FileImage :size="22" /><strong>{{ idPhotoFile ? idPhotoFile.name : '选择证件照原图' }}</strong><span>建议使用正面、光线均匀的照片</span><input id="id-photo-file" type="file" accept="image/*" :disabled="busy" @change="chooseIdPhoto" /></label>
          <div v-if="idPhotoPreview" class="image-preview id-photo-source-preview"><img :src="idPhotoPreview" alt="证件照原图预览" /></div>
        </div>
        <div class="id-photo-options">
          <label>证件照规格<select v-model="idPhotoSpecId" class="form-control"><option v-for="spec in ID_PHOTO_SPECS" :key="spec.id" :value="spec.id">{{ spec.label }} · {{ spec.widthPx }}×{{ spec.heightPx }} px</option><option value="custom">自定义像素</option></select></label>
          <div class="id-photo-spec-data"><div><span>尺寸</span><strong>{{ selectedIdPhotoSpec.widthMm ? `${selectedIdPhotoSpec.widthMm} × ${selectedIdPhotoSpec.heightMm} mm` : '自定义' }}</strong></div><div><span>输出</span><strong>{{ selectedIdPhotoSpec.widthPx }} × {{ selectedIdPhotoSpec.heightPx }} px</strong></div><div><span>适用</span><strong>{{ selectedIdPhotoSpec.usage }}</strong></div></div>
          <div v-if="idPhotoSpecId === 'custom'" class="form-grid two"><label>宽度（px）<input v-model="customWidthPx" class="form-control" type="number" min="64" max="4000" step="1" /></label><label>高度（px）<input v-model="customHeightPx" class="form-control" type="number" min="64" max="4000" step="1" /></label></div>
          <label>背景色<select v-model="idPhotoBackground" class="form-control"><option v-for="color in availableIdPhotoBackgrounds" :key="color.id" :value="color.value">{{ color.label }}</option></select></label>
          <label>主体水平位置 <strong>{{ Math.round(idPhotoFocalX * 100) }}%</strong><input v-model="idPhotoFocalX" class="form-range" type="range" min="0.2" max="0.8" step="0.01" /></label>
          <label>主体垂直位置 <strong>{{ Math.round(idPhotoFocalY * 100) }}%</strong><input v-model="idPhotoFocalY" class="form-range" type="range" min="0.2" max="0.8" step="0.01" /></label>
          <button class="primary-button" type="button" :disabled="busy || !idPhotoFile" @click="runIdPhotoCrop"><WandSparkles :size="15" /> {{ busy ? '生成中...' : '生成证件照' }}</button>
        </div>
      </div>
      <div class="id-photo-reference"><ShieldCheck :size="15" /><span><strong>规格要求参考</strong>{{ ID_PHOTO_SPEC_SOURCE }} · 更新于 {{ ID_PHOTO_SPEC_UPDATED_AT }}。不同学校、签证中心和办证机构可能要求不同背景色、尺寸或文件大小，请以实际通知为准。</span></div>
      <div v-if="idPhotoResult" class="image-result-block"><div class="result-callout"><CheckCircle2 :size="16" /><span>{{ idPhotoResult.summary }}</span><button class="outline-button" type="button" @click="downloadIdPhoto"><Download :size="15" /> 下载 JPG</button></div><div v-if="idPhotoResultPreview" class="image-preview result-preview id-photo-result-preview"><img :src="idPhotoResultPreview" alt="证件照裁剪结果预览" /></div></div>
      <section v-if="idPhotoResult" class="photo-sheet-panel" aria-labelledby="photo-sheet-title">
        <div class="card-heading"><div><h3 id="photo-sheet-title">证件照相纸排版</h3><small>复用当前证件照结果，按纸张尺寸生成可打印排版图。</small></div><Printer :size="18" aria-hidden="true" /></div>
        <div class="photo-sheet-options">
          <label>纸张<select v-model="photoSheetPaperSize" class="form-control"><option v-for="paper in paperSizes" :key="paper.id" :value="paper.id">{{ paper.label }} · {{ paper.widthMm }}×{{ paper.heightMm }} mm</option></select></label>
          <label>方向<select v-model="photoSheetOrientation" class="form-control"><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
          <label>份数<input v-model="photoSheetCopies" class="form-control" type="number" min="1" max="100" /></label>
          <label>边距（mm）<input v-model="photoSheetMarginMm" class="form-control" type="number" min="0" max="30" step="1" /></label>
          <label>间距（mm）<input v-model="photoSheetGapMm" class="form-control" type="number" min="0" max="20" step="1" /></label>
          <label>清晰度（DPI）<select v-model="photoSheetDpi" class="form-control"><option :value="150">150</option><option :value="200">200</option><option :value="300">300</option></select></label>
        </div>
        <label class="check-option photo-sheet-crop"><input v-model="photoSheetCropMarks" type="checkbox" /> 显示裁剪标记</label>
        <p class="field-hint photo-sheet-capacity" :class="{ 'photo-sheet-invalid': photoSheetLayout.error }">{{ photoSheetLayout.error || `当前版式：${photoSheetLayout.columns} 列 × ${photoSheetLayout.rows} 行，最多 ${photoSheetLayout.capacity} 张 · ${photoSheetLayout.paperWidthPx}×${photoSheetLayout.paperHeightPx} px` }}</p>
        <div class="action-row"><button class="primary-button" type="button" :disabled="busy || Boolean(photoSheetLayout.error)" @click="runPhotoSheet"><Printer :size="15" /> {{ busy ? '排版中...' : '生成排版图' }}</button><button v-if="photoSheetResult" class="outline-button" type="button" @click="downloadPhotoSheet"><Download :size="15" /> 下载排版图</button><button v-if="photoSheetResult" class="outline-button" type="button" @click="printPhotoSheetNow"><Printer :size="15" /> 直接打印</button></div>
        <div v-if="photoSheetPreview" class="image-preview result-preview photo-sheet-preview"><img :src="photoSheetPreview" alt="证件照相纸排版预览" /></div>
        <div v-if="photoSheetResult" class="result-callout"><CheckCircle2 :size="16" /><span>{{ photoSheetResult.summary }}</span></div>
      </section>
    </template>

    <template v-else>
      <div class="tool-title-row image-advanced-title">
        <div><h2>图片文字编辑</h2><p>在画布上消除、替换、复制和粘贴；OCR 仅用于提取文字，原图始终保留。</p></div>
        <span class="offline-chip"><LockKeyhole :size="13" /> 画布编辑</span>
      </div>
      <label class="dropzone compact-drop image-drop" for="editor-image-file"><FileImage :size="22" /><strong>{{ editorFile ? editorFile.name : '选择要编辑的图片' }}</strong><span>大图会按 2400px 长边建立编辑副本</span><input id="editor-image-file" type="file" accept="image/*" @change="chooseEditorImage" /></label>
      <div class="editor-toolbar" role="toolbar" aria-label="图片文字编辑工具">
        <div class="segmented-control editor-mode-control" aria-label="编辑模式"><button v-for="tool in IMAGE_EDITOR_MODES" :key="tool.id" type="button" :class="{ active: editorMode === tool.id }" :aria-pressed="editorMode === tool.id" :disabled="!editorReady" @click="editorMode = tool.id">{{ tool.label }}</button></div>
        <button class="icon-button" type="button" :disabled="!editorHistoryCanUndo" aria-label="撤销" title="撤销" @click="undoEditor"><RotateCcw :size="16" /></button><button class="icon-button" type="button" :disabled="!editorHistoryCanRedo" aria-label="重做" title="重做" @click="redoEditor"><RefreshCw :size="16" /></button>
        <button class="outline-button" type="button" :disabled="!editorSelection" @click="copyEditorSelection"><Copy :size="15" /> 复制选区</button><button class="outline-button" type="button" :disabled="!editorClipboard" @click="pasteEditorAtCenter"><Copy :size="15" /> 粘贴到中心</button>
        <button class="primary-button" type="button" :disabled="!editorReady" @click="exportEditorImage"><Download :size="15" /> 导出 PNG</button>
      </div>
      <div class="editor-options">
        <label v-if="editorMode === 'erase'">笔刷 {{ editorBrushSize }} px<input v-model="editorBrushSize" class="form-range" type="range" min="4" max="120" /></label>
        <label v-if="editorMode === 'erase'" class="inline-check"><input v-model="editorTransparent" type="checkbox" /> 透明消除</label>
        <label v-if="(editorMode === 'erase' && !editorTransparent) || editorMode === 'replace'">覆盖色<input v-model="editorEraseColor" class="color-input" type="color" /></label>
        <label v-if="editorMode === 'replace'">替换文字<input v-model="editorReplaceText" class="form-control" type="text" maxlength="200" placeholder="框选后自动替换" /></label>
        <label v-if="editorMode === 'text'">添加文字<input v-model="editorAddText" class="form-control" type="text" maxlength="200" placeholder="点击画布放置文字" /></label>
        <label v-if="['text', 'replace'].includes(editorMode)">字号 {{ editorTextSize }}<input v-model="editorTextSize" class="form-range" type="range" min="10" max="120" /></label>
        <label v-if="['text', 'replace'].includes(editorMode)">文字色<input v-model="editorTextColor" class="color-input" type="color" /></label>
        <span class="editor-mode-hint">当前：{{ imageEditorModeLabel }}</span>
      </div>
      <div class="editor-canvas-shell" :class="{ ready: editorReady, 'editor-cursor-erase': editorMode === 'erase' }">
        <div v-if="!editorReady" class="editor-empty"><ImageIcon :size="38" /><span>{{ editorStatus }}</span></div>
        <div v-show="editorReady" class="editor-canvas-wrap"><canvas ref="editorCanvas" :width="editorWidth" :height="editorHeight" aria-label="图片编辑画布" @pointerdown="handleEditorPointerDown" @pointermove="handleEditorPointerMove" @pointerup="handleEditorPointerUp" @pointercancel="handleEditorPointerUp" @pointerleave="handleEditorPointerUp"></canvas><div v-if="editorSelection" class="editor-selection" :style="editorSelectionStyle" aria-hidden="true"></div></div>
      </div>
      <div class="editor-footer"><span class="safe-hint"><ShieldCheck :size="14" /> {{ editorStatus }}</span><button class="outline-button" type="button" :disabled="editorOcrBusy || !editorFile" @click="runEditorOcr"><Search :size="15" /> {{ editorOcrBusy ? '识别中...' : 'OCR 提取文字' }}</button></div>
      <div v-if="editorOcrText" class="editor-ocr-result"><div class="card-heading"><div><strong>OCR 文字结果</strong><small>文字识别在本机完成；首次使用会按授权下载语言模型</small></div><button class="outline-button" type="button" @click="copyOcrText"><Copy :size="15" /> 复制文字</button></div><textarea v-model="editorOcrText" class="form-control" rows="5" aria-label="OCR 文字结果"></textarea></div>
    </template>
  </div>
</template>
