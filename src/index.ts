import {
  loadConfig,
  describeFilter,
  describeLabeler,
  hasFirehoseFilters,
} from './config'
import { createDb, migrateToLatest } from './db'
import { createServer } from './server'
import { FirehoseSubscription } from './firehose'
import { LabelSubscription } from './labeler'
import { cleanupStalePosts } from './cleanup'

const main = async () => {
  const cfg = loadConfig()

  console.log('[startup] service DID:', cfg.serviceDid)
  console.log('[startup] publisher DID:', cfg.publisherDid)
  console.log('[startup] feed record:', cfg.recordName)
  console.log('[startup] firehose filter:', describeFilter(cfg.filter))
  console.log('[startup] moderation labels:', describeLabeler(cfg.labeler))

  const db = createDb(cfg.databaseUrl, cfg.databaseSsl)
  await migrateToLatest(db)
  await cleanupStalePosts(db, cfg)

  // Start the HTTP feed server.
  const app = createServer(db, cfg)
  app.listen(cfg.port, cfg.listenHost, () => {
    console.log(`[server] listening on ${cfg.listenHost}:${cfg.port}`)
  })

  // Moderation-verdict source: subscribe to the labeler stream.
  let labeler: LabelSubscription | undefined
  if (cfg.labeler.values.length > 0) {
    labeler = new LabelSubscription(db, cfg)
    labeler.run()
    console.log('[labeler] subscribed to', cfg.labeler.endpoint)
  } else {
    console.log('[labeler] not started (no FEED_MOD_LABELS)')
  }

  // Firehose source: only needed for self-label / hashtag / keyword matching.
  let firehose: FirehoseSubscription | undefined
  if (hasFirehoseFilters(cfg.filter)) {
    firehose = new FirehoseSubscription(db, cfg)
    firehose.run()
    console.log('[firehose] subscribed to', cfg.subscriptionEndpoint)
  } else {
    console.log('[firehose] not started (no self-label/hashtag/keyword filters)')
  }

  // Periodically log throughput for whichever sources are running.
  setInterval(() => {
    firehose?.logStats()
    labeler?.logStats()
  }, 60_000)

  const shutdown = async () => {
    console.log('[shutdown] closing...')
    try {
      await db.destroy()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
