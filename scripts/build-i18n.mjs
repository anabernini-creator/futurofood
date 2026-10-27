#!/usr/bin/env node
// Bilingual site build: English at the root, Spanish under /es/.
//
// The English pages are the source. Every translatable piece carries its
// Spanish next to it:
//   data-es="…"            element content (HTML), e.g. <h1 data-es="Hola">Hello</h1>
//   data-es-<attr>="…"     attribute value, e.g. data-es-content on <meta>,
//                          data-es-placeholder, data-es-aria-label, data-es-alt
// This script writes es/<page>.html with the Spanish already in the HTML (so
// search engines read it), keeping the English in data-en / data-en-<attr>
// for the scripts that need both (share.js, the blog search).
//
// First it refreshes the home page from the newest stories (build-home.mjs),
// the newsletter archive and the "Related Stories" of every article.
// It also keeps, in the English sources: the canonical URL, hreflang
// alternates (en, es, x-default → English), robots max-image-preview:large and
// the EN/ES switch links. And it regenerates sitemap.xml with both languages.
//
//   node scripts/build-i18n.mjs          # rebuild es/, hreflang and sitemap
//
// Run it after editing any English page (the "Sync Spanish pages" workflow
// also runs it on every push to main). The weekly agent runs it on its own.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHome } from "./build-home.mjs";
import { buildArchive } from "./build-archive.mjs";
import { buildRelated } from "./build-related.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://futurofood.com";
const ES_DIR = "es";

// Clean URL of each page ("/" = home). null: no canonical/hreflang (404).
// futurofood.html is an older copy of the home page and points there.
const STATIC_PAGES = {
  "index.html": { path: "/", sitemap: ["daily", "1.0"] },
  "futurofood.html": { path: "/" },
  "futurofood-blog.html": { path: "/futurofood-blog", sitemap: ["daily", "0.9"] },
  "futurofood-about.html": { path: "/futurofood-about", sitemap: ["monthly", "0.7"] },
  "patrocinadores.html": { path: "/patrocinadores", sitemap: ["monthly", "0.6"] },
  "futurofood-privacy.html": { path: "/futurofood-privacy", sitemap: ["yearly", "0.3"] },
  "futurofood-terms.html": { path: "/futurofood-terms", sitemap: ["yearly", "0.3"] },
  "boletin.html": { path: "/boletin", sitemap: ["weekly", "0.6"] },
  "pro.html": { path: "/pro" }, // noindex for now
  "404.html": { path: null },
  "futurofood-article.html": { path: "/futurofood-article", sitemap: ["monthly", "0.8"] },
};

export function sitePages(root = ROOT) {
  const pages = { ...STATIC_PAGES };
  for (const f of readdirSync(root).filter((f) => /^futurofood-article-.+\.html$/.test(f)).sort()) {
    pages[f] = { path: `/${f.replace(/\.html$/, "")}`, sitemap: ["monthly", "0.6"] };
  }
  return pages;
}

export const esPath = (path) => (path === "/" ? "/es/" : `/es${path}`);

// ── Minimal HTML tokenizer (attribute values may contain "<" and ">") ──
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const TOKEN_RE = /<!--[\s\S]*?-->|<(script|style)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTR_RE = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(s) {
  const out = new Map();
  for (const m of s.matchAll(ATTR_RE)) out.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}
