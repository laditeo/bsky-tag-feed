import { AtpAgent } from '@atproto/api'
import dotenv from 'dotenv'

dotenv.config()

const run = async () => {
  const handle = process.env.BLUESKY_HANDLE
  const password = process.env.BLUESKY_PASSWORD
  if (!handle || !password) {
    throw new Error('Set BLUESKY_HANDLE and BLUESKY_PASSWORD in your .env')
  }

  const recordName = process.env.FEED_RECORD_NAME || 'tag-feed'

  const agent = new AtpAgent({ service: 'https://bsky.social' })
  await agent.login({ identifier: handle, password })

  await agent.com.atproto.repo.deleteRecord({
    repo: agent.session!.did,
    collection: 'app.bsky.feed.generator',
    rkey: recordName,
  })

  console.log(`✓ Feed "${recordName}" unpublished.`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
