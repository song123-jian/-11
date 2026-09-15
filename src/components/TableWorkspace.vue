<script setup>
import { computed, ref, watch } from 'vue'
import {
  ArrowLeftRight,
  CheckCircle2,
  Combine,
  Download,
  FileSpreadsheet,
  ListX,
  Rows3,
  ShieldCheck,
  Split,
  Trash2,
  Upload,
} from 'lucide-vue-next'
import { downloadBlob } from '../services/imageTools.js'
import {
  createSplitZip,
  createTableBlob,
  createXlsxBlob,
  dedupeTable,
  mergeTables,
  readTableFile,
  splitTableByColumn,
  transposeTable,
} from '../services/tableTools.js'

const props = defineProps({
  notify: { type: Function, default: null },
})

const emit = defineEmits(['busy-change'])

const files = ref([])
const operation = ref('merge')
const selectedColumn = ref('')
const dedupeColumns = ref([])
const outputFormat = ref('csv')
const result = ref(null)
const busy = ref(false)
const errorMessage = ref('')
const inputRef = ref(null)

const operations = [
  { id: 'merge', label: '多表合并', icon: Combine, description: '按表头合并多个文件，缺少的列留空。' },
  { id: 'split', label: '按列拆分', icon: Split, description: '按指定列的值拆成多个 CSV，再打包下载。' },
  { id: 'dedupe', label: '去重', icon: ListX, description: '按选定列去重，保留首次出现的记录。' },
  { id: 'transpose', label: '转置', icon: ArrowLeftRight, description: '将行列互换，适合整理横向表格。' },
  { id: 'convert', label: '格式互转', icon: FileSpreadsheet, description: '在 Excel、CSV、JSON 之间转换。' },
]

const currentOperation = computed(() => operations.find((item) => item.id === operation.value) || operations[0])
const firstTable = computed(() => files.value[0]?.table || { headers: [], rows: [] })
const availableColumns = computed(() => firstTable.value.headers || [])
const previewTable = computed(() => {
  if (result.value?.table) return result.value.table
  return firstTable.value
})
const previewRows = computed(() => previewTable.value.rows?.slice(0, 12) || [])
const previewTruncated = computed(() => (previewTable.value.rows?.length || 0) > previewRows.value.length)
const sourceSummary = computed(() => {
  if (!files.value.length) return '尚未选择文件'
  const rows = files.value.reduce((total, item) => total + item.table.rows.length, 0)
  return `${files.value.length} 个文件 · ${rows.toLocaleString()} 行`
})

function notify(message, type = 'success') {
  props.notify?.(message, type)
}

function resetResult() {
  result.value = null
  errorMessage.value = ''
}

async function chooseFiles(event) {
  const selected = Array.from(event.target.files || [])
  event.target.value = ''
  if (!selected.length) return
  if (selected.length > 30) {
    errorMessage.value = '一次最多选择 30 个文件'
    notify(errorMessage.value, 'error')
    return
  }
  busy.value = true
  emit('busy-change', true)
  errorMessage.value = ''
  try {
    const parsed = []
    for (const file of selected) {
      const loaded = await readTableFile(file)
      parsed.push({ name: file.name, format: loaded.format, table: loaded.table })
    }
    files.value = parsed
    selectedColumn.value = parsed[0]?.table.headers[0] || ''
    dedupeColumns.value = []
    resetResult()
    notify(`已载入 ${parsed.length} 个表格文件`, 'info')
  } catch (error) {
    errorMessage.value = error?.message || '表格读取失败'
    notify(errorMessage.value, 'error')
  } finally {
    busy.value = false
    emit('busy-change', false)
  }
}

function removeFile(index) {
  files.value = files.value.filter((_, itemIndex) => itemIndex !== index)
  selectedColumn.value = files.value[0]?.table.headers[0] || ''
  dedupeColumns.value = dedupeColumns.value.filter((column) => availableColumns.value.includes(column))
  resetResult()
}

function clearFiles() {
  files.value = []
  selectedColumn.value = ''
  dedupeColumns.value = []
  resetResult()
}

function outputExtension(format) {
  return format === 'xlsx' ? 'xlsx' : format === 'json' ? 'json' : 'csv'
}

async function createOutput(table, format = outputFormat.value) {
  if (format === 'xlsx') return createXlsxBlob(table)
  return createTableBlob(table, format)
}

async function runOperation() {
  if (!files.value.length) {
    notify('请先选择 Excel、CSV 或 JSON 文件', 'error')
    return
  }
  busy.value = true
  emit('busy-change', true)
  resetResult()
  try {
    let table
    let output
    if (operation.value === 'merge') {
      table = mergeTables(files.value.map((item) => item.table))
      output = await createOutput(table)
    } else if (operation.value === 'split') {
      if (!selectedColumn.value) throw new Error('请选择拆分列')
      const groups = splitTableByColumn(firstTable.value, selectedColumn.value)
      if (!groups.length) throw new Error('没有可拆分的数据')
      output = await createSplitZip(groups, outputFormat.value)
      table = groups[0].table
      output.filename = output.filename || `table-split-${Date.now()}.zip`
    } else if (operation.value === 'dedupe') {
      table = dedupeTable(firstTable.value, dedupeColumns.value)
      output = await createOutput(table)
    } else if (operation.value === 'transpose') {
      table = transposeTable(firstTable.value)
      output = await createOutput(table)
    } else {
      table = firstTable.value
      output = await createOutput(table, outputFormat.value)
    }
    result.value = {
      table,
      blob: output.blob,
      filename: output.filename || `table-${operation.value}-${Date.now()}.${outputExtension(outputFormat.value)}`,
      summary: operation.value === 'split'
        ? `已按“${selectedColumn.value}”拆分并打包 ${splitTableByColumn(firstTable.value, selectedColumn.value).length} 个 ${outputFormat.value.toUpperCase()} 文件`
        : `已完成${currentOperation.value.label} · ${table.rows.length.toLocaleString()} 行 × ${table.headers.length} 列`,
    }
    notify('表格处理完成，可下载结果')
  } catch (error) {
    errorMessage.value = error?.message || '表格处理失败'
    notify(errorMessage.value, 'error')
  } finally {
    busy.value = false
    emit('busy-change', false)
  }
}

