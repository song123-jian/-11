/**
 * Common ID-photo sizes used by the editor. These are reference values, not
 * a substitute for the requirements published by the issuing organisation.
 */
export const ID_PHOTO_SPECS = Object.freeze([
  Object.freeze({
    id: 'small-one-inch',
    label: '小一寸',
    widthMm: 22,
    heightMm: 32,
    widthPx: 260,
    heightPx: 378,
    backgroundColors: ['white', 'blue', 'red'],
    usage: '常见报名、考试照片',
  }),
  Object.freeze({
    id: 'one-inch',
    label: '一寸',
    widthMm: 25,
    heightMm: 35,
    widthPx: 295,
    heightPx: 413,
    backgroundColors: ['white', 'blue', 'red'],
    usage: '常见证件与档案照片',
  }),
  Object.freeze({
    id: 'large-one-inch',
    label: '大一寸',
    widthMm: 33,
    heightMm: 48,
    widthPx: 390,
    heightPx: 567,
    backgroundColors: ['white', 'blue', 'red'],
    usage: '常见资格考试与申请材料',
  }),
  Object.freeze({
    id: 'two-inch',
    label: '二寸',
    widthMm: 35,
    heightMm: 49,
    widthPx: 413,
    heightPx: 579,
    backgroundColors: ['white', 'blue', 'red'],
    usage: '常见简历、档案与申请材料',
  }),
  Object.freeze({
    id: 'passport-visa',
    label: '护照 / 签证常见',
    widthMm: 35,
    heightMm: 45,
    widthPx: 413,
    heightPx: 531,
    backgroundColors: ['white'],
    usage: '不同国家和机构要求可能不同',
  }),
])

export const ID_PHOTO_BACKGROUND_COLORS = Object.freeze([
  Object.freeze({ id: 'white', label: '白底', value: '#ffffff' }),
  Object.freeze({ id: 'blue', label: '蓝底', value: '#438edb' }),
  Object.freeze({ id: 'red', label: '红底', value: '#d93025' }),
])

export const ID_PHOTO_SPEC_SOURCE = '常用证件照尺寸参考（以办证机构最新要求为准）'
export const ID_PHOTO_SPEC_UPDATED_AT = '2026-09-13'

export function getIdPhotoSpec(specId) {
  return ID_PHOTO_SPECS.find((item) => item.id === specId) || ID_PHOTO_SPECS[1]
}

export function normalizeIdPhotoSpec(value) {
  if (value && typeof value === 'object' && Number.isFinite(value.widthPx) && Number.isFinite(value.heightPx)) {
    return {
      ...getIdPhotoSpec(value.id),
      ...value,
      widthPx: Math.max(1, Math.round(Number(value.widthPx))),
      heightPx: Math.max(1, Math.round(Number(value.heightPx))),
    }
  }
  return getIdPhotoSpec(String(value || 'one-inch'))
}

export function getIdPhotoBackgroundColor(value) {
  const candidate = String(value || '').trim().toLowerCase()
  return ID_PHOTO_BACKGROUND_COLORS.find((item) => item.id === candidate || item.value === candidate)?.value || '#ffffff'
}

export function normalizeCustomIdPhotoSpec({ widthPx, heightPx, widthMm = 0, heightMm = 0, label = '自定义规格' } = {}) {
  const normalizedWidth = Number(widthPx)
  const normalizedHeight = Number(heightPx)
  if (!Number.isInteger(normalizedWidth) || normalizedWidth < 64 || normalizedWidth > 4_000) {
    throw new Error('自定义宽度必须是 64-4000 的整数像素')
  }
  if (!Number.isInteger(normalizedHeight) || normalizedHeight < 64 || normalizedHeight > 4_000) {
    throw new Error('自定义高度必须是 64-4000 的整数像素')
  }
  return {
    id: 'custom',
    label: String(label || '自定义规格').trim().slice(0, 40) || '自定义规格',
    widthMm: Number.isFinite(Number(widthMm)) ? Math.max(0, Number(widthMm)) : 0,
    heightMm: Number.isFinite(Number(heightMm)) ? Math.max(0, Number(heightMm)) : 0,
    widthPx: normalizedWidth,
    heightPx: normalizedHeight,
    backgroundColors: ID_PHOTO_BACKGROUND_COLORS.map((item) => item.id),
    usage: '按输入像素生成',
  }
}
