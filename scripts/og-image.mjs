#!/usr/bin/env node
// Link-preview cards (Open Graph / X) for article pages.
//
// For each article page it renders og/<page>.jpg (1200x630): FuturoFood logo,
// the category with its emoji on the dark-green placeholder, the Spanish title
// and a two-line excerpt — then points the page's og:/twitter: tags at it.
// Title and description tags are Spanish too (LATAM audience, same language as
// the WhatsApp share message).
//
//   node scripts/og-image.mjs                      # every futurofood-article*.html
//   node scripts/og-image.mjs futurofood-article-x.html …
//
// Needs Chrome (CHROME_PATH, /usr/bin/google-chrome on GitHub runners, or the
// macOS app) and puppeteer-core. Without them pages keep og-default.jpg.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://futurofood.com";
const DEFAULT_IMAGE = `${SITE}/og-default.jpg`;

// Same categories as the blog filters; the card shows the category's emoji.
const CATEGORIES = {
  "Lab-Grown": { emoji: "🧬", es: "Cultivado en Lab" },
  "Regenerative": { emoji: "🌱", es: "Regenerativo" },
  "Insect Protein": { emoji: "🦗", es: "Proteína de Insectos" },
  "Food Tech": { emoji: "🤖", es: "Tecnología Alimentaria" },
  "Water": { emoji: "💧", es: "Agua" },
  "Ancestral": { emoji: "🌽", es: "Ancestral" },
};

function decode(s) {
  return String(s)
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Two lines in a WhatsApp/LinkedIn preview ≈ 150 characters
function clip(text, max = 150) {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "").replace(/[,;:—-]\s*$/, "") + "…";
}

export function ogDataFromPage(html) {
  const title = html.match(/<h1 class="article-title" data-es="([^"]*)"/);
  const deck = html.match(/<p class="article-deck" data-es="([^"]*)"/);
  const tag = html.match(/<span class="article-tag"[^>]*>([^<]*)<\/span>/);
  if (!title || !deck || !tag) throw new Error("missing title, deck or tag");
  const label = Object.keys(CATEGORIES).find((k) => decode(tag[1]).endsWith(k)) || "Food Tech";
  return { title: decode(title[1]), excerpt: decode(deck[1]), category: CATEGORIES[label] };
}

