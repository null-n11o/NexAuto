// @vitest-environment node
/**
 * auto_reply マイグレーションのスキーマ整合テスト。
 * DBには接続せず、SQLファイルをパースして期待するカラム/indexの存在を検証する。
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect, beforeAll } from 'vitest'

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/20260729000000_auto_reply.sql',
)
const CLAIM_MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/20260910000000_auto_reply_claim.sql',
)

let sql: string
let claimSql: string

beforeAll(() => {
  sql = readFileSync(MIGRATION_PATH, 'utf-8')
  claimSql = readFileSync(CLAIM_MIGRATION_PATH, 'utf-8')
})

describe('posts auto-reply columns', () => {
  it('adds cta_reply_posted boolean not null default false', () => {
    expect(sql).toMatch(/ALTER TABLE posts[\s\S]*cta_reply_posted\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i)
  })
  it('adds cta_reply_post_id text', () => {
    expect(sql).toMatch(/cta_reply_post_id\s+TEXT/i)
  })
})

describe('accounts auto-reply config', () => {
  it('adds auto_reply_config jsonb', () => {
    expect(sql).toMatch(/ALTER TABLE accounts[\s\S]*auto_reply_config\s+JSONB/i)
  })
})

describe('pending index', () => {
  it('creates partial index over pending published posts', () => {
    expect(sql).toMatch(/CREATE INDEX[\s\S]*idx_posts_auto_reply_pending[\s\S]*ON posts[\s\S]*WHERE status = 'published' AND cta_reply_posted = FALSE/i)
  })
})

describe('auto-reply claim column', () => {
  it('adds cta_reply_claimed_at timestamptz', () => {
    expect(claimSql).toMatch(/ALTER TABLE posts[\s\S]*cta_reply_claimed_at\s+TIMESTAMPTZ/i)
  })
})
