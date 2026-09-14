---
name: dober-strategy-review
description: Threadsアカウント「Dober」(@dober_fullstack)の週次パフォーマンスを振り返り、参照実例セット(account_content_strategy)の更新を提案・適用する。「Doberの今週の振り返り」「Doberの戦略を更新して」のように起動する。提案→ユーザー承認→DB適用の流れ。
---

# dober-strategy-review

Dober (account_id: `df3bd84a-b782-4c68-bbee-7697e95decaa`) の最新分析レポートと過去CSVの5000imp超実績を元に、投稿生成が参照する「実例セット」を進化させる。直近で伸びた投稿を高パフォーマンス実例としてA〜Gフォーマットに分類し、現行セットとの差分をユーザーに提示し、承認後に新バージョンとしてDBへ適用する。

フォーマット定義（A〜G）は `../dober-content-strategy/references/formats.md` を参照する。

## 実行手順

### Step 1: 最新の分析レポートを確認する

`mcp__supabase__execute_sql`（project_id: `fdmhkjiqsrzktfmbqlxg`）で最新レポートを取得する:

```sql
SELECT id, generated_at, report_data, insights
FROM account_analysis_reports
WHERE account_id = 'df3bd84a-b782-4c68-bbee-7697e95decaa'
ORDER BY generated_at DESC
LIMIT 1;
```

- レポートが存在しない、または `generated_at` が7日より古い場合は、`account-post-analysis` スキルを実行して最新レポートを生成するようユーザーに促す（「最新レポートが無い/古いので先に分析しますか？」）。
- 取得した `report_data.summary.topByImpressions` / `topByEngagement` が高パフォーマンス投稿の候補。`insights.next_actions` は補足の方向性として読む。
- 直近レポートだけでなく、過去CSVの5000imp超で確認済みの強い型（危機・負債型、基本基準型、社会が思う/本当の価値対比型、人工刺激/やめる・やる型、退屈な規律型、階層分類型、恋愛・女性視点型）を優先する。

### Step 2: 高パフォーマンス投稿をA〜Gに分類する

`../dober-content-strategy/references/formats.md` のA〜G定義に従い、Step 1で得たTOP投稿（重複除外）を各フォーマットに分類し、採用理由(rationale)を付ける。現行定義ではA〜Eを厚めにし、F/Gを補助的に選定する（目安: 計15〜20件）。

通常ローテーションから外すもの:
- アルファ/シグマ型。5000imp超データ内の出現が少なく、直近でも伸びが弱い。
- 「お金の使い方」単体の訓話。採用するなら「社会が思う成功/本当の成功」「金で買える/買えない」「仕組み/自由」の構造に変換する。
- 有名人逸話単体。採用するなら「退屈な規律」「毎朝の反復」など現行A〜Gに接続する。

各実例は以下の `StrategyExample` 形式にする:

- `format`: A〜Gのいずれか
- `title`: 投稿本文の先頭行
- `content`: 投稿本文全体（report_dataの `content`）
- `metrics`: `{ impressions, likes, replies, reposts }`（report_dataの数値。follows はレポートに無いため省略可）
- `score`: `likes*10 + replies*5 + reposts*5 + Math.round(Math.log(impressions))`（並び替えヒント）
- `rationale`: なぜこの実例を参照に採用するか1文

### Step 3: 現行セットとの差分を提示する

現在アクティブな実例を取得する:

```sql
SELECT id, version, examples
FROM account_content_strategy
WHERE account_id = 'df3bd84a-b782-4c68-bbee-7697e95decaa' AND is_active = true;
```

現行 `examples` とStep 2の新セットを比較し、差分を提示する:
- ✅ 追加（今週伸びた新規実例）
- ❌ 除外（鮮度が落ちた/より良い実例に置き換える）
- ➖ 維持（引き続き参照する定番実例）

併せて、`insights.next_actions` の要約を「今週の所感」として添える。

### Step 4: ユーザー承認後にDBへ適用する

ユーザーが承認（または修正指示）したら、確定した新セットを一時JSONファイルに書き出し、`apply-strategy.ts` で適用する:

```bash
npx tsx .Codex/skills/dober-strategy-review/scripts/apply-strategy.ts "Dober" /tmp/dober-strategy-new.json --source-report <Step1のレポートID>
```

成功メッセージ（新version・id・件数）をユーザーに報告し、次回以降の `dober-content-strategy` による生成にこの実例が反映される旨を伝える。
