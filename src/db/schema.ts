export interface DatabaseSchema {
  post: Post
  sub_state: SubState
}

export interface Post {
  uri: string
  cid: string
  author: string
  /** ISO-8601 timestamp of when we indexed the post. */
  indexedAt: string
  /** Comma-separated list of reasons the post matched (e.g. "label:porn,kw:cats"). */
  reason: string | null
  /** Truncated post text, stored for debugging/inspection. */
  text: string | null
}

export interface SubState {
  service: string
  cursor: number
}
