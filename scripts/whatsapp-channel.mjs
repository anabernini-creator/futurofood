#!/usr/bin/env node
// Ready-to-paste message for the FuturoFood WhatsApp Channel, for the
// articles a merged weekly review PR published (registry entries that were
// not there before the merge, BASE_REGISTRY_REF). The weekly-newsletter
// workflow posts it as a PR comment; Ana pastes it into the Channel.
//
// WhatsApp format: each story is the category emoji + the title in *bold*,
// then its published deck (Spanish) and the link to the Spanish page, tagged
// utm_source=whatsapp_channel&utm_medium=social&utm_campaign=weekly.
// At most 3 stories per message: more stories are split into several.
//
// Env: BASE_REGISTRY_REF (git ref before the merge), OUTPUT_DIR (writes
// whatsapp.md, the PR comment). Without OUTPUT_DIR it prints the comment.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY = "scripts/articles-registry.json";
const SITE = "https://futurofood.com";
const UTM = "utm_source=whatsapp_channel&utm_medium=social&utm_campaign=weekly";
const PER_MESSAGE = 3;

// Same icons as the blog's topic list
const CATEGORY_EMOJI = { lab: "🧬", regen: "🌱", insects: "🦗", tech: "🤖", water: "💧", ancestral: "🌽" };

export function articleLink(entry) {
  return `${SITE}/es/${entry.filename.replace(/\.html$/, "")}?${UTM}`; // Spanish message → /es/ page
}

// WhatsApp reads *…* as bold and _…_ as italics: keep the article's own
// asterisks from breaking the bold title.
const plain = (s) => String(s).replace(/\s+/g, " ").replace(/\*/g, "").trim();

export function renderStory(entry) {
  const emoji = CATEGORY_EMOJI[entry.tag_slug] || CATEGORY_EMOJI.tech;
  return `${emoji} *${plain(entry.title_es)}*\n${plain(entry.deck_es)}\n${articleLink(entry)}`;
}

export function renderChannelMessages(entries, date = new Date()) {
  const day = date.toLocaleDateString("es", { day: "numeric", month: "long", timeZone: "America/Costa_Rica" });
  const chunks = [];
  for (let i = 0; i < entries.length; i += PER_MESSAGE) chunks.push(entries.slice(i, i + PER_MESSAGE));
  return chunks.map((chunk, i) => {
    const part = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : "";
    // Reader tips: invitation at the end of the week's last message
    const tip = i === chunks.length - 1 ? ["✍️ ¿Conoces a alguien que esté cambiando cómo se cultiva, se investiga o se come en tu país? Cuéntanos su historia: hello@futurofood.com"] : [];
    return [`*FuturoFood · Semana del ${day}*${part}`, ...chunk.map(renderStory), ...tip].join("\n\n");
  });
}

export function renderComment(messages) {
  const lines = [
    "📲 **Mensaje para el Canal de WhatsApp de FuturoFood**",
    "",
    messages.length > 1
      ? `Son ${messages.length} mensajes (máximo 3 historias cada uno). Copia cada bloque con el botón de copiar y pégalo en el Canal, uno por uno.`
      : "Copia el bloque con el botón de copiar y pégalo en el Canal.",
  ];
  messages.forEach((m, i) => {
    if (messages.length > 1) lines.push("", `**Mensaje ${i + 1} de ${messages.length}**`);
    lines.push("", "```text", m, "```");
  });
  return lines.join("\n") + "\n";
}

function registryAt(ref) {
  try {
    return JSON.parse(execFileSync("git", ["show", `${ref}:${REGISTRY}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return [];
  }
}

function main() {
  const current = JSON.parse(readFileSync(REGISTRY, "utf8"));
  const before = new Set(registryAt(process.env.BASE_REGISTRY_REF || "HEAD~1").map((e) => e.slug));
  // Registry is newest first; the Channel reads top to bottom in that order
  const fresh = current.filter((e) => !before.has(e.slug));
  console.log(`[whatsapp-channel] ${fresh.length} new article(s):`, fresh.map((e) => e.slug).join(", ") || "—");
  if (!fresh.length) return;
  const comment = renderComment(renderChannelMessages(fresh));
  const out = process.env.OUTPUT_DIR;
  if (!out) return console.log(comment);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "whatsapp.md"), comment);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
