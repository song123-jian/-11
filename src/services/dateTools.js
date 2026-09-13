function parseDateInput(value, label) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(value || ''))
  if (!match) throw new Error(`${label}必须使用 YYYY-MM-DD 格式`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label}不是有效日期`)
  }
  return date
}

function toDateInputValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }
  return String(value || '')
}

export function calculateAge(birthDate, referenceDate = new Date()) {
  const birth = parseDateInput(birthDate, '出生日期')
  const reference = parseDateInput(toDateInputValue(referenceDate), '计算日期')
  if (birth > reference) throw new Error('出生日期不能晚于计算日期')
  let years = reference.getUTCFullYear() - birth.getUTCFullYear()
  const monthDelta = reference.getUTCMonth() - birth.getUTCMonth()
  if (monthDelta < 0 || (monthDelta === 0 && reference.getUTCDate() < birth.getUTCDate())) years -= 1
  return { years, label: `${years} 岁` }
}

export function calculateDateDifference(startDate, endDate) {
  const start = parseDateInput(startDate, '开始日期')
  const end = parseDateInput(endDate, '结束日期')
  const signedDays = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  return {
    days: Math.abs(signedDays),
    signedDays,
    direction: signedDays >= 0 ? '正向' : '倒序',
  }
}
