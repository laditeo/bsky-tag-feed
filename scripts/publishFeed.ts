import fs from 'fs/promises'
import { AtpAgent, BlobRef } from '@atproto/api'
import dotenv from 'dotenv'

dotenv.config()

const run = async () => {
  const handle = process.env.BLUESKY_HANDLE
  const password = process.env.BLUESKY_PASSWORD
  if (!handle || !password) {
    throw new Error('Set BLUESKY_HANDLE and BLUESKY_PASSWORD in your .env')
  }

  const hostname = process.env.FEEDGEN_HOSTNAME
  const serviceDid =
    process.env.FEEDGEN_SERVICE_DID ||
    (hostname ? `did:web:${hostname}` : undefined)
  if (!serviceDid) {
    throw new Error('Set FEEDGEN_SERVICE_DID or FEEDGEN_HOSTNAME in your .env')
  }

  const recordName = process.env.FEED_RECORD_NAME || 'tag-feed'
  const displayName = process.env.FEED_DISPLAY_NAME || 'My Tag Feed'
  const description = process.env.FEED_DESCRIPTION || ''
  const avatarPath = process.env.FEED_AVATAR_PATH

  const agent = new AtpAgent({ service: 'https://bsky.social' })
  await agent.login({ identifier: handle, password })

  let avatarRef: BlobRef | undefined
  if (avatarPath) {
    let encoding: string
    if (avatarPath.endsWith('.png')) encoding = 'image/png'
    else if (avatarPath.endsWith('.jpg') || avatarPath.endsWith('.jpeg'))
      encoding = 'image/jpeg'
    else throw new Error('FEED_AVATAR_PATH must be a .png or .jpg image')
    const img = await fs.readFile(avatarPath)
    const uploaded = await agent.com.atproto.repo.uploadBlob(img, { encoding })
    avatarRef = uploaded.data.blob
  }

  await agent.com.atproto.repo.putRecord({
    repo: agent.session!.did,
    collection: 'app.bsky.feed.generator',
    rkey: recordName,
    record: {
      did: serviceDid,
      displayName,
      description,
      avatar: avatarRef,
      createdAt: new Date().toISOString(),
    },
  })

  console.log('✓ Feed published:')
  console.log(
    `  at://${agent.session!.did}/app.bsky.feed.generator/${recordName}`,
  )
  console.log(`  service DID: ${serviceDid}`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
