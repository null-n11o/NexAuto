import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const envPath = path.join(REPO_ROOT, '.env.local')
if (fs.existsSync(envPath)) process.loadEnvFile(envPath)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const { data: accounts } = await supabase
  .from('accounts')
  .select('id, account_name, platform')
  .ilike('account_name', '%Dober%')
const account = accounts[0]
console.log('アカウント:', account)

// 先週〜直近の投稿（scheduled_date降順、直近20件）
const { data: posts } = await supabase
  .from('posts')
  .select('id, status, source, scheduled_date, published_at, platform_post_id, error_message, content')
  .eq('account_id', account.id)
  .gte('scheduled_date', '2026-07-06')
  .order('scheduled_date', { ascending: true })

console.log(`\n=== 投稿一覧 (${posts.length}件) ===`)
const statusCount = {}
for (const p of posts) {
  statusCount[p.status] = (statusCount[p.status] || 0) + 1
  const head = p.content.replace(/\n/g, ' ').slice(0, 24)
  console.log(
    `${p.scheduled_date?.slice(5, 16)} | ${p.status.padEnd(9)} | pid:${p.platform_post_id ? 'あり' : 'なし '} | ${head}` +
      (p.error_message ? `\n    ⚠️ ${p.error_message}` : '')
  )
}
console.log('\n=== status集計 ===')
console.log(statusCount)

// エラーメッセージの種類集計
const { data: failed } = await supabase
  .from('posts')
  .select('scheduled_date, error_message')
  .eq('account_id', account.id)
  .not('error_message', 'is', null)
  .order('scheduled_date', { ascending: true })
console.log(`\n=== error_messageがある投稿 (全期間, ${failed.length}件) ===`)
for (const f of failed) {
  console.log(`${f.scheduled_date?.slice(0, 16)} | ${f.error_message}`)
}
