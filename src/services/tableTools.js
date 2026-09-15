const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const TABLE_MAX_ROWS = 100_000
export const TABLE_MAX_COLUMNS = 256
export const TABLE_MAX_CELL_LENGTH = 20_000
export const TABLE_MAX_FILE_BYTES = 50 * 1024 * 1024

function asCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (text.length > TABLE_MAX_CELL_LENGTH) throw new Error(`单元格内容不能超过 ${TABLE_MAX_CELL_LENGTH} 个字符`)
  return text
}

function uniqueHeaders(values) {
  const used = new Map()
  return values.map((value, index) => {
    const base = asCell(value).trim() || `列 ${index + 1}`
    const count = (used.get(base) || 0) + 1
    used.set(base, count)
    return count === 1 ? base : `${base} (${count})`
  })
}

function assertDimensions(headers, rows) {
  if (headers.length > TABLE_MAX_COLUMNS) throw new Error(`列数不能超过 ${TABLE_MAX_COLUMNS}`)
  if (rows.length > TABLE_MAX_ROWS) throw new Error(`行数不能超过 ${TABLE_MAX_ROWS}`)
}

export function normalizeTable(table) {
  const source = table && typeof table === 'object' ? table : {}
  const sourceHeaders = Array.isArray(source.headers) ? source.headers : []
  const sourceRows = Array.isArray(source.rows) ? source.rows : []
  const width = Math.max(sourceHeaders.length, ...sourceRows.map((row) => Array.isArray(row) ? row.length : 0), 0)
  const headers = uniqueHeaders(Array.from({ length: width }, (_, index) => sourceHeaders[index] ?? `列 ${index + 1}`))
  const rows = sourceRows.map((row) => Array.from({ length: width }, (_, index) => asCell(Array.isArray(row) ? row[index] : '')))
  assertDimensions(headers, rows)
  return { headers, rows }
}

export function tableFromMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) return { headers: [], rows: [] }
  if (matrix.length > TABLE_MAX_ROWS + 1) throw new Error(`行数不能超过 ${TABLE_MAX_ROWS}`)
  const width = Math.max(...matrix.map((row) => Array.isArray(row) ? row.length : 0), 0)
  if (!width) return { headers: [], rows: [] }
  return normalizeTable({
    headers: matrix[0],
    rows: matrix.slice(1),
  })
}

export function tableToMatrix(table) {
  const normalized = normalizeTable(table)
  return [normalized.headers, ...normalized.rows]
}

function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/, 1)[0]
  const candidates = [',', '\t', ';']
  return candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
}

export function parseDelimited(text, delimiter = null) {
  const source = String(text || '').replace(/^\uFEFF/, '')
  const separator = delimiter || detectDelimiter(source)
  const matrix = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (quoted) {
      if (character === '"' && next === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        value += character
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true
    } else if (character === separator) {
      row.push(value)
      value = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && next === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell !== '') || matrix.length) matrix.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
    if (value.length > TABLE_MAX_CELL_LENGTH) throw new Error(`单元格内容不能超过 ${TABLE_MAX_CELL_LENGTH} 个字符`)
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  if (value.length || row.length) {
    row.push(value)
    matrix.push(row)
  }
  return tableFromMatrix(matrix)
}

export function parseCsv(text) {
  return parseDelimited(text)
}

function objectRowsToTable(rows) {
  const headers = []
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!headers.includes(key)) headers.push(key)
    })
  })
  return normalizeTable({
    headers,
    rows: rows.map((row) => headers.map((header) => row?.[header] ?? '')),
  })
}

export function parseJsonTable(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text || '').replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('JSON 格式无效')
  }
  if (Array.isArray(parsed)) {
    if (!parsed.length) return { headers: [], rows: [] }
    if (parsed.every((row) => Array.isArray(row))) return tableFromMatrix(parsed)
    if (parsed.every((row) => row && typeof row === 'object' && !Array.isArray(row))) return objectRowsToTable(parsed)
  }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.headers) && Array.isArray(parsed.rows)) {
    return normalizeTable(parsed)
  }
  throw new Error('JSON 必须是对象数组、二维数组或 { headers, rows }')
}

