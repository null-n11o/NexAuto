# Threads モメンタム連動 LINE誘導オートリプライ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dober/Threads の published 投稿を publish後一定時間監視し、インプレが閾値に達した投稿にだけ LINE誘導リプを1回自動でぶら下げる。

**Architecture:** 既存 `/api/cron/publish`（cron-job.org 起動 → CRON_SECRET認証 → posts走査 → Threads API）と同型の独立cronエンドポイント `/api/cron/auto-reply` を追加する。`postToThreads` に返信対応（`reply_to_id`）を足し、`posts` の発火フラグと `accounts` のアカウント別設定で制御する。

**Tech Stack:** Next.js 16 (App Router, Route Handlers) / TypeScript / Supabase (service role) / Vitest / Threads Graph API v1.0 / cron-job.org

## Global Constraints

- **対象アカウントは Dober/Threads のみ**（`account_name = 'Dober/Threads'`）。他アカウントは `auto_reply_config = NULL` で無効。
- **初期値：閾値 500 インプレ / ウィンドウ 60分 / cron 10分毎**。すべて `accounts.auto_reply_config` で設定変更可能にする。
- **リプ文面は以下を一字一句そのまま**（Dober公式コピー・確定）:
  ```
  公式LINE登録者に以下無料で配布しておりますのでぜひ。「無料特典を受け取る」とメッセージお願いいたします。
  note記事『人生をイージーモードに変える「規律」の教科書：一流の男たちが実践するメンタルと習慣の作り方』
  https://lin.ee/NnXNfzd
  ```
- **既存の新規投稿経路（`replyToId` 未指定）は無変更・回帰なし。**
- **1投稿1リプ（冪等）**。`posts.cta_reply_posted` フラグで担保する。
- TDD（Vitest, `// @vitest-environment node`）。テストはDBに接続せず、依存を `vi.mock` / `vi.hoisted` でモックする。
- cron は既存 `/api/cron/publish` と同一の `Bearer ${process.env.CRON_SECRET}` 認証。
- Threads access_token は AES暗号化保存。使用時に `decrypt()`（`@/lib/crypto`）で復号する。`platform_user_id` は平文。

## File Structure

| ファイル | 種別 | 責務 |
|---|---|---|
| `supabase/migrations/20260729000000_auto_reply.sql` | 新規 | posts 発火列 / accounts 設定列 / 部分index |
| `src/test/schema/auto-reply-migration.test.ts` | 新規 | 上記マイグレーションのスキーマ整合テスト |
| `src/lib/threads-api.ts` | 修正 | `postToThreads` に `replyToId` 追加 |
| `src/test/lib/threads-api.test.ts` | 修正 | `reply_to_id` 付与/非付与のテスト追加 |
| `src/app/api/cron/auto-reply/route.ts` | 新規 | 対象抽出→判定→リプ投稿→フラグ更新 |
| `src/test/api/auto-reply.test.ts` | 新規 | cron route のテスト |
| `scripts/seed-dober-auto-reply.mjs` | 新規 | Dober アカウントへ `auto_reply_config` 投入 |

---

### Task 1: DB マイグレーション（発火フラグ・アカウント設定・index）

**Files:**
- Create: `supabase/migrations/20260729000000_auto_reply.sql`
- Test: `src/test/schema/auto-reply-migration.test.ts`

**Interfaces:**
- Consumes: 既存 `posts` / `accounts` テーブル。
- Produces: `posts.cta_reply_posted BOOLEAN NOT NULL DEFAULT FALSE`, `posts.cta_reply_post_id TEXT`, `accounts.auto_reply_config JSONB`。以降のタスクがこれらを参照する。

- [ ] **Step 1: Write the failing test**

Create `src/test/schema/auto-reply-migration.test.ts`:

