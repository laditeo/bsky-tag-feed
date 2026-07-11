import dotenv from 'dotenv'

dotenv.config()

export type MatchMode = 'any' | 'all'

export interface FilterConfig {
  selfLabels: string[]
  hashtags: string[]
  keywords: string[]
  languages: string[]
  matchMode: MatchMode
}

export interface Config {
  port: number
  listenHost: string
  hostname: string
  serviceDid: string
  publisherDid: string
  recordName: string
  subscriptionEndpoint: string
  subscriptionReconnectDelay: number
  databaseUrl: string
  databaseSsl: boolean
  filter: FilterConfig
}

const req = (name: string): string => {
  const val = process.env[name]
  if (!val || val.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return val.trim()
}

const opt = (name: string, fallback: string): string => {
  const val = process.env[name]
  return val && val.trim() !== '' ? val.trim() : fallback
}

/** Split a comma-separated env value into a normalized, lowercased list. */
const parseList = (name: string): string[] => {
  const raw = process.env[name]
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
}

export const loadConfig = (): Config => {
  const hostname = req('FEEDGEN_HOSTNAME')
  const serviceDid = opt('FEEDGEN_SERVICE_DID', `did:web:${hostname}`)

  const matchModeRaw = opt('FEED_MATCH_MODE', 'any').toLowerCase()
  const matchMode: MatchMode = matchModeRaw === 'all' ? 'all' : 'any'

  const filter: FilterConfig = {
    selfLabels: parseList('FEED_SELF_LABELS'),
    // Normalize hashtags: strip a leading '#'.
    hashtags: parseList('FEED_HASHTAGS').map((t) => t.replace(/^#/, '')),
    keywords: parseList('FEED_KEYWORDS'),
    // Keep only the primary subtag of language codes (e.g. "en-US" -> "en").
    languages: parseList('FEED_LANGUAGES').map((l) => l.split('-')[0]),
    matchMode,
  }

  return {
    port: parseInt(opt('PORT', opt('FEEDGEN_PORT', '3000')), 10),
    listenHost: opt('FEEDGEN_LISTENHOST', '0.0.0.0'),
    hostname,
    serviceDid,
    publisherDid: req('FEEDGEN_PUBLISHER_DID'),
    recordName: opt('FEED_RECORD_NAME', 'tag-feed'),
    subscriptionEndpoint: opt('FEEDGEN_SUBSCRIPTION_ENDPOINT', 'wss://bsky.network'),
    subscriptionReconnectDelay: parseInt(
      opt('FEEDGEN_SUBSCRIPTION_RECONNECT_DELAY', '3000'),
      10,
    ),
    databaseUrl: req('DATABASE_URL'),
    databaseSsl: opt('DATABASE_SSL', 'false').toLowerCase() === 'true',
    filter,
  }
}

/** Human-readable summary of active filters, and a warning if none are set. */
export const describeFilter = (f: FilterConfig): string => {
  const parts: string[] = []
  if (f.selfLabels.length) parts.push(`self-labels=[${f.selfLabels.join(', ')}]`)
  if (f.hashtags.length) parts.push(`hashtags=[${f.hashtags.join(', ')}]`)
  if (f.keywords.length) parts.push(`keywords=[${f.keywords.join(', ')}]`)
  if (f.languages.length) parts.push(`languages=[${f.languages.join(', ')}]`)
  if (parts.length === 0) {
    return 'NO FILTERS CONFIGURED — the feed will stay empty until you set FEED_SELF_LABELS / FEED_HASHTAGS / FEED_KEYWORDS'
  }
  return `mode=${f.matchMode} ${parts.join(' ')}`
}
