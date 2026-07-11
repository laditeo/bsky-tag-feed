# Bluesky Tag Feed

A [Bluesky](https://bsky.app) **feed generator** that keeps only the posts that
match your rules, from two independent sources:

- **Moderation labels** (verdicts from a labeler service, e.g. `mod.bsky.app`):
  `porn`, `sexual`, `nudity`, `graphic-media`, `gore`, … — **primary source**.
  These are decisions made by the labeler, *not* the post author.
- **Self-labels** (content categories set by the author) — via the firehose
- **Hashtags** — from the `#tag` richtext facets *and* the `tags` field
- **Keywords** — substring match on the post text
- **Language** — optional gate (e.g. only `en` / `ru`)

A post is included if it matches the moderation-label rules **or** the
firehose filters. Each source can be enabled independently.

It is based on the official
[bluesky-social/feed-generator](https://github.com/bluesky-social/feed-generator)
starter kit, adapted to use **PostgreSQL** and **ENV-based configuration** so it
runs cleanly on [Railway](https://railway.app) or [Render](https://render.com).

## How it works

```
Labeler stream ──ws──▶ LabelSubscription ──by label val──┐
(mod.bsky.app)                                           ├──▶ Postgres (post)
Bluesky Firehose ──ws──▶ FirehoseSubscription ──matchPost()──┘        │
                                                                     │
Bluesky App ──getFeedSkeleton──▶ Express feed server ◀───────────────┘
```

A single Node process runs up to three things at once:

1. **Labeler consumer** — opens a WebSocket to the labeler
   (`com.atproto.label.subscribeLabels`), keeps post labels whose value is in
   `FEED_MOD_LABELS`, and stores them. A negated label (`neg`) removes the post.
   Only runs when `FEED_MOD_LABELS` is set.
2. **Firehose consumer** — opens a WebSocket to `wss://bsky.network`, decodes
   every `app.bsky.feed.post` from the CAR blocks, runs `matchPost()`
   (self-labels / hashtags / keywords), and stores matches. Only runs when at
   least one of those filters is set.
3. **Feed server (XRPC)** — an Express app exposing the endpoints Bluesky calls:
   `app.bsky.feed.getFeedSkeleton`, `app.bsky.feed.describeFeedGenerator`, and
   `/.well-known/did.json`.

Both consumers save their cursor so restarts resume where they left off.

> **Note on adult content:** on Bluesky, `porn`/`sexual`/`nudity` are usually
> *self-labeled* by authors; the moderation labeler emits its own verdicts
> (heavy on `nudity`, plus `gore`, `spam`, `self-harm`, etc.). If you want the
> broadest adult-content coverage, enable **both** `FEED_MOD_LABELS` and
> `FEED_SELF_LABELS`.

## Project layout

```
src/
  config.ts      ENV parsing + filter config
  db/            Kysely + Postgres schema & migrations
  filter.ts      matchPost(): self-labels / hashtags / keywords / language
  firehose.ts    firehose subscription + CAR decoding + DB writes
  algos.ts       feed query with cursor pagination
  server.ts      Express endpoints
  index.ts       wires everything together
scripts/
  publishFeed.ts    register the feed on your Bluesky account
  unpublishFeed.ts  remove it
```

## 1. Local setup

Requires Node 18+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env      # then edit .env
```

Fill in at least `DATABASE_URL`, `FEEDGEN_HOSTNAME`, `FEEDGEN_PUBLISHER_DID`,
and your filter lists. Run in dev mode:

```bash
npm run dev
```

You should see the firehose connect and, after a minute, a
`posts seen=… matched=…` line. Check the feed locally:

```bash
curl "http://localhost:3000/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://<PUBLISHER_DID>/app.bsky.feed.generator/tag-feed"
```

## 2. Configuration (ENV)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `DATABASE_SSL` | no | `true` if the DB requires SSL (most external URLs) |
| `FEEDGEN_HOSTNAME` | yes | Public host, e.g. `my-feed.up.railway.app` |
| `FEEDGEN_SERVICE_DID` | no | Defaults to `did:web:<FEEDGEN_HOSTNAME>` |
| `FEEDGEN_PUBLISHER_DID` | yes | DID of the account that owns the feed |
| `FEED_RECORD_NAME` | no | Feed rkey / short name (default `tag-feed`) |
| `FEEDGEN_SUBSCRIPTION_ENDPOINT` | no | Firehose relay (default `wss://bsky.network`) |
| `PORT` | no | HTTP port (Railway/Render set this automatically) |
| **Moderation labels** | | |
| `FEED_MOD_LABELS` | – | Label values to keep, e.g. `porn,sexual,nudity,graphic-media`. Empty = labeler off |
| `FEED_LABELER_ENDPOINT` | no | Labeler WS (default `wss://mod.bsky.app`) |
| `FEED_LABELER_DID` | no | Labeler DID (default `did:plc:ar7c4by46qjdydhdevvrndac`) |
| **Firehose filters** | | |
| `FEED_SELF_LABELS` | – | Author self-labels, e.g. `porn,sexual,nudity,graphic-media` |
| `FEED_HASHTAGS` | – | e.g. `art,photography` (with or without `#`) |
| `FEED_KEYWORDS` | – | e.g. `cat,kitten` |
| `FEED_LANGUAGES` | – | e.g. `en,ru` (empty = any) |
| `FEED_MATCH_MODE` | – | `any` (union, default) or `all` (intersection) |

> Find your `FEEDGEN_PUBLISHER_DID`: log in at bsky.app and look it up, or run the
> `publishFeed` script which prints the `at://<did>/...` URI it created.

## 3. Deploy to Railway (recommended)

The firehose consumer must run **24/7**, so deploy as one always-on service.

1. Push this repo to GitHub.
2. On Railway: **New Project → Deploy from GitHub repo**.
3. Add a database: **New → Database → PostgreSQL**. Railway exposes
   `DATABASE_URL` automatically; reference it in your service variables
   (`DATABASE_URL = ${{Postgres.DATABASE_URL}}`).
4. Set the remaining variables from the table above. Leave `DATABASE_SSL=false`
   when using Railway's internal Postgres URL.
5. Deploy. Railway builds with `npm run build` and starts with `npm run start`
   (see `railway.json`).
6. Under **Settings → Networking**, generate a public domain and set
   `FEEDGEN_HOSTNAME` to that domain (without `https://`). Redeploy.

### Deploy to Render (alternative)

Create a **Web Service** (not a free one — the free tier sleeps and would drop
the firehose) pointing at this repo, plus a **PostgreSQL** instance. Build
command `npm install && npm run build`, start command `npm run start`. Set
`DATABASE_SSL=true` for Render's external Postgres URL, and set the same ENV vars.

## 4. Publish the feed to your account

Once the service is deployed and reachable at `https://<FEEDGEN_HOSTNAME>`, run
locally (with the same `.env`, plus `BLUESKY_HANDLE` and an **app password** in
`BLUESKY_PASSWORD`):

```bash
npm run publishFeed
```

This creates an `app.bsky.feed.generator` record on your account pointing at your
service DID. Your feed then appears in the Bluesky app. To remove it:

```bash
npm run unpublishFeed
```

## Notes & limitations

- **No auth on `getFeedSkeleton`** — the feed is public. Add JWT verification if
  you need per-viewer logic.
- **Self-labels only cover author-declared labels**, not third-party labeler
  verdicts (those aren't in the firehose commit records).
- Change filters by editing the ENV vars and redeploying/restarting.
- The `post` table grows over time; add a periodic cleanup job if needed.
