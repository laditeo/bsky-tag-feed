import { loadConfig, describeFilter } from './config'
import { createDb, migrateToLatest } from './db'
import { createServer } from './server'
import { FirehoseSubscription } from './firehose'

const main = async () => {
  const cfg = loadConfig()

  console.log('[startup] service DID:', cfg.serviceDid)
  console.log('[startup] publisher DID:', cfg.publisherDid)
  console.log('[startup] feed record:', cfg.recordName)
  console.log('[startup] filter:', describeFilter(cfg.filter))

  const db = createDb(cfg.databaseUrl, cfg.databaseSsl)
  await migrateToLatest(db)

  // Start the HTTP feed server.
  const app = createServer(db, cfg)
  app.listen(cfg.port, cfg.listenHost, () => {
    console.log(`[server] listening on ${cfg.listenHost}:${cfg.port}`)
  })

  // Start consuming the firehose.
  const firehose = new FirehoseSubscription(db, cfg)
  firehose.run()
  console.log('[firehose] subscribed to', cfg.subscriptionEndpoint)

  // Periodically log how many posts we have seen/matched.
  setInterval(() => firehose.logStats(), 60_000)

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
