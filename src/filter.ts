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
 * A language gate (if configured) is always applied as a precondition. Then
 * each active category (self-labels, hashtags, keywords) is evaluated:
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
    const found = extractHashtags(record).filter((t) => cfg.hashtags.includes(t))
    categoryHits.push(found.length > 0)
    reasons.push(...found.map((t) => `tag:${t}`))
  }

  if (cfg.keywords.length > 0) {
    const text = (record.text ?? '').toLowerCase()
    const found = cfg.keywords.filter((k) => text.includes(k))
    categoryHits.push(found.length > 0)
    reasons.push(...found.map((k) => `kw:${k}`))
  }

  // No active categories -> nothing can match.
  if (categoryHits.length === 0) {
    return { matched: false, reasons: [] }
  }

  const matched =
    cfg.matchMode === 'all'
      ? categoryHits.every((hit) => hit)
      : categoryHits.some((hit) => hit)

  return { matched, reasons: matched ? reasons : [] }
}
