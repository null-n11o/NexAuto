# NexAuto MCP Server

Claude Code または Claude Desktop からSNS投稿を操作するMCPサーバーです。

## セットアップ

### 環境変数

以下の環境変数が必要です:

- `SUPABASE_URL`: Supabase プロジェクトURL
- `SUPABASE_SERVICE_ROLE_KEY`: サービスロールキー（Supabase ダッシュボード → Settings → API）

### Claude Code への設定

`~/.claude/claude_desktop_config.json`（またはClaude Desktopの設定）に追加:

```json
{
  "mcpServers": {
    "nexauto": {
      "command": "node",
      "args": ["/path/to/nexauto/packages/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://fdmhkjiqsrzktfmbqlxg.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}
```

## 利用可能なツール

| ツール | 説明 |
|--------|------|
| `list_accounts` | アカウント一覧を取得 |
| `create_post` | 下書き投稿を作成（公開しない） |
| `list_posts` | 投稿一覧を取得（statusフィルタ可） |
| `update_post` | 投稿を更新（`published` にはできない） |
| `list_analysis_reports` | DB上の分析レポート一覧 |
| `list_post_metrics` | 公開済み投稿のメトリクス |
| `ingest_x_analytics_csv` | Xポスト別CSVを raw へ保存し posts/post_metrics を更新 |
| `list_raw_exports` | 保存済みCSV一覧 |
| `save_markdown_report` | 週次Markdownを `data/reports/` へ保存（`x|threads/<slug>/<file>.md`） |
| `list_markdown_reports` | Markdownレポート一覧 |
| `get_markdown_report` | Markdownレポート本文 |
