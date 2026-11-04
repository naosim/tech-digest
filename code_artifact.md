# IT技術記事 RSSリーダー兼ローカルLLM要約システム 基本設計書

## 1. システム概要・コンセプト

本システムは、登録したIT技術系Webサイト（Zenn, Qiita, 各種技術ブログなど）のRSS/Atomフィードから新着記事を効率的にインプットするための**自分専用Webリーダー**である。

自前の常時起動サーバー（VPS等）を持たず、**GitHub Actions**と**GitHub Pages**をハブとして活用する。また、ローカルPCの環境（非力なマシン環境でも動作する軽量なローカルLLM）を活かし、記事本文のスクレイピング、自動カテゴリ分類、および**約400文字の構造的要約**と**解説画像の抽出**を行う。

開発の複雑化を防ぐため、以下の**2つのフェーズ（ステップ）**に分けて構築を行う。

* **ステップ1**: 完全静的な「基本RSSリーダー」の構築（要約機能なし・自動収集と表示のみ）
* **ステップ2**: 「ローカルPCのAI（Ollama）による要約パイプライン」の統合

---

## 2. アーキテクチャと運用フロー

### 2.1 全体アーキテクチャ図

```text
 [各技術ブログ/RSS]
        │
        │ (定期フェッチ)
        ▼
┌─────────────────────────┐
│     GitHub Actions      │ ── (新着メタデータの抽出・追加) ──┐
└─────────────────────────┘                                │
                                                           ▼
┌─────────────────────────◄── (git push / pull) ────── ┌───────────────────┐
│       GitHub Pages      │                            │    GitHub Repo    │
│  (静的WebUIで誰でも閲覧)  │                            │ ├─ feeds.json     │
└─────────────────────────┘                            │ └─ articles.json  │
                                                       └───────────────────┘
                                                           ▲
                                                           │ (git pull / push)
                                               ┌───────────────────────────┐
                                               │        ローカルPC         │
                                               │ 1. Playwright本文・画像抽出 │
                                               │ 2. Ollama(2B) 分類＆要約   │
                                               └───────────────────────────┘
```

### 2.2 役割分担

1. **GitHub Actions**:
   * `feeds.json` に登録されたRSSフィードを定期巡回（cron）。
   * 新しい記事のメタデータ（タイトル、URL、公開日時等）を検出して `articles.json` に `status: "pending"` としてコミット・プッシュする。
2. **GitHub Pages**:
   * リポジトリ内の `articles.json` を読み込み、SPA風のUIで閲覧可能な静的サイトを提供（ステップ1から稼働）。
3. **ローカルPC（バッチ処理エンジン / ステップ2で導入）**:
   * 定期的に `git pull` し、`articles.json` 内の未処理（`status: "pending"`）記事を抽出。
   * **Playwright + @mozilla/readability** を用いて動的ページの本文テキストおよび解説画像URL群を抽出。
   * **Ollama (2Bクラスモデル)** を使い、①カテゴリ分類 ＞ ②400文字最適化要約 を実行。
   * 結果を `articles.json` に反映し、`status: "completed"` へ変更して `git push`。

---

## 3. データ設計（JSONスキーマ仕様）

データベースは用いず、リポジトリ内で管理する**JSONファイル**で一元化する。

### 3.1 `feeds.json`（RSS登録用設定ファイル）

ユーザーが購読したい技術ブログのフィードURLを定義する。

```json
[
  {
    "id": "zenn-typescript",
    "name": "Zenn (TypeScript)",
    "url": "https://zenn.dev/topics/typescript/feed"
  },
  {
    "name": "Qiita Popular",
    "url": "https://qiita.com/popular-items/feed"
  }
]
```

### 3.2 `articles.json`（記事メタデータ＆要約データ）

記事のメタデータ、要約テキスト、画像リストを保持する。

```json
[
  {
    "id": "hash-url-001",
    "url": "https://zenn.dev/example/articles/xyz",
    "title": "TypeScript 5.xにおける最新仕様解説",
    "source": "Zenn (TypeScript)",
    "publishedAt": "2026-06-05T10:00:00Z",
    "status": "completed",
    "category": "TUTORIAL",
    "summary": "Node.js環境における最新の型推論機能とパフォーマンス最適化の手法について解説したチュートリアル記事です。この記事では、従来の型定義の課題と、新しいコンパイラオプションの導入によって型チェック速度が大幅に改善される具体的な仕組みがコード例と共に示されています。開発者にとってのメリットとして、大規模プロジェクトにおけるCI/CD時間の削減とエディタのレスポンス向上に直接寄与する点が挙げられています。",
    "imageUrls": [
      "https://res.cloudinary.com/example/architecture.png",
      "https://res.cloudinary.com/example/benchmark.png"
    ]
  }
]
```

