import { Subscription } from '@atproto/xrpc-server'
import { Config } from './config'
import { Database } from './db'

const METHOD = 'com.atproto.label.subscribeLabels'
const POST_MARKER = '/app.bsky.feed.post/'

/** A single label emitted by a labeler (com.atproto.label.defs#label). */
interface Label {
  ver?: number
  src?: string
  uri: string
  cid?: string
  val: string
  neg?: boolean
  cts?: string
  exp?: string
}

/** The #labels message body. */
interface LabelsMessage {
  seq: number
  labels: Label[]
}

const isLabelsMessage = (evt: unknown): evt is LabelsMessage => {
  const e = evt as Partial<LabelsMessage> | null
  return !!e && typeof e.seq === 'number' && Array.isArray(e.labels)
}

/** Extract the author DID from an at:// post URI. */
const authorFromUri = (uri: string): string => {
  const rest = uri.startsWith('at://') ? uri.slice('at://'.length) : uri
  return rest.split('/')[0]
}

/**
 * Subscribes to a labeler's moderation-verdict stream and mirrors matching
 * post labels into the feed. Applying a label adds the post; negating it (or
 * an explicit `neg`) removes it.
 */
export class LabelSubscription {
  public sub: Subscription<unknown>
  private appliedCount = 0
  private negatedCount = 0
  private seenLabels = 0

  constructor(
    public db: Database,
    public cfg: Config,
  ) {
    this.sub = new Subscription({
      service: cfg.labeler.endpoint,
      method: METHOD,
      getParams: () => this.getCursor(),
      validate: (value: unknown) => value,
    })
  }

  async run() {
    try {
      for await (const evt of this.sub) {
        try {
          await this.handleMessage(evt)
        } catch (err) {
          console.error('[labeler] failed to handle message', err)
        }
        const seq = (evt as { seq?: number })?.seq
        if (typeof seq === 'number' && seq % 20 === 0) {
          await this.updateCursor(seq)
        }
      }
    } catch (err) {
      console.error('[labeler] subscription errored, reconnecting...', err)
      setTimeout(() => this.run(), this.cfg.subscriptionReconnectDelay)
    }
  }

  private async handleMessage(evt: unknown) {
    if (!isLabelsMessage(evt)) return

    const wanted = this.cfg.labeler.values
    const expectedSrc = this.cfg.labeler.did

    const toCreate: {
      uri: string
      cid: string
      author: string
      indexedAt: string
      reason: string | null
      text: string | null
    }[] = []
    const toDelete: string[] = []

    for (const label of evt.labels) {
      // Only labels from the configured labeler, on posts, with a wanted value.
      if (expectedSrc && label.src && label.src !== expectedSrc) continue
      if (!label.uri || !label.uri.includes(POST_MARKER)) continue
      const val = String(label.val ?? '').toLowerCase()
      if (!wanted.includes(val)) continue

      this.seenLabels++

      if (label.neg) {
        this.negatedCount++
        toDelete.push(label.uri)
        continue
      }

      // Without a cid we cannot page the feed deterministically; skip.
      if (!label.cid) continue

      this.appliedCount++
      toCreate.push({
        uri: label.uri,
        cid: label.cid,
        author: authorFromUri(label.uri),
        indexedAt: label.cts ?? new Date().toISOString(),
        reason: `mod:${val}`,
        text: null,
      })
    }

    if (toDelete.length > 0) {
      await this.db.deleteFrom('post').where('uri', 'in', toDelete).execute()
    }
    if (toCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(toCreate)
        .onConflict((oc) =>
          oc.column('uri').doUpdateSet({
            cid: (eb) => eb.ref('excluded.cid'),
            reason: (eb) => eb.ref('excluded.reason'),
          }),
        )
        .execute()
    }
  }

  logStats() {
    console.log(
      `[labeler] labels matched=${this.seenLabels} applied=${this.appliedCount} negated=${this.negatedCount}`,
    )
  }

  private async getCursor(): Promise<{ cursor?: number }> {
    const res = await this.db
      .selectFrom('sub_state')
      .selectAll()
      .where('service', '=', this.cfg.labeler.endpoint)
      .executeTakeFirst()
    return res ? { cursor: Number(res.cursor) } : {}
  }

  private async updateCursor(cursor: number) {
    await this.db
      .insertInto('sub_state')
      .values({ service: this.cfg.labeler.endpoint, cursor })
      .onConflict((oc) => oc.column('service').doUpdateSet({ cursor }))
      .execute()
  }
}
