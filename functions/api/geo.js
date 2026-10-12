// Cloudflare Pages Function — GET /api/geo
// Tells consent.js whether the visitor needs the cookie consent banner:
// EU/EEA, UK and Switzerland (GDPR) and Brazil (LGPD). Uses only the country
// Cloudflare already attaches to the request; nothing is stored.

const CONSENT_COUNTRIES = new Set([
  // EU
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEA, UK, Switzerland
  "IS", "LI", "NO", "GB", "CH",
  // Brazil
  "BR",
]);

export function onRequestGet({ request }) {
  const country = request.cf?.country || null;
  return new Response(
    JSON.stringify({ consent_required: country ? CONSENT_COUNTRIES.has(country) : false }),
    { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }
  );
}
