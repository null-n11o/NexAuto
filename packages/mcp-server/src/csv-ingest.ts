import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'

const COL = {
  id: 'ポストID',
  text: 'ポスト本文',
  url: 'ポストのリンク',
  date: '日付',
  impressions: ['インプレッション数', 'インプレッション'],
  likes: ['いいね', 'いいね数'],
  reposts: ['リポスト', 'リポスト数', 'リツイート'],
  replies: ['返信', '返信数'],
} as const

export type CsvRow = Record<string, string>

export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    if (ch !== '\r') field += ch
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).filter((r) => r.some((c) => c.trim() !== '')).map((r) => {
    const obj: CsvRow = {}
    headers.forEach((h, idx) => {
      obj[h] = r[idx] ?? ''
    })
    return obj
  })
}

export function loadCsv(path: string): CsvRow[] {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  if (rows.length === 0 || !(COL.url in rows[0]) || !(COL.id in rows[0])) {
    throw new Error('「ポスト別」CSVではない（ポストID / ポストのリンク 列が無い）')
  }
  return rows
}

function intField(row: CsvRow, names: readonly string[]): number {
  for (const name of names) {
    const raw = (row[name] || '').replace(/,/g, '').trim()
    if (!raw) continue
    const n = Number.parseInt(raw, 10)
    if (!Number.isNaN(n)) return n
  }
  return 0
}

export function csvDate(row: CsvRow): string | null {
  const raw = (row[COL.date] || '').trim()
  const match = raw.match(/^[A-Za-z]{3}, ([A-Za-z]{3}) (\d{1,2}), (\d{4})$/)
  if (!match) return null
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  }
  const month = months[match[1]]
  if (!month) return null
  return `${match[3]}-${month}-${match[2].padStart(2, '0')}`
}

export async function upsertPostsFromCsv(
  supabase: SupabaseClient,
  accountId: string,
  rows: CsvRow[],
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0
  let skipped = 0
  for (const row of rows) {
    const platformPostId = (row[COL.id] || '').trim()
    const content = (row[COL.text] || '').trim()
    if (!platformPostId || !content) {
      skipped += 1
      continue
    }
    const day = csvDate(row) || new Date().toISOString().slice(0, 10)
    const publishedAt = `${day}T00:00:00+09:00`
    const { data: existing, error: findError } = await supabase
      .from('posts')
      .select('id')
      .eq('account_id', accountId)
      .eq('platform_post_id', platformPostId)
      .maybeSingle()
    if (findError) throw new Error(findError.message)

    let postId = existing?.id as string | undefined
    if (postId) {
      const { error } = await supabase
        .from('posts')
        .update({
          content,
          scheduled_date: day,
          published_at: publishedAt,
          status: 'published',
        })
        .eq('id', postId)
      if (error) throw new Error(error.message)
    } else {
      const { data, error } = await supabase
        .from('posts')
        .insert({
          account_id: accountId,
          content,
          scheduled_date: day,
          status: 'published',
          source: 'manual',
          published_at: publishedAt,
          platform_post_id: platformPostId,
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      postId = data.id
    }

    const { error: metricsError } = await supabase.from('post_metrics').insert({
      post_id: postId,
      impressions: intField(row, COL.impressions),
      likes: intField(row, COL.likes),
      reposts: intField(row, COL.reposts),
      replies: intField(row, COL.replies),
    })
    if (metricsError) throw new Error(metricsError.message)
    upserted += 1
  }
  return { upserted, skipped }
}
