# Tech Digest

IT技術記事のRSSフィードを定期収集し、GitHub Pages で一覧表示する静的リーダーです。

## 主要ファイル

- `feeds.json`: RSSフィードの登録一覧
- `fetch-rss.ts`: フィードを取得して `articles.json` を更新するスクリプト
- `articles.json`: 収集済み記事一覧
- `index.html`: GitHub Pages 用の静的UI
- `.github/workflows/rss-cron.yml`: 6時間おきの自動更新ジョブ
- `summarize-local.ts`: ローカル Playwright / Ollama による本文抽出・分類・要約
- `scripts/summarize-and-push.ps1`: 要約後に `articles.json` だけをコミット・プッシュする手動実行スクリプト

RSS項目に enclosure、Media RSS、または本文内画像が含まれる場合、画像URLを `imageUrl` として保存し、記事カードにサムネイルを表示します。既存記事の画像情報もRSS同期時に補完されます。
ステップ2ではローカル処理で記事本文を抽出し、カテゴリ・約400文字の要約・本文内の画像URLを `articles.json` に保存します。GitHub Pages上では要約と画像ギャラリーを表示します。

## セットアップ

```bash
npm install
npx playwright install chromium
npm run fetch:rss
npm run serve
```

ローカルでは `http://localhost:8000` でページを確認できます。

## ローカル要約（ステップ2）

Ollama を起動し、設定したモデルを取得してから実行します。

```bash
ollama pull bonsai-2:2b
npm run summarize:local
```

未処理 (`pending`) の記事を順番に処理し、成功した記事ごとに `articles.json` を保存します。Ollama接続とモデルを先に確認し、失敗した記事は `pending` のまま残してエラー終了します。最初の数件だけ試す場合は `npx tsx summarize-local.ts --limit=3` を実行できます。モデルやOllama APIのURLは `OLLAMA_MODEL`、`OLLAMA_URL` 環境変数で変更できます。

処理結果をGitHubへ反映する場合は、内容を確認してから PowerShell で `.\scripts\summarize-and-push.ps1` を実行します。要約が成功した場合に限り `articles.json` のみをコミットしてプッシュします。ステージ済みの変更がある場合は誤コミット防止のため中断します。

## GitHub Actions

GitHub Actions で `rss-cron.yml` を有効化すると、6時間ごとに RSS を取得し、`articles.json` の更新を自動コミットします。