```ts
// @vitest-environment node
/**
 * auto_reply マイグレーションのスキーマ整合テスト。
 * DBには接続せず、SQLファイルをパースして期待するカラム/indexの存在を検証する。
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect, beforeAll } from 'vitest'

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/20260729000000_auto_reply.sql',
)

let sql: string

beforeAll(() => {
  sql = readFileSync(MIGRATION_PATH, 'utf-8')
})

describe('posts auto-reply columns', () => {
  it('adds cta_reply_posted boolean not null default false', () => {
    expect(sql).toMatch(/ALTER TABLE posts[\s\S]*cta_reply_posted\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i)
  })
  it('adds cta_reply_post_id text', () => {
    expect(sql).toMatch(/cta_reply_post_id\s+TEXT/i)
  })
})

describe('accounts auto-reply config', () => {
  it('adds auto_reply_config jsonb', () => {
    expect(sql).toMatch(/ALTER TABLE accounts[\s\S]*auto_reply_config\s+JSONB/i)
  })
})

describe('pending index', () => {
  it('creates partial index over pending published posts', () => {
    expect(sql).toMatch(/CREATE INDEX[\s\S]*idx_posts_auto_reply_pending[\s\S]*ON posts[\s\S]*WHERE status = 'published' AND cta_reply_posted = FALSE/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/schema/auto-reply-migration.test.ts`
Expected: FAIL — `ENOENT` (migration file not found) / `readFileSync` throws.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260729000000_auto_reply.sql`:

```sql
-- Momentum-gated LINE CTA auto-reply support.

-- posts: 発火状態（1投稿1リプの冪等担保）
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS cta_reply_posted  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cta_reply_post_id TEXT;

-- accounts: アカウント別オートリプ設定
--   { "enabled": bool, "threshold": int, "window_minutes": int, "templates": string[] }
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS auto_reply_config JSONB;

-- 監視対象（未発火の published 投稿）を絞る部分index
CREATE INDEX IF NOT EXISTS idx_posts_auto_reply_pending
  ON posts (published_at)
  WHERE status = 'published' AND cta_reply_posted = FALSE;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/schema/auto-reply-migration.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Apply the migration to the database**

