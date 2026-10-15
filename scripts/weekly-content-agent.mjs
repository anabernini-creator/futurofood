#!/usr/bin/env node
// Weekly content agent — runs from GitHub Actions every Monday.
// 1. Pulls real outlet RSS feeds for LATAM food-tech news (see FEEDS below).
// 2. Verifies each candidate's source URL actually resolves (200 OK).
// 3. Asks Claude to draft a bilingual (EN/ES) article grounded in the fetched excerpt.
// 4. Renders a new article page from scripts/article-template.html.
// 5. Inserts a card into futurofood-blog.html, then builds the Spanish pages
//    (es/) and sitemap.xml with scripts/build-i18n.mjs.
// No dependencies — relies on global fetch (Node 18+ / Bun).
//
// Requires env: ANTHROPIC_API_KEY (optional: ANTHROPIC_MODEL)
// Optional env for the review PR: REVIEW_SUMMARY_PATH (writes a Markdown summary
// of the new articles there) and PREVIEW_BASE_URL (Cloudflare branch preview).
// 6. Searches YouTube (Claude web search, youtube.com only) for a video about
//    each story; a verified, embeddable match is stored as video_url and
//    embedded in the article, otherwise the editorial placeholder shows.
//
// Manual video override: node scripts/weekly-content-agent.mjs --set-video <slug> <url|none>
// Backfill: --find-videos searches a video for every published article without one.
// Optional env SKIP_URLS_PATH: file with one source URL per line from earlier
// review PRs (e.g. discarded ones) so those stories are never proposed again.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { updateOgCards } from "./og-image.mjs";
import { buildSite } from "./build-i18n.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Same URL rules as the browser (media.js), so the agent only stores videos the site can play.
const { parseVideoUrl } = createRequire(import.meta.url)("../media.js");
const ROOT = join(__dirname, "..");
const REGISTRY_PATH = join(__dirname, "articles-registry.json");
const TEMPLATE_PATH = join(__dirname, "article-template.html");
const BLOG_PATH = join(ROOT, "futurofood-blog.html");

const TARGET_ARTICLES = 3;
// Try a few extra candidates so a failed draft can be replaced by the next story.
const MAX_ATTEMPTS = 8;
// Only cover recent news — some feeds keep returning year-old items.
const MAX_AGE_DAYS = 21;
// Keep the weekly mix varied — at most this many stories per outlet per run.
const MAX_PER_OUTLET = 2;
// Category labels must match the filter buttons and existing cards in futurofood-blog.html.
const CATEGORIES = {
  lab: { en: "Lab-Grown", es: "Cultivado en Lab" },
  regen: { en: "Regenerative", es: "Regenerativo" },
  insects: { en: "Insect Protein", es: "Proteína de Insectos" },
  tech: { en: "Food Tech", es: "Tecnología Alimentaria" },
  water: { en: "Water", es: "Agua" },
  ancestral: { en: "Ancestral", es: "Ancestral" },
};
const VALID_TAGS = Object.keys(CATEGORIES);
// Weekly global funding roundups mention many non-LATAM companies — not one story.
const ROUNDUP_RE = /^the week in agrifoodtech|roundup|newsletter|lo m[aá]s le[ií]do/i;

// NOTE: We deliberately do NOT use Google News RSS. Its <link> is an
// obfuscated redirect into a JS-rendered splash page (no plain HTTP redirect
// to the real article), so a plain fetch can't verify or read the source —
// it would "verify" a Google URL, not the actual outlet. These are real
// outlet RSS feeds with direct, fetchable article links and full content.
const FEEDS = [
  // FoodNavigator-LATAM — its RSS also mixes in sister global titles, so filter to LATAM.
  { url: "https://www.foodnavigator-latam.com/arc/outboundfeeds/rss/", requireLatam: true, requireFoodtech: false },
  // Global food/agtech outlet — filter down to LATAM-relevant stories.
  { url: "https://agfundernews.com/feed", requireLatam: true, requireFoodtech: false },
  // Global alternative-protein / future-food outlet — filter down to LATAM.
  { url: "https://www.greenqueen.com.hk/feed/", requireLatam: true, requireFoodtech: false },
  // Environment journalism in Spanish (also covers other regions) — filter to both.
  { url: "https://es.mongabay.com/feed/", requireLatam: true, requireFoodtech: true },
  // Brazilian agribusiness outlet (Portuguese) — filter to food/agtech stories.
  { url: "https://www.agfeed.com.br/feed/", requireLatam: false, requireFoodtech: true },
  // LATAM startup outlets, broad — filter down to food/agtech stories.
  { url: "https://www.contxto.com/en/feed/", requireLatam: false, requireFoodtech: true },
  { url: "https://latamlist.com/feed/", requireLatam: false, requireFoodtech: true },
  { url: "https://startupi.com.br/feed/", requireLatam: false, requireFoodtech: true },
  // Climate/food journalism (Spanish edition, also covers China) — filter to both.
  { url: "https://dialogue.earth/es/feed/", requireLatam: true, requireFoodtech: true },
  // Global tech journalism, broad — filter to stories that are both.
  { url: "https://restofworld.org/feed/", requireLatam: true, requireFoodtech: true },
];

