import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Post, PostMetrics } from '@/types'
import { withLatestMetrics } from '@/lib/analytics/latest-metrics'
import { PrintButton } from './PrintButton'
import { NexAutoLogo } from '@/components/brand/logo'

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ account_id?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { account_id } = await searchParams

  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, account_name, platform')
    .order('created_at')

  const accountId = account_id ?? accounts?.[0]?.id

  if (!accountId) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <p className="text-sm text-gray-500">アカウントがありません。</p>
      </div>
    )
  }

  const accountName = accounts?.find(a => a.id === accountId)?.account_name ?? ''

  const { data: posts } = await supabase
    .from('posts')
    .select('*, post_metrics(impressions, likes, reposts, replies, fetched_at)')
    .eq('status', 'published')
    .eq('account_id', accountId)
    .order('published_at', { ascending: false })
    .limit(100)

  const postsWithLatestMetrics = withLatestMetrics(
    (posts ?? []) as (Post & { post_metrics: PostMetrics[] })[]
  )

  const totalImpressions = postsWithLatestMetrics.reduce(
    (sum, p) => sum + (p.latest_metrics?.impressions ?? 0), 0
  )
  const totalLikes = postsWithLatestMetrics.reduce(
    (sum, p) => sum + (p.latest_metrics?.likes ?? 0), 0
  )

  const generatedAt = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { font-size: 11pt; }
        }
      `}</style>

      <div className="max-w-4xl mx-auto p-8">
        {/* ヘッダー */}
        <div className="flex justify-between items-start mb-8 pb-4 border-b">
          <div>
            <div className="mb-3">
              <NexAutoLogo width={120} />
            </div>
            <h1 className="text-2xl font-bold">
              SNS パフォーマンスレポート{accountName ? ` — ${accountName}` : ''}
            </h1>
            <p className="text-sm text-gray-500 mt-1">生成日: {generatedAt}</p>
          </div>
          <PrintButton />
        </div>

        {/* サマリー */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="border rounded p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">総投稿数</p>
            <p className="text-3xl font-bold">{postsWithLatestMetrics.length}</p>
          </div>
          <div className="border rounded p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">総表示回数</p>
            <p className="text-3xl font-bold">{totalImpressions.toLocaleString()}</p>
          </div>
          <div className="border rounded p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">総いいね数</p>
            <p className="text-3xl font-bold">{totalLikes.toLocaleString()}</p>
          </div>
        </div>

        {/* 投稿一覧 */}
        <h2 className="text-lg font-semibold mb-3">投稿別パフォーマンス</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2">
              <th className="text-left py-2 pr-4 font-semibold">投稿内容</th>
              <th className="text-left py-2 pr-4 font-semibold">投稿日</th>
              <th className="text-right py-2 pr-4 font-semibold">表示</th>
              <th className="text-right py-2 pr-4 font-semibold">いいね</th>
              <th className="text-right py-2 pr-4 font-semibold">リポスト</th>
              <th className="text-right py-2 font-semibold">リプライ</th>
            </tr>
          </thead>
          <tbody>
            {postsWithLatestMetrics.map(post => (
              <tr key={post.id} className="border-b">
                <td className="py-2 pr-4 max-w-xs">
                  <p className="line-clamp-2">{post.content}</p>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap text-gray-500">
                  {post.published_at
                    ? new Date(post.published_at).toLocaleDateString('ja-JP')
                    : '-'}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {post.latest_metrics?.impressions ?? '-'}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {post.latest_metrics?.likes ?? '-'}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {post.latest_metrics?.reposts ?? '-'}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {post.latest_metrics?.replies ?? '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="text-xs text-gray-400 mt-8">
          ※ メトリクスは投稿後 1時間・24時間・7日後に自動取得した最新値を表示しています。
        </p>
      </div>
    </>
  )
}
