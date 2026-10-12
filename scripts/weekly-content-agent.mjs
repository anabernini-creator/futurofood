#!/usr/bin/env node
// Weekly content agent — runs from GitHub Actions every Monday.
// 1. Pulls real outlet RSS feeds for LATAM food-tech news (see FEEDS below).
// 2. Verifies each candidate's source URL actually resolves (200 OK).
// 3. Asks Claude to draft a bilingual (EN/ES) article grounded in the fetched excerpt.
// 4. Renders a new article page from scripts/article-template.html.
// 5. Inserts a card into futurofood-blog.html and a <url> into sitemap.xml.
// No dependencies — relies on global fetch (Node 18+ / Bun).
//
// Requires env: ANTHROPIC_API_KEY (optional: ANTHROPIC_MODEL)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const REGISTRY_PATH = join(__dirname, "articles-registry.json");
const TEMPLATE_PATH = join(__dirname, "article-template.html");
const BLOG_PATH = join(ROOT, "futurofood-blog.html");
const SITEMAP_PATH = join(ROOT, "sitemap.xml");

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
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
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

Write a short, original news article based ONLY on the excerpt below. Do not invent quotes, numbers, or facts that aren't in the excerpt or headline. If the excerpt looks thin, paywalled, or unrelated to the headline, keep the article brief and high-level and lean on the headline + outlet context instead of fabricating detail. Attribute claims to the outlet (e.g. "according to ${candidate.sourceName}" / "según ${candidate.sourceName}").

SOURCE OUTLET: ${candidate.sourceName}
SOURCE URL: ${candidate.verifiedUrl}
HEADLINE: ${candidate.title}
PUBLISHED: ${candidate.pubDate}
ARTICLE EXCERPT (auto-extracted, may include boilerplate — use your judgment):
"""
${candidate.excerpt}
"""

If the story is NOT substantially about food, agriculture, or food technology in Latin America (for example it is about another region, or food is only mentioned in passing), respond with ONLY {"skip": true, "reason": "one short sentence"} and nothing else.

Otherwise respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:
{
  "tag_slug": "one of lab (Lab-Grown), regen (Regenerative), insects (Insect Protein), tech (Food Tech), water (Water), ancestral (Ancestral) — pick the closest category",
  "emoji": "one relevant emoji",
  "title_en": "headline, punchy, ~12-16 words", "title_es": "natural Spanish translation, not literal",
  "deck_en": "one-sentence dek, ~25-35 words", "deck_es": "...",
  "takeaways": [{"en":"...","es":"..."}, {"en":"...","es":"..."}, {"en":"...","es":"..."}],
  "body": [{"type":"p","en":"...","es":"..."}, {"type":"h2","en":"...","es":"..."}, "5 to 8 items total, at least 2 of type h2, each p is 2-4 sentences"]
}
All Spanish must read as natural Latin American Spanish, not a literal translation.`;

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

// ---------- rendering ----------

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
  return content.replace(re, `$1\n${newInner}\n    $3`);
}

export function renderCard(entry) {
  return `    <a class="article-card" data-tag="${entry.tag_slug}" href="${entry.filename}">
      <div>
        <div class="card-top">
          <span class="tag tag-${entry.tag_slug}" data-es="${escapeAttr(entry.tag_es)}">${escapeHtml(entry.tag_en)}</span>
          <span class="card-readtime" data-es="${entry.read_minutes} min">${entry.read_minutes} min</span>
        </div>
        <h3 class="card-title" data-es="${escapeAttr(entry.title_es)}">${escapeHtml(entry.title_en)}</h3>
        <p class="card-excerpt" data-es="${escapeAttr(entry.deck_es)}">${escapeHtml(entry.deck_en)}</p>
        <div class="card-bottom">
          <span class="card-date" data-es="Fuente: ${escapeAttr(entry.source_name)}">Source: ${escapeHtml(entry.source_name)}</span>
          <span class="tag tag-${entry.tag_slug}" data-es="${escapeAttr(entry.tag_es)}">${escapeHtml(entry.tag_en)}</span>
        </div>
      </div>
      <div class="card-img">${entry.emoji}</div>
    </a>`;
}

export function renderSitemapUrl(entry) {
  const cleanPath = entry.filename.replace(/\.html$/, "");
  return `  <url>
    <loc>https://futurofood.com/${cleanPath}</loc>
    <lastmod>${entry.date_iso}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`;
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

  const wordCount = draft.body.reduce((n, b) => n + b.en.split(/\s+/).length, 0);
  const readMinutes = Math.max(3, Math.round(wordCount / 200));

  const dateHuman = new Date(meta.date_iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const replacements = {
    "{{TITLE_EN}}": escapeHtml(draft.title_en),
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY env var. Aborting. (use --dry-run to test the feed/verify pipeline without it)");
    process.exit(1);
  }

  const registry = readRegistry();
  const usedUrls = new Set(registry.map((r) => r.source_url));

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
  let sitemapHtml = readFileSync(SITEMAP_PATH, "utf8");
  readMarkerBlock(blogHtml, "futurofood-blog.html"); // throws if markers missing
  readMarkerBlock(sitemapHtml, "sitemap.xml");

  const newCards = [];
  const newUrls = [];
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

    const meta = { source_name: candidate.sourceName, source_url: candidate.verifiedUrl, date_iso: todayIso };
    const related = registry.slice(0, 3);
    const { html, readMinutes } = renderArticlePage(draft, meta, related);

    writeFileSync(join(ROOT, filename), html);
    log("wrote", filename);

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
    };
    registry.unshift(entry);
    newRegistryEntries.push(entry);
    newCards.push(renderCard(entry));
    newUrls.push(renderSitemapUrl(entry));
  }

  if (newRegistryEntries.length === 0) {
    log("No articles were successfully drafted this run.");
    return;
  }

  const existingCardsBlock = readMarkerBlock(blogHtml, "futurofood-blog.html").trim();
  const mergedCards = [newCards.join("\n\n"), existingCardsBlock].filter(Boolean).join("\n\n");
  blogHtml = replaceMarkerBlock(blogHtml, mergedCards);
  writeFileSync(BLOG_PATH, blogHtml);

  const existingUrlsBlock = readMarkerBlock(sitemapHtml, "sitemap.xml").trim();
  const mergedUrls = [newUrls.join("\n\n"), existingUrlsBlock].filter(Boolean).join("\n\n");
  sitemapHtml = replaceMarkerBlock(sitemapHtml, mergedUrls);
  writeFileSync(SITEMAP_PATH, sitemapHtml);

  writeRegistry(registry);

  log(`Done. Published ${newRegistryEntries.length} article(s):`);
  for (const e of newRegistryEntries) log(` - ${e.filename} (${e.source_name})`);
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((e) => {
    console.error("[content-agent] fatal:", e);
    process.exit(1);
  });
}
