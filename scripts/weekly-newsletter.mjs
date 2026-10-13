#!/usr/bin/env node
// Sends "FuturoFood Weekly" for the articles a merged review PR published.
// The new articles are the registry entries that were not there before the
// merge (BASE_REGISTRY_REF). Posts them to /api/weekly-newsletter, which
// holds the Beehiiv key and creates the issue in Beehiiv.
//
// Env: NEWSLETTER_TRIGGER_TOKEN (required), BASE_REGISTRY_REF (git ref before
// the merge), MODE ("send" | "draft", default "send"), ENDPOINT (optional),
// OUTPUT_DIR (optional: writes result.json / issue.html for the workflow),
// WAIT_FOR_LIVE (optional: wait until each article URL answers 200).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const REGISTRY = "scripts/articles-registry.json";
const endpoint = process.env.ENDPOINT || "https://futurofood.com/api/weekly-newsletter";
const mode = process.env.MODE === "draft" ? "draft" : "send";
const out = process.env.OUTPUT_DIR;

function registryAt(ref) {
  try {
    return JSON.parse(execFileSync("git", ["show", `${ref}:${REGISTRY}`], { encoding: "utf8" }));
  } catch {
    return [];
  }
}

const current = JSON.parse(readFileSync(REGISTRY, "utf8"));
const before = new Set(registryAt(process.env.BASE_REGISTRY_REF || "HEAD~1").map((e) => e.slug));
const fresh = current.filter((e) => !before.has(e.slug));
console.log(`[newsletter] ${fresh.length} new article(s):`, fresh.map((e) => e.slug).join(", ") || "—");
if (!fresh.length) process.exit(0);

// Cloudflare deploys main in ~2 minutes: don't email links before they work
if (process.env.WAIT_FOR_LIVE) {
  const deadline = Date.now() + 10 * 60 * 1000;
  for (const e of fresh) {
    const url = `https://futurofood.com/${e.filename.replace(/\.html$/, "")}`;
    while (true) {
      const r = await fetch(url, { method: "HEAD" }).catch(() => null);
      if (r?.ok) break;
      if (Date.now() > deadline) {
        console.error(`[newsletter] ${url} is still not live after 10 minutes — not sending`);
        process.exit(1);
      }
      await new Promise((ok) => setTimeout(ok, 15000));
    }
    console.log("[newsletter] live:", url);
  }
}

const res = await fetch(endpoint, {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.NEWSLETTER_TRIGGER_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({
    mode,
    date: new Date().toISOString().slice(0, 10),
    articles: fresh.map((e) => ({
      path: e.filename.replace(/\.html$/, ""),
      title_es: e.title_es,
      deck_es: e.deck_es,
      tag_es: e.tag_es,
      source: e.source_name,
    })),
  }),
});
const result = await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }));
console.log("[newsletter] result:", JSON.stringify({ ...result, html: result.html ? "(html)" : undefined }));
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
  if (result.html) writeFileSync(join(out, "issue.html"), result.html);
}
// Plan without API posting is an expected outcome (the workflow posts the
// ready-to-paste issue); anything else unexpected fails the run.
if (!result.ok && result.error !== "plan_not_supported") process.exit(1);
