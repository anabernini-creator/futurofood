#!/usr/bin/env node
// Newsletter archive (boletin.html → /boletin and /es/boletin): every edition,
// newest first — its number, date and the stories in it, each linked to its
// article (brief stories without a page link to the blog filtered to them).
// Editions are the same as the home page's "Vol. · Issue": the weeks with
// published stories (build-home.mjs). build-i18n.mjs runs this before /es/,
// so the weekly agent adds each new edition in its own review PR.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStories, editions, storyHref } from "./build-home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderArchive(stories) {
  return editions(stories).map((e) => `    <section class="issue" id="v${e.volume}-${e.issue}">
      <div class="issue-head">
        <h2 class="issue-num" data-es="Edición ${e.issue}">Issue ${e.issue}</h2>
        <time class="issue-date" datetime="${e.date}" data-es="${e.dateEs} · Vol. ${e.volume}">${e.dateEn} · Vol. ${e.volume}</time>
      </div>
      <h3 class="issue-sub" data-es="En esta edición">In this issue</h3>
      <ul class="issue-list">
${e.stories.map((s) => `        <li><span class="issue-tag" data-es="${s.tagEs}">${s.tagEn}</span><a href="${escapeAttr(storyHref(s))}" data-es="${s.titleEs}">${s.titleEn}</a></li>`).join("\n")}
      </ul>
    </section>`).join("\n");
}

export function buildArchive({ root = ROOT, log = console.log } = {}) {
  const path = join(root, "boletin.html");
  const before = readFileSync(path, "utf8");
  const stories = readStories(readFileSync(join(root, "futurofood-blog.html"), "utf8"));
  const re = /(<!-- ARCHIVE:START[^>]*-->)[\s\S]*?([ ]*<!-- ARCHIVE:END -->)/;
  if (!re.test(before)) throw new Error("ARCHIVE markers missing in boletin.html");
  const after = before.replace(re, (_, a, b) => `${a}\n${renderArchive(stories)}\n${b}`);
  if (after !== before) writeFileSync(path, after);
  log(`[archive] ${editions(stories).length} edition(s) in boletin.html (${after !== before ? "updated" : "unchanged"})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildArchive();
