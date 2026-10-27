#!/usr/bin/env node
// "Related Stories" at the end of every article page, rebuilt from the
// published articles on each build, so older pages also link to the new ones.
// Order: articles from the same country and topic, then the same country or
// topic, then the newest others ("regional" is not a country). Each card is a
// real link, in the HTML, so search engines follow it too.
// build-i18n.mjs runs this before writing /es/.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStories } from "./build-home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELATED_COUNT = 3;
const EMOJI = { lab: "🧬", regen: "🌱", insects: "🦗", tech: "🤖", water: "💧", ancestral: "🌽" };
// Hand-written pages that aren't in the registry
const COUNTRY = { "futurofood-article.html": "brasil" };
const SECTION_RE = /<div class="related-section">[\s\S]*?<\/div>(?=\s*<\/article>)/;

const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Articles with their own page (newest first), with country and emoji from
// the registry when the agent published them
export function relatedPool(stories, registry) {
  const byFile = new Map(registry.map((r) => [r.filename, r]));
  return stories.filter((s) => s.href).map((s) => {
    const r = byFile.get(s.href);
    return { ...s, country: r?.country || COUNTRY[s.href] || null, emoji: r?.emoji || EMOJI[s.tag] || "" };
  });
}

export function pickRelated(self, pool, n = RELATED_COUNT) {
  const sameCountry = (a) => a.country && a.country !== "regional" && a.country === self.country;
  const score = (a) => (sameCountry(a) ? 1 : 0) + (a.tag === self.tag ? 1 : 0);
  return pool
    .filter((a) => a.href !== self.href)
    .map((a, i) => ({ a, i, score: score(a) }))
    .sort((x, y) => y.score - x.score || x.i - y.i) // pool is newest first
    .slice(0, n)
    .map((x) => x.a);
}

export function renderRelated(related) {
  const cards = related.map((r) => `      <a class="related-card" href="${escapeAttr(r.href)}">
        <div class="related-img" aria-hidden="true">${r.emoji}</div>
        <div>
          <span class="related-tag" data-es="${r.emoji} ${r.tagEs}">${r.emoji} ${r.tagEn}</span>
          <div class="related-title-text" data-es="${r.titleEs}">${r.titleEn}</div>
          <span class="related-date" data-es="Fuente: ${r.sourceEs} · ${r.read} min">Source: ${r.sourceEn} · ${r.read} min</span>
        </div>
      </a>`);
  return `<div class="related-section">
      <div class="related-title" data-es="Historias Relacionadas">Related Stories</div>
${cards.join("\n")}
    </div>`;
}

export function buildRelated({ root = ROOT, log = console.log } = {}) {
  const stories = readStories(readFileSync(join(root, "futurofood-blog.html"), "utf8"));
  let registry = [];
  try { registry = JSON.parse(readFileSync(join(root, "scripts/articles-registry.json"), "utf8")); } catch {}
  const pool = relatedPool(stories, registry);
  let changed = 0, pages = 0;
  for (const file of readdirSync(root).filter((f) => /^futurofood-article(-.+)?\.html$/.test(f))) {
    const path = join(root, file);
    const before = readFileSync(path, "utf8");
    if (!SECTION_RE.test(before)) continue;
    const self = pool.find((s) => s.href === file);
    if (!self) continue; // a page the blog doesn't list
    pages++;
    const after = before.replace(SECTION_RE, () => renderRelated(pickRelated(self, pool)));
    if (after !== before) { writeFileSync(path, after); changed++; }
  }
  log(`[related] ${pages} article page(s) (${changed} updated)`);
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildRelated();
