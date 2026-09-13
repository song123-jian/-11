const MAX_EXPRESSION_LENGTH = 200
const MAX_TOKEN_COUNT = 100
const MAX_PARENTHESIS_DEPTH = 20
const MAX_ABSOLUTE_VALUE = 1_000_000_000_000
const MAX_CURRENCY_CENTS = 99_999_999_999_999

const UPPERCASE_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const SMALL_UNITS = ['', '拾', '佰', '仟']
const GROUP_UNITS = ['', '万', '亿', '兆']

function normalizeExpression(expression) {
  const source = String(expression ?? '')
    .trim()
    .replace(/[−－]/g, '-')
    .replace(/[＋]/g, '+')
    .replace(/[×✕]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
  if (!source) throw new Error('请输入计算表达式')
  if (source.length > MAX_EXPRESSION_LENGTH) throw new Error(`表达式不能超过 ${MAX_EXPRESSION_LENGTH} 个字符`)
  return source
}

function tokenize(expression) {
  const tokens = []
  let index = 0
  while (index < expression.length) {
    const character = expression[index]
    if (/\s/.test(character)) {
      index += 1
      continue
    }
    if (/[0-9.]/.test(character)) {
      const start = index
      let dotCount = 0
      while (index < expression.length && /[0-9.]/.test(expression[index])) {
        if (expression[index] === '.') dotCount += 1
        index += 1
      }
      const literal = expression.slice(start, index)
      if (literal === '.' || dotCount > 1 || !Number.isFinite(Number(literal))) throw new Error('数字格式无效')
      tokens.push({ type: 'number', value: Number(literal) })
    } else if ('+-*/()'.includes(character)) {
      tokens.push({ type: 'symbol', value: character })
      index += 1
    } else {
      throw new Error('表达式仅支持数字、括号和四则运算符')
    }
    if (tokens.length > MAX_TOKEN_COUNT) throw new Error('表达式过于复杂')
  }
  if (!tokens.length) throw new Error('请输入计算表达式')
  return tokens
}

function ensureCalculationRange(value) {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_VALUE) throw new Error('计算结果超出范围')
  return value
}

class ExpressionParser {
  constructor(tokens) {
    this.tokens = tokens
    this.index = 0
    this.depth = 0
  }

  current() {
    return this.tokens[this.index]
  }

  consume(value) {
    if (this.current()?.value !== value) return false
    this.index += 1
    return true
  }

  parse() {
    const result = this.parseAddSub()
    if (this.current()) throw new Error('表达式格式无效')
    return ensureCalculationRange(result)
  }

  parseAddSub() {
    let result = this.parseMulDiv()
    while (this.current()?.value === '+' || this.current()?.value === '-') {
      const operator = this.current().value
      this.index += 1
      const right = this.parseMulDiv()
      result = ensureCalculationRange(operator === '+' ? result + right : result - right)
    }
    return result
  }

  parseMulDiv() {
    let result = this.parseUnary()
    while (this.current()?.value === '*' || this.current()?.value === '/') {
      const operator = this.current().value
      this.index += 1
      const right = this.parseUnary()
      if (operator === '/' && right === 0) throw new Error('不能除以 0')
      result = ensureCalculationRange(operator === '*' ? result * right : result / right)
    }
    return result
  }

  parseUnary() {
    if (this.consume('+')) return this.parseUnary()
    if (this.consume('-')) return ensureCalculationRange(-this.parseUnary())
    return this.parsePrimary()
  }

  parsePrimary() {
    const token = this.current()
    if (token?.type === 'number') {
      this.index += 1
      return token.value
    }
    if (this.consume('(')) {
      this.depth += 1
      if (this.depth > MAX_PARENTHESIS_DEPTH) throw new Error('括号嵌套层数过多')
      const result = this.parseAddSub()
      if (!this.consume(')')) throw new Error('括号不匹配')
      this.depth -= 1
      return result
    }
    throw new Error('表达式格式无效')
  }
}

export function calculateExpression(expression) {
  const source = normalizeExpression(expression)
  const result = new ExpressionParser(tokenize(source)).parse()
  return Number(result.toFixed(12))
}

function currencyCents(value) {
  if (!Number.isFinite(Number(value))) throw new Error('金额必须是有效数字')
  const numeric = Number(value)
  const cents = Math.round((Math.abs(numeric) + Number.EPSILON) * 100)
  if (cents > MAX_CURRENCY_CENTS) throw new Error('金额不能超过 999,999,999,999.99 元')
  return { cents, negative: numeric < 0 }
}

export function formatLowercaseAmount(value) {
  const { cents, negative } = currencyCents(value)
  const amount = (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${negative ? '-' : ''}${amount}`
}

function convertGroup(group) {
  let result = ''
  let zeroPending = false
  for (let position = 3; position >= 0; position -= 1) {
    const digit = Math.floor(group / (10 ** position)) % 10
    if (digit === 0) {
      if (result) zeroPending = true
      continue
    }
    if (zeroPending) result += '零'
    zeroPending = false
    result += UPPERCASE_DIGITS[digit] + SMALL_UNITS[position]
  }
  return result
}

function convertInteger(value) {
  if (value === 0) return '零'
  const groups = []
  let remaining = value
  while (remaining > 0) {
    groups.unshift(remaining % 10_000)
    remaining = Math.floor(remaining / 10_000)
  }

  let result = ''
  let zeroBetween = false
  groups.forEach((group, index) => {
    const groupUnit = GROUP_UNITS[groups.length - 1 - index]
    if (group === 0) {
      if (result) zeroBetween = true
      return
    }
    if (result && (zeroBetween || group < 1_000)) result += '零'
    result += convertGroup(group) + groupUnit
    zeroBetween = false
  })
  return result
}

export function formatChineseCurrency(value) {
  const { cents, negative } = currencyCents(value)
  const yuan = Math.floor(cents / 100)
  const jiao = Math.floor(cents / 10) % 10
  const fen = cents % 10
  let fraction = ''
  if (jiao === 0 && fen === 0) {
    fraction = '整'
  } else {
    if (jiao > 0) fraction += `${UPPERCASE_DIGITS[jiao]}角`
    if (fen > 0) {
      if (jiao === 0 && yuan > 0) fraction += '零'
      fraction += `${UPPERCASE_DIGITS[fen]}分`
    }
  }
  return `${negative ? '负' : ''}人民币${convertInteger(yuan)}元${fraction}`
}

export function buildCalculatorResult(value) {
  return {
    value,
    lowercase: formatLowercaseAmount(value),
    uppercase: formatChineseCurrency(value),
  }
}
