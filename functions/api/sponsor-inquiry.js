// Cloudflare Pages Function — POST /api/sponsor-inquiry
// Emails sponsorship inquiries from /patrocinadores to Ana through Cloudflare
// Email Service (REST API). Sending to a verified destination address of the
// account is free. Reply-To is the sender, so Ana can answer them directly.
//
// Requires the Pages secret CF_EMAIL_TOKEN: a Cloudflare API token with the
// "Email Sending: Edit" permission (set with `wrangler pages secret put`).

const ACCOUNT_ID = "7ff771f8ba9f746f18e6ee1bb8fa5cdd";
const TO = "anabernini@gmail.com";
const FROM = "patrocinadores@futurofood.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORMATS = {
  newsletter: "Mención en el newsletter",
  banner: "Banner en el blog (728×90)",
  article: "Artículo patrocinado",
  unsure: "Aún no sabe",
};
const BUDGETS = {
  "200-500": "US$200–500",
  "500-1000": "US$500–1.000",
  "1000+": "Más de US$1.000",
  unsure: "Aún no sabe",
};

function json(data, status) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
function field(body, key, max) {
  const v = typeof body?.[key] === "string" ? body[key].trim() : "";
  return v.length > max ? null : v;
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  // Bots: a hidden field humans never fill, or a form sent within 3 seconds
  // of loading. Answer "ok" so they don't retry, but send nothing.
  const startedAt = Number(body?.started_at);
  if (field(body, "fax", 200) || (startedAt && Date.now() - startedAt < 3000)) {
    return json({ ok: true }, 200);
  }

  const name = field(body, "name", 100);
  const company = field(body, "company", 120);
  const email = field(body, "email", 200);
  const website = field(body, "website", 200);
  const message = field(body, "message", 3000);
  const format = FORMATS[body?.format] ? body.format : "unsure";
  const budget = BUDGETS[body?.budget] ? body.budget : "unsure";
  const lang = body?.lang === "es" ? "es" : "en";

  if (!name || !company) return json({ ok: false, error: "missing_fields" }, 400);
  if (!email || !EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
  if (!message || message.length < 10) return json({ ok: false, error: "missing_message" }, 400);
  if (website === null) return json({ ok: false, error: "invalid_website" }, 400);

  const token = env.CF_EMAIL_TOKEN?.trim();
  if (!token) return json({ ok: false, error: "not_configured" }, 503);

  const text = [
    "Nueva consulta de patrocinio desde futurofood.com/patrocinadores",
    "",
    `Nombre:   ${name}`,
    `Empresa:  ${company}`,
    `Correo:   ${email}`,
    `Sitio:    ${website || "—"}`,
    `Formato:  ${FORMATS[format]}`,
    `Presupuesto: ${BUDGETS[budget]}`,
    `Idioma del sitio: ${lang === "es" ? "español" : "inglés"}`,
    "",
    "Mensaje:",
    message,
    "",
    "— Responde a este correo para contestarle directamente.",
  ].join("\n");

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID || ACCOUNT_ID}/email/sending/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        to: TO,
        from: FROM,
        reply_to: email,
        subject: `Patrocinio: ${company} — ${FORMATS[format]}`,
        text,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return json({ ok: true }, 200);
    console.error("sponsor_inquiry_send_failed", res.status, JSON.stringify(data.errors || data));
    return json({ ok: false, error: "send_failed" }, 502);
  } catch (err) {
    console.error("sponsor_inquiry_fetch_failed", err?.message);
    return json({ ok: false, error: "send_failed" }, 502);
  }
}

export async function onRequestGet() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
