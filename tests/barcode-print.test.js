import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateEan13CheckDigit,
  normalizeBarcodeOptions,
  normalizeBarcodeValue,
} from '../src/services/barcodeTools.js'
import {
  DEFAULT_PRINT_SETTINGS,
  PAPER_SIZES,
  buildPrintPageStyle,
  loadPrintSettings,
  normalizePrintSettings,
  parsePrintPageRange,
  resolvePrintPages,
  savePrintSettings,
} from '../src/services/printSettings.js'

test('barcode validation normalizes EAN-13 and rejects unsafe input', () => {
  assert.equal(calculateEan13CheckDigit('400638133393'), 1)
  assert.deepEqual(normalizeBarcodeValue('4006 3813 3393', 'ean13'), {
    format: 'ean13',
    value: '4006381333931',
    autoCheckDigit: true,
  })
  assert.deepEqual(normalizeBarcodeValue('4006381333931', 'ean13').value, '4006381333931')
  assert.throws(() => normalizeBarcodeValue('4006381333932', 'ean13'), /校验位错误/)
  assert.throws(() => normalizeBarcodeValue('中文编号', 'code128'), /可打印 ASCII/)
})

test('barcode rendering options stay within bounded output limits', () => {
  assert.deepEqual(normalizeBarcodeOptions({ width: 20, height: 1, margin: -4, displayValue: false, lineColor: '#abc', background: '#ffffff' }), {
    width: 4,
    height: 30,
    margin: 0,
    displayValue: false,
    lineColor: '#17324d',
    background: '#ffffff',
  })
})

test('print settings keep stable defaults and exact paper CSS dimensions', () => {
  const normalized = normalizePrintSettings({ paperSize: 'B4_JIS', copies: 0, orientation: 'landscape', customScale: 999 })
  assert.equal(normalized.paperSize, 'B4_JIS')
  assert.equal(normalized.copies, 1)
  assert.equal(normalized.customScale, 400)
  assert.match(buildPrintPageStyle(normalized), /size: 364mm 257mm/)
  assert.equal(DEFAULT_PRINT_SETTINGS.paperSize, 'A4')
})

test('print settings expose the four requested paper sizes', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(PAPER_SIZES).map(([key, paper]) => [key, [paper.widthMm, paper.heightMm]])),
    {
      A4: [210, 297],
      A5: [148, 210],
      B4_JIS: [257, 364],
      B5_JIS: [182, 257],
    },
  )
  assert.match(buildPrintPageStyle({ paperSize: 'A5' }), /size: 148mm 210mm/)
  assert.match(buildPrintPageStyle({ paperSize: 'B5_JIS', orientation: 'landscape' }), /size: 257mm 182mm/)
})

test('print settings load without writing and save only normalized user changes', () => {
  const calls = []
  const loaded = loadPrintSettings((key, fallback) => {
    calls.push(['load', key])
    return { ...fallback, paperSize: 'B5_JIS' }
  })
  assert.deepEqual(calls, [['load', 'print-settings']])
  assert.equal(loaded.paperSize, 'B5_JIS')

  let saved
  assert.equal(savePrintSettings({ paperSize: 'invalid', copies: 0 }, (key, value) => {
    saved = { key, value }
    return true
  }), true)
  assert.equal(saved.key, 'print-settings')
  assert.equal(saved.value.paperSize, 'A4')
  assert.equal(saved.value.copies, 1)
})

test('print page ranges apply custom range, odd/even filtering, and reverse order', () => {
  assert.deepEqual(parsePrintPageRange({ pageRange: 'custom', customRange: '1-2,4' }, 5), [1, 2, 4])
  assert.deepEqual(resolvePrintPages({ pageRange: 'custom', customRange: '1-5', oddEven: 'even', reverse: true }, 5), [4, 2])
  assert.deepEqual(resolvePrintPages({ pageRange: 'current', oddEven: 'all' }, 5, 3), [3])
  assert.throws(() => resolvePrintPages({ pageRange: 'custom', customRange: '1-x' }, 5), /页码范围格式无效/)
})
