# NexAuto 運用データ

- `data/raw/x-analytics/YYYY-MM-DD/*.csv` — X アナリティクスの原資料。Git には入れない。
- `data/reports/{x|threads}/{account-slug}/YYYY-Wxx.md` — 週次レポート。kcp の各チャネル `analytics/` から symlink で読む。

| アカウント | レポート | kcp |
|---|---|---|
| Kentaro Nakano X | `x/kentaro-nakano/` | `brands/kentaro-nakano/channels/x/analytics` |
| Kentaro Nakano Threads | `threads/kentaro-nakano/` | `brands/kentaro-nakano/channels/threads/analytics` |
| Dober Threads | `threads/dober/` | `brands/dober/channels/threads/analytics` |
