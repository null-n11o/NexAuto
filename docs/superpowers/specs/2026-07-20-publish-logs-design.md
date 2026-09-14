# publish事後解析ログ（publish_logs）設計

- 日付: 2026-07-20
- ブランチ: `feat/publish-logs`

## 背景・課題

Dober（Threads）の週次分析で、先週（07/08〜07/19）に publish 失敗が **19件** 発生していた。
エラーは全て `Threads publish error: The requested resource does not exist` に集約され、
時刻ごとに 22:30 はほぼ成功・03:00/11:00 はほぼ失敗という強い偏りがあった。

`src/lib/threads-api.ts` の `postToThreads` はコンテナ作成（Step1）→ publish（Step2）を
**待機なしで即実行**しており、レースコンディションが疑われる。しかし調査時点では
**Threads API の生レスポンスも各ステップの所要時間も残っていない**ため、
「コンテナは作れたが準備前に publish した」のか「時刻依存で別の失敗が起きた」のかを
データで確定できなかった。

失敗を後から解析できる観測基盤が無いことが根本の痛みである。

## ゴール

- publish 試行（成功・失敗の両方）を 1 試行 = 1 レコードで `publish_logs` に記録する。
- Threads の 2 段階（コンテナ作成 / publish）それぞれの HTTP ステータス・所要時間・
  **生レスポンス（マスキング済）** ・container_id を残す。
- cron 経由・手動経由の**両方**の publish を、共通層一箇所の仕込みで捕捉する。
- 後から SQL で時刻別・アカウント別の失敗パターンを解析できるようにする。
- ログは 60 日で自動削除する。

## 非ゴール

- 待機・リトライによる失敗の**根治**（コンテナ status ポーリング等）は別タスク。本設計は
  「解析できる状態にする」ことに限定する。
- リアルタイム通知（Slack 等）・成功率ダッシュボードは対象外（本ログの上に後から乗せられる）。
- `image_url` マイグレーション未適用問題の解消は対象外（別途対応）。

## アーキテクチャ

### 1. テーブル `publish_logs`

migration: `supabase/migrations/20260720000000_publish_logs.sql`

| カラム | 型 | 内容 |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `post_id` | uuid FK→posts(id) | |
| `account_id` | uuid FK→accounts(id) | |
| `platform` | text | `threads` / `x` |
| `trigger` | text | `cron` / `manual` |
| `result` | text | `success` / `failed` |
| `failed_step` | text null | `create` / `publish` / null |
| `total_ms` | int | 総所要時間 |
| `create_http_status` | int null | Step1 HTTP ステータス |
| `container_id` | text null | Step1 で得たコンテナID |
| `create_ms` | int null | Step1 所要 |
| `create_response` | jsonb null | Step1 生レスポンス（マスキング済） |
| `publish_http_status` | int null | Step2 HTTP ステータス |
| `platform_post_id` | text null | Step2 で得た投稿ID |
| `publish_ms` | int null | Step2 所要 |
| `publish_response` | jsonb null | Step2 生レスポンス（マスキング済） |
| `error_message` | text null | 例外メッセージ |
| `created_at` | timestamptz default now() | |

- index: `created_at`（クリーンアップ・時刻解析用）、`account_id`。
- RLS: 既存テーブルの流儀に合わせる。書き込みは service role（cron / API）から行う。

### 2. `postToThreads` を計測メタ付きに拡張（`src/lib/threads-api.ts`）

現状は投稿ID文字列のみ返し中間情報を捨てている。以下を返すよう変更する。

- 戻り値を `{ platformPostId: string, meta: PublishMeta }` に変更。
- 失敗時は `meta` を添えて throw する（呼び出し側が meta を拾えるよう、カスタムエラーに
  `meta` を持たせる or 例外前に meta を確定させる）。
- `PublishMeta` に各ステップの HTTP ステータス・所要 ms・生レスポンス・container_id・
  `failed_step` を格納する。
- X 版（`src/lib/x-api` 相当）も同型のメタを返すよう最小限あわせる（Threads 優先、X は
  取れる範囲で）。

### 3. ラッパ `publishAndLog`（新規 `src/lib/publish-log.ts`）

- シグネチャ: `publishAndLog(supabase, { post, account, trigger }): Promise<PublishResult>`
- 内部で `publishPost` を呼び、成功・例外いずれからも `publish_logs` 行を組み立てて書き込む。
- **cron route と手動 publish route はこのラッパを呼ぶだけ**にする（ログ仕込みを集約）。
- `trigger` は呼び出し側が `'cron'` / `'manual'` を渡す。
- **ログ書き込みは try-catch で握りつぶす**。ログ失敗時も publish の成否はそのまま返す
  （publish を巻き込まない）。

### 4. マスキング `maskSecrets`（`src/lib/publish-log.ts` 同居 or `src/lib/mask.ts`）

- `create_response` / `publish_response` を保存する前に通す。
- キー名が `access_token` / `api_key` / `api_secret` / `token`（大小無視・部分一致）に
  マッチする値を再帰的に `***` へ置換する。
- **リクエストURL（トークンがクエリに乗る）は保存しない**。保存対象はレスポンス body のみ。

### 5. クリーンアップ（60日）

- `src/app/api/cron/publish/route.ts` の publish 処理**完了後**に
  `DELETE FROM publish_logs WHERE created_at < now() - interval '60 days'` を実行。
- 追加 cron・追加インフラなし。削除の失敗も publish 結果に影響させない（try-catch）。

## データフロー

```
cron/publish route ─┐
                    ├─→ publishAndLog(supabase, {post, account, trigger})
manual publish route┘        │
                             ├─→ publishPost → postToThreads → { platformPostId, meta }
                             │                                   （例外時は meta 付き error）
                             ├─→ maskSecrets(meta.*_response)
                             └─→ INSERT publish_logs（try-catch 握りつぶし）
                    ┌─────────────────────────────────────────────┘
cron/publish route ─┴─→ (publish 全件処理後) DELETE publish_logs WHERE created_at < 60日前
```

## エラーハンドリング

- publish 本体の成否判定は従来通り（`posts.status` の published/failed 更新は変更しない）。
- ログ INSERT 失敗・クリーンアップ DELETE 失敗は握りつぶし、cron/API のレスポンスには
  影響させない（件数など軽い情報のみ返す）。
- `postToThreads` が Step1 で失敗した場合は `failed_step='create'`、Step2 なら
  `failed_step='publish'`、例外内容を `error_message` と該当 `*_response` に残す。

## テスト方針

- `maskSecrets()` — unit: トークン系キーが再帰的に伏せられる／通常キーは残る。
- `postToThreads` の meta — unit（fetch モック）: 成功時に container_id・各 ms・
  platform_post_id が入る。Step1 失敗で `failed_step='create'`、Step2 失敗で
  `failed_step='publish'` かつ生エラーが meta に載る。
- `publishAndLog` — 成功・失敗それぞれで正しい `publish_logs` 行が組まれる。
  **ログ書き込みが例外を投げても publish 結果は返る**こと。
- cron route 統合 — publish 1 件につきログ 1 行、クリーンアップ DELETE が呼ばれる。
- 既存テスト（`src/test/api/publish.test.ts`, `src/test/lib/threads-api.test.ts`）が
  壊れないこと。

## 補足: 今回の目的との接続

このログ導入後に 03:00/11:00 が再び失敗した場合、`publish_response` の生エラー・
`container_id` の有無・`create_ms`/`publish_ms` が残るため、レースコンディション
（コンテナは作れたが準備前に publish）か時刻依存の別要因かを**データで確定**できる。