const LATAM_RE = /latin america|latam|am[eé]rica latina|latinoam[eé]rica|amazon[iíi]a|amaz[oô]nia|brazil|brasil|mexico|méxico|colombia|argentina|chile|per[uú]|costa rica|ecuador|uruguay|paraguay|bolivia|venezuela|guatemala|honduras|panam[aá]|dominican|el salvador|nicaragua/i;
const FOODTECH_RE = /\bfood\b|foodtech|food-tech|agri|agtech|ag-tech|agriculture|farm|crop|livestock|protein|meat|dairy|seafood|aquaculture|nutrition|beverage|coffee|caf[eé]|cacao|cocoa|regenerative|cultivated meat|alternative protein|vertical farm|fertilizer|fertilizante|aliment|agro|agr[ií]cola|cultivo|ganad|pecu[aá]ri|pesca|acuicultura|aquicultura|semilla|semente|prote[ií]na|carne|leche|leite|l[aá]cteo|insect|fermenta/i;

function log(...args) {
  console.log("[content-agent]", ...args);
}

const KNOWN_OUTLETS = {
  "agfundernews.com": "AgFunderNews",
  "contxto.com": "Contxto",
  "restofworld.org": "Rest of World",
  "foodnavigator-latam.com": "FoodNavigator-LATAM",
  "greenqueen.com.hk": "Green Queen",
  "es.mongabay.com": "Mongabay Latam",
  "agfeed.com.br": "AgFeed",
  "latamlist.com": "LatamList",
  "startupi.com.br": "Startupi",
  "dialogue.earth": "Dialogue Earth",
};
function outletName(hostname) {
  return KNOWN_OUTLETS[hostname] || hostname;
}

// ---------- small utils ----------

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
function escapeJson(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- RSS ----------

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function cleanLink(raw) {
  const link = raw.trim().replace(/&amp;/g, "&");
  try {
    const url = new URL(link);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return link;
  }
}

function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const contentMatch = block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/);
    items.push({
      title: stripHtml(extractTag(block, "title") || ""),
      link: cleanLink(extractTag(block, "link") || ""),
      pubDate: extractTag(block, "pubDate") || "",
      description: stripHtml(extractTag(block, "description") || ""),
      contentEncoded: contentMatch ? stripHtml(contentMatch[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")) : "",
    });
  }
  return items;
}

function isRecent(item) {
  const published = Date.parse(item.pubDate);
  if (Number.isNaN(published)) return false;
  return Date.now() - published <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function isRelevant(item, feedConfig) {
  if (ROUNDUP_RE.test(item.title) || !isRecent(item)) return false;
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  if (feedConfig.requireLatam && !LATAM_RE.test(haystack)) return false;
  if (feedConfig.requireFoodtech && !FOODTECH_RE.test(haystack)) return false;
  return true;
}

async function fetchCandidates() {
  const all = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetchWithTimeout(feed.url, { headers: { "user-agent": "Mozilla/5.0 (compatible; FuturoFoodBot/1.0)" } });
      if (!res.ok) { log("feed fetch failed", feed.url, res.status); continue; }
      const xml = await res.text();
      const items = parseRssItems(xml).filter((item) => isRelevant(item, feed));
      log(`${feed.url} -> ${items.length} relevant items`);
      all.push(...items);
    } catch (e) {
      log("feed error", feed.url, e.message);
    }
  }
  const seen = new Set();
  return all
    .filter((item) => {
      const key = item.title.toLowerCase();
      if (!item.link || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
}

// ---------- verification ----------
// These feeds give real, direct outlet URLs (unlike Google News' obfuscated
// redirects), so a plain fetch reliably confirms the source is live.

async function verifyAndFetchExcerpt(item) {
  try {
    const res = await fetchWithTimeout(item.link, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; FuturoFoodBot/1.0)" },
    });
    if (!res.ok) return null;
    const finalUrl = res.url || item.link;
    let hostname = "";
    try { hostname = new URL(finalUrl).hostname.replace(/^www\./, ""); } catch {}
    // Prefer the RSS feed's own full content over re-scraping the live page —
    // it's cleaner (no nav/ads chrome) and avoids a second network dependency.
    let excerpt = item.contentEncoded || item.description || "";
    if (excerpt.length < 200) {
      const html = await res.text();
      excerpt = stripHtml(html).slice(0, 6000);
    }
    return {
      ...item,
      verifiedUrl: finalUrl,
      sourceName: outletName(hostname),
      excerpt: excerpt.slice(0, 6000),
    };
  } catch (e) {
    log("verify failed", item.link, e.message);
    return null;
  }
}

// ---------- Claude ----------

function extractJsonBlock(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no_json_found");
  return raw.slice(start, end + 1);
}

