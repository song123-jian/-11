import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSplitZip,
  dedupeTable,
  mergeTables,
  parseCsv,
  parseJsonTable,
  readTableFile,
  serializeCsv,
  splitTableByColumn,
  transposeTable,
} from '../src/services/tableTools.js'
import { normalizeTargetImageOptions } from '../src/services/imageTools.js'
import { calculatePhotoSheetLayout, normalizePhotoSheetOptions } from '../src/services/photoPrintTools.js'
import { getIdPhotoSpec } from '../src/services/idPhotoSpecs.js'

test('CSV parser and serializer preserve quoted commas, quotes, and line breaks', () => {
  const table = parseCsv('姓名,备注\r\n张三,"含,逗号"\r\n李四,"多行\n文本"\r\n')
  assert.deepEqual(table.headers, ['姓名', '备注'])
  assert.deepEqual(table.rows, [['张三', '含,逗号'], ['李四', '多行\n文本']])
  assert.match(serializeCsv(table), /"含,逗号"/)
  assert.match(serializeCsv(table), /"多行\n文本"/)
})

test('table operations merge, dedupe, split, and transpose predictably', () => {
  const first = { headers: ['客户', '金额'], rows: [['甲', '10'], ['甲', '10'], ['乙', '20']] }
  const second = { headers: ['客户', '日期'], rows: [['丙', '2026-09-15']] }
  assert.deepEqual(mergeTables([first, second]), {
    headers: ['客户', '金额', '日期'],
    rows: [['甲', '10', ''], ['甲', '10', ''], ['乙', '20', ''], ['丙', '', '2026-09-15']],
  })
  assert.deepEqual(dedupeTable(first, ['客户', '金额']).rows, [['甲', '10'], ['乙', '20']])
  const groups = splitTableByColumn(first, '客户')
  assert.deepEqual(groups.map((group) => [group.key, group.table.rows.length]), [['甲', 2], ['乙', 1]])
  assert.deepEqual(transposeTable({ headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] }), {
    headers: ['A', '1', '3'],
    rows: [['B', '2', '4']],
  })
})

test('JSON table input accepts object arrays and keeps union headers', () => {
  assert.deepEqual(parseJsonTable('[{"客户":"甲","金额":10},{"客户":"乙","日期":"今天"}]'), {
    headers: ['客户', '金额', '日期'],
    rows: [['甲', '10', ''], ['乙', '', '今天']],
  })
})

test('split archives honor the selected output format and file-size guard', async () => {
  const groups = splitTableByColumn({ headers: ['组', '值'], rows: [['甲', '1'], ['乙', '2']] }, '组')
  const archive = await createSplitZip(groups, 'xlsx')
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await archive.blob.arrayBuffer())
  assert.deepEqual(Object.keys(zip.files).filter((name) => name.endsWith('.xlsx')).sort(), ['乙.xlsx', '甲.xlsx'].sort())
  await assert.rejects(() => readTableFile({ size: 50 * 1024 * 1024 + 1, name: 'too-large.csv', text: async () => '' }), /50 MB/)
})

test('target image options stay within safe bounds', () => {
  assert.deepEqual(normalizeTargetImageOptions({ targetKb: 512, format: 'image/webp' }), {
    targetKb: 512,
    minQuality: 0.18,
    maxEdge: 2400,
    format: 'image/webp',
  })
  assert.throws(() => normalizeTargetImageOptions({ targetKb: 5 }), /10-20000/)
  assert.throws(() => normalizeTargetImageOptions({ maxEdge: 20 }), /64-8000/)
})

test('photo sheet layout uses paper dimensions and rejects over-capacity requests', () => {
  const layout = calculatePhotoSheetLayout(getIdPhotoSpec('one-inch'), { paperSize: 'A4', copies: 8, marginMm: 10, gapMm: 4, dpi: 150 })
  assert.equal(layout.paperWidthMm, 210)
  assert.equal(layout.paperHeightMm, 297)
  assert.equal(layout.columns, 6)
  assert.equal(layout.rows, 7)
  assert.ok(layout.capacity >= 8)
  assert.equal(normalizePhotoSheetOptions({ paperSize: 'unknown', copies: 0 }).paperSize, 'A4')
  assert.throws(() => calculatePhotoSheetLayout(getIdPhotoSpec('one-inch'), { paperSize: 'A5', copies: 100, marginMm: 10, gapMm: 4 }), /最多排/)
})
