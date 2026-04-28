#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const SOURCES_FILE = path.join(DATA_DIR, "sources.json");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");

const ARTICLE_POOL_LIMIT = 300;
const TOTAL_LIST_ITEMS = 100;
const ARTICLE_SLOT_SIZE = 1;
const VIDEO_SLOT_SIZE = 9;
const TARGET_ARTICLE_COUNT = (TOTAL_LIST_ITEMS * ARTICLE_SLOT_SIZE) / (ARTICLE_SLOT_SIZE + VIDEO_SLOT_SIZE);
const TARGET_VIDEO_COUNT = TOTAL_LIST_ITEMS - TARGET_ARTICLE_COUNT;
const MAX_CONTENT_ITEMS = TOTAL_LIST_ITEMS;
const MAX_ITEMS_PER_SOURCE = 40;
const DEFAULT_MAX_DAILY_VIDEO_ITEMS = 12;
const PER_ITEM_REQUEST_INTERVAL_MS = parseInteger(process.env.PER_ITEM_REQUEST_INTERVAL_MS, 1000);
const REQUEST_INTERVAL_MS = parseInteger(process.env.REQUEST_INTERVAL_MS, 2500);
const REQUEST_TIMEOUT_MS = parseInteger(process.env.REQUEST_TIMEOUT_MS, 15000);
const USER_AGENT =
  "retro-game-press-clip/1.0 (+GitHub Actions; RSS/Atom only; metadata collection only)";