async function draftArticle(candidate) {
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const prompt = `You are FuturoFood's editorial agent, writing for a bilingual (English/Spanish) news outlet covering food-tech, agtech, and food innovation across Latin America.

FuturoFood's editorial promise — it decides both which stories we run and how we title them:
"Stories of those who grow, research and build to change the food system" / "Historias de quienes cultivan, investigan y emprenden para cambiar el sistema".

Write a short, original news article based ONLY on the excerpt below. Do not invent quotes, numbers, or facts that aren't in the excerpt or headline. If the excerpt looks thin, paywalled, or unrelated to the headline, keep the article brief and high-level and lean on the headline + outlet context instead of fabricating detail. Attribute claims to the outlet (e.g. "according to ${candidate.sourceName}" / "según ${candidate.sourceName}").

SOURCE OUTLET: ${candidate.sourceName}
SOURCE URL: ${candidate.verifiedUrl}
HEADLINE: ${candidate.title}
PUBLISHED: ${candidate.pubDate}
ARTICLE EXCERPT (auto-extracted, may include boilerplate — use your judgment):
"""
${candidate.excerpt}
"""

Respond with ONLY {"skip": true, "reason": "one short sentence"} and nothing else if either is true:
- The story is NOT substantially about food, agriculture, or food technology in Latin America (for example it is about another region, or food is only mentioned in passing).
- It does not fit the editorial promise: there are no farmers, researchers, or entrepreneurs/companies actually changing how food is grown, made, or distributed at its center. Pure finance or market news (commodity prices, debt restructurings, earnings, corporate event agendas) is skipped unless it is centered on such a change.

Otherwise respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:
{
  "tag_slug": "one of lab (Lab-Grown), regen (Regenerative), insects (Insect Protein), tech (Food Tech), water (Water), ancestral (Ancestral) — pick the closest category",
  "emoji": "one relevant emoji",
  "title_en": "headline, ~10-16 words — see TITLES below", "title_es": "natural Spanish headline (adapted, not a literal translation)",
  "deck_en": "one-sentence dek, ~25-35 words", "deck_es": "...",
  "seo_title_en": "search-result title, max 47 characters, main keyword first (company/topic + change), faithful to the excerpt",
  "meta_description_en": "search-result description, max 155 characters, specific and inviting, no claims beyond the excerpt",
  "seo_title_es": "same as seo_title_en, in natural Spanish (the /es/ page), max 47 characters",
  "meta_description_es": "same as meta_description_en, in natural Spanish, max 155 characters",
  "keywords_en": ["5 to 7 search keywords: company or people, topic, technology, country, 'Latin America'"],
  "takeaways": [{"en":"...","es":"..."}, {"en":"...","es":"..."}, {"en":"...","es":"..."}],
  "body": [{"type":"p","en":"...","es":"..."}, {"type":"h2","en":"...","es":"..."}, "5 to 8 items total, at least 2 of type h2, each p is 2-4 sentences"]
}
TITLES: name who is driving the change and what they are concretely doing — the protagonist (farmers, a research team, a startup or company) and the change in how food is grown, made, or distributed. Lead with the change, not with funding amounts, events, or personalities; no nicknames or sensational labels for people (e.g. not "the 'neurotic' CEO"). Claim only what the excerpt supports, and keep its tense: what is planned or in pilot must not read as already happening at scale (e.g. robots that will replant are not robots that harvest).

All Spanish must read as natural Latin American Spanish, not a literal translation. Sources may be in Portuguese — watch for Portuguese false friends (e.g. an event "trilha" is a "programa" or "eje temático" in Spanish, never "trilla").`;

  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        // Thinking is on by default for this model and counts toward max_tokens.
        max_tokens: 16000,
        messages: [{ role: "user", content: prompt }],
      }),
    },
    180000
  );
  if (!res.ok) throw new Error(`anthropic_error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data.stop_reason !== "end_turn") throw new Error(`stop_reason ${data.stop_reason}`);
  // The first content block can be a thinking block — read the text block instead.
  const text = data.content?.find((b) => b.type === "text")?.text || "";
  const parsed = JSON.parse(extractJsonBlock(text));
  if (parsed.skip) throw new Error(`not_latam_foodtech: ${parsed.reason || ""}`);
  if (!VALID_TAGS.includes(parsed.tag_slug)) parsed.tag_slug = "tech";
  parsed.tag_en = CATEGORIES[parsed.tag_slug].en;
  parsed.tag_es = CATEGORIES[parsed.tag_slug].es;
  return parsed;
}

// ---------- video ----------

// Asks Claude to search youtube.com for a video about this specific story.
// The pick is only kept if its id appeared in the search results (never a
// guessed URL) and YouTube's oEmbed confirms it exists and can be embedded.
async function findVideo(candidate, draft) {
  const prompt = `Find a YouTube video about this specific news story for FuturoFood, a food-tech news site covering Latin America.

STORY: ${draft.title_en}
SUMMARY: ${draft.deck_en}
SOURCE: ${candidate.sourceName} — ${candidate.verifiedUrl}

Rules:
- Only pick a video that covers this specific story, company, product, project or event — for example from the company's own channel, the source outlet, or a news report about it. A general video about the broader topic does NOT qualify.
- Prefer official channels and reputable news outlets, and recent videos.
- Only use a youtube.com/watch URL that appeared in your search results. Never construct or guess one.
- Finding nothing suitable is a normal outcome — answer null rather than settling for a loosely related video.

Respond with ONLY JSON: {"video_url": "https://www.youtube.com/watch?v=..." or null, "reason": "one short sentence"}`;

  const messages = [{ role: "user", content: prompt }];
  const seenIds = new Set();
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
          max_tokens: 16000,
          // Picking one video is a simple task: low effort and the basic search tool keep it fast
          output_config: { effort: "low" },
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3, allowed_domains: ["youtube.com"] }],
          messages,
        }),
      },
      300000
    );
    if (!res.ok) throw new Error(`anthropic_error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    data = await res.json();
    for (const block of data.content || []) {
      if (block.type !== "web_search_tool_result") continue;
      // Search errors come back as HTTP 200 with an error object instead of a result list
      if (!Array.isArray(block.content)) {
        log("web search error:", block.content?.error_code || JSON.stringify(block.content).slice(0, 200));
        continue;
      }
      for (const result of block.content) {
        const parsed = parseVideoUrl(result.url);
        if (parsed?.type === "youtube") seenIds.add(parsed.id);
      }
    }
    // A long server-side search can pause; resend the turn so it resumes.
    if (data.stop_reason !== "pause_turn") break;
    messages.splice(1, messages.length - 1, { role: "assistant", content: data.content });
  }
  if (data.stop_reason !== "end_turn") throw new Error(`stop_reason ${data.stop_reason}`);

  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const pick = JSON.parse(extractJsonBlock(text));
  if (!pick.video_url) {
    log(`video: none (${seenIds.size} YouTube results checked) —`, pick.reason || "");
    return null;
  }
  const parsed = parseVideoUrl(pick.video_url);
  if (parsed?.type !== "youtube") throw new Error(`not a YouTube URL: ${pick.video_url}`);
  if (!seenIds.has(parsed.id)) throw new Error(`video ${parsed.id} was not in the ${seenIds.size} search results`);
  return verifyYouTube(parsed.id);
}

