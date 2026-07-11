import express, { Express } from 'express'
import { Config } from './config'
import { Database } from './db'
import { getFeed } from './algos'

export const createServer = (db: Database, cfg: Config): Express => {
  const app = express()

  const feedUri = `at://${cfg.publisherDid}/app.bsky.feed.generator/${cfg.recordName}`

  // Health check.
  app.get('/', (_req, res) => {
    res.status(200).send('Bluesky Tag Feed is running.')
  })

  // did:web document so Bluesky can resolve did:web:<hostname>.
  app.get('/.well-known/did.json', (_req, res) => {
    if (cfg.serviceDid !== `did:web:${cfg.hostname}`) {
      res.sendStatus(404)
      return
    }
    res.json({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: cfg.serviceDid,
      service: [
        {
          id: '#bsky_fg',
          type: 'BskyFeedGenerator',
          serviceEndpoint: `https://${cfg.hostname}`,
        },
      ],
    })
  })

  // Tells clients which feeds this generator serves.
  app.get('/xrpc/app.bsky.feed.describeFeedGenerator', (_req, res) => {
    res.json({
      did: cfg.serviceDid,
      feeds: [{ uri: feedUri }],
    })
  })

  // The actual feed skeleton (list of post URIs).
  app.get('/xrpc/app.bsky.feed.getFeedSkeleton', async (req, res) => {
    const requestedFeed = req.query.feed
    if (typeof requestedFeed === 'string' && requestedFeed !== feedUri) {
      res.status(400).json({
        error: 'UnsupportedAlgorithm',
        message: 'Unsupported algorithm',
      })
      return
    }

    const limitRaw = parseInt(String(req.query.limit ?? '30'), 10)
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 100)
      : 30
    const cursor =
      typeof req.query.cursor === 'string' ? req.query.cursor : undefined

    try {
      const body = await getFeed(db, { limit, cursor })
      res.json(body)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      if (message === 'malformed cursor') {
        res.status(400).json({ error: 'InvalidRequest', message })
        return
      }
      console.error('[server] getFeedSkeleton error', err)
      res.status(500).json({ error: 'InternalServerError' })
    }
  })

  return app
}
