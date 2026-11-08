# Tech Digest

IT技術記事のRSSフィードを定期収集し、GitHub Pages で一覧表示する静的リーダーです。

## 主要ファイル

- `feeds.json`: RSSフィードの登録一覧
- `security-feeds.json`: セキュリティ情報用RSSフィードの登録一覧
- `fetch-rss.ts`: フィードを取得し、最新100件とアーカイブを更新するスクリプト
- `articles.json`: 表示・要約対象の最新100件
- `security-articles.json`: 要約せずに表示する最新500件のセキュリティ情報
- `archives/`: 101件目以降の記事を1000件ずつ保存するJSONと一覧 (`index.json`)
- `index.html`: GitHub Pages 用の静的UI
- `.github/workflows/rss-cron.yml`: 6時間おきの自動更新ジョブ
- `summarize-local.ts`: ローカル Playwright / Ollama による本文抽出・分類・要約
- `scripts/summarize-and-push.sh`: 要約後に `articles.json` だけをコミット・プッシュする Git Bash 用手動実行スクリプト

RSS項目に enclosure、Media RSS、または本文内画像が含まれる場合、画像URLを `imageUrl` として保存し、記事カードにサムネイルを表示します。既存記事の画像情報もRSS同期時に補完されます。
一覧には最新100件を表示し、それより古い記事は削除せず `archives/articles-0001.json` から1000件単位で保存します。画面上部の選択メニューから各アーカイブを選び、ページ送りで100件ずつ閲覧できます。
ステップ2では最新100件だけを対象にローカル処理で記事本文を抽出し、カテゴリ・テーマ、結論、方法を明示した約400文字の日本語要約・本文内の画像URLを `articles.json` に保存します。GitHub Pages上では要約と画像ギャラリーを表示します。
「セキュリティ情報」リストには JPCERT/CC、IPA、JVN の公式 RSS を表示します。技術記事とは別の `security-articles.json` に保存し、本文取得やAI要約は行いません。セキュリティ情報は新しい順に最大500件を保持します。

## セットアップ

```bash
npm install
npx playwright install chromium
npm run fetch:rss
npm run serve
```

ローカルでは `http://localhost:8000` でページを確認できます。

セキュリティ情報だけを更新する場合は `npm run fetch:security` を実行します。通常の `npm run fetch:rss` と GitHub Actions の定期実行では、両方のリストを更新します。

## ローカル要約（ステップ2）

本文の取得には Playwright、カテゴリ判定には従来どおり Ollama を使用します。Ollama を起動し、設定したモデルを取得してから実行してください。最終的な日本語要約の生成先は `SUMMARY_PROVIDER` で選べ、既定値は `ollama` です。

```bash
ollama pull bonsai-2:2b
npm run summarize:local
```

Gemini CLI で要約を生成する場合は、CLIをインストールして認証したうえで `SUMMARY_PROVIDER=gemini-cli` を指定します。Windows PowerShell では次のように実行できます。

```powershell
$env:SUMMARY_PROVIDER = "gemini-cli"
npm run summarize:local
```

この場合も、本文取得とカテゴリ判定のため Ollama は必要です。最新100件内の未処理 (`pending`) 記事を順番に処理し、成功した記事ごとに `articles.json` を保存します。アーカイブは要約対象になりません。ページの読み込み完了を待ち続けず、DOMの読み込み後に本文抽出を試みます。処理できない記事は `pending` のまま残して次回に再試行します。個別記事の失敗でバッチ全体は異常終了しないため、保存済みの成功分があればその結果をコミット・プッシュできます。最初の数件だけ試す場合は `npx tsx summarize-local.ts --limit=3` を実行できます。モデルやOllama APIのURLは `OLLAMA_MODEL`、`OLLAMA_URL` 環境変数で変更できます。

処理結果をGitHubへ反映する場合は、内容を確認してから Git Bash で `bash ./scripts/summarize-and-push.sh` を実行します。`articles.json` に保存済みの変更があれば、個別記事の失敗が残っていても同ファイルのみをコミットしてプッシュします。変更がない場合は何もコミットしません。ステージ済みの変更がある場合は誤コミット防止のため中断します。

## GitHub Actions

GitHub Actions で `rss-cron.yml` を有効化すると、6時間ごとに RSS を取得し、`articles.json` と `archives/` の更新を自動コミットします。このワークフローには `contents: write` 権限を設定しています。プッシュが403で拒否される場合は、リポジトリの Settings → Actions → General → Workflow permissions で書き込み権限が許可されているか確認してください（組織ポリシーによって制限されている場合もあります）。