import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { parseApplyArgs, validateExamples, nextVersion } from './strategy-utils'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '../../../..')

async function main() {
  const envPath = path.join(REPO_ROOT, '.env.local')
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath)

  const { accountQuery, examplesPath, sourceReportId } = parseApplyArgs(process.argv.slice(2))

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません')
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // examples JSON 読込み・検証
  const raw = JSON.parse(fs.readFileSync(path.resolve(examplesPath), 'utf-8'))
  const examples = validateExamples(raw)

  // アカウント特定
  const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('id, account_name')
    .ilike('account_name', `%${accountQuery}%`)
  if (accErr) throw new Error(`アカウント検索エラー: ${accErr.message}`)
  if (!accounts || accounts.length === 0) {
    console.error(`アカウントが見つかりません: "${accountQuery}"`)
    process.exit(1)
  }
  if (accounts.length > 1) {
    console.error(`複数該当: ${accounts.map((a) => a.account_name).join(', ')}`)
    process.exit(1)
  }
  const account = accounts[0]

  // 現在の最大version取得
  const { data: maxRow, error: maxErr } = await supabase
    .from('account_content_strategy')
    .select('version')
    .eq('account_id', account.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxErr) throw new Error(`version取得エラー: ${maxErr.message}`)
  const newVersion = nextVersion(maxRow?.version ?? null)

  // 旧アクティブを無効化（部分ユニークインデックスを壊さないため先に実行）
  const { error: deactErr } = await supabase
    .from('account_content_strategy')
    .update({ is_active: false })
    .eq('account_id', account.id)
    .eq('is_active', true)
  if (deactErr) throw new Error(`旧バージョン無効化エラー: ${deactErr.message}`)

  // 新バージョンをアクティブで挿入
  const { data: inserted, error: insErr } = await supabase
    .from('account_content_strategy')
    .insert({
      account_id: account.id,
      version: newVersion,
      examples,
      source_report_id: sourceReportId ?? null,
      is_active: true,
      activated_at: new Date().toISOString(),
    })
    .select('id, version')
    .single()
  if (insErr) throw new Error(`挿入エラー: ${insErr.message}`)

  console.log(`✅ 戦略を更新しました (account: ${account.account_name}, version: ${inserted.version}, id: ${inserted.id}, examples: ${examples.length}件)`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
