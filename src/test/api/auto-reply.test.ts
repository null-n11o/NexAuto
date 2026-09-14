// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

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

import { GET, pendingScanFilter } from '@/app/api/cron/auto-reply/route'

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

function makeSupabaseMock(
  posts: object[],
  accounts: { data: object[] | null, error: unknown } = { data: [{ auto_reply_config: CONFIG }], error: null },
) {
  const updateResult = { data: [{ id: 'post-1' }], error: null as unknown }
  const updateChain = { eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), then: (resolve: (v: unknown) => void) => resolve(updateResult) }
  const updateEq = vi.fn().mockReturnValue(updateChain)
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    gt: vi.fn().mockImplementation(function (this: { then: ReturnType<typeof vi.fn> }) { this.then.mockImplementation((resolve) => resolve({ data: [], error: null })); return this }),
    then: vi.fn().mockImplementation((resolve: (v: unknown) => void) => resolve({ data: posts, error: null })),
  }
  const accountSelect = {
    then: vi.fn().mockImplementation((resolve: (v: unknown) => void) => resolve(accounts)),
  }
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'posts') return { select: vi.fn().mockReturnValue(selectChain), update }
    if (table === 'accounts') return { select: vi.fn().mockReturnValue(accountSelect) }
    return {}
  })
  mockCreateServiceClient.mockResolvedValue({ from })
  return { from, update, updateEq, selectChain, updateResult }
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

const TIERS = [
  { window_minutes: 30, threshold: 200 },
  { window_minutes: 60, threshold: 350 },
  { window_minutes: 360, threshold: 500 },
  { window_minutes: 600, threshold: 600 },
]
const TIERED_CONFIG = { enabled: true, tiers: TIERS, templates: CONFIG.templates }

function tieredPost(minutesAgo: number, overrides: Record<string, unknown> = {}) {
  return threadsPost({
    published_at: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
    accounts: {
      platform: 'threads',
      access_token: 'enc-token',
      platform_user_id: 'user-1',
      auto_reply_config: TIERED_CONFIG,
    },
    ...overrides,
  })
}