function setAttr(attrStr, name, value) {
  const re = new RegExp(`(\\s${name.replace(/[-]/g, "\\-")}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  const quoted = `"${value}"`;
  return re.test(attrStr) ? attrStr.replace(re, (_, pre) => pre + quoted) : `${attrStr.replace(/\s*$/, "")} ${name}=${quoted}`;
}
function removeAttr(attrStr, name) {
  return attrStr.replace(new RegExp(`\\s${name.replace(/[-]/g, "\\-")}(\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+))?`, "i"), "");
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeAttr(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return NAMED[e.toLowerCase()] ?? m;
  });
}
const encodeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const stripTags = (s) => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

// Walks the document. onTag(tag) sees every opening tag; onElement(el) sees
// each closed element with its content; onScript(s) sees <script>/<style>.
// Callbacks push edits { start, end, text, block? } (block = element content).
function scan(html, { onTag, onElement, onScript }) {
  const edits = [];
  const stack = [];
  for (const m of html.matchAll(TOKEN_RE)) {
    const [full, rawName, rawAttrs, rawBody, closeName, openName, openAttrs, selfClose] = m;
    const start = m.index;
    if (full.startsWith("<!--")) continue;
    if (rawName) {
      const bodyStart = start + full.length - full.match(/<\/\w+\s*>$/)[0].length - rawBody.length;
      const tag = { name: rawName.toLowerCase(), attrs: parseAttrs(rawAttrs), attrStr: rawAttrs, start, end: bodyStart, selfClose: false };
      onScript?.({ tag, body: rawBody, bodyStart, bodyEnd: bodyStart + rawBody.length }, edits);
      continue;
    }
    if (openName) {
      const tag = { name: openName.toLowerCase(), attrs: parseAttrs(openAttrs), attrStr: openAttrs, start, end: start + full.length, selfClose: !!selfClose };
      onTag?.(tag, edits);
      if (!VOID.has(tag.name) && !selfClose) stack.push(tag);
      continue;
    }
    const name = closeName.toLowerCase();
    const i = stack.map((t) => t.name).lastIndexOf(name);
    if (i === -1) continue;
    const el = stack[i];
    stack.length = i;
    onElement?.({ ...el, contentStart: el.end, contentEnd: start, content: html.slice(el.end, start) }, edits);
  }
  return edits;
}

// Applies edits from the end; edits inside a replaced element content drop.
function applyEdits(html, edits) {
  const blocks = edits.filter((e) => e.block);
  const final = edits.filter((e) => !blocks.some((b) => b !== e && e.start >= b.start && e.end <= b.end));
  final.sort((a, b) => b.start - a.start);
  for (const e of final) html = html.slice(0, e.start) + e.text + html.slice(e.end);
  return html;
}

const openTag = (tag, attrStr) => `<${tag.name}${attrStr}${tag.selfClose ? "/" : ""}>`;

// Attributes of the first tag matching name + test(attrs)
function findAttrs(html, name, test) {
  const re = new RegExp(`<${name}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, "gi");
  for (const m of html.matchAll(re)) {
    const attrs = parseAttrs(m[1].replace(/\/$/, ""));
    if (test(attrs)) return attrs;
  }
  return null;
}

// ── English source: canonical, hreflang, robots, EN/ES links ──
function headLinks(path) {
  const en = SITE + path, es = SITE + esPath(path);
  return [
    `<link rel="canonical" href="${en}"/>`,
    `<link rel="alternate" hreflang="en" href="${en}"/>`,
    `<link rel="alternate" hreflang="es" href="${es}"/>`,
    `<link rel="alternate" hreflang="x-default" href="${en}"/>`,
  ].join("\n");
}

