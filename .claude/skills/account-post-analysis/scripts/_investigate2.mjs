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
  .from('accounts').select('id').ilike('account_name', '%Dober%')
const accountId = accounts[0].id

const { data: posts, error } = await supabase
  .from('posts')
  .select('status, scheduled_date, image_url')
  .eq('account_id', accountId)
  .gte('scheduled_date', '2026-07-06')
  .order('scheduled_date', { ascending: true })
if (error) { console.error('取得エラー:', error); process.exit(1) }

console.log('status × image_url クロス集計')
const cross = {}
for (const p of posts) {
  const hasImg = p.image_url ? 'image有' : 'textのみ'
  const key = `${p.status} / ${hasImg}`
  cross[key] = (cross[key] || 0) + 1
}
console.log(cross)

console.log('\n時刻(UTC) × status クロス集計')
const byTime = {}
for (const p of posts) {
  const t = p.scheduled_date.slice(11, 16)
  byTime[t] = byTime[t] || { published: 0, failed: 0 }
  byTime[t][p.status] = (byTime[t][p.status] || 0) + 1
}
console.log(byTime)

console.log('\nfailedかつimage有 / failedかつtextのみ の内訳（時刻別）')
for (const p of posts.filter(p => p.status === 'failed')) {
  console.log(`${p.scheduled_date.slice(5,16)} | ${p.image_url ? 'image有: ' + p.image_url.slice(0, 50) : 'textのみ'}`)
}