describe('GET /api/cron/auto-reply', () => {
  beforeAll(() => {
    process.env.CRON_SECRET = 'test-secret'
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    mockPostToThreads.mockResolvedValue({ platformPostId: 'reply-1', meta: {} })
  })

  afterEach(() => { vi.restoreAllMocks() })

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

  describe('tiers（OR条件）', () => {
    it('tier1: 30分以内かつ200インプレ以上で発火する', async () => {
      mockFetchThreadsMetrics.mockResolvedValue({ impressions: 250, likes: 0, replies: 0, reposts: 0 })
      makeSupabaseMock([tieredPost(20)])

      const res = await GET(makeRequest())
      const body = await res.json()

      expect(body.replied).toBe(1)
      expect(mockPostToThreads).toHaveBeenCalledTimes(1)
    })

    it('30分を過ぎた250インプレは発火しない（tier2の350未満）', async () => {
      mockFetchThreadsMetrics.mockResolvedValue({ impressions: 250, likes: 0, replies: 0, reposts: 0 })
      makeSupabaseMock([tieredPost(45)])

      const res = await GET(makeRequest())
      const body = await res.json()

      expect(body.replied).toBe(0)
      expect(mockPostToThreads).not.toHaveBeenCalled()
    })

    it('tier2: 1時間以内かつ350インプレ以上で発火する', async () => {
      mockFetchThreadsMetrics.mockResolvedValue({ impressions: 400, likes: 0, replies: 0, reposts: 0 })
      makeSupabaseMock([tieredPost(45)])

      const res = await GET(makeRequest())
      const body = await res.json()

      expect(body.replied).toBe(1)
    })

    it('tier3: 6時間以内かつ500インプレ以上で発火する', async () => {
      mockFetchThreadsMetrics.mockResolvedValue({ impressions: 520, likes: 0, replies: 0, reposts: 0 })
      makeSupabaseMock([tieredPost(300)])

      const res = await GET(makeRequest())
      const body = await res.json()

      expect(body.replied).toBe(1)
    })

    it('tier4: 10時間以内かつ600インプレ以上で発火する', async () => {
      mockFetchThreadsMetrics.mockResolvedValue({ impressions: 650, likes: 0, replies: 0, reposts: 0 })
      makeSupabaseMock([tieredPost(540)])

      const res = await GET(makeRequest())
      const body = await res.json()

      expect(body.replied).toBe(1)
    })

    it('最大ウィンドウ(10時間)超過はメトリクスを見ずスキップする', async () => {
      makeSupabaseMock([tieredPost(660)])

      const res = await GET(makeRequest())
      const body = await res.json()

      expect(body.replied).toBe(0)
      expect(mockFetchThreadsMetrics).not.toHaveBeenCalled()
      expect(mockPostToThreads).not.toHaveBeenCalled()
    })
  })

  it('未発火 published のみを対象にクエリする（冪等フィルタ）', async () => {
    mockFetchThreadsMetrics.mockResolvedValue({ impressions: 800, likes: 0, replies: 0, reposts: 0 })
    const { selectChain } = makeSupabaseMock([threadsPost()])

    await GET(makeRequest())

    expect(selectChain.eq).toHaveBeenCalledWith('status', 'published')
    expect(selectChain.eq).toHaveBeenCalledWith('cta_reply_posted', false)
  })

  it('発火ウィンドウ内と未解決claimだけを走査する', async () => {
    mockFetchThreadsMetrics.mockResolvedValue({ impressions: 800, likes: 0, replies: 0, reposts: 0 })
    const { selectChain } = makeSupabaseMock([threadsPost()])

    await GET(makeRequest())

    expect(selectChain.or).toHaveBeenCalledWith(
      expect.stringMatching(/^published_at\.gte\."[^"]+",cta_reply_claimed_at\.not\.is\.null$/),
    )
  })

  it('アカウント設定の最大ウィンドウで走査範囲を決める', async () => {
    mockFetchThreadsMetrics.mockResolvedValue({ impressions: 250, likes: 0, replies: 0, reposts: 0 })
    const { selectChain } = makeSupabaseMock(
      [tieredPost(20)],
      { data: [{ auto_reply_config: TIERED_CONFIG }], error: null },
    )

    await GET(makeRequest())

    const filter = vi.mocked(selectChain.or).mock.calls[0]?.[0] as string
    const cutoff = filter.match(/published_at\.gte\."([^"]+)"/)?.[1]
    expect(cutoff).toBeTruthy()
    const ageMin = (Date.now() - new Date(cutoff as string).getTime()) / 60000
    expect(ageMin).toBeGreaterThan(599)
    expect(ageMin).toBeLessThan(601)
  })
})

describe('pendingScanFilter', () => {
  it('quotes the timestamp so PostgREST does not split on colons', () => {
    const filter = pendingScanFilter(720, Date.parse('2026-09-14T10:20:00Z'))
    expect(filter).toBe(
      'published_at.gte."2026-09-13T22:20:00.000Z",cta_reply_claimed_at.not.is.null',
    )
  })
})


