import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './crypto.js'

const THREADS_API_BASE = 'https://graph.threads.net/v1.0'
const THREAD_FIELDS = [
  'id',
  'text',
  'timestamp',
  'permalink',
  'username',
  'media_type',
  'media_product_type',
  'media_url',
  'thumbnail_url',
  'shortcode',
  'is_quote_post',
  'has_replies',
].join(',')
const PAGE_LIMIT = 100
const MAX_PAGES = 100

export interface ThreadsPost {
  id: string
  text?: string
  timestamp?: string
  permalink?: string
  username?: string
  media_type?: string
  media_product_type?: string
  media_url?: string
  thumbnail_url?: string
  shortcode?: string
  is_quote_post?: boolean
  has_replies?: boolean
  [key: string]: unknown
}

interface ThreadsResponse {
  data?: ThreadsPost[]
  paging?: { next?: string }
  error?: { message?: string }
}

interface ExistingPost {
  id: string
  platform_post_id: string | null
}

function dateBoundary(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} は ISO 8601 の日時で指定してください`)
  return parsed
}

function postTimestamp(post: ThreadsPost): Date | undefined {
  if (!post.timestamp) return undefined
  const parsed = new Date(post.timestamp)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function slugify(value: string): string {
  const slug = value.split('/')[0]
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
  return slug || 'account'
}

function apiError(response: Response, payload: ThreadsResponse): Error {
  const message = payload.error?.message || `Threads API returned HTTP ${response.status}`
  return new Error(`Threads API error: ${message}`)
}

async function fetchPage(url: URL | string, accessToken: string): Promise<ThreadsResponse> {
  const requestUrl = typeof url === 'string' ? new URL(url) : new URL(url.toString())
  if (!requestUrl.searchParams.has('access_token')) {
    requestUrl.searchParams.set('access_token', accessToken)
  }
  const response = await fetch(requestUrl, { signal: AbortSignal.timeout(30_000) })
  let payload: ThreadsResponse
  try {
    payload = await response.json() as ThreadsResponse
  } catch {
    throw new Error(`Threads API returned HTTP ${response.status} with an unreadable response`)
  }
  if (!response.ok) throw apiError(response, payload)
  return payload
}

export async function fetchThreadsPosts(
  accessToken: string,
  userId: string,
  since?: string,
  until?: string,
): Promise<{ posts: ThreadsPost[]; pages: number }> {
  const sinceDate = dateBoundary(since, 'since')
  const untilDate = dateBoundary(until, 'until')
  if (sinceDate && untilDate && sinceDate > untilDate) {
    throw new Error('since は until より前の日時で指定してください')
  }

  const firstUrl = new URL(`${THREADS_API_BASE}/${encodeURIComponent(userId)}/threads`)
  firstUrl.searchParams.set('fields', THREAD_FIELDS)
  firstUrl.searchParams.set('limit', String(PAGE_LIMIT))
  if (since) firstUrl.searchParams.set('since', since)
  if (until) firstUrl.searchParams.set('until', until)

  const postsById = new Map<string, ThreadsPost>()
  let next: URL | string = firstUrl
  let pages = 0

  while (next && pages < MAX_PAGES) {
    const payload = await fetchPage(next, accessToken)
    pages += 1
    for (const post of payload.data || []) {
      if (!post?.id) continue
      const timestamp = postTimestamp(post)
      if (sinceDate && timestamp && timestamp < sinceDate) continue
      if (untilDate && timestamp && timestamp > untilDate) continue
      postsById.set(post.id, post)
    }
    next = payload.paging?.next || ''
  }

  if (next) throw new Error(`Threads API pagination exceeded ${MAX_PAGES} pages`)
  return { posts: [...postsById.values()], pages }
}

function rowForPost(accountId: string, post: ThreadsPost) {
  const timestamp = postTimestamp(post)
  const timestampIso = timestamp?.toISOString() || null
  return {
    account_id: accountId,
    content: typeof post.text === 'string' ? post.text : '',
    scheduled_date: timestampIso?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    status: 'published',
    source: 'manual',
    platform_post_id: post.id,
    published_at: timestampIso,
    image_url: typeof post.media_url === 'string' ? post.media_url : null,
  }
}

async function loadExistingPosts(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ExistingPost[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('id, platform_post_id')
    .eq('account_id', accountId)
    .range(0, 99_999)
  if (error) throw new Error(error.message)
  return (data || []) as ExistingPost[]
}

export async function saveThreadsPosts(
  supabase: SupabaseClient,
  root: string,
  accountId: string,
  accountName: string,
  posts: ThreadsPost[],
  metadata: { since?: string; until?: string; pages: number; dryRun: boolean },
): Promise<{ inserted: number; updated: number; unchanged: number; exportPath: string }> {
  const existing = await loadExistingPosts(supabase, accountId)
  const existingByPlatformId = new Map(
    existing.filter((post) => post.platform_post_id).map((post) => [post.platform_post_id as string, post.id]),
  )
  const rows = posts.map((post) => rowForPost(accountId, post))
  let inserted = 0
  let updated = 0
  let unchanged = 0

  if (!metadata.dryRun) {
    const newRows = [] as ReturnType<typeof rowForPost>[]
    for (const row of rows) {
      const existingId = existingByPlatformId.get(row.platform_post_id)
      if (existingId) {
        const { error } = await supabase
          .from('posts')
          .update({
            content: row.content,
            scheduled_date: row.scheduled_date,
            status: row.status,
            published_at: row.published_at,
            image_url: row.image_url,
          })
          .eq('id', existingId)
        if (error) throw new Error(error.message)
        updated += 1
      } else {
        newRows.push(row)
      }
    }
    for (let start = 0; start < newRows.length; start += 100) {
      const chunk = newRows.slice(start, start + 100)
      const { error } = await supabase.from('posts').insert(chunk)
      if (error) throw new Error(error.message)
      inserted += chunk.length
    }
  } else {
    inserted = rows.filter((row) => !existingByPlatformId.has(row.platform_post_id)).length
    updated = rows.length - inserted
  }
  unchanged = existing.length === 0 ? 0 : rows.filter((row) => existingByPlatformId.has(row.platform_post_id)).length - updated

  const exportDate = new Date().toISOString().slice(0, 10)
  const exportRelative = join('data', 'exports', 'threads', slugify(accountName), `${exportDate}.json`)
  const exportPath = join(root, exportRelative)
  await mkdir(join(root, 'data', 'exports', 'threads', slugify(accountName)), { recursive: true })
  await writeFile(exportPath, JSON.stringify({
    source: 'threads-api',
    account_name: accountName,
    retrieved_at: new Date().toISOString(),
    since: metadata.since || null,
    until: metadata.until || null,
    pages: metadata.pages,
    dry_run: metadata.dryRun,
    counts: { posts: posts.length, inserted, updated, unchanged },
    posts,
  }, null, 2) + '\n', 'utf8')

  return { inserted, updated, unchanged, exportPath: exportRelative }
}

export async function syncThreadsPosts(
  supabase: SupabaseClient,
  root: string,
  accountId: string,
  since?: string,
  until?: string,
  dryRun = false,
): Promise<Record<string, unknown>> {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('account_name, platform, platform_user_id, access_token')
    .eq('id', accountId)
    .maybeSingle()
  if (accountError) throw new Error(accountError.message)
  if (!account) throw new Error('指定されたアカウントが見つかりません')
  if (account.platform !== 'threads') throw new Error('このツールはThreadsアカウント専用です')
  if (!account.platform_user_id || !account.access_token) {
    throw new Error('Threadsアカウントに platform_user_id または access_token がありません')
  }

  const accessToken = decrypt(account.access_token)
  const fetched = await fetchThreadsPosts(accessToken, account.platform_user_id, since, until)
  const saved = await saveThreadsPosts(supabase, root, accountId, account.account_name, fetched.posts, {
    since,
    until,
    pages: fetched.pages,
    dryRun,
  })
  return {
    account_name: account.account_name,
    platform: account.platform,
    since: since || null,
    until: until || null,
    pages: fetched.pages,
    fetched_posts: fetched.posts.length,
    dry_run: dryRun,
    ...saved,
  }
}