function quoteCsv(value) {
  const text = asCell(value)
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function serializeCsv(table) {
  return tableToMatrix(table).map((row) => row.map(quoteCsv).join(',')).join('\r\n') + '\r\n'
}

export function serializeJson(table) {
  const normalized = normalizeTable(table)
  return JSON.stringify(normalized.rows.map((row) => Object.fromEntries(normalized.headers.map((header, index) => [header, row[index] ?? '']))), null, 2)
}

export function mergeTables(tables) {
  const normalized = (Array.isArray(tables) ? tables : []).map(normalizeTable).filter((table) => table.headers.length)
  if (!normalized.length) return { headers: [], rows: [] }
  const headers = []
  normalized.forEach((table) => table.headers.forEach((header) => {
    if (!headers.includes(header)) headers.push(header)
  }))
  const rows = normalized.flatMap((table) => table.rows.map((row) => {
    const values = new Map(table.headers.map((header, index) => [header, row[index] ?? '']))
    return headers.map((header) => values.get(header) ?? '')
  }))
  return normalizeTable({ headers, rows })
}

export function dedupeTable(table, columns = []) {
  const normalized = normalizeTable(table)
  const selected = (Array.isArray(columns) ? columns : [columns]).map((column) => {
    if (Number.isInteger(column)) return column
    return normalized.headers.indexOf(String(column))
  }).filter((index) => index >= 0 && index < normalized.headers.length)
  const indexes = selected.length ? [...new Set(selected)] : normalized.headers.map((_, index) => index)
  const seen = new Set()
  const rows = normalized.rows.filter((row) => {
    const key = JSON.stringify(indexes.map((index) => row[index] ?? ''))
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return normalizeTable({ headers: normalized.headers, rows })
}

function safeGroupName(value, index) {
  const text = String(value || '空值').trim() || '空值'
  return text.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 80) || `分组-${index + 1}`
}

export function splitTableByColumn(table, column) {
  const normalized = normalizeTable(table)
  const index = Number.isInteger(column) ? column : normalized.headers.indexOf(String(column))
  if (index < 0 || index >= normalized.headers.length) throw new Error('请选择有效的拆分列')
  const groups = new Map()
  normalized.rows.forEach((row) => {
    const key = String(row[index] ?? '').trim() || '空值'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  })
  return [...groups.entries()].map(([key, rows], index) => ({
    key,
    filename: `${safeGroupName(key, index)}.csv`,
    table: normalizeTable({ headers: normalized.headers, rows }),
  }))
}

export function transposeTable(table) {
  const matrix = tableToMatrix(table)
  const width = Math.max(...matrix.map((row) => row.length), 0)
  const transposed = Array.from({ length: width }, (_, column) => matrix.map((row) => row[column] ?? ''))
  return tableFromMatrix(transposed)
}

export function detectTableFormat(name) {
  const extension = String(name || '').toLowerCase().split('.').pop()
  if (extension === 'json') return 'json'
  if (extension === 'xlsx') return 'xlsx'
  if (extension === 'tsv') return 'tsv'
  if (extension === 'xls') return 'xls'
  return 'csv'
}

function xmlEscape(value) {
  return String(value).replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]))
}

