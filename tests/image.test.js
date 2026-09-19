import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_IMAGE_OPERATIONS,
  getLocalAiRuntime,
  normalizeAiOptions,
  replaceConnectedBackground,
  runLocalAiImage,
} from '../src/services/imageAiTools.js'
import {
  ID_PHOTO_SPECS,
  getIdPhotoBackgroundColor,
  getIdPhotoSpec,
  normalizeCustomIdPhotoSpec,
  normalizeIdPhotoSpec,
} from '../src/services/idPhotoSpecs.js'
import { calculateCoverCrop, normalizeIdPhotoRenderOptions, renderIdPhoto } from '../src/services/idPhotoTools.js'
import {
  clampEditorPoint,
  fitEditorDimensions,
  normalizeEditorRect,
  wrapCanvasText,
} from '../src/services/imageEditorTools.js'
import {
  calculateImageMeasurement,
  formatAspectRatio,
  formatMeasurementValue,
  normalizeMeasurementDpi,
} from '../src/services/imageMeasureTools.js'

test('ID photo reference data exposes common sizes and bounded custom sizes', () => {
  assert.equal(ID_PHOTO_SPECS.length >= 5, true)
  assert.deepEqual(getIdPhotoSpec('one-inch'), {
    id: 'one-inch',
    label: '一寸',
    widthMm: 25,
    heightMm: 35,
    widthPx: 295,
    heightPx: 413,
    backgroundColors: ['white', 'blue', 'red'],
    usage: '常见证件与档案照片',
  })
  assert.equal(normalizeIdPhotoSpec('missing').id, 'one-inch')
  assert.equal(getIdPhotoBackgroundColor('#438edb'), '#438edb')
  assert.equal(getIdPhotoBackgroundColor('bad-value'), '#ffffff')
  const custom = normalizeCustomIdPhotoSpec({ widthPx: 600, heightPx: 800, label: '报名照' })
  assert.deepEqual([custom.id, custom.widthPx, custom.heightPx, custom.label], ['custom', 600, 800, '报名照'])
  assert.throws(() => normalizeCustomIdPhotoSpec({ widthPx: 20, heightPx: 800 }), /64-4000/)
})

test('ID photo crop keeps target aspect ratio and focal point bounded', () => {
  const crop = calculateCoverCrop(1200, 800, 295, 413, 2, -1)
  assert.equal(crop.sw / crop.sh, 295 / 413)
  assert.equal(crop.sx, 1200 - crop.sw)
  assert.equal(crop.sy, 0)
  const options = normalizeIdPhotoRenderOptions({ spec: 'two-inch', backgroundColor: '#d93025', focalX: 9, focalY: -3, quality: 0.1 })
  assert.equal(options.spec.id, 'two-inch')
  assert.equal(options.backgroundColor, '#d93025')
  assert.equal(options.focalX, 1)
  assert.equal(options.focalY, 0)
  assert.equal(options.quality, 0.5)
})

test('ID photo rendering rejects missing input with a user-facing validation error', async () => {
  await assert.rejects(() => renderIdPhoto(null), /请选择 JPG、PNG、WebP/)
})

test('local AI runtime and options fail closed without a browser canvas', () => {
  const runtime = getLocalAiRuntime()
  assert.equal(runtime.available, false)
  assert.equal(runtime.mode, 'local-heuristic')
  assert.deepEqual(normalizeAiOptions({ strength: -2, threshold: 999, maxEdge: 99, backgroundColor: '#ffffff' }), {
    strength: 0,
    threshold: 120,
    maxEdge: 512,
    backgroundColor: '#ffffff',
  })
  return assert.rejects(() => runLocalAiImage(null, AI_IMAGE_OPERATIONS.enhance), /请选择/)
})

test('local background replacement only changes edge-connected pixels', () => {
  const pixels = new Uint8ClampedArray([
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  ])
  // Keep a dark center pixel isolated from the edge background.
  pixels[(4 * 4) + 0] = 12
  pixels[(4 * 4) + 1] = 12
  pixels[(4 * 4) + 2] = 12
  const result = replaceConnectedBackground({ data: pixels, width: 3, height: 3 }, { threshold: 30, replacementColor: '#438edb' })
  assert.equal(result.removedPixels, 8)
  assert.deepEqual(Array.from(pixels.slice(0, 3)), [67, 142, 219])
  assert.deepEqual(Array.from(pixels.slice(16, 19)), [12, 12, 12])
})

test('image editor geometry clamps points, selections, and large images', () => {
  assert.deepEqual(clampEditorPoint({ x: -4, y: 80 }, 60, 50), { x: 0, y: 49 })
  assert.deepEqual(normalizeEditorRect({ x: 45, y: 40 }, { x: 5, y: 4 }, 60, 50), { x: 5, y: 4, width: 40, height: 36 })
  assert.deepEqual(fitEditorDimensions(4800, 2400, 1600), { width: 1600, height: 800, scale: 1 / 3 })
  const context = { measureText: (value) => ({ width: value.length * 10 }) }
  assert.deepEqual(wrapCanvasText(context, '一二三四五', 25), ['一二', '三四', '五'])
})

test('image measurement validates DPI and converts pixels to physical units', () => {
  assert.equal(normalizeMeasurementDpi(300), 300)
  assert.throws(() => normalizeMeasurementDpi(0), /1-2400/)
  assert.throws(() => normalizeMeasurementDpi(2401), /1-2400/)
  assert.equal(formatAspectRatio(600, 400), '3:2')
  assert.throws(() => formatAspectRatio(0, 400), /图片宽度必须是大于 0/)

  const measurement = calculateImageMeasurement({ width: 600, height: 400, fileSize: 1536, dpi: 300, unit: 'mm' })
  assert.equal(measurement.widthPx, 600)
  assert.equal(measurement.heightPx, 400)
  assert.equal(measurement.aspectRatio, '3:2')
  assert.equal(measurement.fileSizeBytes, 1536)
  assert.equal(measurement.fileSizeKb, 1.5)
  assert.equal(Number(measurement.physicalWidth.toFixed(2)), 50.8)
  assert.equal(Number(measurement.physicalHeight.toFixed(2)), 33.87)

  const inches = calculateImageMeasurement({ width: 300, height: 150, dpi: 300, unit: 'in' })
  assert.equal(inches.physicalWidth, 1)
  assert.equal(inches.physicalHeight, 0.5)
  const centimeters = calculateImageMeasurement({ width: 300, height: 150, dpi: 300, unit: 'cm' })
  assert.equal(centimeters.physicalWidth, 2.54)
  assert.equal(centimeters.physicalHeight, 1.27)
  assert.equal(formatMeasurementValue(1234.567, 1), '1,234.6')
})
