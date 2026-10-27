// Read server credentials without ever serializing their values.
// Supabase supports both current publishable/secret keys and legacy keys.
const value = (...values) => values.find((item) => typeof item === 'string' && item.trim())?.trim() || ''

export function supabaseServiceConfig(env = process.env) {
  return {
    url: value(env.SUPABASE_URL, env.VITE_SUPABASE_URL),
    publicKey: value(env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_ANON_KEY, env.VITE_SUPABASE_PUBLISHABLE_KEY, env.VITE_SUPABASE_ANON_KEY),
    secretKey: value(env.SUPABASE_SECRET_KEY, env.SUPABASE_SERVICE_ROLE_KEY),
  }
}

export function serviceReadiness(env = process.env) {
  const config = supabaseServiceConfig(env)
  return {
    database: Boolean(config.url),
    authentication: Boolean(config.publicKey),
    serverAccess: Boolean(config.secretKey),
    aiProvider: Boolean(value(env.ANTHROPIC_API_KEY)),
    teamReady: Boolean(config.url && config.publicKey && config.secretKey),
    aiReady: Boolean(config.url && config.secretKey && value(env.ANTHROPIC_API_KEY)),
  }
}
