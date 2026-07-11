import { FilterConfig } from './config'

export interface MatchResult {
  matched: boolean
  reasons: string[]
}

/**
 * A loose shape of an app.bsky.feed.post record. We only read the fields we
 * care about, so we keep this permissive rather than importing full lexicons.
 */
export interface PostRecordLike {
  $type?: string
  text?: string
  langs?: string[]
  tags?: string[]
  facets?: Array<{
    features?: Array<{ $type?: string; tag?: string }>
  }>
  labels?: {
    $type?: string
    values?: Array<{ val?: string }>
  }
}

/** Extract self-label values (e.g. "porn", "nudity") set by the author. */
export const extractSelfLabels = (record: PostRecordLike): string[] => {
  const values = record.labels?.values
  if (!Array.isArray(values)) return []
  return values
    .map((v) => (v?.val ? String(v.val).toLowerCase() : ''))
    .filter((v) => v.length > 0)
}

/** Extract hashtags from both the `tags` field and richtext `#tag` facets. */
export const extractHashtags = (record: PostRecordLike): string[] => {
  const out = new Set<string>()
  if (Array.isArray(record.tags)) {
    for (const t of record.tags) {
      if (t) out.add(String(t).toLowerCase().replace(/^#/, ''))
    }
  }
  if (Array.isArray(record.facets)) {
    for (const facet of record.facets) {
      for (const feature of facet.features ?? []) {
        if (feature?.$type === 'app.bsky.richtext.facet#tag' && feature.tag) {
          out.add(String(feature.tag).toLowerCase().replace(/^#/, ''))
        }
      }
    }
  }
  return [...out]
}

/**
 * Decide whether a post matches the configured filters.
 *
 * A language gate (if configured) is always applied as a precondition.
 *
 * Strong tags are "self-sufficient": their mere presence means drawn + adult
 * (e.g. hentai, rule34, yiff), so they match on their own regardless of
 * matchMode and without requiring a self-label.
 *
 * The remaining categories (self-labels, general hashtags, keywords) are then
 * evaluated together:
 *  - matchMode "any": keep the post if it hits at least one active category
 *  - matchMode "all": keep the post only if it hits every active category
 */
export const matchPost = (
  record: PostRecordLike,
  cfg: FilterConfig,
): MatchResult => {
  // Language precondition.
  if (cfg.languages.length > 0) {
    const langs = (record.langs ?? []).map((l) =>
      String(l).toLowerCase().split('-')[0],
    )
    if (!langs.some((l) => cfg.languages.includes(l))) {
      return { matched: false, reasons: [] }
    }
  }

  const tags = extractHashtags(record)

  // Self-sufficient drawn-adult tags: match on their own.
  const strongReasons: string[] = []
  if (cfg.strongTags.length > 0) {
    const strongHits = tags.filter((t) => cfg.strongTags.includes(t))
    strongReasons.push(...strongHits.map((t) => `strong:${t}`))
  }

  const reasons: string[] = []
  const categoryHits: boolean[] = []

  if (cfg.selfLabels.length > 0) {
    const found = extractSelfLabels(record).filter((v) =>
      cfg.selfLabels.includes(v),
    )
    categoryHits.push(found.length > 0)
    reasons.push(...found.map((v) => `label:${v}`))
  }

  if (cfg.hashtags.length > 0) {
    const found = tags.filter((t) => cfg.hashtags.includes(t))
    categoryHits.push(found.length > 0)
    reasons.push(...found.map((t) => `tag:${t}`))
  }

  if (cfg.keywords.length > 0) {
    const text = (record.text ?? '').toLowerCase()
    const found = cfg.keywords.filter((k) => text.includes(k))
    categoryHits.push(found.length > 0)
    reasons.push(...found.map((k) => `kw:${k}`))
  }

  const baseMatched =
    categoryHits.length === 0
      ? false
      : cfg.matchMode === 'all'
        ? categoryHits.every((hit) => hit)
        : categoryHits.some((hit) => hit)

  // A strong tag always qualifies; otherwise fall back to the category logic.
  const matched = strongReasons.length > 0 || baseMatched
  if (!matched) return { matched: false, reasons: [] }

  const allReasons = [...strongReasons, ...(baseMatched ? reasons : [])]
  return { matched: true, reasons: allReasons }
}