---

## 4. 各ステップにおける詳細設計

### 【ステップ1】基本RSSリーダー（静的公開・要約なし）

AI要約機能を持たない、シンプルな自動巡回型RSSリーダーを作成・公開する。

#### A. RSS自動収集機能（GitHub Actions側）
* **実行仕様**: 6時間おきに実行、または `workflow_dispatch`（手動実行）。
* **使用ライブラリ**: Node.js + `rss-parser`
* **処理ルール**:
  * `feeds.json` を読み込む。
  * `articles.json` を参照し、重複URLを排除して新着記事のみを配列の先頭に追加。
  * 新着記事には `status: "pending"` を付与。
  * 差分があれば `articles.json` を自動コミット＆プッシュ。

#### B. フロントエンド表示仕様（GitHub Pages側）
* **技術選定**: プレーンな HTML5 / Tailwind CSS (CDN) / Vanilla JavaScript
* **仕様**:
  * 起動時に `fetch('articles.json')` でデータを読み込み、カード形式で描画。
  * 記事タイトル、サイト名（バッジ）、公開日時を表示。
  * クリックで別タブで元記事を表示。

---

### 【ステップ2】ローカルAI（Ollama）要約パイプラインの統合

ステップ1で構築した基盤に対し、ローカルPCでの高度なコンテンツ抽出・要約処理を統合する。

#### A. 本文・画像抽出（Playwright + Readability）
* **Playwright**: JavaScriptで動的レンダリングされたSPAサイト（Zenn/Qiita等）の全描画を待機し、完全なHTMLを取得。
* **@mozilla/readability**: HTMLからヘッダー/フッター/サイドバー/広告を除去し、メインの本文テキストのみを抽出。
* **画像フィルタリング**: 本文エリア内の `<img>` タグの `src` を絶対パスに変換。アバター・アイコン・SVG等を除外した実質的な「図解・解説画像」のみを `imageUrls` に格納。

#### B. 2段階 LLMパイプライン（Ollama 2Bモデル最適化）
非力な2Bモデルの処理能力を高めるため、タスクを「分類」と「400文字要約」に分解して実行する。

1. **Step 1: カテゴリ分類（LLM Router）**
   * 入力: タイトル ＋ 冒頭300文字
   * 判定カテゴリ: `TUTORIAL`, `RELEASE`, `TROUBLESHOOT`, `GENERAL` のいずれか1つ（単語のみ返却）。
2. **Step 2: 条件付き 400文字要約**
   * 分類されたカテゴリごとに、最適なプロンプト観点（【要約の視点】）を注入。
   * 入力: 本文先頭4,000文字程度
   * 出力: **約400文字**の日本語によるまとまった要約文章。

---

## 5. 参考コード実装例 (AIコーディング用プロトタイプ)

AIプログラミングアシスタント（Cursor等）が実装を参照できるように、核心となるロジックのサンプルコードを記載する。

### 5.1 【ステップ1用】RSSフェッチ＆JSON更新スクリプト案 (`fetch-rss.ts`)

```typescript
import Parser from 'rss-parser';
import * as fs from 'fs';
import * as path from 'path';

interface FeedConfig { name: string; url: string; }
interface Article {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  status: 'pending' | 'completed';
}

const parser = new Parser();
const FEEDS_PATH = path.join(__dirname, 'feeds.json');
const ARTICLES_PATH = path.join(__dirname, 'articles.json');

async function syncRss() {
  const feeds: FeedConfig[] = JSON.parse(fs.readFileSync(FEEDS_PATH, 'utf-8'));
  let existingArticles: Article[] = [];
  
  if (fs.existsSync(ARTICLES_PATH)) {
    existingArticles = JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf-8'));
  }

  const existingUrls = new Set(existingArticles.map(a => a.url));
  const newArticles: Article[] = [];

  for (const feed of feeds) {
    try {
      const feedData = await parser.parseURL(feed.url);
      for (const item of feedData.items) {
        if (item.link && !existingUrls.has(item.link)) {
          newArticles.push({
            id: Buffer.from(item.link).toString('base64').slice(0, 16),
            title: item.title || '無題',
            url: item.link,
            source: feed.name,
            publishedAt: item.isoDate || new Date().toISOString(),
            status: 'pending'
          });
        }
      }
    } catch (e) {
      console.error(`Error fetching feed ${feed.name}:`, e);
    }
  }

  if (newArticles.length > 0) {
    const updated = [...newArticles, ...existingArticles];
    fs.writeFileSync(ARTICLES_PATH, JSON.stringify(updated, null, 2), 'utf-8');
    console.log(`${newArticles.length}件の新着記事を追加しました。`);
  } else {
    console.log('新着記事はありませんでした。');
  }
}

syncRss();
```

