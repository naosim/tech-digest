import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Parser from 'rss-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FeedConfig {
  id?: string;
  name: string;
  url: string;
}

interface Article {
  id: string;
  url: string;
  title: string;
  source: string;
  publishedAt: string;
  status: 'pending' | 'completed';
}

const parser = new Parser();
const ROOT_DIR = __dirname;
const FEEDS_PATH = path.join(ROOT_DIR, 'feeds.json');
const ARTICLES_PATH = path.join(ROOT_DIR, 'articles.json');

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw.trim() ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    console.warn(`Unable to parse ${filePath}. Using fallback value.`);
    return fallback;
  }
}

function buildArticleId(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

async function syncRss() {
  const feeds = readJson<FeedConfig[]>(FEEDS_PATH, []);
  const existingArticles = readJson<Article[]>(ARTICLES_PATH, []);
  const existingUrls = new Set(existingArticles.map((article) => article.url));
  const newArticles: Article[] = [];

  for (const feed of feeds) {
    if (!feed.url) {
      continue;
    }

    try {
      const feedData = await parser.parseURL(feed.url);
      const items = feedData.items ?? [];

      for (const item of items) {
        const rawUrl = item.link ?? item.guid;
        if (!rawUrl || existingUrls.has(rawUrl)) {
          continue;
        }

        newArticles.push({
          id: buildArticleId(rawUrl),
          title: item.title?.trim() || '無題',
          url: rawUrl,
          source: feed.name,
          publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
          status: 'pending'
        });

        existingUrls.add(rawUrl);
      }
    } catch (error) {
      console.error(`Failed to fetch feed: ${feed.name}`, error);
    }
  }

  if (newArticles.length === 0) {
    console.log('新着記事はありませんでした。');
    return;
  }

  const updatedArticles = [...newArticles, ...existingArticles];
  fs.writeFileSync(ARTICLES_PATH, `${JSON.stringify(updatedArticles, null, 2)}\n`, 'utf-8');
  console.log(`${newArticles.length}件の新着記事を追加しました。`);
}

await syncRss();