export function normalizeEnglish(html, page) {
  const { path } = page;
  // canonical + alternates, together where the canonical was (or after <title>)
  html = html.replace(/<link rel="alternate" hreflang="[^"]*" href="[^"]*"\/>\n?/g, "");
  if (path) {
    const block = headLinks(path);
    html = /<link rel="canonical"[^>]*\/>/.test(html)
      ? html.replace(/<link rel="canonical"[^>]*\/>/, block)
      : html.replace(/(<title\b[^>]*>[^<]*<\/title>\n)/, `$1${block}\n`);
  }
  // Google Discover: allow large image previews
  const robots = html.match(/<meta name="robots" content="([^"]*)"\/>/);
  if (robots) {
    if (!/max-image-preview/.test(robots[1])) html = html.replace(robots[0], `<meta name="robots" content="${robots[1]}, max-image-preview:large"/>`);
  } else {
    html = html.replace(/(<meta name="viewport"[^>]*\/>\n)/, `$1<meta name="robots" content="max-image-preview:large"/>\n`);
  }
  // og:locale + alternate
  html = html.replace(/<meta property="og:locale:alternate"[^>]*\/>\n?/g, "");
  if (/<meta property="og:locale"/.test(html)) {
    html = html.replace(/<meta property="og:locale" content="[^"]*"\/>/, `<meta property="og:locale" content="en_US"/>\n<meta property="og:locale:alternate" content="es_LA"/>`);
  }
  // EN/ES switch: real links to the page in each language
  const edits = scan(html, {
    onTag(tag, edits) {
      if (tag.name !== "a" || !/\blang-btn\b/.test(tag.attrs.get("class") || "")) return;
      const lang = tag.attrs.get("data-lang");
      const target = path ? (lang === "es" ? esPath(path) : path) : (lang === "es" ? "/es/" : "/");
      let a = setAttr(tag.attrStr, "href", target);
      a = setAttr(a, "hreflang", lang);
      a = setAttr(a, "class", lang === "en" ? "lang-btn active" : "lang-btn");
      a = lang === "en" ? setAttr(a, "aria-current", "true") : removeAttr(a, "aria-current");
      edits.push({ start: tag.start, end: tag.end, text: openTag(tag, a) });
    },
  });
  return applyEdits(html, edits);
}

