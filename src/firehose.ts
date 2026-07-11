import { Subscription } from '@atproto/xrpc-server'
import { cborToLexRecord, readCar } from '@atproto/repo'
import { Config } from './config'
import { Database } from './db'
import { matchPost, PostRecordLike } from './filter'

const METHOD = 'com.atproto.sync.subscribeRepos'
const POST_COLLECTION = 'app.bsky.feed.post'
const MAX_TEXT_LENGTH = 500

/** A repo op inside a #commit message. */
interface RepoOp {
  action: 'create' | 'update' | 'delete'
  path: string
  cid?: { toString(): string } | null
}

/** The decoded #commit message body. */
interface CommitEvt {
  seq: number
  repo: string
  ops: RepoOp[]
  blocks: Uint8Array
}

/** Structural detection so we do not depend on lexicon `$type` tagging. */
const isCommit = (evt: unknown): evt is CommitEvt => {
  const e = evt as Partial<CommitEvt> | null
  return (
    !!e &&
    typeof e.seq === 'number' &&
    typeof e.repo === 'string' &&
    Array.isArray(e.ops) &&
    e.blocks instanceof Uint8Array
  )
}

export class FirehoseSubscription {
  public sub: Subscription<unknown>
  private matchedCount = 0
  private seenCount = 0

  constructor(
    public db: Database,
    public cfg: Config,
  ) {
    this.sub = new Subscription({
      service: cfg.subscriptionEndpoint,
      method: METHOD,
      getParams: () => this.getCursor(),
      // Pass-through: we decode records ourselves from the CAR blocks.
      validate: (value: unknown) => value,
    })
  }

  async run() {
    try {
      for await (const evt of this.sub) {
        try {
          await this.handleEvent(evt)
        } catch (err) {
          console.error('[firehose] failed to handle message', err)
        }
        const seq = (evt as { seq?: number })?.seq
        if (typeof seq === 'number' && seq % 20 === 0) {
          await this.updateCursor(seq)
        }
      }
    } catch (err) {
      console.error('[firehose] subscription errored, reconnecting...', err)
      setTimeout(() => this.run(), this.cfg.subscriptionReconnectDelay)
    }
  }

  private async handleEvent(evt: unknown) {
    if (!isCommit(evt)) return

    const car = await readCar(evt.blocks)
    const toCreate: {
      uri: string
      cid: string
      author: string
      indexedAt: string
      reason: string | null
      text: string | null
    }[] = []
    const toDelete: string[] = []

    for (const op of evt.ops) {
      const collection = op.path.split('/')[0]
      if (collection !== POST_COLLECTION) continue

      const uri = `at://${evt.repo}/${op.path}`

      if (op.action === 'delete') {
        toDelete.push(uri)
        continue
      }

      if (op.action === 'create' || op.action === 'update') {
        if (!op.cid) continue
        const bytes = car.blocks.get(op.cid as never)
        if (!bytes) continue

        let record: PostRecordLike
        try {
          record = cborToLexRecord(bytes) as PostRecordLike
        } catch {
          continue
        }
        if (record?.$type !== POST_COLLECTION) continue

        this.seenCount++
        const result = matchPost(record, this.cfg.filter)
        if (!result.matched) continue

        this.matchedCount++
        toCreate.push({
          uri,
          cid: op.cid.toString(),
          author: evt.repo,
          indexedAt: new Date().toISOString(),
          reason: result.reasons.join(',') || null,
          text: (record.text ?? '').slice(0, MAX_TEXT_LENGTH) || null,
        })
      }
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
            text: (eb) => eb.ref('excluded.text'),
          }),
        )
        .execute()
    }
  }

  logStats() {
    console.log(
      `[firehose] posts seen=${this.seenCount} matched=${this.matchedCount}`,
    )
  }

  private async getCursor(): Promise<{ cursor?: number }> {
    const res = await this.db
      .selectFrom('sub_state')
      .selectAll()
      .where('service', '=', this.cfg.subscriptionEndpoint)
      .executeTakeFirst()
    return res ? { cursor: res.cursor } : {}
  }

  private async updateCursor(cursor: number) {
    await this.db
      .insertInto('sub_state')
      .values({ service: this.cfg.subscriptionEndpoint, cursor })
      .onConflict((oc) =>
        oc.column('service').doUpdateSet({ cursor }),
      )
      .execute()
  }
}