Run: `npx supabase db push`
Expected: マイグレーションが適用される。ローカルSupabaseを使わない運用なら、Supabase ダッシュボード SQL Editor に上記SQLを貼って実行し、`posts` と `accounts` に列が追加されたことを確認する。

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260729000000_auto_reply.sql src/test/schema/auto-reply-migration.test.ts
git commit -m "feat: add auto-reply schema (posts flags, accounts config, pending index)"
```

---

### Task 2: `postToThreads` に返信（reply_to_id）対応を追加

**Files:**
- Modify: `src/lib/threads-api.ts`（`ThreadsPostOptions` と `postToThreads` の container作成部）
- Test: `src/test/lib/threads-api.test.ts`（テスト追加）

**Interfaces:**
- Consumes: なし（既存の Threads API フロー）。
- Produces: `postToThreads(opts: { accessToken: string; userId: string; content: string; imageUrl?: string | null; replyToId?: string | null }): Promise<{ platformPostId: string; meta: PublishMeta }>`。`replyToId` 指定時、container作成URLに `reply_to_id=<id>` を付与する。Task 3 がこれを利用する。

- [ ] **Step 1: Write the failing test**

Add to `src/test/lib/threads-api.test.ts`（`describe('postToThreads', ...)` の末尾、最後の `it(...)` の後に追記）:

```ts
  it('adds reply_to_id to the create container request when replyToId is provided', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'container-123' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'FINISHED' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'reply-456' }) })
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = postToThreads({
      accessToken: 'token-abc',
      userId: 'user-789',
      content: 'ぶら下げリプ',
      replyToId: 'parent-999',
    })
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.platformPostId).toBe('reply-456')
    const [createUrl] = mockFetch.mock.calls[0]
    expect(createUrl).toContain('reply_to_id=parent-999')
  })

  it('does NOT add reply_to_id when replyToId is not provided', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'container-123' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'FINISHED' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'post-456' }) })
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = postToThreads({
      accessToken: 'token-abc',
      userId: 'user-789',
      content: '通常投稿',
    })
    await vi.runAllTimersAsync()
    await resultPromise

    const [createUrl] = mockFetch.mock.calls[0]
    expect(createUrl).not.toContain('reply_to_id')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/lib/threads-api.test.ts -t "reply_to_id"`
Expected: FAIL — 1本目のテストで `createUrl` に `reply_to_id=parent-999` が含まれない。

- [ ] **Step 3: Implement replyToId support**

In `src/lib/threads-api.ts`, add `replyToId` to the options interface:

```ts
interface ThreadsPostOptions {
  accessToken: string
  userId: string
  content: string
  imageUrl?: string | null
  replyToId?: string | null
}
```

Update the function signature destructuring and the container-create block:

```ts
export async function postToThreads(
  { accessToken, userId, content, imageUrl, replyToId }: ThreadsPostOptions,
): Promise<{ platformPostId: string; meta: PublishMeta }> {
  const meta: PublishMeta = { containerId: null, create: null, status: null, publish: null, failedStep: null }

  // Step 1: Create media container
  const createUrl = new URL(`${THREADS_API_BASE}/${userId}/threads`)
  createUrl.searchParams.set('media_type', imageUrl ? 'IMAGE' : 'TEXT')
  createUrl.searchParams.set('text', content)
  if (imageUrl) createUrl.searchParams.set('image_url', imageUrl)
  if (replyToId) createUrl.searchParams.set('reply_to_id', replyToId)
  createUrl.searchParams.set('access_token', accessToken)
  // ...（以降のstatus待ち・publishは無変更）
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/test/lib/threads-api.test.ts`
Expected: PASS（既存テスト＋追加2本すべて green。既存の新規投稿テストが `reply_to_id` 無しで通ることも確認）

- [ ] **Step 5: Commit**

```bash
git add src/lib/threads-api.ts src/test/lib/threads-api.test.ts
git commit -m "feat: support reply_to_id in postToThreads for reply threads"
```

---

### Task 3: 発火cron `/api/cron/auto-reply`

**Files:**
- Create: `src/app/api/cron/auto-reply/route.ts`
- Test: `src/test/api/auto-reply.test.ts`

**Interfaces:**
- Consumes:
  - `postToThreads({ accessToken, userId, content, replyToId })`（Task 2）
  - `fetchThreadsPostMetrics({ mediaId, accessToken }): Promise<{ impressions, likes, replies, reposts }>`（既存 `@/lib/threads-metrics`）
  - `decrypt(s: string): string`（既存 `@/lib/crypto`）
  - `createServiceClient()`（既存 `@/lib/supabase/server`）
  - `posts.cta_reply_posted` / `posts.cta_reply_post_id` / `accounts.auto_reply_config`（Task 1）
- Produces: `GET(request: Request): Promise<NextResponse>`。JSON `{ replied: number, checked: number }` を返す。

- [ ] **Step 1: Write the failing test**

Create `src/test/api/auto-reply.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const {
  mockFetchThreadsMetrics,
  mockPostToThreads,
  mockCreateServiceClient,
} = vi.hoisted(() => ({
  mockFetchThreadsMetrics: vi.fn(),
  mockPostToThreads: vi.fn(),
  mockCreateServiceClient: vi.fn(),
}))

vi.mock('@/lib/threads-metrics', () => ({ fetchThreadsPostMetrics: mockFetchThreadsMetrics }))
vi.mock('@/lib/threads-api', () => ({ postToThreads: mockPostToThreads }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: mockCreateServiceClient }))
vi.mock('@/lib/crypto', () => ({ decrypt: (s: string) => s }))

import { GET } from '@/app/api/cron/auto-reply/route'

const CONFIG = {
  enabled: true,
  threshold: 500,
  window_minutes: 60,
  templates: ['公式LINEはこちら https://lin.ee/NnXNfzd'],
}

function makeRequest(secret = 'test-secret') {
  return new Request('http://localhost/api/cron/auto-reply', {
    headers: { authorization: `Bearer ${secret}` },
  })
}

function makeSupabaseMock(posts: object[]) {
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: object[] }) => void) => resolve({ data: posts }),
  }
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'posts') return { select: vi.fn().mockReturnValue(selectChain), update }
    return {}
  })
  mockCreateServiceClient.mockResolvedValue({ from })
  return { from, update, updateEq, selectChain }
}

function threadsPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    platform_post_id: 'media-1',
    published_at: new Date().toISOString(), // just now → within window
    cta_reply_posted: false,
    accounts: {
      platform: 'threads',
      access_token: 'enc-token',
      platform_user_id: 'user-1',
      auto_reply_config: CONFIG,
    },
    ...overrides,
  }
}

