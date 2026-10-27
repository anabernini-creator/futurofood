#!/usr/bin/env node
// Live home page: rebuilds the parts of index.html (and its copy
// futurofood.html) that follow the newest stories. The stories come from the
// blog (futurofood-blog.html: the weekly agent's cards plus the hand-written
// ones), newest first:
//   - date of the latest edition (newest story) and "Vol. · Issue": the
//     volume is the year (2026 = Vol. 1), the issue counts the weeks of that
//     year with published stories
//   - headline ticker: the 6 newest stories
//   - cover story: the newest article (full page), with its takeaways
//   - left column: the next 3 stories; right column: the one after
//   - "Latest Stories": the 4 after those
//   - "From the archive": earlier articles that are not on the front page
//     (cover and columns). The HTML holds up to ARCHIVE_POOL of them (picked
//     each week, so older ones also come back), 3 visible; a small inline
//     script shows 3 at random on every visit, preferring ones that aren't in
//     "Latest Stories"
//   - story counts per topic
// Only English is written here, with Spanish in data-es; build-i18n.mjs
// (which calls this first) writes /es/.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOME_FILES = ["index.html", "futurofood.html"];
const FIRST_YEAR = 2026; // Vol. 1
const ARCHIVE_SHOWN = 3;
const ARCHIVE_POOL = 24; // cards in the HTML (page weight on phones)

const EMOJI = { lab: "🧬", regen: "🌱", insects: "🦗", tech: "🤖", water: "💧", ancestral: "🌽" };

const decode = (s) => String(s)
  .replace(/<[^>]+>/g, "")
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
const escapeText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// An element by class: { attrs, inner, es (raw data-es) }
function el(html, tag, cls) {
  const m = html.match(new RegExp(`<${tag}\\b((?:[^>"']|"[^"]*"|'[^']*')*\\bclass="[^"]*\\b${cls}\\b[^"]*"(?:[^>"']|"[^"]*"|'[^']*')*)>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return null;
  const es = m[1].match(/\sdata-es="([^"]*)"/) || m[1].match(/\sdata-es='([^']*)'/);
  return { attrs: m[1], inner: m[2].trim(), es: es ? es[1] : null };
}

// ── Stories from the blog cards ──
export function readStories(blogHtml) {
  const cards = blogHtml.match(/<article class="article-card"[\s\S]*?<\/article>/g) || [];
  return cards.map((card, order) => {
    const link = el(card, "a", "card-link");
    const title = link || el(card, "h3", "card-title");
    const excerpt = el(card, "p", "card-excerpt");
    const tag = card.match(/<span class="tag tag-([a-z]+)" data-es="([^"]*)">([^<]*)<\/span>/);
    const read = card.match(/class="card-readtime"[^>]*>(\d+) min/);
    const date = card.match(/<time datetime="(\d{4}-\d{2}-\d{2})"/);
    const source = card.match(/<span data-es="Fuente: ([^"]*)">Source: ([^<]*)<\/span>/);
    const share = card.match(/<button type="button" class="card-share-btn"[\s\S]*?<\/button>/);
    const href = link ? link.attrs.match(/href="([^"]*)"/)[1] : null;
    return {
      order,
      date: date[1],
      href: href && /^futurofood-article/.test(href) ? href : null,
      tag: tag[1], tagEs: tag[2], tagEn: tag[3],
      titleEn: title.inner, titleEs: title.es,
      excerptEn: excerpt.inner, excerptEs: excerpt.es,
      read: read ? read[1] : "1",
      sourceEn: source ? source[2] : "", sourceEs: source ? source[1] : "",
      shareButton: share ? share[0] : "",
    };
  }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.order - b.order));
}

// Link for a story: its page, or the blog filtered to it (brief stories)
export function storyHref(s) {
  return s.href || `futurofood-blog.html?q=${encodeURIComponent(decode(s.titleEn).split(/\s+/).slice(0, 4).join(" "))}`;
}

// ── The cover article, read from its page ──
export function readCover(articleHtml) {
  const h1 = el(articleHtml, "h1", "article-title");
  const deck = el(articleHtml, "p", "article-deck");
  const content = articleHtml.slice(articleHtml.indexOf('class="article-content"'));
  const paragraphs = [...content.matchAll(/<p data-es="([^"]*)">([\s\S]*?)<\/p>/g)].slice(0, 2).map((m) => ({ es: m[1], en: m[2].trim() }));
  const takeaways = [...(articleHtml.match(/<div class="takeaways">[\s\S]*?<\/ul>/) || [""])[0].matchAll(/<li>[\s\S]*?<span data-es="([^"]*)">([\s\S]*?)<\/span><\/li>/g)].map((m) => ({ es: m[1], en: m[2].trim() }));
  const metaItems = [...articleHtml.matchAll(/<div class="meta-item" data-es='([^']*)'>([\s\S]*?)<\/div>/g)];
  const source = metaItems.find((m) => /^Sources?:/.test(decode(m[2])));
  const frame = articleHtml.match(/<div class="feature-image media-frame"((?:[^>"']|"[^"]*")*)>([\s\S]*?)<\/div>/);
  return {
    titleEn: h1.inner, titleEs: h1.es,
    deckEn: deck.inner, deckEs: deck.es,
    paragraphs, takeaways,
    sourceEn: source ? decode(source[2]) : "", sourceEs: source ? decode(source[1]) : "",
    frameAttrs: frame ? frame[1] : ' data-video-url=""',
    frameInner: frame ? frame[2].trim() : "",
  };
}

// ── Edition: date of the newest story, volume = year, issue = weeks published ──
function isoWeek(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of that week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-${1 + Math.round(((d - firstThursday) / 864e5 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)}`;
}
// Every edition, newest first: the stories of one week (ISO weeks), numbered
// within its year (2026 = Vol. 1). The edition's date is its newest story.
export function editions(stories) {
  const fmt = (iso, lang) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const byWeek = new Map();
  for (const s of stories) {
    const w = isoWeek(s.date);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(s);
  }
  const list = [...byWeek.values()]
    .map((group) => group.slice().sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : x.order - y.order)))
    .sort((x, y) => (x[0].date < y[0].date ? -1 : 1));
  const perYear = {};
  return list.map((group) => {
    const date = group[0].date;
    const year = +date.slice(0, 4);
    perYear[year] = (perYear[year] || 0) + 1;
    return { volume: year - FIRST_YEAR + 1, issue: perYear[year], year, date, dateEn: fmt(date, "en-US"), dateEs: fmt(date, "es"), stories: group };
  }).reverse();
}