// ── Spanish page from the English one ──
// Relative links to pages go to their Spanish version; relative assets
// (share.js, og/…, logo.png) become root-absolute so they load from /es/.
function makeLinkRewriter(pages) {
  const byFile = new Map(Object.entries(pages).filter(([, p]) => p.path).map(([f, p]) => [f, p.path]));
  const paths = new Set(byFile.values());
  return function rewrite(url) {
    if (!url || /^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return url; // anchors, https:, mailto:, data:…
    const [, p, rest] = url.match(/^([^?#]*)(.*)$/);
    if (p === "") return url;
    if (p.startsWith("/")) {
      if (p.startsWith("/es/")) return url;
      const clean = p.replace(/\.html$/, "").replace(/^\/index$/, "/");
      return paths.has(clean) ? esPath(clean) + rest : url;
    }
    if (byFile.has(p)) return esPath(byFile.get(p)) + rest;
    return `/${p}${rest}`;
  };
}

function translateJsonLd(json, ctx) {
  let data;
  try { data = JSON.parse(json); } catch { return null; }
  const fix = (node) => {
    if (Array.isArray(node)) return node.forEach(fix);
    if (!node || typeof node !== "object") return;
    if (node["@type"] === "NewsArticle") {
      if (ctx.headline) node.headline = ctx.headline;
      if (ctx.description) node.description = ctx.description;
      if (ctx.section) node.articleSection = ctx.section;
      if (ctx.image) node.image = [ctx.image];
      node.inLanguage = "es";
      if (ctx.url) node.mainEntityOfPage = ctx.url;
      for (const who of [node.author, node.editor]) {
        if (who?.url?.startsWith(`${SITE}/futurofood-about`)) who.url = who.url.replace(`${SITE}/futurofood-about`, `${SITE}/es/futurofood-about`);
      }
    }
    const target = node["@type"] === "WebSite" && node.potentialAction?.target;
    if (target?.urlTemplate) target.urlTemplate = target.urlTemplate.replace(`${SITE}/futurofood-blog`, `${SITE}/es/futurofood-blog`);
    for (const v of Object.values(node)) if (v && typeof v === "object") fix(v);
  };
  fix(data);
  return JSON.stringify(data, null, 2);
}

// Spanish values for the structured data, read from the English page
function spanishContext(html, url) {
  const ctx = { url };
  const h1 = findAttrs(html, "h1", (a) => /\barticle-title\b/.test(a.get("class") || "") && a.has("data-es"));
  if (h1) ctx.headline = stripTags(decodeAttr(h1.get("data-es")));
  const desc = findAttrs(html, "meta", (a) => a.get("name") === "description" && a.has("data-es-content"));
  if (desc) ctx.description = decodeAttr(desc.get("data-es-content"));
  const tag = findAttrs(html, "span", (a) => /\barticle-tag\b/.test(a.get("class") || "") && a.has("data-es"));
  if (tag) ctx.section = stripTags(decodeAttr(tag.get("data-es"))).replace(/^[^\p{L}]+/u, "");
  const img = findAttrs(html, "meta", (a) => a.get("property") === "og:image" && a.has("data-es-content"));
  if (img) ctx.image = decodeAttr(img.get("data-es-content"));
  return ctx;
}

export function toSpanish(html, page, pages) {
  const rewrite = makeLinkRewriter(pages);
  const url = page.path ? SITE + esPath(page.path) : null;
  const ctx = spanishContext(html, url);

  // New attribute string for a tag in the Spanish page
  function spanishAttrs(tag) {
    let a = tag.attrStr;
    const get = (k) => tag.attrs.get(k);
    if (tag.name === "html") a = setAttr(a, "lang", "es");
    // data-es-<attr> → <attr>; the English stays in data-en-<attr>
    for (const [k, v] of tag.attrs) {
      if (!k.startsWith("data-es-")) continue;
      const target = k.slice("data-es-".length);
      if (get(target) !== undefined && !tag.attrs.has(`data-en-${target}`)) a = setAttr(a, `data-en-${target}`, get(target));
      a = setAttr(a, target, v);
    }
    if (tag.name === "link" && get("rel") === "canonical" && url) a = setAttr(a, "href", url);
    if (tag.name === "meta" && get("property") === "og:url" && url) a = setAttr(a, "content", url);
    if (tag.name === "meta" && get("property") === "og:locale") a = setAttr(a, "content", "es_LA");
    if (tag.name === "meta" && get("property") === "og:locale:alternate") a = setAttr(a, "content", "en_US");
    if (tag.name === "a" && /\blang-btn\b/.test(get("class") || "")) {
      const es = get("data-lang") === "es";
      a = setAttr(a, "class", es ? "lang-btn active" : "lang-btn");
      return es ? setAttr(a, "aria-current", "true") : removeAttr(a, "aria-current");
    }
    for (const at of ["href", "src", "poster", "action"]) {
      const v = get(at);
      if (v !== undefined && rewrite(v) !== v) a = setAttr(a, at, rewrite(v));
    }
    if (get("srcset")) a = setAttr(a, "srcset", get("srcset").split(",").map((s) => s.trim().replace(/^\S+/, rewrite)).join(", "));
    return a;
  }

  // Links inside the Spanish HTML that replaces an element's content
  function rewriteFragment(fragment) {
    const edits = scan(fragment, {
      onTag(tag, edits) {
        const a = spanishAttrs(tag);
        if (a !== tag.attrStr) edits.push({ start: tag.start, end: tag.end, text: openTag(tag, a) });
      },
    });
    return applyEdits(fragment, edits);
  }

  const edits = scan(html, {
    onTag(tag, edits) {
      const a = spanishAttrs(tag);
      // Elements with data-es are rewritten when closed (they also get data-en)
      if (tag.attrs.has("data-es") && !VOID.has(tag.name) && !tag.selfClose) { tag.esAttrs = a; return; }
      if (a !== tag.attrStr) edits.push({ start: tag.start, end: tag.end, text: openTag(tag, a) });
    },
    onElement(el, edits) {
      if (!el.attrs.has("data-es")) return;
      const es = decodeAttr(el.attrs.get("data-es"));
      let a = el.esAttrs ?? el.attrStr;
      if (el.name !== "title" && !el.attrs.has("data-en")) a = setAttr(a, "data-en", encodeAttr(el.content));
      edits.push({ start: el.start, end: el.end, text: openTag(el, a) });
      edits.push({ start: el.contentStart, end: el.contentEnd, text: el.name === "title" ? escapeText(es) : rewriteFragment(es), block: true });
    },
    onScript({ tag, body, bodyStart, bodyEnd }, edits) {
      const a = spanishAttrs(tag);
      if (a !== tag.attrStr) edits.push({ start: tag.start, end: tag.end, text: openTag(tag, a) });
      if (tag.name === "script" && tag.attrs.get("type") === "application/ld+json") {
        const out = translateJsonLd(body, ctx);
        if (out) edits.push({ start: bodyStart, end: bodyEnd, text: `\n${out}\n` });
      }
    },
  });
  return applyEdits(html, edits);
}

// ── Sitemap ──
// Last commit date of the page; today if it has uncommitted changes (so the
// sitemap built before a commit matches the one built after it).
function lastmod(file, root) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const today = new Date().toLocaleDateString("en-CA");
  try {
    if (git(["status", "--porcelain", "--", file])) return today;
    return git(["log", "-1", "--format=%cs", "--", file]) || today;
  } catch {
    return today;
  }
}

export function renderSitemap(pages, root = ROOT) {
  let registry = [];
  try { registry = JSON.parse(readFileSync(join(root, "scripts/articles-registry.json"), "utf8")); } catch {}
  const dates = new Map(registry.map((e) => [e.filename, e.date_iso]));
  const entries = Object.entries(pages).filter(([, p]) => p.sitemap && p.path);
  const urls = [];
  for (const [file, p] of entries) {
    const date = dates.get(file) || lastmod(file, root);
    const alts = [["en", SITE + p.path], ["es", SITE + esPath(p.path)], ["x-default", SITE + p.path]]
      .map(([l, h]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${h}"/>`).join("\n");
    for (const loc of [SITE + p.path, SITE + esPath(p.path)]) {
      urls.push(`  <url>
    <loc>${loc}</loc>
${alts}
    <lastmod>${date}</lastmod>
    <changefreq>${p.sitemap[0]}</changefreq>
    <priority>${p.sitemap[1]}</priority>
  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/build-i18n.mjs — English at the root, Spanish under /es/. Do not edit by hand. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}

// ── Build ──
export function buildSite({ root = ROOT, log = console.log } = {}) {
  // Home page first (cover, columns, ticker, edition), so /es/ gets it too
  buildHome({ root, log });
  // Newsletter archive (/boletin): one entry per edition
  buildArchive({ root, log });
  // "Related Stories" on every article page (same country/topic first)
  buildRelated({ root, log });
  const pages = sitePages(root);
  const esDir = join(root, ES_DIR);
  mkdirSync(esDir, { recursive: true });
  // Spanish pages whose English source is gone are removed
  for (const f of readdirSync(esDir)) if (f.endsWith(".html") && !pages[f]) rmSync(join(esDir, f));
  let changed = 0;
  for (const [file, page] of Object.entries(pages)) {
    const src = join(root, file);
    if (!existsSync(src)) continue;
    const before = readFileSync(src, "utf8");
    const en = normalizeEnglish(before, page);
    if (en !== before) { writeFileSync(src, en); changed++; }
    const esFile = join(esDir, file);
    const es = toSpanish(en, page, pages);
    if (!existsSync(esFile) || readFileSync(esFile, "utf8") !== es) { writeFileSync(esFile, es); changed++; }
  }
  const sitemapPath = join(root, "sitemap.xml");
  const sitemap = renderSitemap(pages, root);
  if (!existsSync(sitemapPath) || readFileSync(sitemapPath, "utf8") !== sitemap) { writeFileSync(sitemapPath, sitemap); changed++; }
  log(`[i18n] ${Object.keys(pages).length} pages → es/, sitemap.xml (${changed} file(s) updated)`);
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildSite();