function downloadResult() {
  if (!result.value?.blob) return
  downloadBlob(result.value.blob, result.value.filename)
  notify('表格结果已下载')
}

watch(operation, () => {
  resetResult()
  if (operation.value === 'dedupe') dedupeColumns.value = []
})
</script>

<template>
  <section class="table-workspace" aria-labelledby="table-workspace-title">
    <div class="tool-title-row table-workspace-title">
      <div><h2 id="table-workspace-title">Excel / CSV 工具</h2><p>多表合并、拆分、去重、转置和 JSON↔CSV；数据只在本机处理。</p></div>
      <span class="offline-chip"><ShieldCheck :size="13" /> 本地处理</span>
    </div>

    <div class="table-operation-tabs" role="tablist" aria-label="表格处理方式">
      <button v-for="item in operations" :key="item.id" type="button" role="tab" :aria-selected="operation === item.id" :class="{ active: operation === item.id }" @click="operation = item.id"><component :is="item.icon" :size="15" />{{ item.label }}</button>
    </div>
    <p class="table-operation-description">{{ currentOperation.description }} <span>{{ sourceSummary }}</span></p>

    <div class="table-toolbar">
      <label class="outline-button file-button"><Upload :size="15" /> 选择表格<input ref="inputRef" type="file" multiple accept=".csv,.tsv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="busy" @change="chooseFiles" /></label>
      <button class="icon-button" type="button" :disabled="busy || !files.length" aria-label="清空表格文件" title="清空文件" @click="clearFiles"><Trash2 :size="16" /></button>
      <label class="table-output-format">输出格式<select v-model="outputFormat" class="form-control" :disabled="busy"><option value="csv">CSV</option><option value="xlsx">Excel（XLSX）</option><option value="json">JSON</option></select></label>
      <button class="primary-button" type="button" :disabled="busy || !files.length" @click="runOperation"><Rows3 :size="16" /> {{ busy ? '处理中...' : '执行处理' }}</button>
    </div>

    <div v-if="files.length" class="table-file-list" aria-label="已选择表格文件">
      <div v-for="(item, index) in files" :key="`${item.name}-${index}`" class="table-file-row"><FileSpreadsheet :size="15" /><span class="file-name" :title="item.name">{{ item.name }}</span><span>{{ item.format.toUpperCase() }} · {{ item.table.rows.length.toLocaleString() }} 行</span><button class="icon-button" type="button" :aria-label="`移除 ${item.name}`" @click="removeFile(index)"><Trash2 :size="14" /></button></div>
    </div>

    <div v-if="operation === 'split' || operation === 'dedupe'" class="table-options-grid">
      <label v-if="operation === 'split'">拆分列<select v-model="selectedColumn" class="form-control"><option value="" disabled>选择列</option><option v-for="column in availableColumns" :key="column" :value="column">{{ column }}</option></select></label>
      <label v-else>去重依据（不选则整行去重）<select v-model="dedupeColumns" class="form-control table-multi-select" multiple><option v-for="column in availableColumns" :key="column" :value="column">{{ column }}</option></select></label>
      <p class="field-hint">{{ operation === 'split' ? '拆分使用第一个文件；结果会打包为 ZIP。' : '保留每组首次出现的记录，不修改源文件。' }}</p>
    </div>

    <p v-if="errorMessage" class="table-error" role="alert">{{ errorMessage }}</p>
    <div v-if="result" class="result-callout table-result"><CheckCircle2 :size="16" /><span>{{ result.summary }}</span><button class="outline-button" type="button" @click="downloadResult"><Download :size="15" /> 下载 {{ result.filename.endsWith('.zip') ? 'ZIP' : result.filename.endsWith('.xlsx') ? 'XLSX' : result.filename.endsWith('.json') ? 'JSON' : 'CSV' }}</button></div>

    <div v-if="previewTable.headers.length" class="table-preview-wrap">
      <div class="table-preview-heading"><strong>{{ result ? '结果预览' : '输入预览' }}</strong><span>最多显示 12 行 · {{ previewTable.rows.length.toLocaleString() }} 行 × {{ previewTable.headers.length }} 列</span></div>
      <div class="table-preview-scroll"><table class="table-preview"><thead><tr><th v-for="header in previewTable.headers" :key="header">{{ header }}</th></tr></thead><tbody><tr v-for="(row, rowIndex) in previewRows" :key="rowIndex"><td v-for="(header, columnIndex) in previewTable.headers" :key="`${rowIndex}-${header}`">{{ row[columnIndex] }}</td></tr></tbody></table></div>
      <p v-if="previewTruncated" class="field-hint">其余行已省略，仅用于预览。</p>
    </div>
    <div v-else class="table-empty"><FileSpreadsheet :size="34" /><strong>选择 CSV、JSON 或 XLSX 开始</strong><span>支持本地表格处理，不会上传文件内容。</span></div>
  </section>
</template>
