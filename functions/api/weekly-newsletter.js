// Cloudflare Pages Function — POST /api/weekly-newsletter
// Called by GitHub Actions after a weekly review PR is merged (the articles are
// live). Builds "FuturoFood Weekly — <fecha>" and creates it in Beehiiv:
//   mode "send"  → status confirmed: published and emailed to all subscribers
//   mode "draft" → left as a draft in Beehiiv
// The Beehiiv key stays in Cloudflare (BEEHIIV_API_KEY); callers authenticate
// with NEWSLETTER_TRIGGER_TOKEN. Beehiiv only allows creating posts by API on
// its Max and Enterprise plans — on other plans this answers
// "plan_not_supported" plus the ready-to-paste HTML.

const SITE = "https://futurofood.com";

function json(data, status) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function spanishDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function buildIssue(articles, dateIso) {
  const subject = `FuturoFood Weekly — ${spanishDate(dateIso)}`;
  const campaign = `weekly-${dateIso}`;
  const items = articles.map((a) => {
    const url = `${SITE}/${a.path}?utm_source=newsletter&utm_medium=email&utm_campaign=${campaign}`;
    return `
<h2 style="margin:28px 0 6px;font-size:22px;line-height:1.25;"><a href="${esc(url)}" style="color:#0A0F0A;text-decoration:none;">${esc(a.title_es)}</a></h2>
<p style="margin:0 0 4px;font-size:13px;color:#5B6B5B;">${esc(a.tag_es)}${a.source ? ` · Fuente: ${esc(a.source)}` : ""}</p>
<p style="margin:0 0 10px;font-size:16px;line-height:1.6;">${esc(a.deck_es)}</p>
<p style="margin:0 0 8px;"><a href="${esc(url)}" style="color:#1F8A4C;font-weight:bold;">Leer la historia →</a></p>`;
  }).join('\n<hr style="border:none;border-top:1px solid #E2E8E2;margin:24px 0;"/>');
  const count = articles.length;
  const html = `
<p style="font-size:16px;line-height:1.6;">Hola,</p>
<p style="font-size:16px;line-height:1.6;">${count === 1 ? "Esta es la historia" : `Estas son las ${count} historias`} de la semana en FuturoFood: quienes cultivan, investigan y emprenden para cambiar el sistema alimentario en América Latina.</p>
${items}
<hr style="border:none;border-top:1px solid #E2E8E2;margin:28px 0;"/>
<p style="font-size:15px;line-height:1.6;">¿Conoces a alguien a quien le interese? Reenvíale este correo o comparte cualquier historia por WhatsApp desde <a href="${SITE}/futurofood-blog?utm_source=newsletter&utm_medium=email&utm_campaign=${campaign}" style="color:#1F8A4C;">futurofood.com</a>.</p>
<p style="font-size:13px;line-height:1.6;color:#5B6B5B;">All stories are also available in English at futurofood.com.</p>`;
  const subtitle = count === 1
    ? "La historia de la semana sobre quienes cambian la alimentación en LATAM"
    : `${count} historias sobre quienes cambian la alimentación en LATAM`;
  return { subject, subtitle, html };
}

export async function onRequestPost({ request, env }) {
  const expected = env.NEWSLETTER_TRIGGER_TOKEN?.trim();
  const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !safeEqual(auth, expected)) return json({ ok: false, error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }
  const mode = body?.mode === "send" ? "send" : "draft";
  const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(body?.date || "") ? body.date : new Date().toISOString().slice(0, 10);
  const articles = Array.isArray(body?.articles)
    ? body.articles.filter((a) => a && a.title_es && a.deck_es && /^futurofood-article[\w-]*$/.test(a.path || "")).slice(0, 10)
    : [];
  if (!articles.length) return json({ ok: false, error: "no_articles" }, 400);

  const issue = buildIssue(articles, dateIso);
  const apiKey = env.BEEHIIV_API_KEY?.trim();
  const pub = env.BEEHIIV_PUBLICATION_ID?.trim();
  if (!apiKey || !pub) return json({ ok: false, error: "not_configured", ...issue }, 500);
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

  // Same subject already in Beehiiv (e.g. the workflow was re-run) → don't send twice
  try {
    const list = await fetch(`https://api.beehiiv.com/v2/publications/${pub}/posts?limit=20&order_by=created&direction=desc`, { headers });
    if (list.ok) {
      const posts = (await list.json()).data || [];
      const dup = posts.find((p) => p.title === issue.subject);
      if (dup) return json({ ok: true, duplicate: true, post_id: dup.id, status: dup.status, subject: issue.subject }, 200);
    }
  } catch {}

  const res = await fetch(`https://api.beehiiv.com/v2/publications/${pub}/posts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: issue.subject,
      subtitle: issue.subtitle,
      body_content: issue.html,
      status: mode === "send" ? "confirmed" : "draft",
      email_settings: { email_subject_line: issue.subject, email_preview_text: issue.subtitle },
      recipients: mode === "send" ? { email: { tier_ids: ["all"] }, web: { tier_ids: ["all"] } } : undefined,
      content_tags: ["weekly"],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return json({ ok: true, mode, post_id: data?.data?.id, status: data?.data?.status, subject: issue.subject }, 200);

  console.error("beehiiv_create_post_failed", res.status, JSON.stringify(data).slice(0, 500));
  // 403 / plan wording = the endpoint isn't in this Beehiiv plan; 401 = bad key
  const plan = res.status === 403 || (res.status !== 401 && /\bplan\b|enterprise/i.test(JSON.stringify(data)));
  // 424, not 502: Cloudflare replaces 502 bodies on the custom domain with its own error page
  return json({ ok: false, error: plan ? "plan_not_supported" : "beehiiv_error", beehiiv_status: res.status, beehiiv: data?.errors || data, ...issue }, 424);
}

export async function onRequestGet() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
