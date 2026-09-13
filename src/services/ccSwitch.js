import { normalizeRelayConfig } from './relayApi.js'

const MAX_DEEPLINK_LENGTH = 64 * 1024
const MAX_CONFIG_LENGTH = 256 * 1024
const CC_SWITCH_APPS = new Set(['claude', 'claude-desktop', 'codex', 'gemini', 'grokbuild', 'opencode', 'openclaw', 'hermes'])

function nonEmpty(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || ''
}

function firstNonEmpty(...values) {
  return values.map(nonEmpty).find(Boolean) || ''
}

function decodeBase64Json(value) {
  const raw = nonEmpty(value)
  if (!raw || raw.length > MAX_CONFIG_LENGTH) return null
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - raw.length % 4) % 4)
    const binary = atob(normalized)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function findStringByKeys(value, keys, depth = 0) {
  if (!value || depth > 8 || typeof value !== 'object') return ''
  const keySet = new Set(keys.map((key) => key.toLowerCase()))
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKeys(item, keys, depth + 1)
      if (found) return found
    }
    return ''
  }
  for (const [key, entry] of Object.entries(value)) {
    if (keySet.has(key.toLowerCase()) && typeof entry === 'string' && nonEmpty(entry)) return entry.trim()
  }
  for (const entry of Object.values(value)) {
    const found = findStringByKeys(entry, keys, depth + 1)
    if (found) return found
  }
  return ''
}

function findTomlValue(value, keys) {
  if (typeof value !== 'string') return ''
  const keySet = new Set(keys.map((key) => key.toLowerCase()))
  for (const line of value.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*(?:#.*)?$/)
    if (!match || !keySet.has(match[1].toLowerCase())) continue
    const raw = match[2].trim()
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return nonEmpty(raw.slice(1, -1))
    }
    return nonEmpty(raw)
  }
  return ''
}

function extractConfigFields(config) {
  const configObject = config && typeof config === 'object' ? config : null
  const toml = findStringByKeys(configObject, ['config'])
  return {
    baseUrl: firstNonEmpty(
      findStringByKeys(configObject, ['ANTHROPIC_BASE_URL', 'GOOGLE_GEMINI_BASE_URL', 'baseUrl', 'base_url', 'baseURL', 'endpoint']),
      findTomlValue(toml, ['base_url', 'baseUrl', 'baseURL', 'endpoint']),
    ),
    model: firstNonEmpty(
      findStringByKeys(configObject, ['ANTHROPIC_MODEL', 'GEMINI_MODEL', 'model', 'defaultModel']),
      findTomlValue(toml, ['model', 'default_model']),
    ),
    apiKey: firstNonEmpty(
      findStringByKeys(configObject, ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'apiKey', 'api_key']),
      findTomlValue(toml, ['api_key', 'apiKey', 'OPENAI_API_KEY']),
    ),
  }
}

function validateImportedBaseUrl(value) {
  const baseUrl = nonEmpty(value)
  if (!baseUrl) return ''
  const normalized = normalizeRelayConfig({ baseUrl }).baseUrl
  const parsed = new URL(normalized)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('CC Switch 链接中的端点必须是安全的 http(s) 地址')
  }
  return normalized
}

export function parseCcSwitchProviderLink(input) {
  const raw = nonEmpty(input)
  if (!raw || raw.length > MAX_DEEPLINK_LENGTH) throw new Error('CC Switch 链接不能为空且不能超过 64 KB')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('CC Switch 链接格式无效')
  }
  if (url.protocol !== 'ccswitch:' || url.hostname !== 'v1' || url.pathname !== '/import') {
    throw new Error('仅支持 ccswitch://v1/import 供应商链接')
  }
  const params = url.searchParams
  if (params.get('resource') !== 'provider') throw new Error('CC Switch 链接不是供应商资源')
  const app = firstNonEmpty(params.get('app'), 'codex').toLowerCase()
  if (!CC_SWITCH_APPS.has(app)) throw new Error('CC Switch 链接包含不支持的应用类型')
  const config = decodeBase64Json(params.get('config'))
  const configFields = extractConfigFields(config)
  const endpoint = firstNonEmpty(params.get('endpoint'), params.get('baseUrl'), configFields.baseUrl).split(',')[0]
  const apiKey = firstNonEmpty(params.get('apiKey'), params.get('api_key'), configFields.apiKey)
  const model = firstNonEmpty(params.get('model'), configFields.model)
  const baseUrl = validateImportedBaseUrl(endpoint)
  if (!baseUrl) throw new Error('CC Switch 链接缺少 endpoint')
  if (!apiKey) throw new Error('CC Switch 链接缺少 API Key')
  if (apiKey.length > 512) throw new Error('CC Switch API Key 不能超过 512 个字符')
  if (model.length > 200) throw new Error('CC Switch 模型名不能超过 200 个字符')
  return {
    app,
    name: firstNonEmpty(params.get('name'), 'CC Switch 供应商'),
    homepage: nonEmpty(params.get('homepage')),
    baseUrl,
    model,
    apiKey,
    enabled: params.get('enabled') === 'true',
  }
}

export function buildCcSwitchProviderLink(value = {}) {
  const baseUrl = validateImportedBaseUrl(value.baseUrl)
  const model = nonEmpty(value.model)
  const apiKey = nonEmpty(value.apiKey)
  const app = firstNonEmpty(value.app, 'codex').toLowerCase()
  if (!baseUrl) throw new Error('请先填写中转站 Base URL')
  if (!apiKey) throw new Error('请先填写中转站 API Key')
  if (!model) throw new Error('请先填写中转站模型名')
  if (model.length > 200) throw new Error('中转站模型名不能超过 200 个字符')
  if (apiKey.length > 512) throw new Error('中转站 API Key 不能超过 512 个字符')
  if (!CC_SWITCH_APPS.has(app)) throw new Error('CC Switch 应用类型不受支持')
  const url = new URL('ccswitch://v1/import')
  url.searchParams.set('resource', 'provider')
  url.searchParams.set('app', app)
  url.searchParams.set('name', firstNonEmpty(value.name, '效率百宝箱中转站'))
  url.searchParams.set('endpoint', baseUrl)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('model', model)
  if (nonEmpty(value.homepage)) url.searchParams.set('homepage', nonEmpty(value.homepage))
  url.searchParams.set('enabled', 'false')
  return url.toString()
}

export function ccSwitchProviderJson(value = {}) {
  const baseUrl = validateImportedBaseUrl(value.baseUrl)
  const model = nonEmpty(value.model)
  const apiKey = nonEmpty(value.apiKey)
  if (!baseUrl || !model || !apiKey) throw new Error('导出 CC Switch 配置前请补全 Base URL、模型名和 API Key')
  return JSON.stringify({
    version: 'v1',
    resource: 'provider',
    app: firstNonEmpty(value.app, 'codex'),
    name: firstNonEmpty(value.name, '效率百宝箱中转站'),
    endpoint: baseUrl,
    apiKey,
    model,
    homepage: nonEmpty(value.homepage) || undefined,
    enabled: false,
  }, null, 2)
}

