import { describe, it, expect } from 'vitest'
import { calcEngagementRate, parseArgs, aggregate, buildWeeklyTrend, type MetricsPost, type FollowerSnapshot } from './analyze-utils'

describe('calcEngagementRate', () => {
  it('インプレッションに対するライク・リプライ・リポストの割合をパーセントで返す', () => {
    expect(calcEngagementRate(1000, 50, 10, 5)).toBe(6.5)
  })

  it('インプレッションが0のときは0を返す', () => {
    expect(calcEngagementRate(0, 5, 0, 0)).toBe(0)
  })
})

describe('parseArgs', () => {
  it('アカウント名のみ指定した場合、daysはデフォルト7になる', () => {
    expect(parseArgs(['Dober'])).toEqual({ accountQuery: 'Dober', days: 7 })
  })

  it('--daysオプションを指定できる', () => {
    expect(parseArgs(['Dober', '--days', '30'])).toEqual({ accountQuery: 'Dober', days: 30 })
  })

  it('アカウント名が無い場合はエラーになる', () => {
    expect(() => parseArgs([])).toThrow('アカウント名を指定してください')
    expect(() => parseArgs(['--days', '30'])).toThrow('アカウント名を指定してください')
  })

  it('--daysに数値以外を指定するとエラーになる', () => {
    expect(() => parseArgs(['Dober', '--days', 'abc'])).toThrow('--days には数値を指定してください')
  })
})

describe('aggregate', () => {
  const now = new Date('2026-06-12T00:00:00Z')

  const posts: MetricsPost[] = [
    {
      id: '1',
      content: 'A'.repeat(80),
      scheduledDate: '2026-06-10',
      publishedAt: '2026-06-10T00:00:00Z',
      impressions: 1000,
      likes: 50,
      replies: 10,
      reposts: 5,
    },
    {
      id: '2',
      content: 'short post',
      scheduledDate: '2026-06-05',
      publishedAt: '2026-06-05T00:00:00Z',
      impressions: 2000,
      likes: 20,
      replies: 0,
      reposts: 0,
    },
    {
      id: '3',
      content: 'old post',
      scheduledDate: '2026-05-01',
      publishedAt: '2026-05-01T00:00:00Z',
      impressions: 500,
      likes: 100,
      replies: 0,
      reposts: 0,
    },
  ]

  it('全体サマリーを計算する', () => {
    const summary = aggregate(posts, 7, now)

    expect(summary.totalPosts).toBe(3)
    expect(summary.totalImpressions).toBe(3500)
    expect(summary.totalLikes).toBe(170)
    expect(summary.totalReplies).toBe(10)
    expect(summary.totalReposts).toBe(5)
    expect(summary.avgImpressionsAll).toBe(1166.7)
    expect(summary.avgEngagementRateAll).toBe(9.2)
    expect(summary.oldestPostDate).toBe('2026-05-01')
    expect(summary.latestPostDate).toBe('2026-06-10')
  })

  it('直近N日間のサマリーを計算する（境界値は含む）', () => {
    const summary = aggregate(posts, 7, now)

    // 06-05, 06-10 は now(06-12) から7日以内
    expect(summary.recentPostsCount).toBe(2)
    expect(summary.recentImpressions).toBe(3000)
    expect(summary.recentLikes).toBe(70)
    expect(summary.avgImpressionsRecent).toBe(1500)
  })

  it('TOPは直近N日内の投稿のみを対象に、インプレッション順・エンゲージメント率順で返す', () => {
    const summary = aggregate(posts, 7, now)

    // id '3'(2026-05-01) は now(06-12) から7日より前なのでTOPに含めない
    expect(summary.topByImpressions.map(p => p.id)).toEqual(['2', '1'])
    expect(summary.topByEngagement.map(p => p.id)).toEqual(['1', '2'])
    expect(summary.topByEngagement[0].engagementRate).toBe(6.5)
  })

  it('期間を広げるとTOPに古い投稿も含まれる', () => {
    const summary = aggregate(posts, 60, now)

    expect(summary.topByImpressions.map(p => p.id)).toEqual(['2', '1', '3'])
    expect(summary.topByEngagement.map(p => p.id)).toEqual(['3', '1', '2'])
    expect(summary.topByEngagement[0].engagementRate).toBe(20)
  })

  it('投稿が0件の場合はゼロ値とN/Aを返す', () => {
    const summary = aggregate([], 7, now)

    expect(summary.totalPosts).toBe(0)
    expect(summary.totalImpressions).toBe(0)
    expect(summary.avgImpressionsAll).toBe(0)
    expect(summary.oldestPostDate).toBe('N/A')
    expect(summary.latestPostDate).toBe('N/A')
    expect(summary.topByImpressions).toEqual([])
    expect(summary.topByEngagement).toEqual([])
  })
})

describe('buildWeeklyTrend', () => {
  const now = new Date('2026-06-12T00:00:00Z')

  const posts: MetricsPost[] = [
    {
      id: 'a',
      content: 'this week post',
      scheduledDate: '2026-06-10',
      publishedAt: '2026-06-10T00:00:00Z',
      impressions: 1000,
      likes: 50,
      replies: 10,
      reposts: 5,
    },
    {
      id: 'b',
      content: 'five weeks ago post',
      scheduledDate: '2026-05-02',
      publishedAt: '2026-05-02T00:00:00Z',
      impressions: 400,
      likes: 40,
      replies: 0,
      reposts: 0,
    },
  ]

  const followerHistory: FollowerSnapshot[] = [
    { fetchedAt: '2026-06-11T00:00:00Z', followersCount: 1200 },
    { fetchedAt: '2026-06-04T00:00:00Z', followersCount: 1100 },
    { fetchedAt: '2026-04-20T00:00:00Z', followersCount: 900 },
  ]

  it('直近8週分の行を、過去から現在の順で返す', () => {
    const rows = buildWeeklyTrend(posts, followerHistory, now)

    expect(rows).toHaveLength(8)
    // 最後の行が直近の週（週末日 = nowの日付）
    expect(rows[7].weekLabel).toBe('06/12')
  })

  it('各週の投稿数・インプレッション・ライク・平均エンゲージメント率を集計する', () => {
    const rows = buildWeeklyTrend(posts, followerHistory, now)

    // week0 (06/05 ～ 06/12): postA が含まれる
    const thisWeek = rows[7]
    expect(thisWeek.postsCount).toBe(1)
    expect(thisWeek.impressions).toBe(1000)
    expect(thisWeek.likes).toBe(50)
    expect(thisWeek.avgEngagementRate).toBe(6.5)
    expect(thisWeek.followersCount).toBe(1200)

    // week1 (05/29 ～ 06/05): 投稿なし
    const lastWeek = rows[6]
    expect(lastWeek.postsCount).toBe(0)
    expect(lastWeek.followersCount).toBe(1100)

    // week5 (05/01 ～ 05/08): postB が含まれる
    const fiveWeeksAgo = rows[2]
    expect(fiveWeeksAgo.postsCount).toBe(1)
    expect(fiveWeeksAgo.impressions).toBe(400)
    expect(fiveWeeksAgo.avgEngagementRate).toBe(10)
    expect(fiveWeeksAgo.followersCount).toBe(900)
  })

  it('フォロワー数のスナップショットが無い週はnullを返す', () => {
    const rows = buildWeeklyTrend(posts, [], now)

    expect(rows.every(r => r.followersCount === null)).toBe(true)
  })
})
