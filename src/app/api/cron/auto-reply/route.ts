import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { fetchThreadsPostMetrics } from '@/lib/threads-metrics'
import { postToThreads } from '@/lib/threads-api'
import { decrypt } from '@/lib/crypto'

interface AutoReplyTier {
  window_minutes: number
  threshold: number
}

interface AutoReplyConfig {
  enabled?: boolean
  threshold?: number
  window_minutes?: number
  tiers?: AutoReplyTier[]
  templates?: string[]
}

// tiers があればそれを、無ければ従来の単一 threshold/window_minutes を1段として扱う
function resolveTiers(config: AutoReplyConfig): AutoReplyTier[] {
  if (config.tiers?.length) return config.tiers
  return [{ window_minutes: config.window_minutes ?? 60, threshold: config.threshold ?? 500 }]
}

interface AccountShape {
  platform: string
  access_token: string | null
  platform_user_id: string | null
  auto_reply_config: AutoReplyConfig | null
}

function pickTemplate(templates: string[]): string {
  return templates[Math.floor(Math.random() * templates.length)]
}

type Stage = 'load_posts' | 'config' | 'decrypt' | 'metrics' | 'claim' | 'publish' | 'persist' | 'reconcile'
interface Failure {
  postId?: string
  stage: Stage
  replyId?: string
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const errors: Failure[] = []
  let replied = 0
  let checked = 0
  const report = (failure: Failure) => {
    errors.push(failure)
    // Do not log raw exceptions: API/network errors may contain access tokens or URLs.
    console.error('[auto-reply] failure', failure)
  }
  const finish = () => {
    const summary = { replied, checked, failed: errors.length, errors }
    console.info('[auto-reply] completed', summary)
    // Only a broken sweep should fail the HTTP job. Per-post errors stay in the
    // body so cron-job.org keeps calling the endpoint instead of disabling it.
    const fatal = errors.some(error => error.stage === 'load_posts')
    return NextResponse.json(summary, { status: fatal ? 500 : 200 })
  }

  try {
    const supabase = await createServiceClient()
    let cursor: string | undefined
    // Keyset pagination stays stable as successful posts leave the pending set.
    // Continue until an empty page, even when the database caps results below our limit.
    while (true) {
      let query = supabase.from('posts')
        .select('id, platform_post_id, published_at, cta_reply_posted, cta_reply_claimed_at, accounts(platform, access_token, platform_user_id, auto_reply_config)')
        .eq('status', 'published')
        .eq('cta_reply_posted', false)
        .not('platform_post_id', 'is', null)
        .not('published_at', 'is', null)
        .order('id', { ascending: true })
        .limit(200)
      if (cursor) query = query.gt('id', cursor)
      const { data: posts, error } = await query
      if (error) { report({ stage: 'load_posts' }); break }
      if (!posts?.length) break
      cursor = posts[posts.length - 1].id

      // Limit concurrent external requests without letting a failed post stop the page.
      for (let offset = 0; offset < posts.length; offset += 5) {
        await Promise.all(posts.slice(offset, offset + 5).map(async (post) => {
          let stage: Stage = 'config'
          let replyId: string | undefined
          try {
            // Retained claims need operator reconciliation even after the eligibility window.
            if (post.cta_reply_claimed_at) {
              if (Date.now() - new Date(post.cta_reply_claimed_at).getTime() > 15 * 60 * 1000) {
                report({ postId: post.id, stage: 'reconcile' })
              }
              return
            }
            const raw = post.accounts as unknown
            const account = (Array.isArray(raw) ? raw[0] : raw) as AccountShape | undefined
            const config = account?.auto_reply_config
            if (!account || account.platform !== 'threads' || !config?.enabled) return
            const tiers = resolveTiers(config)
            if (!tiers.every(t => Number.isFinite(t.window_minutes) && t.window_minutes > 0 && Number.isFinite(t.threshold) && t.threshold > 0)) {
              report({ postId: post.id, stage }); return
            }
            const elapsed = () => Date.now() - new Date(post.published_at as string).getTime()
            if (elapsed() < 0 || elapsed() > Math.max(...tiers.map(t => t.window_minutes)) * 60000) return
            checked++
            const templates = config.templates?.filter(t => typeof t === 'string' && t.trim()) ?? []
            if (!account.access_token || !account.platform_user_id || !templates.length) {
              report({ postId: post.id, stage }); return
            }
            stage = 'decrypt'
            const accessToken = decrypt(account.access_token)
            stage = 'metrics'
            const metrics = await fetchThreadsPostMetrics({ mediaId: post.platform_post_id as string, accessToken })
            if (!tiers.some(t => elapsed() <= t.window_minutes * 60000 && metrics.impressions >= t.threshold)) return

            stage = 'claim'
            const claimedAt = new Date().toISOString()
            const claim = await supabase.from('posts')
              .update({ cta_reply_claimed_at: claimedAt })
              .eq('id', post.id)
              .eq('cta_reply_posted', false)
              .is('cta_reply_claimed_at', null)
              .select('id')
            if (claim.error) { report({ postId: post.id, stage }); return }
            if (!claim.data?.length) return // Another invocation owns this post.

            // Never release a claim automatically after a send attempt. A timeout can mean
            // Threads published successfully but the response was lost; retry would duplicate it.
            stage = 'publish'
            const result = await postToThreads({
              accessToken, userId: account.platform_user_id,
              content: pickTemplate(templates), replyToId: post.platform_post_id as string,
            })
            replyId = result.platformPostId
            replied++
            stage = 'persist'
            const saved = await supabase.from('posts')
              .update({ cta_reply_posted: true, cta_reply_post_id: replyId })
              .eq('id', post.id)
              .eq('cta_reply_claimed_at', claimedAt)
              .select('id')
            if (saved.error || !saved.data?.length) report({ postId: post.id, stage, replyId })
          } catch {
            report({ postId: post.id, stage, ...(replyId ? { replyId } : {}) })
          }
        }))
      }
    }
  } catch {
    report({ stage: 'load_posts' })
  }
  return finish()
}