function cardHtml({ title, excerpt, category }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@900&family=DM+Sans:wght@400&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;color:#E8F5E0;position:relative;
  background:radial-gradient(ellipse at 78% 50%, rgba(74,222,128,.14), transparent 55%),linear-gradient(160deg,#123420 0%,#0C2214 55%,#08160D 100%);
  display:grid;grid-template-columns:1fr 300px;gap:52px;padding:64px 72px}
body::after{content:"";position:absolute;inset:24px;border:1px solid rgba(232,245,224,.10);pointer-events:none}
.text{display:flex;flex-direction:column;min-width:0}
.logo{font-family:'Playfair Display',Georgia,serif;font-weight:900;font-size:38px;letter-spacing:-.02em}
.logo em{font-style:normal;color:#4ADE80}
.chip{align-self:flex-start;margin-top:34px;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:17px;letter-spacing:.16em;text-transform:uppercase;color:#4ADE80;border:1px solid rgba(74,222,128,.45);padding:7px 14px}
h1{margin-top:22px;font-family:'Playfair Display',Georgia,serif;font-weight:900;font-size:54px;line-height:1.08;letter-spacing:-.02em;
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
p{margin-top:20px;font-family:'DM Sans',system-ui,sans-serif;font-size:25px;line-height:1.4;color:rgba(232,245,224,.72);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.site{margin-top:auto;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:17px;letter-spacing:.2em;text-transform:uppercase;color:rgba(232,245,224,.5)}
.media{align-self:center;height:300px;position:relative;display:flex;align-items:center;justify-content:center;border:1px solid rgba(232,245,224,.10);
  background:radial-gradient(ellipse at 50% 42%, rgba(74,222,128,.16), transparent 62%),linear-gradient(160deg,#164027 0%,#0E2918 55%,#0A1C10 100%)}
.media::after{content:"";position:absolute;inset:12px;border:1px solid rgba(232,245,224,.10)}
.emoji{font-family:"Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif;font-size:130px;line-height:1;filter:drop-shadow(0 12px 28px rgba(0,0,0,.45))}
</style></head><body>
<div class="text">
  <div class="logo">Futuro<em>Food</em></div>
  <div class="chip">${escapeHtml(category.emoji)} ${escapeHtml(category.es)}</div>
  <h1 id="t" data-short="${escapeHtml(title.split(" — ")[0])}">${escapeHtml(title)}</h1>
  <p>${escapeHtml(excerpt)}</p>
  <div class="site">futurofood.com</div>
</div>
<div class="media"><span class="emoji">${escapeHtml(category.emoji)}</span></div>
</body></html>`;
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

// Points the page's preview tags at the card (or the default image).
export function applyOgMeta(html, { title, excerpt, imageUrl }) {
  const desc = clip(excerpt);
  const set = (attr, key, value) => {
    const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*"\\/>`);
    const tag = `<meta ${attr}="${key}" content="${escapeHtml(value)}"/>`;
    if (re.test(html)) html = html.replace(re, () => tag);
    else html = html.replace(/<meta property="og:site_name"[^>]*\/>\n/, (m) => `${m}${tag}\n`);
  };
  set("property", "og:title", title);
  set("property", "og:description", desc);
  set("property", "og:image", imageUrl);
  set("property", "og:image:alt", `${title} — FuturoFood`);
  set("property", "og:locale", "es_LA");
  set("name", "twitter:title", title);
  set("name", "twitter:description", desc);
  set("name", "twitter:image", imageUrl);
  return html;
}

// Renders cards for the given article files and updates their tags.
// Returns the list of files whose card was rendered.
export async function updateOgCards(files, log = console.log) {
  const exe = chromePath();
  let puppeteer = null;
  try { puppeteer = exe && (await import("puppeteer-core")).default; } catch {}
  if (!puppeteer) log("[og] Chrome/puppeteer-core not available — pages keep og-default.jpg");

  const browser = puppeteer ? await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] }) : null;
  const rendered = [];
  try {
    for (const file of files) {
      const path = join(ROOT, file);
      let html = readFileSync(path, "utf8");
      const data = ogDataFromPage(html);
      let imageUrl = DEFAULT_IMAGE;
      let fit = null;
      if (browser) {
        try {
          const name = `${basename(file, ".html")}.jpg`;
          mkdirSync(join(ROOT, "og"), { recursive: true });
          const page = await browser.newPage();
          await page.setViewport({ width: 1200, height: 630 });
          await page.setContent(cardHtml(data), { waitUntil: "networkidle0" });
          fit = await page.evaluate(async () => {
            await document.fonts.ready;
            // Largest size (54→40px) that fits the title in 3 lines, else in 4.
            // Runs after the fonts load — Playfair is wider than the fallback.
            const t = document.getElementById("t");
            const lines = () => Math.round(t.scrollHeight / parseFloat(getComputedStyle(t).lineHeight));
            const fitsAt = (size, max) => { t.style.fontSize = size + "px"; return lines() <= max; };
            const tryFit = () => {
              for (const max of [3, 4]) {
                for (let size = 54; size >= 40; size -= 2) if (fitsAt(size, max)) return { size, lines: lines() };
              }
              return null;
            };
            // Very long titles ("X — and Y"): keep the first clause rather than cut mid-word
            const fit = tryFit() || ((t.textContent = t.dataset.short), tryFit());
            if (fit) return fit;
            fitsAt(40, 4);
            return { size: 40, lines: lines() };
          });
          await page.screenshot({ path: join(ROOT, "og", name), type: "jpeg", quality: 84 });
          await page.close();
          imageUrl = `${SITE}/og/${name}`;
          rendered.push(file);
        } catch (e) {
          log(`[og] card failed for ${file}: ${e.message}`);
        }
      }
      writeFileSync(path, applyOgMeta(html, { ...data, imageUrl }));
      log(`[og] ${file} → ${imageUrl}${fit ? ` (title ${fit.size}px, ${fit.lines} lines)` : ""}`);
    }
  } finally {
    if (browser) await browser.close();
  }
  return rendered;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = args.length ? args : readdirSync(ROOT).filter((f) => /^futurofood-article.*\.html$/.test(f)).sort();
  updateOgCards(files).catch((e) => {
    console.error("[og] fatal:", e);
    process.exit(1);
  });
}
