import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './runtime.js'

const RELAY_CONFIG_KEY = 'relay-api-config'
const RELAY_KEY_KEY = 'relay-api-key'

// API keys live only for the lifetime of this renderer process. Persisted
// config is intentionally limited to non-sensitive connection settings.
let relayApiKeyInMemory = ''

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TRANSIENT_RETRIES = 2
const CHAT_TRANSIENT_RETRIES = 1
const RETRY_BASE_DELAY_MS = 250
const RETRY_MAX_DELAY_MS = 2_000

export const DEEPSEEK_RELAY_PRESET = Object.freeze({
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  acquireUrl: 'https://platform.deepseek.com/api_keys',
})

function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJson(storage, key, value) {
  try {
    if (value === null || value === undefined) storage?.removeItem(key)
    else storage?.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}

function storagePair() {
  if (typeof window === 'undefined') return { local: null, session: null }
  return { local: window.localStorage, session: window.sessionStorage }
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('中转站 Base URL 必须是完整的 http(s) 地址')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('中转站 Base URL 仅支持 http 或 https')
  }
  if (parsed.username || parsed.password) throw new Error('Base URL 不应包含账号或密码')
  if (parsed.search || parsed.hash) throw new Error('Base URL 不应包含查询参数或片段')
  if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/v1'
  return parsed.toString().replace(/\/+$/, '')
}

export function normalizeRelayConfig(value = {}) {
  return {
    baseUrl: String(value.baseUrl || '').trim().replace(/\/+$/, ''),
    model: String(value.model || '').trim(),
    apiKey: String(value.apiKey || ''),
    // API keys are memory-only until an OS credential-store adapter exists.
    rememberKey: false,
    timeoutMs: Math.min(120_000, Math.max(5_000, Number(value.timeoutMs) || DEFAULT_TIMEOUT_MS)),
  }
}

export function applyDeepSeekPreset(value = {}) {
  return normalizeRelayConfig({
    ...value,
    baseUrl: DEEPSEEK_RELAY_PRESET.baseUrl,
    model: DEEPSEEK_RELAY_PRESET.model,
  })
}

export function isDeepSeekPreset(value = {}) {
  const config = normalizeRelayConfig(value)
  return config.baseUrl.toLocaleLowerCase() === DEEPSEEK_RELAY_PRESET.baseUrl
    && config.model === DEEPSEEK_RELAY_PRESET.model
}

export function loadRelayConfig() {
  const { local, session } = storagePair()
  const persisted = readJson(local, RELAY_CONFIG_KEY) || {}
  if (persisted && typeof persisted === 'object' && !Array.isArray(persisted) && Object.hasOwn(persisted, 'apiKey')) {
    const sanitized = { ...persisted }
    delete sanitized.apiKey
    writeJson(local, RELAY_CONFIG_KEY, sanitized)
  }
  // Remove keys written by older builds, but never read them back into memory.
  writeJson(local, RELAY_KEY_KEY, null)
  writeJson(session, RELAY_KEY_KEY, null)
  return normalizeRelayConfig({
    ...persisted,
    apiKey: relayApiKeyInMemory,
  })
}

export function saveRelayConfig(value) {
  const config = normalizeRelayConfig(value)
  if (config.baseUrl) config.baseUrl = normalizeBaseUrl(config.baseUrl)
  const { local, session } = storagePair()
  const base = {
    baseUrl: config.baseUrl,
    model: config.model,
    rememberKey: false,
    timeoutMs: config.timeoutMs,
  }
  writeJson(local, RELAY_CONFIG_KEY, base)
  relayApiKeyInMemory = config.apiKey || ''
  // Remove any key written by versions that exposed unsafe persistence options.
  writeJson(local, RELAY_KEY_KEY, null)
  writeJson(session, RELAY_KEY_KEY, null)
  return config
}

export function clearRelayApiKey() {
  relayApiKeyInMemory = ''
  const { local, session } = storagePair()
  writeJson(local, RELAY_KEY_KEY, null)
  writeJson(session, RELAY_KEY_KEY, null)
}

export function maskRelayApiKey(value) {
  const key = String(value || '')
  if (!key) return '未配置'
  if (key.length <= 8) return `${key.slice(0, 2)}••••${key.slice(-2)}`
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}

function validateConnectionConfig(value, { requireModel = false } = {}) {
  const config = normalizeRelayConfig(value)
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  if (!baseUrl) throw new Error('请先在设置中填写中转站 Base URL')
  if (requireModel && !config.model) throw new Error('请先填写中转站模型名')
  if (config.model.length > 200) throw new Error('中转站模型名不能超过 200 个字符')
  if (!config.apiKey) throw new Error('请先填写中转站 API Key')
  if (config.apiKey.length > 512) throw new Error('中转站 API Key 不能超过 512 个字符')
  return { ...config, baseUrl }
}

function endpointFor(baseUrl, path) {
  const normalized = baseUrl.replace(/\/+$/, '')
  if (normalized.endsWith(path)) return normalized
  return `${normalized}${path}`
}

function errorForStatus(status) {
  if (status === 401 || status === 403) return '中转站鉴权失败，请检查 API Key'
  if (status === 404) return '中转站接口不存在，请确认 Base URL 包含正确的 /v1 路径'
  if (status === 429) return '中转站请求过于频繁，请稍后重试'
  if (status >= 500) return `中转站服务暂时不可用（HTTP ${status}）`
  return `中转站返回 HTTP ${status}`
}

function isTransientStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get?.('retry-after')
  const seconds = retryAfter === null || retryAfter === undefined ? Number.NaN : Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(RETRY_MAX_DELAY_MS, Math.round(seconds * 1000))
  }
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** attempt))
}

function abortError() {
  const error = new Error('任务已取消')
  error.name = 'AbortError'
  return error
}

async function waitForRetry(milliseconds, externalSignal) {
  if (externalSignal?.aborted) throw abortError()
  if (milliseconds <= 0) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      externalSignal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', abort)
      reject(abortError())
    }
    externalSignal?.addEventListener('abort', abort, { once: true })
    if (externalSignal?.aborted) abort()
  })
}

function requestWithTimeout(milliseconds, externalSignal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), milliseconds)
  const abort = () => controller.abort()
  externalSignal?.addEventListener('abort', abort, { once: true })
  if (externalSignal?.aborted) abort()
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', abort)
    },
    timedOut: () => controller.signal.aborted && !externalSignal?.aborted,
  }
}

async function requestJson(url, options, timeoutMs, signal, { maxRetries = 0 } = {}) {
  let attempt = 0
  const deadline = Date.now() + timeoutMs
  while (true) {
    if (signal?.aborted) throw abortError()
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      const timeoutError = new Error('中转站请求超时，请检查地址和网络后重试')
      timeoutError.name = 'TimeoutError'
      throw timeoutError
    }
    const request = requestWithTimeout(remainingMs, signal)
    try {
      const response = await fetch(url, { ...options, signal: request.signal, cache: 'no-store' })
      if (response.ok) return await response.json()
      if (attempt < maxRetries && isTransientStatus(response.status)) {
        const delay = retryDelayMs(response, attempt)
        if (delay >= Math.max(0, deadline - Date.now())) throw new Error(errorForStatus(response.status))
        attempt += 1
        await waitForRetry(delay, signal)
        continue
      }
      throw new Error(errorForStatus(response.status))
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (signal?.aborted) throw error
        if (request.timedOut()) {
          const timeoutError = new Error('中转站请求超时，请检查地址和网络后重试')
          timeoutError.name = 'TimeoutError'
          throw timeoutError
        }
      }
      throw error
    } finally {
      request.clear()
    }
  }
}

export async function testRelayConnection(value, { signal, requestId = null } = {}) {
  const config = validateConnectionConfig(value)
  if (isTauriRuntime) {
    if (signal?.aborted) {
      const error = new Error('任务已取消')
      error.name = 'AbortError'
      throw error
    }
    return invoke('relay_test_connection', {
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      requestId,
    })
  }
  const data = await requestJson(endpointFor(config.baseUrl, '/models'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
  }, config.timeoutMs, signal, { maxRetries: MAX_TRANSIENT_RETRIES })
  const models = Array.isArray(data?.data) ? data.data : []
  const modelIds = models
    .map((item) => typeof item?.id === 'string' ? item.id.trim() : '')
    .filter((id) => id && id.length <= 200)
    .slice(0, 200)
  return {
    provider: new URL(config.baseUrl).host,
    modelCount: modelIds.length,
    model: config.model,
    models: modelIds,
  }
}

export async function callRelayChat(value, { messages, temperature = 0.2, maxTokens = 1024, signal, requestId = null } = {}) {
  const config = validateConnectionConfig(value, { requireModel: true })
  if (!Array.isArray(messages) || !messages.length) throw new Error('请输入至少一条消息')
  if (messages.length > 100) throw new Error('中转站消息数量必须在 1-100 条之间')
  const totalCharacters = messages.reduce((total, message) => {
    if (!['system', 'user', 'assistant'].includes(message?.role)) throw new Error('中转站消息角色仅支持 system、user、assistant')
    const content = String(message?.content || '')
    if (!content.trim() || content.length > 100_000) throw new Error('中转站单条消息不能为空且不能超过 100000 个字符')
    return total + content.length
  }, 0)
  if (totalCharacters > 500_000) throw new Error('中转站消息总长度不能超过 500000 个字符')
  if (isTauriRuntime) {
    if (signal?.aborted) {
      const error = new Error('任务已取消')
      error.name = 'AbortError'
      throw error
    }
    return invoke('relay_chat', {
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey,
      messages,
      temperature,
      maxTokens,
      timeoutMs: config.timeoutMs,
      requestId,
    })
  }
  const idempotencyKey = typeof requestId === 'string' && /^[\x21-\x7E]{1,200}$/.test(requestId) ? requestId : ''
  const data = await requestJson(endpointFor(config.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ model: config.model, messages, temperature, max_tokens: maxTokens }),
  }, config.timeoutMs, signal, { maxRetries: idempotencyKey ? CHAT_TRANSIENT_RETRIES : 0 })
  const choice = data?.choices?.[0]
  const content = typeof choice?.message?.content === 'string'
    ? choice.message.content.trim()
    : Array.isArray(choice?.message?.content)
      ? choice.message.content.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim()
      : ''
  if (!content) throw new Error('中转站未返回可读文本')
  return {
    content,
    model: data.model || config.model,
    usage: data.usage || null,
    provider: new URL(config.baseUrl).host,
  }
}