describe('auto-reply failure reporting', () => {
  afterEach(() => { vi.restoreAllMocks() })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    mockFetchThreadsMetrics.mockResolvedValue({ impressions: 800 })
    mockPostToThreads.mockResolvedValue({ platformPostId: 'reply-1' })
  })

  it('reports database read failures instead of an empty success', async () => {
    const { selectChain } = makeSupabaseMock([])
    selectChain.then.mockImplementation((resolve) => resolve({ data: null, error: { code: '42703', message: 'column posts.cta_reply_claimed_at does not exist' } }))
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ failed: 1, errors: [{ stage: 'load_posts' }] })
    expect(console.error).toHaveBeenCalled()
  })

  it('reports metrics failure but continues other posts without leaking credentials', async () => {
    makeSupabaseMock([threadsPost(), threadsPost({ id: 'post-2' })])
    mockFetchThreadsMetrics.mockRejectedValueOnce(new Error('token=secret-do-not-log'))
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ replied: 1, checked: 2, failed: 1, errors: [{ postId: 'post-1', stage: 'metrics' }] })
    expect(JSON.stringify(body)).not.toContain('secret-do-not-log')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret-do-not-log')
  })

  it('does not send if claiming fails', async () => {
    const { updateResult } = makeSupabaseMock([threadsPost()])
    updateResult.error = { code: '08006' }
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ errors: [{ stage: 'claim' }] })
    expect(mockPostToThreads).not.toHaveBeenCalled()
  })

  it('detects a persistence update that affected zero rows', async () => {
    const { updateResult } = makeSupabaseMock([threadsPost()])
    mockPostToThreads.mockImplementationOnce(async () => {
      updateResult.data = []
      return { platformPostId: 'reply-1' }
    })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ replied: 1, errors: [{ stage: 'persist', replyId: 'reply-1' }] })
  })

  it('reports a later page failure while retaining earlier successes', async () => {
    const { selectChain } = makeSupabaseMock([])
    selectChain.gt.mockReturnThis()
    const pages = [
      { data: [threadsPost()], error: null },
      { data: null, error: { code: '08006' } },
    ]
    selectChain.then.mockImplementation((resolve) => resolve(pages.shift()))
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ replied: 1, errors: [{ stage: 'load_posts' }] })
  })

  it('reports stale claims even when their eligibility window has expired', async () => {
    makeSupabaseMock([threadsPost({ published_at: '2020-01-01T00:00:00Z', cta_reply_claimed_at: '2020-01-01T00:01:00Z' })])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ errors: [{ stage: 'reconcile' }] })
    expect(mockPostToThreads).not.toHaveBeenCalled()
  })

  it('does not flag an in-flight recent claim as failed', async () => {
    makeSupabaseMock([threadsPost({ cta_reply_claimed_at: new Date().toISOString() })])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(mockPostToThreads).not.toHaveBeenCalled()
  })

  it('reports send failure and retains claim for reconciliation', async () => {
    const { update } = makeSupabaseMock([threadsPost()])
    mockPostToThreads.mockRejectedValueOnce(new Error('network timeout'))
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ failed: 1, errors: [{ stage: 'publish' }] })
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ cta_reply_claimed_at: null }))
  })

  it('reports persistence failure with the published reply ID', async () => {
    const { update, updateResult } = makeSupabaseMock([threadsPost()])
    mockPostToThreads.mockImplementationOnce(async () => {
      updateResult.error = { code: '08006' }
      return { platformPostId: 'reply-1' }
    })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ replied: 1, failed: 1, errors: [{ stage: 'persist', replyId: 'reply-1' }] })
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ cta_reply_claimed_at: null }))
  })

  it('does not send when another invocation wins the atomic claim', async () => {
    const { updateResult } = makeSupabaseMock([threadsPost()])
    updateResult.data = []
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(mockPostToThreads).not.toHaveBeenCalled()
  })

  it('reports an unresolved previous attempt without sending again', async () => {
    makeSupabaseMock([threadsPost({ cta_reply_claimed_at: new Date(Date.now() - 3600000).toISOString() })])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ errors: [{ stage: 'reconcile' }] })
    expect(mockPostToThreads).not.toHaveBeenCalled()
  })

  it('loads subsequent pages even if the server caps a page below the requested size', async () => {
    const { selectChain } = makeSupabaseMock([])
    selectChain.gt.mockReturnThis()
    const pages = [[threadsPost({ id: 'post-1', published_at: '2020-01-01T00:00:00Z' })], [threadsPost({ id: 'post-2' })], []]
    selectChain.then.mockImplementation((resolve) => resolve({ data: pages.shift() ?? [], error: null }))
    const res = await GET(makeRequest())
    expect(await res.json()).toMatchObject({ replied: 1, checked: 1 })
    expect(selectChain.gt).toHaveBeenCalledWith('id', 'post-1')
  })

  it('uses a fallback window and stays HTTP 200 if account config cannot be loaded', async () => {
    mockFetchThreadsMetrics.mockResolvedValue({ impressions: 800, likes: 0, replies: 0, reposts: 0 })
    const { selectChain } = makeSupabaseMock([threadsPost()], { data: null, error: { code: '08006' } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ errors: [{ stage: 'config' }] })
    const filter = vi.mocked(selectChain.or).mock.calls[0]?.[0] as string
    const cutoff = filter.match(/published_at\.gte\."([^"]+)"/)?.[1]
    expect(cutoff).toBeTruthy()
    const ageMs = Date.now() - new Date(cutoff as string).getTime()
    expect(ageMs).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(ageMs).toBeLessThan(25 * 60 * 60 * 1000)
  })
})
