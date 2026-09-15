export const ONLINE_CONSENT_SCHEMA_VERSION = 2
export const ONLINE_CONSENT_POLICY_VERSION = 'fr-g06-v1'

export const consentScopes = Object.freeze({
  exchange: '汇率服务',
  ip: '公网 IP 服务',
  speed: '测速服务',
  ocr: 'OCR 模型下载',
  ping: 'Ping 检测',
  port: '端口检测',
  'relay-test': '中转站连接测试',
  relay: '中转站 AI 内容发送',
  translation: '翻译助手内容发送',
})

const disclosureDefaults = Object.freeze({
  exchange: Object.freeze({
    provider: 'Frankfurter（ECB 参考汇率）',
    providerKey: 'https://api.frankfurter.dev/v1',
    data: '换算金额、源币种和目标币种',
    purpose: '获取带日期的 ECB 参考汇率并完成换算',
  }),
  ip: Object.freeze({
    provider: 'ipify',
    providerKey: 'https://api64.ipify.org',
    data: '网络请求元数据；服务方会自动看到当前公网 IP',
    purpose: '查询并显示当前公网 IP 地址',
  }),
  speed: Object.freeze({
    provider: 'Cloudflare Speed',
    providerKey: 'https://speed.cloudflare.com',
    data: '约 2 MB 测试流量和网络请求元数据',
    purpose: '测量本次下载链路的即时速率',
  }),
  ocr: Object.freeze({
    provider: 'jsDelivr（Tesseract.js 语言模型 CDN）',
    providerKey: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data',
    data: '所选语言代码和语言模型下载请求；待识别图片不会发送',
    purpose: '首次下载并缓存 OCR 语言模型，识别过程仍在本机完成',
  }),
  ping: Object.freeze({
    provider: '用户指定目标',
    providerKey: '',
    data: '一次 ICMP 连通性探测和目标主机名',
    purpose: '检测指定目标是否可达及响应耗时',
  }),
  port: Object.freeze({
    provider: '用户指定目标',
    providerKey: '',
    data: '一次 TCP 连接探测、目标主机名和端口',
    purpose: '检测指定端口是否可建立连接',
  }),
  'relay-test': Object.freeze({
    provider: '已配置中转站',
    providerKey: '',
    data: 'API Key、Base URL 和模型列表查询请求；不发送文档或输入正文',
    purpose: '验证连接并读取可用模型列表',
  }),
  relay: Object.freeze({
    provider: '已配置中转站',
    providerKey: '',
    data: 'API Key、模型名、固定系统提示、你输入的文本及生成参数',
    purpose: '调用已配置的 AI 模型处理你主动提交的文本',
  }),
  translation: Object.freeze({
    provider: '已配置中转站',
    providerKey: '',
    data: 'API Key、模型名、源语言、目标语言、翻译风格和你输入的文本',
    purpose: '调用已配置的 AI 模型生成翻译结果',
  }),
})

const defaultCancel = '可在任务中心取消；也可在设置中撤回授权，撤回会中止当前任务并阻止后续请求。'

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function boundedText(value, fallback = '', maximum = 500) {
  const normalized = String(value ?? '').trim()
  return (normalized || fallback).slice(0, maximum)
}

function normalizedGrantedAt(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function createConsentDisclosure(scope, overrides = {}) {
  if (!Object.hasOwn(consentScopes, scope)) return null
  const defaults = disclosureDefaults[scope]
  const provider = boundedText(overrides.provider, defaults.provider, 240)
  const providerKey = boundedText(overrides.providerKey, defaults.providerKey, 500)
  if (!providerKey) return null
  return {
    scope,
    label: consentScopes[scope],
    provider,
    providerKey,
    data: boundedText(overrides.data, defaults.data),
    purpose: boundedText(overrides.purpose, defaults.purpose),
    cancel: boundedText(overrides.cancel, defaultCancel),
    policyVersion: ONLINE_CONSENT_POLICY_VERSION,
  }
}

function normalizeDisclosure(value) {
  if (typeof value === 'string') return createConsentDisclosure(value)
  const source = plainObject(value)
  return source ? createConsentDisclosure(source.scope, source) : null
}

export function normalizeConsent(value) {
  const normalized = { schemaVersion: ONLINE_CONSENT_SCHEMA_VERSION, grants: {} }
  const source = plainObject(value)
  if (source?.schemaVersion !== ONLINE_CONSENT_SCHEMA_VERSION) return normalized
  const grants = plainObject(source.grants)
  if (!grants) return normalized

  Object.keys(consentScopes).forEach((scope) => {
    const grant = plainObject(grants[scope])
    const providerKey = boundedText(grant?.providerKey, '', 500)
    const grantedAt = normalizedGrantedAt(grant?.grantedAt)
    if (!providerKey || !grantedAt || grant?.policyVersion !== ONLINE_CONSENT_POLICY_VERSION) return
    normalized.grants[scope] = {
      providerKey,
      policyVersion: ONLINE_CONSENT_POLICY_VERSION,
      grantedAt,
    }
  })
  return normalized
}

export function grantConsent(value, disclosure, grantedAt = new Date()) {
  const normalized = normalizeConsent(value)
  const requested = normalizeDisclosure(disclosure)
  const timestamp = normalizedGrantedAt(grantedAt)
  if (!requested || !timestamp) return normalized
  normalized.grants[requested.scope] = {
    providerKey: requested.providerKey,
    policyVersion: ONLINE_CONSENT_POLICY_VERSION,
    grantedAt: timestamp,
  }
  return normalized
}

export function isConsentGranted(value, disclosure) {
  const requested = normalizeDisclosure(disclosure)
  if (!requested) return false
  const grant = normalizeConsent(value).grants[requested.scope]
  return Boolean(grant
    && grant.providerKey === requested.providerKey
    && grant.policyVersion === requested.policyVersion)
}

export function revokeConsent(value, scope) {
  const normalized = normalizeConsent(value)
  delete normalized.grants[scope]
  return normalized
}

export function revokeAllConsent() {
  return normalizeConsent()
}

export function consentedScopes(value) {
  const grants = normalizeConsent(value).grants
  return Object.entries(consentScopes)
    .filter(([scope]) => Boolean(grants[scope]))
    .map(([, label]) => label)
}

function isOffline(online) {
  return (typeof online === 'function' ? online() : online) === false
}

export async function authorizeOnlineAction({
  disclosure,
  getConsent,
  requestConsent,
  action,
  online = true,
  allowOffline = false,
}) {
  const requested = normalizeDisclosure(disclosure)
  if (!requested || typeof getConsent !== 'function' || typeof action !== 'function') {
    return { started: false, reason: 'invalid' }
  }
  if (!allowOffline && isOffline(online)) return { started: false, reason: 'offline' }

  if (!isConsentGranted(getConsent(), requested)) {
    if (typeof requestConsent !== 'function' || !await requestConsent(requested)) {
      return { started: false, reason: 'denied' }
    }
  }

  // Re-check immediately before execution so a concurrent revocation cannot race the request.
  if (!isConsentGranted(getConsent(), requested)) return { started: false, reason: 'revoked' }
  if (!allowOffline && isOffline(online)) return { started: false, reason: 'offline' }
  return { started: true, reason: 'authorized', value: await action() }
}
