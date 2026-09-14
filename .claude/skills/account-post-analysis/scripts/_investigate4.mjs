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

const { data: posts } = await supabase
  .from('posts')
  .select('status, scheduled_date, content')
  .eq('account_id', accountId)
  .gte('scheduled_date', '2026-07-06')
  .order('scheduled_date', { ascending: true })

console.log('status別 文字数統計')
const byStatus = { published: [], failed: [] }
for (const p of posts) {
  byStatus[p.status]?.push([...p.content].length)
}
for (const [s, lens] of Object.entries(byStatus)) {
  if (!lens.length) continue
  lens.sort((a,b)=>a-b)
  const min = lens[0], max = lens[lens.length-1]
  const avg = (lens.reduce((a,b)=>a+b,0)/lens.length).toFixed(0)
  const over500 = lens.filter(l=>l>500).length
  console.log(`${s.padEnd(9)}: n=${lens.length} 文字数 min=${min} avg=${avg} max=${max} / 500字超=${over500}件`)
}

console.log('\n各投稿の文字数(char) 一覧')
for (const p of posts) {
  const len = [...p.content].length
  const flag = len > 500 ? ' ★500超' : ''
  console.log(`${p.scheduled_date.slice(5,16)} | ${p.status.padEnd(9)} | ${String(len).padStart(4)}字${flag}`)
}