describe('GET /api/cron/auto-reply', () => {
  beforeAll(() => {
    process.env.CRON_SECRET = 'test-secret'
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mockPostToThreads.mockResolvedValue({ platformPostId: 'reply-1', meta: {} })
  })

  it('CRON_SECRET が一致しない場合 401 を返す', async () => {
    const res = await GET(makeRequest('wrong'))
    expect(res.status).toBe(401)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('インプレが閾値以上ならリプを投稿し発火フラグを立てる', async () => {
    mockFetchThreadsMetrics.mockResolvedValue({ impressions: 800, likes: 5, replies: 0, reposts: 0 })
    const { update, updateEq } = makeSupabaseMock([threadsPost()])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.replied).toBe(1)
    expect(mockPostToThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'enc-token', // decrypt はテストでは identity
        userId: 'user-1',
        content: CONFIG.templates[0],
        replyToId: 'media-1',
      }),
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ cta_reply_posted: true, cta_reply_post_id: 'reply-1' }),
    )
    expect(updateEq).toHaveBeenCalledWith('id', 'post-1')
  })

  it('インプレが閾値未満ならリプを投稿しない', async () => {
    mockFetchThreadsMetrics.mockResolvedValue({ impressions: 300, likes: 1, replies: 0, reposts: 0 })
    makeSupabaseMock([threadsPost()])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.replied).toBe(0)
    expect(mockPostToThreads).not.toHaveBeenCalled()
  })

  it('publish後ウィンドウ(60分)を過ぎた投稿はメトリクスを見ずスキップする', async () => {
    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString()
    makeSupabaseMock([threadsPost({ published_at: old })])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.replied).toBe(0)
    expect(mockFetchThreadsMetrics).not.toHaveBeenCalled()
    expect(mockPostToThreads).not.toHaveBeenCalled()
  })

  it('config が enabled=false のアカウントはスキップする', async () => {
    makeSupabaseMock([threadsPost({
      accounts: { platform: 'threads', access_token: 'enc-token', platform_user_id: 'user-1',
        auto_reply_config: { ...CONFIG, enabled: false } },
    })])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.replied).toBe(0)
    expect(mockFetchThreadsMetrics).not.toHaveBeenCalled()
  })

  it('未発火 published のみを対象にクエリする（冪等フィルタ）', async () => {
    mockFetchThreadsMetrics.mockResolvedValue({ impressions: 800, likes: 0, replies: 0, reposts: 0 })
    const { selectChain } = makeSupabaseMock([threadsPost()])

    await GET(makeRequest())

    expect(selectChain.eq).toHaveBeenCalledWith('status', 'published')
    expect(selectChain.eq).toHaveBeenCalledWith('cta_reply_posted', false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/api/auto-reply.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/cron/auto-reply/route'`。

- [ ] **Step 3: Implement the cron route**

Create `src/app/api/cron/auto-reply/route.ts`:

```ts
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { fetchThreadsPostMetrics } from '@/lib/threads-metrics'
import { postToThreads } from '@/lib/threads-api'
import { decrypt } from '@/lib/crypto'

interface AutoReplyConfig {
  enabled?: boolean
  threshold?: number
  window_minutes?: number
  templates?: string[]
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

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  const { data: posts } = await supabase
    .from('posts')
    .select('id, platform_post_id, published_at, cta_reply_posted, accounts(platform, access_token, platform_user_id, auto_reply_config)')
    .eq('status', 'published')
    .eq('cta_reply_posted', false)
    .not('platform_post_id', 'is', null)
    .not('published_at', 'is', null)

  if (!posts?.length) return NextResponse.json({ replied: 0, checked: 0 })

  const now = Date.now()

  // 対象を絞り込む（enabled / threads / ウィンドウ内）
  const candidates = posts.filter((post) => {
    const accountRaw = post.accounts as unknown
    const account = (Array.isArray(accountRaw) ? accountRaw[0] : accountRaw) as AccountShape | undefined
    const config = account?.auto_reply_config
    if (!account || account.platform !== 'threads' || !config?.enabled) return false
    if (!account.access_token || !account.platform_user_id) return false
    const windowMs = (config.window_minutes ?? 60) * 60 * 1000
    const elapsed = now - new Date(post.published_at as string).getTime()
    return elapsed >= 0 && elapsed <= windowMs
  })

  if (!candidates.length) return NextResponse.json({ replied: 0, checked: 0 })

  const results = await Promise.allSettled(
    candidates.map(async (post) => {
      const accountRaw = post.accounts as unknown
      const account = (Array.isArray(accountRaw) ? accountRaw[0] : accountRaw) as AccountShape
      const config = account.auto_reply_config as AutoReplyConfig
      const threshold = config.threshold ?? 500
      const templates = config.templates ?? []
      if (!templates.length) return { replied: false }

      const accessToken = decrypt(account.access_token as string)
      const mediaId = post.platform_post_id as string

      const metrics = await fetchThreadsPostMetrics({ mediaId, accessToken })
      if (metrics.impressions < threshold) return { replied: false }

      const { platformPostId } = await postToThreads({
        accessToken,
        userId: account.platform_user_id as string,
        content: pickTemplate(templates),
        replyToId: mediaId,
      })

      await supabase
        .from('posts')
        .update({ cta_reply_posted: true, cta_reply_post_id: platformPostId })
        .eq('id', post.id)

      return { replied: true }
    }),
  )

  const replied = results.filter(
    (r) => r.status === 'fulfilled' && (r.value as { replied: boolean }).replied,
  ).length

  return NextResponse.json({ replied, checked: candidates.length })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/test/api/auto-reply.test.ts`
Expected: PASS（6テストすべて green）

- [ ] **Step 5: Run the full test suite for regressions**

Run: `npm run test:run`
Expected: 全テスト PASS（特に既存 `threads-api.test.ts` / `metrics-fetch.test.ts` / `publish` 系に回帰が無いこと）

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/auto-reply/route.ts src/test/api/auto-reply.test.ts
git commit -m "feat: add /api/cron/auto-reply momentum-gated LINE CTA reply"
```

---

### Task 4: Dober アカウントへ `auto_reply_config` を投入

**Files:**
- Create: `scripts/seed-dober-auto-reply.mjs`

**Interfaces:**
- Consumes: `accounts.auto_reply_config`（Task 1）。Supabase 認証は `.mcp.json`（`mcpServers['nexauto'].env`）から読む。**キーの値は出力しない。**
- Produces: Dober/Threads アカウントの `auto_reply_config` に確定設定を書き込む。

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-dober-auto-reply.mjs`:

```mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(__dirname, '..') + '/')
const { createClient } = require('@supabase/supabase-js')

const cfg = JSON.parse(readFileSync(resolve(__dirname, '../.mcp.json'), 'utf8'))
const env = cfg.mcpServers?.['nexauto']?.env ?? cfg.mcpServers?.['sns-automation']?.env
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const AUTO_REPLY_CONFIG = {
  enabled: true,
  threshold: 500,
  window_minutes: 60,
  templates: [
    '公式LINE登録者に以下無料で配布しておりますのでぜひ。「無料特典を受け取る」とメッセージお願いいたします。\nnote記事『人生をイージーモードに変える「規律」の教科書：一流の男たちが実践するメンタルと習慣の作り方』\nhttps://lin.ee/NnXNfzd',
  ],
}

const { data, error } = await supabase
  .from('accounts')
  .update({ auto_reply_config: AUTO_REPLY_CONFIG })
  .eq('account_name', 'Dober/Threads')
  .select('id, account_name, auto_reply_config')

if (error) {
  console.error('update failed:', error.message)
  process.exit(1)
}
console.log('updated:', JSON.stringify(data, null, 2))
```

- [ ] **Step 2: Run the seed script**

Run: `node scripts/seed-dober-auto-reply.mjs`
Expected: `updated: [ { id: 'df3bd84a-…', account_name: 'Dober/Threads', auto_reply_config: { enabled: true, threshold: 500, ... } } ]` が出力される。

- [ ] **Step 3: Verify other accounts remain disabled**

Run:
```bash
node -e "const{readFileSync}=require('fs');const c=JSON.parse(readFileSync('.mcp.json','utf8'));const env=c.mcpServers['nexauto']?.env||c.mcpServers['sns-automation']?.env;const{createClient}=require('@supabase/supabase-js');const s=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);s.from('accounts').select('account_name,auto_reply_config').then(({data})=>console.log(JSON.stringify(data,null,2)))"
```
Expected: Dober/Threads のみ config あり、他アカウント（Kentaro Nakano）は `null`。

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-dober-auto-reply.mjs
git commit -m "chore: seed Dober auto_reply_config"
```

---

### Task 5: 本番トリガー登録と発火確認（運用・コード外）

**Files:** なし（cron-job.org 設定 + 本番観測）

**Interfaces:**
- Consumes: デプロイ済み `/api/cron/auto-reply`（Task 3）と投入済み config（Task 4）。

- [ ] **Step 1: デプロイ**

Run: `git push`（Vercel が本番反映）。反映後、エンドポイントが応答することを確認:
```bash
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer <CRON_SECRET>" "<APP_URL>/api/cron/auto-reply"
```
Expected: `200`。ボディは `{"replied":0,"checked":...}`。

- [ ] **Step 2: cron-job.org にジョブ追加**

既存 publish ジョブと同じ cron-job.org アカウントで新規ジョブを作成:
- URL: `<APP_URL>/api/cron/auto-reply`
- Method: GET
- Header: `Authorization: Bearer <CRON_SECRET>`
- スケジュール: 10分毎（`*/10 * * * *`）

- [ ] **Step 3: 実発火の確認**

Dober の次の投稿が publish されてから60分以内に、インプレが500を超えたタイミングで、その投稿にLINE誘導リプがぶら下がることを Threads 上で目視確認する。あわせて Supabase で当該 `posts.cta_reply_posted = true` / `cta_reply_post_id` が入っていることを確認:
```bash
node -e "const{readFileSync}=require('fs');const c=JSON.parse(readFileSync('.mcp.json','utf8'));const env=c.mcpServers['nexauto']?.env||c.mcpServers['sns-automation']?.env;const{createClient}=require('@supabase/supabase-js');const s=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);s.from('posts').select('id,cta_reply_posted,cta_reply_post_id,published_at').eq('cta_reply_posted',true).order('published_at',{ascending:false}).limit(5).then(({data})=>console.log(JSON.stringify(data,null,2)))"
```
Expected: 直近の発火投稿が並ぶ。

- [ ] **Step 4: 不発弾に付いていないことの確認**

同時間帯にインプレ500未満で停滞した投稿には `cta_reply_posted = false` のままリプが付いていないことを確認する（誤発火が無いこと）。

---

## Self-Review

**Spec coverage:**
- §4.1 Threads API拡張 → Task 2 ✅
- §4.2 DB変更（posts列・accounts列） → Task 1 ✅
- §4.3 発火cron（認証・抽出・判定・投稿・フラグ更新・冪等） → Task 3 ✅
- §4.4 トリガー（cron-job.org 10分毎） → Task 5 ✅
- §5 文面（確定コピー） → Global Constraints + Task 4 templates ✅
- §6 エッジケース（Insights遅延=閾値未達扱い / 失敗時フラグ非更新で再試行 / ウィンドウ境界 / service role） → Task 3 実装＋テスト（ウィンドウ超過・閾値未満）✅
- §7 テスト方針 → Task 2・3 のテスト ✅
- §2 やらないこと（Dober限定・UIなし） → Global Constraints + Task 4（Dober限定投入）✅

**Placeholder scan:** プレースホルダなし。全ステップに実コード/実コマンドあり。`<CRON_SECRET>` `<APP_URL>` は環境固有の秘匿値/URLのため運用ステップでのみ登場（コードには埋め込まない）。

**Type consistency:** `postToThreads({ accessToken, userId, content, replyToId })` は Task 2 の Produces と Task 3 の呼び出しで一致。`fetchThreadsPostMetrics({ mediaId, accessToken }) → { impressions, ... }` は既存シグネチャと一致。`auto_reply_config` の形（enabled/threshold/window_minutes/templates）は Task 1・3・4 で一致。`GET → { replied, checked }` は Task 3 実装とテストで一致。

**補足（§6 失敗時再試行の挙動）:** リプ投稿が失敗した場合、`Promise.allSettled` で rejected となり `cta_reply_posted` は更新されない。次回cronで（ウィンドウ内なら）同投稿が再抽出され再試行される。これは spec §6「リプ投稿失敗 → フラグ非更新 → 再試行」と一致。