export function edition(stories) {
  return editions(stories)[0];
}

// ── Markup ──
const kicker = (s) => `<span class="kicker" data-es="${EMOJI[s.tag] || ""} ${s.tagEs}">${EMOJI[s.tag] || ""} ${s.tagEn}</span>`;

function miniStory(s) {
  return `      <div class="mini-story">
        ${kicker(s)}
        <h3 class="mini-title" data-es="${s.titleEs}">${s.titleEn}</h3>
        <p class="mini-body" data-es="${s.excerptEs}">${s.excerptEn}</p>
        <a href="${escapeAttr(storyHref(s))}" class="read-more" data-es="Leer historia →">Read story →</a>
      </div>`;
}

function card(s) {
  return `    <article class="article-card">
      <div class="card-top-row"><span class="article-tag tag-${s.tag}" data-es="${s.tagEs}">${s.tagEn}</span>${s.shareButton}</div>
      <h3 class="article-title"><a class="card-link" href="${escapeAttr(storyHref(s))}" data-es="${s.titleEs}">${s.titleEn}</a></h3>
      <p class="article-excerpt" data-es="${s.excerptEs}">${s.excerptEn}</p>
      <div class="article-meta" data-es="${s.read} min · Fuente: ${s.sourceEs}">${s.read} min · Source: ${s.sourceEn}</div>
    </article>`;
}

function broadsheet(cover, coverStory, left, right) {
  const readEn = `${coverStory.read} min read`, readEs = `${coverStory.read} min de lectura`;
  return `  <div class="broadsheet">
    <!-- LEFT COL -->
    <div class="bs-col bs-left">
${left.map(miniStory).join("\n")}
    </div>

    <div class="bs-divider"></div>

    <!-- CENTER COL — COVER STORY (the newest article) -->
    <div class="bs-col bs-center">
      <span class="flagship-label" data-es="↗ Historia Principal">↗ Cover Story</span>
      <div class="flagship-img media-frame"${cover.frameAttrs}>
        ${cover.frameInner}
      </div>
      <h1 class="flagship-title" data-es="${cover.titleEs}">${cover.titleEn}</h1>
      <p class="byline" data-es="Por <span>Redacción FuturoFood</span> · Revisado por Ana María Bernini · ${escapeAttr(cover.sourceEs)} · ${readEs}">By <span>FuturoFood Newsroom</span> · Reviewed by Ana María Bernini · ${escapeText(cover.sourceEn)} · ${readEn}</p>
      <p class="flagship-deck" data-es="${cover.deckEs}">${cover.deckEn}</p>
${cover.paragraphs.map((p) => `      <p class="flagship-body" data-es="${p.es}">${p.en}</p>`).join("\n")}
      <a href="${coverStory.href}" class="read-more" data-es="Seguir leyendo →">Continue reading →</a>
    </div>

    <div class="bs-divider"></div>

    <!-- RIGHT COL -->
    <div class="bs-col bs-right">
      <div class="cover-takeaways">
        <span class="cover-takeaways-title" data-es="Puntos clave de la historia principal">Cover story takeaways</span>
        <ul>
${cover.takeaways.map((t) => `          <li data-es="${t.es}">${t.en}</li>`).join("\n")}
        </ul>
      </div>
${right.map(miniStory).join("\n")}
    </div>
  </div>`;
}