### 5.2 【ステップ2用】Playwright本文抽出 ＆ 2段階Ollama要約 (`summarize-local.ts`)

```typescript
import { chromium } from 'playwright';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import fetch from 'node-fetch';

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL_NAME = 'bonsai-2:2b'; // 2Bモデル指定

async function callOllama(prompt: string, maxTokens: number = 400): Promise<string> {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL_NAME,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_predict: maxTokens }
    })
  });
  const data = (await res.json()) as { response: string };
  return data.response.trim();
}

// 1. 分類処理
async function classify(title: string, snippet: string): Promise<string> {
  const prompt = `
以下の技術記事のタイトルと冒頭文を読み、性質にもっとも近いカテゴリを1つだけ選んでその英字キーワード（大文字）のみを出力してください。
選択肢: TUTORIAL, RELEASE, TROUBLESHOOT, GENERAL

タイトル: ${title}
冒頭文: ${snippet}
カテゴリ:`;
  
  const result = await callOllama(prompt, 10);
  if (result.includes('RELEASE')) return 'RELEASE';
  if (result.includes('TROUBLESHOOT')) return 'TROUBLESHOOT';
  if (result.includes('TUTORIAL')) return 'TUTORIAL';
  return 'GENERAL';
}

// 2. 約400文字の要約処理
async function summarize(category: string, fullText: string): Promise<string> {
  const trimmed = fullText.slice(0, 4000);
  const prompt = `
以下のIT技術記事を、開発者向けに日本語で**400文字程度**のまとまった文章で要約してください。
挨拶や前置きは書かず、要約本文のみを出力してください。

カテゴリ: ${category}
記事本文:
${trimmed}`;

  return await callOllama(prompt, 500);
}

// 3. Playwrightでの本文および画像抽出
async function extractContent(url: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const html = await page.content();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const imageUrls: string[] = [];
  if (article && article.content) {
    const contentDom = new JSDOM(article.content);
    contentDom.window.document.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src');
      if (src) {
        try {
          const absUrl = new URL(src, url).href;
          if (!absUrl.includes('avatar') && !absUrl.includes('icon') && !absUrl.endsWith('.svg')) {
            if (!imageUrls.includes(absUrl)) imageUrls.push(absUrl);
          }
        } catch (e) {}
      }
    });
  }

  await browser.close();
  return {
    bodyText: article ? article.textContent.replace(/\s+/g, ' ').trim() : '',
    imageUrls
  };
}
```

---

## 6. 開発タスク進捗チェックリスト

### フェーズ 1: ステップ1 (基本機能)
- [ ] RSS管理用の `feeds.json` を作成・フィードURLを登録
- [ ] GitHub Actions用 Node.jsスクリプト (`fetch-rss.ts`) の実装
- [ ] GitHub Actions ワークフロー (`.github/workflows/rss-cron.yml`) の設定
- [ ] `articles.json` を `fetch()` してカード一覧表示する GitHub Pages 用 `index.html` の作成

### フェーズ 2: ステップ2 (ローカルAI拡張)
- [ ] ローカル環境での Ollama (2Bモデル) と Playwright のセットアップ
- [ ] Playwright ＋ `@mozilla/readability` による本文＆画像抽出スクリプトの実装
- [ ] 2段階処理（分類 ＞ 400文字要約）プロンプト調整とOllama呼び出しの実装
- [ ] 要約完了後の `articles.json` 書き戻し ＆ Auto Commit/Push 用シェルスクリプトの作成
- [ ] フロントエンド（`index.html`）に 400文字要約表示と画像ギャラリー（Lightbox等）の追加