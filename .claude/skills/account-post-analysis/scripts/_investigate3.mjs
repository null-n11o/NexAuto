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
  .select('status, source, scheduled_date, published_at')
  .eq('account_id', accountId)
  .gte('scheduled_date', '2026-07-13')
  .order('scheduled_date', { ascending: true })
if (error) { console.error(error); process.exit(1) }

console.log('scheduled(UTC)     | status    | source   | published_at(UTC) | 遅延')
for (const p of posts) {
  let delay = ''
  if (p.published_at) {
    const d = (new Date(p.published_at) - new Date(p.scheduled_date)) / 60000
    delay = `${d.toFixed(0)}分後`
  }
  console.log(
    `${p.scheduled_date.slice(0,16)} | ${p.status.padEnd(9)} | ${(p.source||'').padEnd(8)} | ${(p.published_at?.slice(0,16)||'-').padEnd(16)} | ${delay}`
  )
}

console.log('\n時刻 × status:')
const byTime = {}
for (const p of posts) {
  const t = p.scheduled_date.slice(11,16)
  byTime[t] = byTime[t] || {}
  byTime[t][p.status] = (byTime[t][p.status]||0)+1
}
console.log(byTime)