// "From the archive" cards: older articles, those in "Latest Stories" marked
// so the page script prefers the others
function archiveCard(s, latest, last, shown) {
  const fmt = (lang) => new Date(`${s.date}T12:00:00Z`).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  return `    <article class="article-card${last ? " is-last" : ""}" data-archive-card${latest ? " data-archive-latest" : ""}${shown ? "" : " hidden"}>
      <div class="card-top-row"><span class="article-tag tag-${s.tag}" data-es="${s.tagEs}">${s.tagEn}</span><time class="archive-date" datetime="${s.date}" data-es="${fmt("es")}">${fmt("en-US")}</time></div>
      <h3 class="article-title"><a class="card-link" href="${escapeAttr(s.href)}" data-es="${s.titleEs}">${s.titleEn}</a></h3>
      <p class="article-excerpt" data-es="${s.excerptEs}">${s.excerptEn}</p>
      <div class="article-meta" data-es="${s.read} min · Fuente: ${s.sourceEs}">${s.read} min · Source: ${s.sourceEn}</div>
    </article>`;
}

// Same order for a given seed (the edition date), so rebuilds within a week
// don't change the page
function seededShuffle(list, seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function archiveStories(stories, frontPage, latest, seed) {
  const skip = new Set(frontPage);
  const inLatest = new Set(latest);
  const pool = seededShuffle(stories.filter((s) => s.href && !skip.has(s)), seed).slice(0, ARCHIVE_POOL);
  // Visible without the script: ones not in "Latest Stories" first
  const ordered = [...pool.filter((s) => !inLatest.has(s)), ...pool.filter((s) => inLatest.has(s))];
  return ordered.map((s, i) => ({ story: s, latest: inLatest.has(s), shown: i < ARCHIVE_SHOWN, last: i === Math.min(ARCHIVE_SHOWN, ordered.length) - 1 }));
}

function between(html, name, content) {
  const re = new RegExp(`(<!-- HOME:${name}:START[^>]*-->\\n)[\\s\\S]*?(\\n\\s*<!-- HOME:${name}:END -->)`);
  if (!re.test(html)) throw new Error(`HOME:${name} markers missing`);
  return html.replace(re, (_, a, b) => a + content + b);
}

export function renderHome(html, stories, coverHtml) {
  const coverStory = stories.find((s) => s.href);
  const rest = stories.filter((s) => s !== coverStory);
  const cover = readCover(coverHtml);
  const ed = edition(stories);

  html = html.replace(/<span class="issue-tag"[^>]*>[^<]*<\/span>/,
    `<span class="issue-tag" data-es="Vol. ${ed.volume} · Edición ${ed.issue} · ${ed.year}">Vol. ${ed.volume} · Issue ${ed.issue} · ${ed.year}</span>`);
  html = html.replace(/<span class="hero-date"[^>]*>[^<]*<\/span>/,
    `<span class="hero-date" data-es="${ed.dateEs}">${ed.dateEn}</span>`);

  const ticker = stories.slice(0, 6).map((s) => `    <span class="ticker-item"><span class="ticker-dot"></span> <span data-es="${s.titleEs}">${s.titleEn}</span></span>`).join("\n");
  html = between(html, "TICKER", `${ticker}\n    <!-- duplicate for the loop -->\n${ticker}`);
  html = between(html, "BROADSHEET", broadsheet(cover, coverStory, rest.slice(0, 3), rest.slice(3, 4)));
  html = between(html, "LATEST", rest.slice(4, 8).map(card).join("\n"));
  const archive = archiveStories(stories, [coverStory, ...rest.slice(0, 4)], rest.slice(4, 8), ed.date);
  html = between(html, "ARCHIVE", archive.map((a) => archiveCard(a.story, a.latest, a.last, a.shown)).join("\n"));
  // No older articles yet: the section stays hidden
  html = html.replace(/(<section class="articles-section archive-section"[^>]*?)(?: hidden)?>/, (_, open) => `${open}${archive.length ? "" : " hidden"}>`);

  // Real story counts per topic
  html = html.replace(/(<div class="topic"[^>]*data-tag="([a-z]+)"[^>]*>[\s\S]*?<span class="topic-count eyebrow")[^>]*>[^<]*(<\/span>)/g, (m, start, tag, end) => {
    const n = stories.filter((s) => s.tag === tag).length;
    return `${start} data-es="${n} ${n === 1 ? "historia" : "historias"}">${n} ${n === 1 ? "story" : "stories"}${end}`;
  });
  return html;
}

export function buildHome({ root = ROOT, log = console.log } = {}) {
  const stories = readStories(readFileSync(join(root, "futurofood-blog.html"), "utf8"));
  const cover = stories.find((s) => s.href);
  if (!cover) throw new Error("no article to put on the cover");
  const coverHtml = readFileSync(join(root, cover.href), "utf8");
  let changed = 0;
  for (const file of HOME_FILES) {
    const path = join(root, file);
    const before = readFileSync(path, "utf8");
    const after = renderHome(before, stories, coverHtml);
    if (after !== before) { writeFileSync(path, after); changed++; }
  }
  const ed = edition(stories);
  log(`[home] cover: ${cover.href} · ${ed.dateEn} · Vol. ${ed.volume} · Issue ${ed.issue} (${changed} file(s) updated)`);
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildHome();
