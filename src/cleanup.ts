import { Config } from './config'
import { Database } from './db'

/**
 * Remove posts indexed under a previous filter configuration so the feed
 * reflects the current rules immediately after a config change.
 */
export const cleanupStalePosts = async (
  db: Database,
  cfg: Config,
): Promise<number> => {
  let removed = 0

  // Drop moderation-label entries when the labeler source is off.
  if (cfg.labeler.values.length === 0) {
    const r = await db
      .deleteFrom('post')
      .where('reason', 'like', 'mod:%')
      .executeTakeFirst()
    removed += Number(r.numDeletedRows ?? 0)
  }

  const f = cfg.filter
  // In strict (all) mode with hashtags, every kept post must have a tag reason.
  if (f.matchMode === 'all' && f.hashtags.length > 0) {
    const r = await db
      .deleteFrom('post')
      .where((eb) =>
        eb.or([
          eb('reason', 'is', null),
          eb.not(eb('reason', 'like', '%tag:%')),
        ]),
      )
      .executeTakeFirst()
    removed += Number(r.numDeletedRows ?? 0)
  }

  if (removed > 0) {
    console.log(`[cleanup] removed ${removed} stale post(s)`)
  }
  return removed
}
