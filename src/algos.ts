import { Database } from './db'

export interface FeedParams {
  limit: number
  cursor?: string
}

export interface FeedSkeleton {
  cursor?: string
  feed: { post: string }[]
}

/**
 * Returns the newest matching posts, paginated with a `<time>::<cid>` cursor.
 */
export const getFeed = async (
  db: Database,
  params: FeedParams,
): Promise<FeedSkeleton> => {
  let builder = db
    .selectFrom('post')
    .selectAll()
    .orderBy('indexedAt', 'desc')
    .orderBy('cid', 'desc')
    .limit(params.limit)

  if (params.cursor) {
    const [time, cid] = params.cursor.split('::')
    if (!time || !cid) {
      throw new Error('malformed cursor')
    }
    const timeStr = new Date(parseInt(time, 10)).toISOString()
    builder = builder.where((eb) =>
      eb.or([
        eb('post.indexedAt', '<', timeStr),
        eb.and([
          eb('post.indexedAt', '=', timeStr),
          eb('post.cid', '<', cid),
        ]),
      ]),
    )
  }

  const rows = await builder.execute()

  const feed = rows.map((row) => ({ post: row.uri }))

  let cursor: string | undefined
  const last = rows.at(-1)
  if (last) {
    cursor = `${new Date(last.indexedAt).getTime()}::${last.cid}`
  }

  return { cursor, feed }
}
