export const DEFAULT_SUPABASE_URL = 'https://mdptlabjdscjusfmdczm.supabase.co'

function readViteEnv() {
  try {
    return import.meta.env || {}
  } catch {
    return {}
  }
}

export function normalizeSupabaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return ''
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return ''
  if (parsed.pathname && parsed.pathname !== '/') return ''
  return parsed.origin
}

export function readSupabaseConfig(env = readViteEnv()) {
  const configuredUrl = normalizeSupabaseUrl(env?.VITE_SUPABASE_URL)
  const url = configuredUrl || DEFAULT_SUPABASE_URL
  const publishableKey = String(env?.VITE_SUPABASE_PUBLISHABLE_KEY || env?.VITE_SUPABASE_ANON_KEY || '').trim()
  return Object.freeze({
    url,
    publishableKey,
    configured: Boolean(url && publishableKey),
    source: configuredUrl ? 'environment' : 'project-default',
  })
}

export const SUPABASE_CONFIG = readSupabaseConfig()
