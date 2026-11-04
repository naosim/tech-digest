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
  imageUrl?: string;
}

interface RssItemWithImages extends Parser.Item {
  'media:content'?: unknown;
  'media:thumbnail'?: unknown;
  'content:encoded'?: string;
}

const parser = new Parser<Record<string, unknown>, RssItemWithImages>({
  customFields: {
    item: [
      ['media:content', 'media:content'],
      ['media:thumbnail', 'media:thumbnail'],
      ['content:encoded', 'content:encoded']
    ]
  }
});
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

function getImageUrl(item: RssItemWithImages): string | undefined {
  const candidates: unknown[] = [item.enclosure?.url];

  const addMediaImage = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(addMediaImage);
    } else if (typeof value === 'string') {
      candidates.push(value);
    } else if (value && typeof value === 'object') {
      const image = value as { url?: unknown; href?: unknown; $?: { url?: unknown; href?: unknown } };
      candidates.push(image.url, image.href, image.$?.url, image.$?.href);
    }
  };

  addMediaImage(item['media:content']);
  addMediaImage(item['media:thumbnail']);

  const embeddedImage = (item['content:encoded'] ?? item.content ?? item.summary ?? '')
    .match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  if (embeddedImage) {
    candidates.push(embeddedImage);
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.href;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function syncRss() {
  const feeds = readJson<FeedConfig[]>(FEEDS_PATH, []);
  const existingArticles = readJson<Article[]>(ARTICLES_PATH, []);
  const existingUrls = new Set(existingArticles.map((article) => article.url));
  const existingByUrl = new Map(existingArticles.map((article) => [article.url, article]));
  const newArticles: Article[] = [];
  let enrichedExistingArticles = false;

  for (const feed of feeds) {
    if (!feed.url) {
      continue;
    }

    try {
      const feedData = await parser.parseURL(feed.url);
      const items = feedData.items ?? [];

      for (const item of items) {
        const rawUrl = item.link ?? item.guid;
        if (!rawUrl) {
          continue;
        }

        const imageUrl = getImageUrl(item);
        const existingArticle = existingByUrl.get(rawUrl);
        if (existingArticle) {
          if (!existingArticle.imageUrl && imageUrl) {
            existingArticle.imageUrl = imageUrl;
            enrichedExistingArticles = true;
          }
          continue;
        }

        if (existingUrls.has(rawUrl)) {
          continue;
        }

        newArticles.push({
          id: buildArticleId(rawUrl),
          title: item.title?.trim() || '無題',
          url: rawUrl,
          source: feed.name,
          publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
          status: 'pending',
          ...(imageUrl ? { imageUrl } : {})
        });

        existingUrls.add(rawUrl);
      }
    } catch (error) {
      console.error(`Failed to fetch feed: ${feed.name}`, error);
    }
  }

  if (newArticles.length === 0 && !enrichedExistingArticles) {
    console.log('新着記事はありませんでした。');
    return;
  }

  const updatedArticles = [...newArticles, ...existingArticles];
  fs.writeFileSync(ARTICLES_PATH, `${JSON.stringify(updatedArticles, null, 2)}\n`, 'utf-8');
  console.log(`${newArticles.length}件の新着記事を追加し、既存記事の画像情報を補完しました。`);
}

await syncRss();
