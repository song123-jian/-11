function positiveNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}必须大于 0`)
  return number
}

export function calculateBmi(weight, heightCm) {
  const kilograms = positiveNumber(weight, '体重')
  const meters = positiveNumber(heightCm, '身高') / 100
  const bmi = kilograms / (meters * meters)
  const category = bmi < 18.5 ? '偏瘦' : bmi < 24 ? '正常' : bmi < 28 ? '超重' : '肥胖'
  return { bmi, category, rule: '中国成人 BMI 分类参考（WS/T 428-2013）' }
}

export function calculateMortgage({ principal, years, annualRate, method }) {
  const amount = positiveNumber(principal, '贷款本金')
  const months = Math.round(positiveNumber(years, '贷款年限') * 12)
  const monthlyRate = positiveNumber(annualRate, '年利率') / 1200
  if (months > 600) throw new Error('贷款期限不能超过 50 年')
  if (method === 'equal-principal') {
    const monthlyPrincipal = amount / months
    const firstPayment = monthlyPrincipal + amount * monthlyRate
    const lastPayment = monthlyPrincipal + monthlyPrincipal * monthlyRate
    const totalInterest = monthlyRate * amount * (months + 1) / 2
    return { monthlyPayment: firstPayment, firstPayment, lastPayment, totalInterest, totalPayment: amount + totalInterest, months }
  }
  const factor = (1 + monthlyRate) ** months
  const monthlyPayment = amount * monthlyRate * factor / (factor - 1)
  const totalPayment = monthlyPayment * months
  return { monthlyPayment, firstPayment: monthlyPayment, lastPayment: monthlyPayment, totalInterest: totalPayment - amount, totalPayment, months }
}

const annualTaxBrackets = [
  [36_000, 0.03, 0],
  [144_000, 0.1, 2_520],
  [300_000, 0.2, 16_920],
  [420_000, 0.25, 31_920],
  [660_000, 0.3, 52_920],
  [960_000, 0.35, 85_920],
  [Number.POSITIVE_INFINITY, 0.45, 181_920],
]

export function calculateAnnualTax({ annualIncome, annualDeduction }) {
  const income = Math.max(0, Number(annualIncome) || 0)
  const deduction = Math.max(0, Number(annualDeduction) || 0)
  const taxable = Math.max(0, income - 60_000 - deduction)
  const [, rate, quickDeduction] = annualTaxBrackets.find(([limit]) => taxable <= limit)
  const tax = Math.max(0, taxable * rate - quickDeduction)
  return {
    taxable,
    tax,
    afterTax: income - tax,
    rate,
    rule: '中国居民个人综合所得年度税率表，基本减除费用 60,000 元/年（自 2019-01-01）',
  }
}

export async function fetchExchangeRate({ amount, from, to, signal }) {
  const sourceAmount = positiveNumber(amount, '换算金额')
  if (from === to) return { amount: sourceAmount, rate: 1, date: new Date().toISOString().slice(0, 10), provider: '本地等值换算' }
  const endpoint = new URL('https://api.frankfurter.dev/v1/latest')
  endpoint.searchParams.set('base', from)
  endpoint.searchParams.set('symbols', to)
  const response = await fetch(endpoint, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`汇率服务返回 HTTP ${response.status}`)
  const data = await response.json()
  const rate = Number(data.rates?.[to])
  if (!Number.isFinite(rate)) throw new Error('汇率服务未返回有效数据')
  return { amount: sourceAmount * rate, rate, date: data.date, provider: 'Frankfurter / ECB 参考汇率' }
}