function columnName(index) {
  let value = index + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function cellIndex(reference) {
  const match = String(reference || '').match(/^([A-Z]+)/i)
  if (!match) return 0
  return match[1].toUpperCase().split('').reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1
}

function textFromXml(node) {
  return Array.from(node?.getElementsByTagName?.('t') || []).map((item) => item.textContent || '').join('')
}

function parseXml(source, label) {
  if (typeof DOMParser === 'undefined') throw new Error(`${label} 需要浏览器 XML 解析能力`)
  const document = new DOMParser().parseFromString(source, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error(`${label} XML 无法解析`)
  return document
}

async function loadZip() {
  const module = await import('jszip')
  return module.default || module
}

async function readZipText(zip, name) {
  const file = zip.file(name)
  return file ? file.async('string') : ''
}

export async function readXlsxTable(file) {
  const JSZip = await loadZip()
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const sharedStrings = []
  const sharedXml = await readZipText(zip, 'xl/sharedStrings.xml')
  if (sharedXml) {
    const document = parseXml(sharedXml, 'sharedStrings')
    Array.from(document.getElementsByTagName('si')).forEach((item) => sharedStrings.push(textFromXml(item)))
  }
  const workbookXml = await readZipText(zip, 'xl/workbook.xml')
  const relsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels')
  if (!workbookXml || !relsXml) throw new Error('XLSX 缺少工作簿信息')
  const workbook = parseXml(workbookXml, 'workbook')
  const rels = parseXml(relsXml, 'workbook relationships')
  const sheet = workbook.getElementsByTagName('sheet')[0]
  if (!sheet) throw new Error('XLSX 没有可读取的工作表')
  const relationId = sheet.getAttribute('r:id') || sheet.getAttribute('id')
  const relation = Array.from(rels.getElementsByTagName('Relationship')).find((item) => item.getAttribute('Id') === relationId)
  const target = relation?.getAttribute('Target') || 'worksheets/sheet1.xml'
  const sheetPath = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`
  const sheetXml = await readZipText(zip, sheetPath)
  if (!sheetXml) throw new Error('XLSX 工作表内容缺失')
  const document = parseXml(sheetXml, 'worksheet')
  const matrix = []
  Array.from(document.getElementsByTagName('row')).forEach((rowNode) => {
    const row = []
    Array.from(rowNode.getElementsByTagName('c')).forEach((cell) => {
      const index = cellIndex(cell.getAttribute('r'))
      const type = cell.getAttribute('t')
      const valueNode = cell.getElementsByTagName('v')[0]
      let value = valueNode?.textContent || ''
      if (type === 'inlineStr') value = textFromXml(cell.getElementsByTagName('is')[0])
      else if (type === 's') value = sharedStrings[Number(value)] || ''
      else if (type === 'b') value = value === '1' ? 'TRUE' : 'FALSE'
      row[index] = value
    })
    matrix.push(row)
  })
  return tableFromMatrix(matrix)
}

export async function readTableFile(file) {
  if (!file || Number(file.size) > TABLE_MAX_FILE_BYTES) throw new Error('单个表格文件不能超过 50 MB')
  const format = detectTableFormat(file?.name)
  if (format === 'xlsx') return { format, table: await readXlsxTable(file) }
  if (format === 'xls') throw new Error('旧版 XLS 暂不支持，请另存为 XLSX 或 CSV')
  const text = await file.text()
  return { format, table: format === 'json' ? parseJsonTable(text) : parseDelimited(text, format === 'tsv' ? '\t' : null) }
}

export function createTableBlob(table, format = 'csv') {
  const normalized = normalizeTable(table)
  const type = String(format || 'csv').toLowerCase()
  if (type === 'json') return { blob: new Blob([serializeJson(normalized)], { type: 'application/json;charset=utf-8' }), extension: 'json', mime: 'application/json' }
  return { blob: new Blob([`\uFEFF${serializeCsv(normalized)}`], { type: 'text/csv;charset=utf-8' }), extension: 'csv', mime: 'text/csv' }
}

export async function createXlsxBlob(table) {
  const normalized = normalizeTable(table)
  const JSZip = await loadZip()
  const zip = new JSZip()
  const rows = tableToMatrix(normalized)
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`).join('')}</row>`).join('')
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`)
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), extension: 'xlsx', mime: XLSX_MIME }
}

export async function createSplitZip(groups, format = 'csv') {
  const JSZip = await loadZip()
  const zip = new JSZip()
  for (const group of groups || []) {
    if (format === 'xlsx') {
      const output = await createXlsxBlob(group.table)
      zip.file(group.filename.replace(/\.csv$/i, '.xlsx'), await output.blob.arrayBuffer())
      continue
    }
    const output = format === 'json' ? serializeJson(group.table) : serializeCsv(group.table)
    zip.file(group.filename.replace(/\.csv$/i, format === 'json' ? '.json' : '.csv'), `\uFEFF${output}`)
  }
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), filename: `table-split-${Date.now()}.zip` }
}
