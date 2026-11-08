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

interface SecurityArticle {
  id: string;
  url: string;
  title: string;
  source: string;
  publishedAt: string;
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
const SECURITY_FEEDS_PATH = path.join(ROOT_DIR, 'security-feeds.json');
const SECURITY_ARTICLES_PATH = path.join(ROOT_DIR, 'security-articles.json');
const ARCHIVES_DIR = path.join(ROOT_DIR, 'archives');
const ARCHIVES_INDEX_PATH = path.join(ARCHIVES_DIR, 'index.json');
const MAX_ACTIVE_ARTICLES = 100;
const MAX_SECURITY_ARTICLES = 500;
const ARCHIVE_BATCH_SIZE = 1000;

interface ArchiveEntry {
  file: string;
  count: number;
  oldestPublishedAt: string;
  newestPublishedAt: string;
}

interface ArchiveIndex {
  archives: ArchiveEntry[];
}

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

function readArchives(): { articles: Article[]; files: string[] } {
  if (!fs.existsSync(ARCHIVES_DIR)) {
    return { articles: [], files: [] };
  }

  const indexExists = fs.existsSync(ARCHIVES_INDEX_PATH);
  const index: ArchiveIndex = indexExists
    ? JSON.parse(fs.readFileSync(ARCHIVES_INDEX_PATH, 'utf-8')) as ArchiveIndex
    : {
        archives: fs.readdirSync(ARCHIVES_DIR)
          .filter((file) => /^articles-\d{4}\.json$/.test(file))
          .sort()
          .map((file) => ({ file, count: 0, oldestPublishedAt: '', newestPublishedAt: '' }))
      };

  if (!Array.isArray(index.archives)) {
    throw new Error(`${ARCHIVES_INDEX_PATH} must contain an archives array.`);
  }

  const files: string[] = [];
  const articles: Article[] = [];
  for (const archive of index.archives) {
    if (!archive || typeof archive.file !== 'string' || !/^articles-\d{4}\.json$/.test(archive.file)) {
      throw new Error(`Invalid archive entry in ${ARCHIVES_INDEX_PATH}.`);
    }

    const filePath = path.join(ARCHIVES_DIR, archive.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Archive file is missing: ${filePath}`);
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(parsed)) {
      throw new Error(`${filePath} must contain a JSON array.`);
    }

    files.push(archive.file);
    articles.push(...parsed as Article[]);
  }

  return { articles, files };
}

function writeJsonIfChanged(filePath: string, value: unknown): boolean {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf-8') === content) {
    return false;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, content, 'utf-8');
  fs.renameSync(temporaryPath, filePath);
  return true;
}

function comparePublishedAtNewestFirst(left: Article, right: Article): number {
  const leftTime = Date.parse(left.publishedAt);
  const rightTime = Date.parse(right.publishedAt);
  return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
}

function compareSecurityArticlesNewestFirst(left: SecurityArticle, right: SecurityArticle): number {
  const leftTime = Date.parse(left.publishedAt);
  const rightTime = Date.parse(right.publishedAt);
  return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
}

async function syncSecurityRss(): Promise<void> {
  const feeds = readJson<FeedConfig[]>(SECURITY_FEEDS_PATH, []);
  const existingArticles = readJson<SecurityArticle[]>(SECURITY_ARTICLES_PATH, []);
  const existingUrls = new Set(existingArticles.map((article) => article.url));
  const newArticles: SecurityArticle[] = [];

  for (const feed of feeds) {
    if (!feed.url) {
      continue;
    }

    try {
      const feedData = await parser.parseURL(feed.url);
      for (const item of feedData.items ?? []) {
        const url = item.link ?? item.guid;
        if (!url || existingUrls.has(url)) {
          continue;
        }

        newArticles.push({
          id: buildArticleId(url),
          title: item.title?.trim() || '無題',
          url,
          source: feed.name,
          publishedAt: item.isoDate || item.pubDate || new Date().toISOString()
        });
        existingUrls.add(url);
      }
    } catch (error) {
      console.error(`Failed to fetch security feed: ${feed.name}`, error);
    }
  }

  const allArticles = [...existingArticles, ...newArticles]
    .sort(compareSecurityArticlesNewestFirst)
    .slice(0, MAX_SECURITY_ARTICLES);
  const changed = writeJsonIfChanged(SECURITY_ARTICLES_PATH, allArticles);
  console.log(
    `セキュリティ情報: ${newArticles.length}件を追加しました（保存 ${allArticles.length}件${changed ? '' : '、変更なし'}）。`
  );
}

function saveArticleSets(allArticles: Article[], previousArchiveFiles: string[]): {
  activeChanged: boolean;
  archiveFilesChanged: boolean;
} {
  allArticles.sort(comparePublishedAtNewestFirst);
  const activeArticles = allArticles.slice(0, MAX_ACTIVE_ARTICLES);
  const archivedArticles = allArticles.slice(MAX_ACTIVE_ARTICLES);
  const oldestFirst = [...archivedArticles].reverse();
  const archives: ArchiveEntry[] = [];
  const currentArchiveFiles = new Set<string>();
  let archiveFilesChanged = false;

  for (let offset = 0; offset < oldestFirst.length; offset += ARCHIVE_BATCH_SIZE) {
    const chunk = oldestFirst.slice(offset, offset + ARCHIVE_BATCH_SIZE).reverse();
    const file = `articles-${String(archives.length + 1).padStart(4, '0')}.json`;
    currentArchiveFiles.add(file);
    if (writeJsonIfChanged(path.join(ARCHIVES_DIR, file), chunk)) {
      archiveFilesChanged = true;
    }

    archives.push({
      file,
      count: chunk.length,
      oldestPublishedAt: chunk[chunk.length - 1].publishedAt,
      newestPublishedAt: chunk[0].publishedAt
    });
  }

  for (const file of previousArchiveFiles) {
    if (!currentArchiveFiles.has(file)) {
      fs.rmSync(path.join(ARCHIVES_DIR, file));
      archiveFilesChanged = true;
    }
  }

  if (writeJsonIfChanged(ARCHIVES_INDEX_PATH, { archives })) {
    archiveFilesChanged = true;
  }

  const activeChanged = writeJsonIfChanged(ARTICLES_PATH, activeArticles);
  return { activeChanged, archiveFilesChanged };
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
  if (process.argv.includes('--security-only')) {
    await syncSecurityRss();
    return;
  }

  const feeds = process.argv.includes('--archive-only')
    ? []
    : readJson<FeedConfig[]>(FEEDS_PATH, []);
  const existingArticles = readJson<Article[]>(ARTICLES_PATH, []);
  const { articles: archivedArticles, files: previousArchiveFiles } = readArchives();
  const allArticles = [...existingArticles, ...archivedArticles];
  const existingUrls = new Set(allArticles.map((article) => article.url));
  const existingByUrl = new Map(allArticles.map((article) => [article.url, article]));
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

        const newArticle: Article = {
          id: buildArticleId(rawUrl),
          title: item.title?.trim() || '無題',
          url: rawUrl,
          source: feed.name,
          publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
          status: 'pending'
        };
        if (imageUrl) {
          newArticle.imageUrl = imageUrl;
        }
        newArticles.push(newArticle);

        existingUrls.add(rawUrl);
        existingByUrl.set(rawUrl, newArticle);
      }
    } catch (error) {
      console.error(`Failed to fetch feed: ${feed.name}`, error);
    }
  }

  const { activeChanged, archiveFilesChanged } = saveArticleSets(
    [...allArticles, ...newArticles],
    previousArchiveFiles
  );
  await syncSecurityRss();
  if (newArticles.length === 0 && !enrichedExistingArticles && !activeChanged && !archiveFilesChanged) {
    console.log('新着記事はありませんでした。');
    return;
  }

  console.log(
    `${newArticles.length}件の新着記事を追加し、${enrichedExistingArticles ? '既存記事の画像情報を補完し、' : ''}${allArticles.length + newArticles.length > MAX_ACTIVE_ARTICLES ? '古い記事をアーカイブしました' : 'アーカイブはありません'}。`
  );
}

await syncRss();
