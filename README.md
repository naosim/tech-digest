# Tech Digest

IT技術記事のRSSフィードを定期収集し、GitHub Pages で一覧表示する静的リーダーです。

## 主要ファイル

- `feeds.json`: RSSフィードの登録一覧
- `fetch-rss.ts`: フィードを取得して `articles.json` を更新するスクリプト
- `articles.json`: 収集済み記事一覧
- `index.html`: GitHub Pages 用の静的UI
- `.github/workflows/rss-cron.yml`: 6時間おきの自動更新ジョブ

## セットアップ

```bash
npm install
npm run fetch:rss
npm run serve
```

ローカルでは `http://localhost:8000` でページを確認できます。

## GitHub Actions

GitHub Actions で `rss-cron.yml` を有効化すると、6時間ごとに RSS を取得し、`articles.json` の更新を自動コミットします。