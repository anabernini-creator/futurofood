// futurofood-mailer: POST { subject, text, reply_to } with
// "Authorization: Bearer <MAILER_TOKEN>" → emails Ana from
// patrocinadores@futurofood.com. Called by the Pages Function
// /api/sponsor-inquiry (Pages Functions can't use the email binding).

const FROM = "patrocinadores@futurofood.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
    const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.MAILER_TOKEN || !safeEqual(auth, env.MAILER_TOKEN)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

    let body;
    try { body = await request.json(); } catch { return Response.json({ ok: false, error: "invalid_body" }, { status: 400 }); }
    const subject = typeof body.subject === "string" ? body.subject.slice(0, 200) : "";
    const text = typeof body.text === "string" ? body.text.slice(0, 10000) : "";
    if (!subject || !text) return Response.json({ ok: false, error: "missing_fields" }, { status: 400 });

    const message = { to: "anabernini@gmail.com", from: FROM, subject, text };
    if (typeof body.reply_to === "string" && EMAIL_RE.test(body.reply_to) && body.reply_to.length <= 200) {
      message.replyTo = body.reply_to;
    }
    try {
      const sent = await env.EMAIL.send(message);
      return Response.json({ ok: true, id: sent?.messageId || null });
    } catch (err) {
      console.error("mailer_send_failed", err?.message);
      return Response.json({ ok: false, error: "send_failed" }, { status: 500 });
    }
  },
};
