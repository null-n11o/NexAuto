import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(__dirname, '..') + '/')
const { createClient } = require('@supabase/supabase-js')

const cfg = JSON.parse(readFileSync(resolve(__dirname, '../.mcp.json'), 'utf8'))
const env = cfg.mcpServers?.['nexauto']?.env ?? cfg.mcpServers?.['sns-automation']?.env
if (!env) {
  throw new Error('MCP server configuration not found in .mcp.json (checked nexauto, sns-automation)')
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const AUTO_REPLY_CONFIG = {
  enabled: true,
  // いずれかの tier（経過時間 ≤ window_minutes かつ インプレ ≥ threshold）を満たせば発火
  tiers: [
    { window_minutes: 30, threshold: 200 },
    { window_minutes: 60, threshold: 350 },
    { window_minutes: 360, threshold: 500 },
    { window_minutes: 600, threshold: 600 },
  ],
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
