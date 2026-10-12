// Cloudflare Pages Function — POST /api/subscribe
// Proxies newsletter signups to Beehiiv so the API key never reaches the browser.
// Requires env vars (set via `wrangler pages secret put`, see project docs):
//   BEEHIIV_API_KEY          — Beehiiv v2 API key
//   BEEHIIV_PUBLICATION_ID   — Beehiiv publication id (starts with "pub_")

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }

  const apiKey = env.BEEHIIV_API_KEY?.trim();
  const publicationId = env.BEEHIIV_PUBLICATION_ID?.trim();

  if (!apiKey || !publicationId) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  try {
    const beehiivRes = await fetch(
      `https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          reactivate_existing: true,
          send_welcome_email: true,
          utm_source: "futurofood.com",
        }),
      }
    );

    if (beehiivRes.status === 201 || beehiivRes.status === 200) {
      return json({ ok: true }, 200);
    }

    if (beehiivRes.status === 400) {
      return json({ ok: false, error: "invalid_email" }, 400);
    }

    const detail = await beehiivRes.text().catch(() => "");
    console.error("beehiiv_error", beehiivRes.status, detail);
    return json({ ok: false, error: "upstream_error" }, 502);
  } catch (err) {
    console.error("beehiiv_fetch_failed", err?.message);
    return json({ ok: false, error: "upstream_error" }, 502);
  }
}

export async function onRequestGet() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