async function verifyYouTube(id) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const res = await fetchWithTimeout(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  // 401 = embedding disabled by the owner, 404/400 = missing or private
  if (!res.ok) throw new Error(`oEmbed ${res.status} for ${url}`);
  const meta = await res.json();
  return { url, title: meta.title || null, channel: meta.author_name || null };
}

// --set-video <slug|filename> <url|none>: add, replace or remove a story's video by hand.
async function setVideo(target, rawUrl) {
  const registry = readRegistry();
  const entry = registry.find((r) => r.slug === target || r.filename === target || r.filename === `futurofood-article-${target}.html`);
  if (!entry) throw new Error(`no article "${target}" in the registry`);
  let video = { url: null, title: null, channel: null };
  if (rawUrl && rawUrl !== "none") {
    const parsed = parseVideoUrl(rawUrl);
    if (!parsed) throw new Error(`unsupported video URL: ${rawUrl} (YouTube, Vimeo or a .mp4/.webm/.ogg file)`);
    video = parsed.type === "youtube" ? await verifyYouTube(parsed.id) : { url: rawUrl, title: null, channel: null };
  }
  Object.assign(entry, { video_url: video.url, video_title: video.title, video_channel: video.channel });

  const pagePath = join(ROOT, entry.filename);
  const page = readFileSync(pagePath, "utf8");
  const re = /(<div class="feature-image media-frame" data-video-url=")[^"]*(")/;
  if (!re.test(page)) throw new Error(`no media frame in ${entry.filename}`);
  writeFileSync(pagePath, page.replace(re, (_, a, b) => `${a}${escapeAttr(video.url || "")}${b}`));
  writeRegistry(registry);
  rebuildCards();
  buildSite({ root: ROOT, log });
  log(video.url ? `video set on ${entry.filename}: ${video.url}` : `video removed from ${entry.filename}`);
}

// --find-videos: search a video for each registry article that has none yet.
async function findMissingVideos() {
  const registry = readRegistry();
  const found = [];
  for (const entry of registry.filter((r) => !r.video_url)) {
    let video = null;
    try {
      video = await findVideo(
        { sourceName: entry.source_name, verifiedUrl: entry.source_url },
        { title_en: entry.title_en, deck_en: entry.deck_en }
      );
    } catch (e) {
      log("video search failed", entry.slug, e.message);
    }
    log(video ? `video for ${entry.slug}: ${video.url} (${video.channel})` : `no video for ${entry.slug}`);
    if (video) {
      await setVideo(entry.slug, video.url);
      found.push({ ...entry, video_url: video.url, video_title: video.title, video_channel: video.channel });
    }
  }
  if (process.env.REVIEW_SUMMARY_PATH && found.length) {
    writeFileSync(process.env.REVIEW_SUMMARY_PATH, [
      `El agente encontró video para ${found.length} artículo(s) ya publicados. **Nada cambia en el sitio hasta que hagas Merge.**`,
      "",
      ...found.flatMap((e) => [`- **${e.title_es}** → [${e.video_title || e.video_url}](${e.video_url})${e.video_channel ? ` — ${e.video_channel}` : ""}`]),
      "",
      "- [ ] Cada video trata de esa noticia (no de un tema general)",
      "",
      "**Para aceptar:** *Merge pull request*. **Para rechazar todo:** *Close pull request*. **Para quitar un solo video:** pídeselo a Claude con el número de este PR.",
      "",
    ].join("\n"));
  }
}

// ---------- rendering ----------

function readSkipUrls() {
  const path = process.env.SKIP_URLS_PATH;
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

function readRegistry() {
  if (!existsSync(REGISTRY_PATH)) return [];
  try { return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")); } catch { return []; }
}
function writeRegistry(list) {
  writeFileSync(REGISTRY_PATH, JSON.stringify(list, null, 2) + "\n");
}

export function readMarkerBlock(content, marker) {
  const re = new RegExp(`<!--\\s*AGENT:ARTICLES:START[^>]*-->([\\s\\S]*?)<!--\\s*AGENT:ARTICLES:END\\s*-->`);
  const m = content.match(re);
  if (!m) throw new Error(`markers not found in ${marker}`);
  return m[1];
}
export function replaceMarkerBlock(content, newInner) {
  const re = /(<!--\s*AGENT:ARTICLES:START[^>]*-->)([\s\S]*?)(<!--\s*AGENT:ARTICLES:END\s*-->)/;
  // Use a replacer function: a string replacement would treat "$1" in a title
  // like "raises $1.3M" as a backreference and inject the marker comment.
  return content.replace(re, (_, start, _inner, end) => `${start}\n${newInner}\n    ${end}`);
}

export function formatCardDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const opts = { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  return { en: d.toLocaleDateString("en-US", opts), es: d.toLocaleDateString("es", opts) };
}

// Heart icon (Feather "heart", MIT) for the blog's save button
const SAVE_BUTTON = `<button type="button" class="save-btn" aria-pressed="false" aria-label="Save article" data-es-aria-label="Guardar artículo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>`;

// Share icon (Feather "share-2", MIT) next to the heart; share.js handles it
const CARD_SHARE_BUTTON = `<button type="button" class="card-share-btn" aria-label="Share this story" data-es-aria-label="Compartir esta historia" title="Share" data-es-title="Compartir"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>`;

// Blog card: the title link stretches over the whole card (CSS), so the save
// button can sit on top as a real button instead of being nested in a link.
export function renderCard(entry) {
  const date = formatCardDate(entry.date_iso);
  return `    <article class="article-card" data-tag="${entry.tag_slug}" data-id="${entry.filename}">
      <div>
        <div class="card-top">
          <span class="tag tag-${entry.tag_slug}" data-es="${escapeAttr(entry.tag_es)}">${escapeHtml(entry.tag_en)}</span>
          <span class="card-readtime" data-es="${entry.read_minutes} min de lectura">${entry.read_minutes} min read</span>
          ${SAVE_BUTTON}
          ${CARD_SHARE_BUTTON}
        </div>
        <h3 class="card-title"><a class="card-link" href="${entry.filename}" data-es="${escapeAttr(entry.title_es)}">${escapeHtml(entry.title_en)}</a></h3>
        <p class="card-excerpt" data-es="${escapeAttr(entry.deck_es)}">${escapeHtml(entry.deck_en)}</p>
        <div class="card-bottom">
          <span class="card-date"><time datetime="${entry.date_iso}" data-es="${date.es}">${date.en}</time> · <span data-es="Fuente: ${escapeAttr(entry.source_name)}">Source: ${escapeHtml(entry.source_name)}</span></span>
          <span class="tag tag-${entry.tag_slug}" data-es="${escapeAttr(entry.tag_es)}">${escapeHtml(entry.tag_en)}</span>
        </div>
      </div>
      <div class="card-img media-frame is-thumb" data-video-url="${escapeAttr(entry.video_url || "")}"><span class="media-emoji" aria-hidden="true">${entry.emoji}</span></div>
    </article>`;
}

export function renderRelated(related) {
  if (related.length === 0) {
    return `      <div class="related-card">
        <div class="related-img">🧬</div>
        <div>
          <span class="related-tag" data-es="🧬 Cultivado en Lab">🧬 Lab-Grown</span>
          <div class="related-title-text" data-es="La agencia estatal de investigación de Brasil cultiva carne de pollo a partir de células">Brazil's state research agency is growing chicken meat from cells</div>
          <span class="related-date" data-es="Fuente: Embrapa · 6 min">Source: Embrapa · 6 min</span>
        </div>
      </div>`;
  }
  return related
    .slice(0, 3)
    .map(
      (r) => `      <div class="related-card">
        <div class="related-img">${r.emoji}</div>
        <div>
          <span class="related-tag" data-es="${escapeAttr(r.emoji + " " + r.tag_es)}">${escapeHtml(r.emoji + " " + r.tag_en)}</span>
          <div class="related-title-text" data-es="${escapeAttr(r.title_es)}">${escapeHtml(r.title_en)}</div>
          <span class="related-date" data-es="Fuente: ${escapeAttr(r.source_name)} · ${r.read_minutes} min">Source: ${escapeHtml(r.source_name)} · ${r.read_minutes} min</span>
        </div>
      </div>`
    )
    .join("\n");
}

// Shortens text at a word boundary (search-result limits)
function fitLength(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[,;:—-]\s*$/, "") + "…";
}

export function renderArticlePage(draft, meta, related) {
  const template = readFileSync(TEMPLATE_PATH, "utf8");

  const takeawaysHtml = draft.takeaways
    .map((t) => `        <li><span class="takeaway-arrow">→</span> <span data-es="${escapeAttr(t.es)}">${escapeHtml(t.en)}</span></li>`)
    .join("\n");

  const bodyBlocks = draft.body.map((block, i) => {
    if (block.type === "h2") {
      const id = `s${i}-${slugify(block.en).slice(0, 30)}`;
      return { html: `    <h2 id="${id}" data-es="${escapeAttr(block.es)}">${escapeHtml(block.en)}</h2>`, toc: { id, en: block.en, es: block.es } };
    }
    return { html: `    <p data-es="${escapeAttr(block.es)}">${escapeHtml(block.en)}</p>`, toc: null };
  });
  const bodyHtml = bodyBlocks.map((b) => b.html).join("\n\n");
  const tocHtml = bodyBlocks
    .filter((b) => b.toc)
    .map((b) => `        <li class="toc-item"><a href="#${b.toc.id}" data-es="${escapeAttr(b.toc.es)}">${escapeHtml(b.toc.en)}</a></li>`)
    .join("\n");

  const tagsHtml = [
    `      <span class="article-tag-item" data-es="${escapeAttr(draft.tag_es)}">${escapeHtml(draft.tag_en)}</span>`,
    `      <span class="article-tag-item">LATAM</span>`,
    `      <span class="article-tag-item" data-es="Tecnología Alimentaria">Food Tech</span>`,
  ].join("\n");

  // Reading time at 200 words per minute (deck, takeaways and body, English)
  const words = (t) => String(t).split(/\s+/).filter(Boolean).length;
  const wordCount = words(draft.deck_en) + draft.takeaways.reduce((n, t) => n + words(t.en), 0) + draft.body.reduce((n, b) => n + words(b.en), 0);
  const readMinutes = Math.max(1, Math.ceil(wordCount / 200));

  const keywords = (Array.isArray(draft.keywords_en) && draft.keywords_en.length
    ? draft.keywords_en
    : [draft.tag_en, "food tech", "Latin America"]).map((k) => String(k).trim()).filter(Boolean)
    .filter((k, i, all) => all.findIndex((x) => x.toLowerCase() === k.toLowerCase()) === i).slice(0, 8);
  const longDate = { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" };
  const dateHuman = new Date(`${meta.date_iso}T12:00:00Z`).toLocaleDateString("en-US", longDate);
  const dateHumanEs = new Date(`${meta.date_iso}T12:00:00Z`).toLocaleDateString("es", longDate);

  const replacements = {
    "{{TITLE_EN}}": escapeHtml(draft.title_en),
    // SEO: title ≤ 60 characters with the suffix, description ≤ 155
    "{{SEO_TITLE}}": escapeHtml(`${fitLength(draft.seo_title_en || draft.title_en, 47)} | FuturoFood`),
    "{{META_DESC_ATTR}}": escapeAttr(fitLength(draft.meta_description_en || draft.deck_en, 155)),
    "{{SEO_TITLE_ES_ATTR}}": escapeAttr(`${fitLength(draft.seo_title_es || draft.title_es, 47)} | FuturoFood`),
    "{{META_DESC_ES_ATTR}}": escapeAttr(fitLength(draft.meta_description_es || draft.deck_es, 155)),
    "{{META_DESC_JSON}}": escapeJson(fitLength(draft.meta_description_en || draft.deck_en, 155)),
    "{{KEYWORDS_ATTR}}": escapeAttr(keywords.join(", ")),
    "{{KEYWORDS_JSON}}": JSON.stringify(keywords),
    "{{TAG_EN_JSON}}": escapeJson(draft.tag_en),
    "{{SOURCE_URL_JSON}}": escapeJson(meta.source_url),
    "{{TITLE_EN_ATTR}}": escapeAttr(draft.title_en),
    "{{TITLE_ES_ATTR}}": escapeAttr(draft.title_es),
    "{{TITLE_EN_JSON}}": escapeJson(draft.title_en),
    "{{DECK_EN}}": escapeHtml(draft.deck_en),
    "{{DECK_EN_ATTR}}": escapeAttr(draft.deck_en),
    "{{DECK_ES_ATTR}}": escapeAttr(draft.deck_es),
    "{{DECK_EN_JSON}}": escapeJson(draft.deck_en),
    "{{TAG_EN}}": escapeHtml(draft.tag_en),
    "{{TAG_ES}}": escapeHtml(draft.tag_es),
    "{{EMOJI}}": draft.emoji,
    "{{SOURCE_NAME}}": escapeHtml(meta.source_name),
    "{{SOURCE_URL}}": meta.source_url,
    "{{READ_MINUTES}}": String(readMinutes),
    "{{DATE_ISO}}": meta.date_iso,
    "{{DATE_HUMAN}}": dateHuman,
    "{{DATE_HUMAN_ES}}": dateHumanEs,
    "{{VIDEO_URL_ATTR}}": escapeAttr(meta.video_url || ""),
    "{{PAGE_PATH}}": meta.page_path,
    "{{TAKEAWAYS_HTML}}": takeawaysHtml,
    "{{BODY_HTML}}": bodyHtml,
    "{{TAGS_HTML}}": tagsHtml,
    "{{TOC_HTML}}": tocHtml,
    "{{RELATED_HTML}}": renderRelated(related),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  return { html, readMinutes };
}

// ---------- main ----------

// Re-renders the generated cards in futurofood-blog.html from the registry —
// use after changing renderCard() so existing cards pick up the new markup.
function rebuildCards() {
  const registry = readRegistry();
  const blogHtml = readFileSync(BLOG_PATH, "utf8");
  readMarkerBlock(blogHtml, "futurofood-blog.html");
  writeFileSync(BLOG_PATH, replaceMarkerBlock(blogHtml, registry.map(renderCard).join("\n\n")));
  log(`Rebuilt ${registry.length} card(s) from the registry.`);
}

async function main() {
  if (process.argv.includes("--rebuild-cards")) { rebuildCards(); buildSite({ root: ROOT, log }); return; }
  if (process.argv.includes("--find-videos")) return findMissingVideos();
  const setVideoAt = process.argv.indexOf("--set-video");
  if (setVideoAt !== -1) return setVideo(process.argv[setVideoAt + 1], process.argv[setVideoAt + 2]);
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY env var. Aborting. (use --dry-run to test the feed/verify pipeline without it)");
    process.exit(1);
  }

  const registry = readRegistry();
  const usedUrls = new Set(registry.map((r) => r.source_url));
  const skipUrls = readSkipUrls();
  for (const url of skipUrls) usedUrls.add(url);
  log(`${skipUrls.length} source(s) from earlier review PRs will be skipped`);

  log("fetching RSS candidates...");
  const candidates = await fetchCandidates();
  log(`found ${candidates.length} raw candidates`);

  const verified = [];
  for (const c of candidates) {
    if (verified.length >= MAX_ATTEMPTS) break;
    const v = await verifyAndFetchExcerpt(c);
    if (!v) continue;
    if (usedUrls.has(v.verifiedUrl)) continue;
    if (verified.filter((x) => x.sourceName === v.sourceName).length >= MAX_PER_OUTLET) continue;
    verified.push(v);
    usedUrls.add(v.verifiedUrl);
  }
  log(`${verified.length} verified, unpublished sources`);

  if (verified.length < TARGET_ARTICLES) {
    log(`Only ${verified.length} verified sources found (need ${TARGET_ARTICLES}). Publishing what we have.`);
  }
  if (verified.length === 0) {
    log("No verifiable sources this run. Exiting without changes.");
    return;
  }

  if (dryRun) {
    log("--dry-run: skipping Claude drafting and file writes. Candidates that would be used:");
    for (const v of verified) log(` - [${v.sourceName}] ${v.title}\n     ${v.verifiedUrl}`);
    return;
  }

  let blogHtml = readFileSync(BLOG_PATH, "utf8");
  readMarkerBlock(blogHtml, "futurofood-blog.html"); // throws if markers missing

  const newRegistryEntries = [];
  const todayIso = new Date().toISOString().slice(0, 10);

  for (const candidate of verified) {
    if (newRegistryEntries.length >= TARGET_ARTICLES) break;
    let draft;
    try {
      draft = await draftArticle(candidate);
    } catch (e) {
      log("draft failed, skipping", candidate.title, e.message);
      continue;
    }

    const baseSlug = slugify(draft.title_en) || slugify(candidate.title) || "story";
    let slug = baseSlug;
    let n = 2;
    while (registry.some((r) => r.slug === slug) || existsSync(join(ROOT, `futurofood-article-${slug}.html`))) {
      slug = `${baseSlug}-${n++}`;
    }
    const filename = `futurofood-article-${slug}.html`;

    let video = null;
    try {
      video = await findVideo(candidate, draft);
      log(video ? `video: ${video.url} (${video.channel})` : "no matching video — placeholder");
    } catch (e) {
      log("video search failed — placeholder", e.message);
    }

    const meta = { source_name: candidate.sourceName, source_url: candidate.verifiedUrl, date_iso: todayIso, video_url: video?.url, page_path: filename.replace(/\.html$/, "") };
    const related = registry.slice(0, 3);
    const { html, readMinutes } = renderArticlePage(draft, meta, related);

    writeFileSync(join(ROOT, filename), html);
    log("wrote", filename);
    // Link-preview card (og/<page>.jpg); falls back to og-default.jpg on failure
    try {
      await updateOgCards([filename], log);
    } catch (e) {
      log("og card failed — default preview image", e.message);
    }

    const entry = {
      slug,
      filename,
      title_en: draft.title_en,
      title_es: draft.title_es,
      deck_en: draft.deck_en,
      deck_es: draft.deck_es,
      tag_slug: draft.tag_slug,
      tag_en: draft.tag_en,
      tag_es: draft.tag_es,
      emoji: draft.emoji,
      read_minutes: readMinutes,
      source_name: candidate.sourceName,
      source_url: candidate.verifiedUrl,
      date_iso: todayIso,
      video_url: video?.url ?? null,
      video_title: video?.title ?? null,
      video_channel: video?.channel ?? null,
    };
    registry.unshift(entry);
    newRegistryEntries.push(entry);
  }

  if (newRegistryEntries.length === 0) {
    log("No articles were successfully drafted this run.");
    return;
  }

  // Cards are always rendered from the registry (newest first), the same way
  // --rebuild-cards does, so the markup stays consistent across runs.
  blogHtml = replaceMarkerBlock(blogHtml, registry.map(renderCard).join("\n\n"));
  writeFileSync(BLOG_PATH, blogHtml);

  writeRegistry(registry);
  // Spanish pages (es/), hreflang and sitemap.xml with both languages
  buildSite({ root: ROOT, log });

  log(`Done. Published ${newRegistryEntries.length} article(s):`);
  for (const e of newRegistryEntries) log(` - ${e.filename} (${e.source_name})`);

  if (process.env.REVIEW_SUMMARY_PATH) {
    writeFileSync(process.env.REVIEW_SUMMARY_PATH, renderReviewSummary(newRegistryEntries, process.env.PREVIEW_BASE_URL));
  }
}

export function renderReviewSummary(entries, previewBaseUrl) {
  const articles = entries.map((e, i) => {
    const preview = previewBaseUrl ? `${previewBaseUrl.replace(/\/$/, "")}/${e.filename.replace(/\.html$/, "")}` : null;
    return [
      `### ${i + 1}. ${e.title_es}`,
      `*${e.title_en}*`,
      "",
      `- **Categoría:** ${e.tag_es}`,
      // The workflow parses this exact "**Fuente:** [name](url)" line to remember
      // sources from earlier review PRs — keep the format if you edit it.
      `- **Fuente:** [${e.source_name}](${e.source_url})`,
      e.video_url
        ? `- **Video:** [${e.video_title || e.video_url}](${e.video_url})${e.video_channel ? ` — ${e.video_channel}` : ""}`
        : "- **Video:** ninguno — se muestra el placeholder",
      preview
        ? `- **Vista previa:** [en español](${preview.replace(/\/(futurofood-article[^/]*)$/, "/es/$1")}) · [en inglés](${preview})`
        : `- **Archivo:** \`${e.filename}\` (y \`es/${e.filename}\`)`,
    ].join("\n");
  });
  return [
    `El agente semanal preparó ${entries.length} artículo(s). **Nada se publica hasta que hagas Merge.**`,
    "",
    ...articles.flatMap((a) => [a, ""]),
    "### Antes de aprobar",
    "- [ ] Encaja con la promesa: *historias de quienes cultivan, investigan y emprenden para cambiar el sistema*, y el título nombra a quién y qué cambia",
    "- [ ] Las cifras y nombres coinciden con la fuente",
    "- [ ] La noticia es de verdad sobre Latinoamérica",
    "- [ ] La categoría es la correcta",
    "- [ ] El español suena natural (ojo con calcos del portugués o del inglés)",
    "- [ ] Si hay video, trata de esta noticia (no de un tema general)",
    "",
    "**Para publicar:** botón *Merge pull request*. Cloudflare lo sube a futurofood.com en unos 2 minutos.",
    "**Para descartar todo:** *Close pull request*.",
    "**Para quitar un solo artículo, cambiar o quitar un video, o corregir texto:** pídeselo a Claude indicando el número de este PR.",
    "",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((e) => {
    console.error("[content-agent] fatal:", e);
    process.exit(1);
  });
}