const RETRO_KEYWORD_PATTERNS = [
  /レトロゲーム/u,
  /ファミコン/u,
  /スーパーファミコン/u,
  /スーファミ/u,
  /メガドライブ/u,
  /PCエンジン/u,
  /ゲームボーイ/u,
  /ゲームギア/u,
  /ネオジオ/u,
  /セガサターン/u,
  /ドリームキャスト/u,
  /アーケードゲーム/u,
  /アーケードアーカイブス/u,
  /アケアカ/u,
  /アケアカNEOGEO/u,
  /MSX/u,
  /MSX2/u,
  /ワンダースワン/u,
  /バーチャルボーイ/u,
  /ゲーム&ウオッチ/u,
  /ゲーム＆ウオッチ/u,
  /PC-FX/u,
  /コナミコマンド/u,
  /EGGコンソール/u,
  /SEGA UNIVERSE/i,
  /往年のIP/u,
  /往年の作品/u,
  /復刻版/u,
  /復刻/u,
  /グラディウス/u,
  /メタルスラッグ/u,
  /サクラ大戦/u,
  /アウトラン/u,
  /ベア・ナックル/u,
  /NiGHTS/,
  /パズルボブル/u,
  /3DO/i,
  /retro games?/i,
  /retro gaming/i,
  /retro console/i,
  /retro hardware/i,
  /famicom/i,
  /\bnes\b/i,
  /\bsnes\b/i,
  /super famicom/i,
  /mega drive/i,
  /pc engine/i,
  /turbografx/i,
  /game boy/i,
  /game gear/i,
  /neo geo/i,
  /sega saturn/i,
  /dreamcast/i,
  /arcade archives?/i,
  /arcade classic/i,
  /classic arcade/i,
  /\bmsx\b/i,
  /wonderswan/i,
  /virtual boy/i,
  /game ?& ?watch/i,
  /game and watch/i,
  /pc-fx/i,
];

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
  "utm_campaign",
  "utm_content",
  "utm_id",
  "utm_medium",
  "utm_name",
  "utm_source",
  "utm_term",
]);

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const runFetchedAt = new Date().toISOString();

  const sources = normalizeSources(await readJsonFile(SOURCES_FILE, []));
  const existingArticles = await readJsonFile(ARTICLES_FILE, []);
  const sourceMap = new Map(sources.map((source) => [source.name, source]));
  const existingArticleMap = new Map();
  const existingVideoMap = new Map();

  for (const article of normalizeExistingArticles(existingArticles)) {
    const source = sourceMap.get(article.sourceName);
    const targetMap = source && source.contentKind === "video" ? existingVideoMap : existingArticleMap;
    targetMap.set(getArticleKey(article.url), article);
  }

  const enabledSources = sources.filter((source) => source.enabled !== false);
  const articleSources = enabledSources.filter((source) => source.contentKind !== "video");
  const videoSources = enabledSources.filter((source) => source.contentKind === "video");

  if (!enabledSources.length) {
    console.log("No enabled sources found.");
    await writeArticlesIfChanged(existingArticles);
    return;
  }

  let discoveredCount = 0;

  for (const source of articleSources) {
    const sourceName = String(source.name || "").trim() || "Unknown Source";
    const sourceUrl = String(source.rssUrl || source.indexUrl || "").trim();

    if (!sourceUrl) {
      console.warn(`[skip] ${sourceName}: source URL is empty.`);
      continue;
    }

    try {
      console.log(`[fetch] ${sourceName}`);

      const items = await fetchSourceItems(source);
      let newItemsForSource = 0;

      for (const item of items) {
        const article = buildArticle(item, source, runFetchedAt);

        if (!article || !shouldKeepArticle(article, source)) {
          continue;
        }

        const key = getArticleKey(article.url);
        const previous = existingArticleMap.get(key);

        if (previous) {
          existingArticleMap.set(key, mergeArticle(previous, article));
        } else {
          existingArticleMap.set(key, article);
          newItemsForSource += 1;
          discoveredCount += 1;
        }
      }

      console.log(`[ok] ${sourceName}: parsed ${items.length} items, ${newItemsForSource} new.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[warn] ${sourceName}: ${message}`);
    }

    await sleep(REQUEST_INTERVAL_MS);
  }

  const allArticles = [...existingArticleMap.values()]
    .filter(isValidArticle)
    .filter((article) => shouldKeepSavedArticle(article, sourceMap))
    .sort(compareArticles);
  const limitedArticles = applyPerSourceLimit(allArticles, sourceMap);
  const nextArticles = selectArticleHighlights(limitedArticles);
  const nextVideos = await fetchDailyVideoArticles(videoSources, existingVideoMap, runFetchedAt);
  const combinedArticles = blendContentItems(nextVideos, nextArticles);

  const changed = await writeArticlesIfChanged(combinedArticles);

  if (changed) {
    console.log(
      `[done] Saved ${combinedArticles.length} items (${nextArticles.length} articles / ${nextVideos.length} videos). ${discoveredCount} new article(s).`,
    );
  } else {
    console.log(
      `[done] No article changes. ${combinedArticles.length} item(s) kept (${nextArticles.length} articles / ${nextVideos.length} videos).`,
    );
  }
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) {
    return [];
  }

  return sources
    .filter((source) => source && typeof source === "object")
    .map((source) => ({
      name: cleanText(source.name) || "Unknown Source",
      rssUrl: String(source.rssUrl || "").trim(),
      indexUrl: String(source.indexUrl || "").trim(),
      tags: normalizeTags(source.tags),
      enabled: source.enabled !== false,
      language: normalizeLanguage(source.language),
      type: normalizeSourceType(source.type, source),
      contentKind: normalizeContentKind(source.contentKind),
      requireRetroKeywords: source.requireRetroKeywords === true,
      maxItems: Math.min(parseInteger(source.maxItems, MAX_ITEMS_PER_SOURCE), MAX_ITEMS_PER_SOURCE),
      maxSavedItems: Math.max(parseInteger(source.maxSavedItems, ARTICLE_POOL_LIMIT), 1),
      maxDailyItems: Math.max(parseInteger(source.maxDailyItems, DEFAULT_MAX_DAILY_VIDEO_ITEMS), 1),
    }))
    .filter((source) => source.rssUrl || source.indexUrl);
}

async function fetchSourceItems(source) {
  if (source.type === "newsSitemap") {
    return fetchNewsSitemapItems(source);
  }

  if (source.type === "youtubeChannel") {
    return fetchYouTubeChannelItems(source);
  }

  const xml = await fetchFeed(source.rssUrl);
  return parseFeedItems(xml).slice(0, source.maxItems || MAX_ITEMS_PER_SOURCE);
}

