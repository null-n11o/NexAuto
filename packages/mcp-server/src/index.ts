import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createClient } from '@supabase/supabase-js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCsv, upsertPostsFromCsv } from './csv-ingest.js'
import {
  archiveCsv,
  listMarkdownReports,
  listRawExports,
  readMarkdownReport,
  saveMarkdownReport,
} from './store.js'
import { syncThreadsPosts } from './threads-import.js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
}

const supabase = createClient(supabaseUrl, supabaseKey)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const server = new Server(
  { name: 'nexauto-mcp', version: '1.2.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_accounts',
      description: '利用可能なSNSアカウントの一覧を返す',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'create_post',
      description: '投稿を下書きとして保存する（公開はしない）',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'アカウントID' },
          content: { type: 'string', description: '投稿本文' },
          image_url: { type: 'string', description: '画像URL（省略可）' },
          scheduled_date: { type: 'string', description: '投稿予定日 (YYYY-MM-DD)' },
        },
        required: ['account_id', 'content', 'scheduled_date'],
      },
    },
    {
      name: 'list_posts',
      description: 'アカウントの投稿一覧を返す',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['draft', 'review', 'ready', 'published', 'failed'],
          },
        },
        required: ['account_id'],
      },
    },
    {
      name: 'update_post',
      description: '投稿の内容・日時・ステータスを更新する。published にはできない',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          content: { type: 'string' },
          image_url: { type: 'string' },
          scheduled_date: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'review', 'ready'] },
        },
        required: ['id'],
      },
    },
    {
      name: 'list_analysis_reports',
      description: 'アカウントの分析レポート一覧を返す（期間指定可）',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          since: { type: 'string' },
          until: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['account_id'],
      },
    },
    {
      name: 'list_post_metrics',
      description: 'アカウントの投稿メトリクスを返す',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          limit: { type: 'number', description: '投稿件数上限（デフォルト50）' },
        },
        required: ['account_id'],
      },
    },
    {
      name: 'sync_threads_posts',
      description: 'Threads APIから指定期間の投稿をページング取得し、重複排除して保存する（公開操作はしない）',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          since: { type: 'string', description: '取得開始日時 ISO8601' },
          until: { type: 'string', description: '取得終了日時 ISO8601' },
          dry_run: { type: 'boolean', description: 'trueの場合はDBを変更せず取得件数と原本だけ確認する' },
        },
        required: ['account_id'],
      },
    },
    {
      name: 'ingest_x_analytics_csv',
      description: 'Xアナリティクスのポスト別CSVを NexAuto の raw へ保存し、posts / post_metrics を更新する',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          csv_path: { type: 'string', description: 'ローカルのCSVパス' },
        },
        required: ['account_id', 'csv_path'],
      },
    },
    {
      name: 'list_raw_exports',
      description: '保存済みのXアナリティクスCSV一覧を返す',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'save_markdown_report',
      description: '週次Markdownレポートを NexAuto へ保存する。パスは x|threads/<account-slug>/<file>.md',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '例: x/kentaro-nakano/2026-W34.md / threads/dober/2026-W34.md' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'list_markdown_reports',
      description: '保存済みMarkdownレポートの一覧を返す',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_markdown_report',
      description: 'Markdownレポート本文を返す',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  ],
}))

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function normalizeImageUrl(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'list_accounts') {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, account_name, platform')
      .order('created_at')
    if (error) throw new Error(error.message)
    return jsonResult(data)
  }

  if (name === 'create_post') {
    const { account_id, content, image_url, scheduled_date } = args as {
      account_id: string; content: string; image_url?: string; scheduled_date: string
    }
    const { data, error } = await supabase
      .from('posts')
      .insert({
        account_id,
        content,
        image_url: normalizeImageUrl(image_url),
        scheduled_date,
        status: 'draft',
        source: 'ai',
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return jsonResult(data)
  }

  if (name === 'list_posts') {
    const { account_id, status } = args as { account_id: string; status?: string }
    let query = supabase
      .from('posts')
      .select('id, content, image_url, scheduled_date, status, source, platform_post_id, published_at, created_at')
      .eq('account_id', account_id)
      // Fetch newest posts first so response/display limits retain recent posts.
      .order('scheduled_date', { ascending: false })
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return jsonResult(data)
  }

  if (name === 'update_post') {
    const { id, ...updates } = args as {
      id: string; content?: string; image_url?: string; scheduled_date?: string; status?: string
    }
    if (updates.status === 'published' || updates.status === 'failed') {
      throw new Error('MCP から published / failed にはできない。公開実行はCEOが行う')
    }
    if (updates.image_url !== undefined) {
      updates.image_url = normalizeImageUrl(updates.image_url) as string
    }
    const { data, error } = await supabase
      .from('posts')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return jsonResult(data)
  }

  if (name === 'list_analysis_reports') {
    const { account_id, since, until, limit = 10 } = args as {
      account_id: string; since?: string; until?: string; limit?: number
    }
    let query = supabase
      .from('account_analysis_reports')
      .select('id, period_start, period_end, days_recent, report_data, insights, generated_at, insights_generated_at')
      .eq('account_id', account_id)
      .order('generated_at', { ascending: false })
      .limit(limit)
    if (since) query = query.gte('generated_at', since)
    if (until) query = query.lte('generated_at', until)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return jsonResult(data)
  }

  if (name === 'list_post_metrics') {
    const { account_id, limit = 50 } = args as { account_id: string; limit?: number }
    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select('id, content, platform_post_id, published_at, post_metrics(impressions, likes, reposts, replies, fetched_at)')
      .eq('account_id', account_id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(limit)
    if (postsError) throw new Error(postsError.message)
    return jsonResult(posts)
  }

  if (name === 'sync_threads_posts') {
    const { account_id, since, until, dry_run = false } = args as {
      account_id: string; since?: string; until?: string; dry_run?: boolean
    }
    return jsonResult(await syncThreadsPosts(supabase, ROOT, account_id, since, until, dry_run))
  }

  if (name === 'ingest_x_analytics_csv') {
    const { account_id, csv_path } = args as { account_id: string; csv_path: string }
    const archived = archiveCsv(ROOT, csv_path)
    const rows = loadCsv(archived)
    const result = await upsertPostsFromCsv(supabase, account_id, rows)
    return jsonResult({ archived: archived.replace(ROOT + '/', ''), rows: rows.length, ...result })
  }

  if (name === 'list_raw_exports') {
    return jsonResult(listRawExports(ROOT))
  }

  if (name === 'save_markdown_report') {
    const { path, content } = args as { path: string; content: string }
    const saved = saveMarkdownReport(ROOT, path, content)
    return jsonResult({ saved })
  }

  if (name === 'list_markdown_reports') {
    return jsonResult(listMarkdownReports(ROOT))
  }

  if (name === 'get_markdown_report') {
    const { path } = args as { path: string }
    return { content: [{ type: 'text' as const, text: readMarkdownReport(ROOT, path) }] }
  }

  throw new Error(`Unknown tool: ${name}`)
})

const transport = new StdioServerTransport()
await server.connect(transport)