async function fetchNewsSitemapItems(source) {
  const xml = await fetchFeed(source.indexUrl);
  const rawItems = parseNewsSitemapItems(xml)
    .filter((item) => item.link && item.title)
    .filter((item) => !source.requireRetroKeywords || matchesRetroKeywords(toKeywordTarget(item)))
    .slice(0, source.maxItems || MAX_ITEMS_PER_SOURCE);
  const items = [];

  for (let index = 0; index < rawItems.length; index += 1) {
    const rawItem = rawItems[index];
    const metadata = await fetchArticleMetadata(rawItem.link);

    items.push({
      ...rawItem,
      title: metadata.title || rawItem.title,
      summary: metadata.summary || rawItem.summary,
      thumbnailUrl: metadata.thumbnailUrl || rawItem.thumbnailUrl,
      publishedAt: metadata.publishedAt || rawItem.publishedAt,
    });

    if (index < rawItems.length - 1) {
      await sleep(PER_ITEM_REQUEST_INTERVAL_MS);
    }
  }

  return items;
}

async function fetchYouTubeChannelItems(source) {
  const html = await fetchFeed(source.indexUrl);
  return parseYouTubeChannelItems(html).slice(0, source.maxItems || MAX_ITEMS_PER_SOURCE);
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function readJsonFile(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

function normalizeExistingArticles(articles) {
  if (!Array.isArray(articles)) {
    return [];
  }

  return articles.filter(isValidArticle).map((article) => {
    const normalizedUrl = normalizeUrl(article.url);

    return {
      title: String(article.title).trim(),
      url: normalizedUrl,
      sourceName: String(article.sourceName).trim(),
      publishedAt: toIsoString(article.publishedAt, article.fetchedAt),
      summary: String(article.summary || "").trim(),
      thumbnailUrl: sanitizeThumbnailUrl(
        normalizeUrl(article.thumbnailUrl || "", article.url, { allowEmpty: true }),
        normalizedUrl,
      ),
      tags: normalizeTags(article.tags),
      fetchedAt: toIsoString(article.fetchedAt, article.publishedAt),
    };
  });
}

async function fetchFeed(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseFeedItems(xml) {
  const cleanedXml = String(xml || "").trim();

  if (!cleanedXml) {
    return [];
  }

  const itemBlocks = extractBlocks(cleanedXml, "item");
  if (itemBlocks.length) {
    return itemBlocks.map((block) => parseRssItem(block));
  }

  const entryBlocks = extractBlocks(cleanedXml, "entry");
  if (entryBlocks.length) {
    return entryBlocks.map((block) => parseAtomEntry(block));
  }

  return [];
}

function parseRssItem(block) {
  const title = decodeEntities(extractTagText(block, ["title"]));
  const link =
    decodeEntities(extractTagText(block, ["link"])) ||
    decodeEntities(extractGuidIfUrl(block));
  const publishedAt = decodeEntities(
    extractTagText(block, ["pubDate", "dc:date", "published", "updated"]),
  );
  const summary = decodeEntities(extractTagText(block, ["description", "summary"]));
  const thumbnailUrl = decodeEntities(extractThumbnailUrl(block));
  const categories = extractCategories(block);

  return {
    title,
    link,
    publishedAt,
    summary,
    thumbnailUrl,
    categories,
  };
}

function parseAtomEntry(block) {
  const title = decodeEntities(extractTagText(block, ["title"]));
  const link = decodeEntities(extractAtomLink(block));
  const publishedAt = decodeEntities(extractTagText(block, ["published", "updated"]));
  const summary = decodeEntities(extractTagText(block, ["summary", "media:description"]));
  const thumbnailUrl = decodeEntities(extractThumbnailUrl(block));
  const categories = extractAtomCategories(block);

  return {
    title,
    link,
    publishedAt,
    summary,
    thumbnailUrl,
    categories,
  };
}

function parseNewsSitemapItems(xml) {
  const urlBlocks = extractBlocks(String(xml || ""), "url");

  return urlBlocks.map((block) => ({
    title: decodeEntities(extractTagText(block, ["news:title", "title"])),
    link: decodeEntities(extractTagText(block, ["loc"])),
    publishedAt: decodeEntities(extractTagText(block, ["news:publication_date", "publication_date"])),
    summary: "",
    thumbnailUrl: "",
    categories: extractDelimitedTagValues(block, ["news:keywords", "keywords"]),
  }));
}

function parseYouTubeChannelItems(html) {
  const uniqueVideoIds = [...new Set([...String(html || "").matchAll(/"videoId":"([^"]+)"/g)].map((match) => match[1]))];

  return uniqueVideoIds.map((videoId) => ({
    title: `YouTube Video ${videoId}`,
    link: `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt: "",
    summary: "",
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    categories: [],
  }));
}

function extractBlocks(xml, tagName) {
  const escapedTag = escapeRegExp(tagName);
  const pattern = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapedTag}>`, "gi");
  const results = [];
  let match;

  while ((match = pattern.exec(xml)) !== null) {
    results.push(match[1]);
  }

  return results;
}

function extractTagText(xml, tagNames) {
  for (const tagName of tagNames) {
    const escapedTag = escapeRegExp(tagName);
    const pattern = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapedTag}>`, "i");
    const match = xml.match(pattern);

    if (match) {
      return unwrapCdata(match[1]).trim();
    }
  }

  return "";
}

function extractGuidIfUrl(xml) {
  const guid = extractTagText(xml, ["guid"]).trim();
  return /^https?:\/\//i.test(guid) ? guid : "";
}

function extractAtomLink(xml) {
  const matches = [...xml.matchAll(/<link\b([^>]*)\/?>/gi)];

  for (const match of matches) {
    const attrs = match[1] || "";
    const rel = getAttribute(attrs, "rel");
    const href = getAttribute(attrs, "href");

    if (href && (!rel || rel === "alternate")) {
      return href;
    }
  }

  return "";
}

function extractThumbnailUrl(xml) {
  const mediaThumbnail = matchAttributeValue(xml, /<media:thumbnail\b[^>]*\burl=["']([^"']+)["'][^>]*\/?>/i);
  if (mediaThumbnail) {
    return mediaThumbnail;
  }

  const mediaContent = matchAttributeValue(
    xml,
    /<media:content\b[^>]*\burl=["']([^"']+)["'][^>]*\/?>/i,
  );
  if (mediaContent) {
    return mediaContent;
  }

  const enclosure = matchAttributeValue(
    xml,
    /<enclosure\b(?=[^>]*\btype=["'][^"']*image[^"']*["'])[^>]*\burl=["']([^"']+)["'][^>]*\/?>/i,
  );
  if (enclosure) {
    return enclosure;
  }

  const itunesImage = matchAttributeValue(xml, /<itunes:image\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
  if (itunesImage) {
    return itunesImage;
  }

  const description = extractTagText(xml, ["description", "summary"]);
  const imageInDescription = matchAttributeValue(description, /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  if (imageInDescription) {
    return imageInDescription;
  }

  return "";
}

function extractCategories(xml) {
  return [...xml.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)]
    .map((match) => decodeEntities(unwrapCdata(match[1])).trim())
    .filter(Boolean);
}

function extractDelimitedTagValues(xml, tagNames) {
  const text = decodeEntities(extractTagText(xml, tagNames));
  if (!text) {
    return [];
  }

  return text
    .split(",")
    .map((value) => cleanText(value))
    .filter(Boolean);
}

function extractAtomCategories(xml) {
  return [...xml.matchAll(/<category\b([^>]*)\/?>/gi)]
    .map((match) => {
      const attrs = match[1] || "";
      return getAttribute(attrs, "term") || getAttribute(attrs, "label") || "";
    })
    .map((value) => decodeEntities(value).trim())
    .filter(Boolean);
}

function buildArticle(item, source, fetchedAtOverride) {
  const baseUrl = source.rssUrl || source.indexUrl;
  const rawUrl = normalizeUrl(item.link || "", baseUrl, { allowEmpty: true });

  if (!rawUrl) {
    return null;
  }

  const title = cleanText(item.title);
  if (!title) {
    return null;
  }

  const publishedAt = toIsoString(item.publishedAt, new Date().toISOString());
  const summary = summarize(item.summary);
  const thumbnailUrl = sanitizeThumbnailUrl(
    normalizeUrl(item.thumbnailUrl || "", rawUrl, { allowEmpty: true }),
    rawUrl,
  );
  const tags = normalizeTags([...(source.tags || []), ...(item.categories || [])]);
  const fetchedAt = toIsoString(fetchedAtOverride, new Date().toISOString());

  return {
    title,
    url: rawUrl,
    sourceName: String(source.name || "").trim() || "Unknown Source",
    publishedAt,
    summary,
    thumbnailUrl,
    tags,
    fetchedAt,
  };
}

function shouldKeepArticle(article, source) {
  if (!source.requireRetroKeywords) {
    return true;
  }

  return matchesRetroKeywords(toKeywordTarget(article));
}

function shouldKeepSavedArticle(article, sourceMap) {
  const source = sourceMap.get(article.sourceName);
  return source ? shouldKeepArticle(article, source) : true;
}

function selectArticleHighlights(articles) {
  return [...articles].sort(compareArticles).slice(0, TARGET_ARTICLE_COUNT);
}

function applyPerSourceLimit(articles, sourceMap) {
  const counts = new Map();
  const selected = [];

  for (const article of articles) {
    const source = sourceMap.get(article.sourceName);
    const limit = source ? source.maxSavedItems : ARTICLE_POOL_LIMIT;
    const currentCount = counts.get(article.sourceName) || 0;

    if (currentCount >= limit) {
      continue;
    }

    selected.push(article);
    counts.set(article.sourceName, currentCount + 1);
  }

  return selected;
}

function takeArticles(selected, selectedKeys, articles, count) {
  for (const article of articles) {
    if (selected.length >= ARTICLE_POOL_LIMIT || count <= 0) {
      break;
    }

    const key = getArticleKey(article.url);
    if (selectedKeys.has(key)) {
      continue;
    }

    selected.push(article);
    selectedKeys.add(key);
    count -= 1;
  }
}

function mergeArticle(previous, next) {
  return {
    title: next.title || previous.title,
    url: previous.url,
    sourceName: next.sourceName || previous.sourceName,
    publishedAt: next.publishedAt || previous.publishedAt,
    summary: next.summary || previous.summary,
    thumbnailUrl: sanitizeThumbnailUrl(next.thumbnailUrl || previous.thumbnailUrl || "", previous.url),
    tags: normalizeTags([...(previous.tags || []), ...(next.tags || [])]),
    fetchedAt: previous.fetchedAt || next.fetchedAt,
  };
}

function summarize(value) {
  const text = cleanText(stripHtml(value));

  if (!text) {
    return "";
  }

  const maxLength = 180;
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/続きを読む$/u, "")
    .replace(/\u00a0/g, " ")
    .trim();
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.map((tag) => cleanText(tag)).filter(Boolean))].slice(0, 10);
}

function normalizeSourceType(value, source) {
  const type = String(value || "").trim();

  if (type === "newsSitemap") {
    return "newsSitemap";
  }

  if (type === "youtubeChannel") {
    return "youtubeChannel";
  }

  if (source && source.indexUrl && !source.rssUrl) {
    return "newsSitemap";
  }

  return "rss";
}

function normalizeContentKind(value) {
  return String(value || "").trim().toLowerCase() === "video" ? "video" : "article";
}

function normalizeLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  return language === "ja" || language === "en" ? language : "";
}

function matchesRetroKeywords(value) {
  const text = String(value || "");
  return RETRO_KEYWORD_PATTERNS.some((pattern) => pattern.test(text));
}

function toKeywordTarget(item) {
  return [item.title, item.summary, Array.isArray(item.categories) ? item.categories.join(" ") : ""]
    .filter(Boolean)
    .join(" ");
}

function toIsoString(primary, fallback) {
  const first = new Date(primary);
  if (!Number.isNaN(first.getTime())) {
    return first.toISOString();
  }

  const second = new Date(fallback);
  if (!Number.isNaN(second.getTime())) {
    return second.toISOString();
  }

  return new Date(0).toISOString();
}

function normalizeUrl(value, baseUrl, options = {}) {
  const allowEmpty = options.allowEmpty === true;
  const candidate = String(value || "").trim();

  if (!candidate) {
    return allowEmpty ? "" : "";
  }

  try {
    const url = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    return url.toString();
  } catch (error) {
    return allowEmpty ? "" : "";
  }
}

function sanitizeThumbnailUrl(thumbnailUrl, articleUrl) {
  const normalizedThumbnail = normalizeUrl(thumbnailUrl || "", articleUrl, { allowEmpty: true });
  const normalizedArticleUrl = normalizeUrl(articleUrl || "", undefined, { allowEmpty: true });

  if (!normalizedThumbnail || normalizedThumbnail === normalizedArticleUrl) {
    return "";
  }

  return normalizedThumbnail;
}

function containsJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u.test(String(value || ""));
}

function getArticleKey(url) {
  return normalizeUrl(url);
}

function compareArticles(left, right) {
  const dateDiff = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);

  if (dateDiff !== 0) {
    return dateDiff;
  }

  return left.url.localeCompare(right.url);
}

async function fetchDailyVideoArticles(videoSources, existingVideoMap, runFetchedAt) {
  if (!videoSources.length) {
    return [];
  }

  const rotationKey = getDailyVideoRotationKey(new Date());
  const reusableVideos = getReusableDailyVideos(existingVideoMap, rotationKey);

  if (reusableVideos.length === TARGET_VIDEO_COUNT) {
    console.log(`[video] Reusing ${reusableVideos.length} video(s) for ${rotationKey}.`);
    return reusableVideos;
  }

  const videoPoolMap = new Map();

  for (const source of videoSources) {
    const sourceName = String(source.name || "").trim() || "Unknown Source";

    try {
      console.log(`[video] ${sourceName}`);
      const items = await fetchSourceItems(source);

      for (const item of items) {
        const candidate = buildVideoCandidate(item, source);

        if (!candidate) {
          continue;
        }

        const key = getArticleKey(candidate.url);
        if (!videoPoolMap.has(key)) {
          videoPoolMap.set(key, candidate);
        }
      }

      console.log(`[ok] ${sourceName}: pooled ${items.length} video item(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[warn] ${sourceName}: ${message}`);
    }

    await sleep(REQUEST_INTERVAL_MS);
  }

  const selectedVideos = await pickDailyVideoSelection(
    [...videoPoolMap.values()].filter(isValidArticle),
    videoSources,
    existingVideoMap,
    rotationKey,
    runFetchedAt,
  );

  console.log(`[video] Selected ${selectedVideos.length} video(s) for ${rotationKey}.`);
  return selectedVideos;
}

async function pickDailyVideoSelection(videoPool, videoSources, existingVideoMap, rotationKey, runFetchedAt) {
  if (!videoPool.length) {
    return [];
  }

  const sourceMap = new Map(videoSources.map((source) => [source.name, source]));
  const shuffledPool = shuffleDeterministically(
    [...videoPool].sort((left, right) => left.url.localeCompare(right.url)),
    rotationKey,
  );
  const selectedKeys = new Set();
  const selected = [];
  const perSourceCounts = new Map();

  takeDailyVideos({
    pool: shuffledPool,
    sourceMap,
    perSourceCounts,
    selected,
    selectedKeys,
    enforcePerSourceLimit: true,
  });

    if (selected.length < TARGET_VIDEO_COUNT) {
      takeDailyVideos({
        pool: shuffledPool,
        sourceMap,
      perSourceCounts,
      selected,
      selectedKeys,
      enforcePerSourceLimit: false,
    });
  }

  const hydratedVideos = [];

  for (let index = 0; index < selected.length && index < TARGET_VIDEO_COUNT; index += 1) {
    hydratedVideos.push(await hydrateVideoArticle(selected[index], existingVideoMap, runFetchedAt));

    if (index < selected.length - 1) {
      await sleep(PER_ITEM_REQUEST_INTERVAL_MS);
    }
  }

  return hydratedVideos.sort(compareArticles);
}

function takeDailyVideos({
  pool,
  sourceMap,
  perSourceCounts,
  selected,
  selectedKeys,
  enforcePerSourceLimit,
}) {
  for (const article of pool) {
    if (selected.length >= TARGET_VIDEO_COUNT) {
      break;
    }

    const key = getArticleKey(article.url);
    if (selectedKeys.has(key)) {
      continue;
    }

    const source = sourceMap.get(article.sourceName);
    const maxDailyItems = source ? source.maxDailyItems : DEFAULT_MAX_DAILY_VIDEO_ITEMS;
    const currentCount = perSourceCounts.get(article.sourceName) || 0;

    if (enforcePerSourceLimit && currentCount >= maxDailyItems) {
      continue;
    }

    selected.push(article);
    selectedKeys.add(key);
    perSourceCounts.set(article.sourceName, currentCount + 1);
  }
}

function buildVideoCandidate(item, source) {
  const article = buildArticle(item, source, new Date(0).toISOString());

  if (!article || !isYouTubeVideoUrl(article.url)) {
    return null;
  }

  return article;
}

async function hydrateVideoArticle(article, existingVideoMap, runFetchedAt) {
  const key = getArticleKey(article.url);
  const existing = existingVideoMap.get(key);
  let metadata = {};

  try {
    metadata = await fetchArticleMetadata(article.url);
  } catch (error) {
    metadata = {};
  }

  const nextArticle = {
    title: cleanText(metadata.title) || article.title,
    url: article.url,
    sourceName: article.sourceName,
    publishedAt: toIsoString(metadata.publishedAt, article.publishedAt),
    summary: summarize(metadata.summary || article.summary),
    thumbnailUrl: sanitizeThumbnailUrl(
      normalizeUrl(metadata.thumbnailUrl || article.thumbnailUrl || "", article.url, { allowEmpty: true }),
      article.url,
    ),
    tags: article.tags,
    fetchedAt: runFetchedAt,
  };

  return existing ? mergeArticle(existing, nextArticle) : nextArticle;
}

function getReusableDailyVideos(existingVideoMap, rotationKey) {
  return [...existingVideoMap.values()]
    .filter((article) => isYouTubeVideoUrl(article.url))
    .filter((article) => getDailyVideoRotationKey(new Date(article.fetchedAt)) === rotationKey)
    .slice(0, TARGET_VIDEO_COUNT);
}

function blendContentItems(videos, articles) {
  const ordered = [];
  const videoQueue = [...videos];
  const articleQueue = [...articles];

  while (videoQueue.length || articleQueue.length) {
    takeBatch(ordered, videoQueue, VIDEO_SLOT_SIZE);
    takeBatch(ordered, articleQueue, ARTICLE_SLOT_SIZE);

    if (!videoQueue.length && articleQueue.length) {
      takeBatch(ordered, articleQueue, ARTICLE_SLOT_SIZE);
    }
  }

  return ordered.slice(0, MAX_CONTENT_ITEMS);
}

function takeBatch(target, queue, count) {
  for (let index = 0; index < count && queue.length; index += 1) {
    target.push(queue.shift());
  }
}

function shuffleDeterministically(items, seedText) {
  const shuffled = [...items];
  const random = createSeededRandom(seedText);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function createSeededRandom(seedText) {
  let seed = hashString(seedText);

  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;

  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function getDailyVideoRotationKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function isYouTubeVideoUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "youtu.be" ||
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "youtube.com"
    );
  } catch (error) {
    return false;
  }
}

function isValidArticle(article) {
  return (
    article &&
    typeof article === "object" &&
    cleanText(article.title) &&
    normalizeUrl(article.url) &&
    cleanText(article.sourceName) &&
    toIsoString(article.publishedAt, article.fetchedAt) &&
    toIsoString(article.fetchedAt, article.publishedAt)
  );
}

async function writeArticlesIfChanged(articles) {
  const sortedArticles = [...articles].slice(0, MAX_CONTENT_ITEMS);
  const nextContent = `${JSON.stringify(sortedArticles, null, 2)}\n`;
  const currentContent = await readFileIfExists(ARTICLES_FILE);

  if (currentContent === nextContent) {
    return false;
  }

  await fs.writeFile(ARTICLES_FILE, nextContent, "utf8");
  return true;
}

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function getAttribute(attrs, name) {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}=["']([^"']+)["']`, "i");
  const match = attrs.match(pattern);
  return match ? match[1] : "";
}

function matchAttributeValue(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? match[1] : "";
}

async function fetchArticleMetadata(url) {
  const html = await fetchFeed(url);

  return {
    title:
      decodeEntities(extractMetaContent(html, ["og:title", "twitter:title"])) ||
      decodeEntities(extractTitleTag(html)),
    summary: decodeEntities(
      extractMetaContent(html, ["description", "og:description", "twitter:description"]),
    ),
    thumbnailUrl: decodeEntities(
      extractMetaContent(html, ["og:image", "twitter:image", "thumbnail"]),
    ),
    publishedAt: decodeEntities(
      extractMetaContent(html, [
        "article:published_time",
        "og:published_time",
        "published_time",
        "datePublished",
      ]),
    ),
  };
}

function extractMetaContent(html, keys) {
  const source = String(html || "");

  for (const key of keys) {
    const escapedKey = escapeRegExp(key);
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name|itemprop)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escapedKey}["'][^>]*>`,
        "i",
      ),
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) {
        return match[1];
      }
    }
  }

  return "";
}

function extractTitleTag(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(stripHtml(match[1])) : "";
}

function unwrapCdata(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, number) => safeFromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}

function safeFromCodePoint(value) {
  try {
    return Number.isFinite(value) ? String.fromCodePoint(value) : "";
  } catch (error) {
    return "";
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
