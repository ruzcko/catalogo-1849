// Security headers for the responses the Functions build. book/_headers only applies to files served as they are,
// so a page a Function makes (the book with its link-preview tags set) gets the same headers here. Keep the two lists
// in step. The Content-Security-Policy is report-only for now: it hasn't been tried against the live book yet.
// The two sha256 hashes are book/index.html's inline scripts (the theme snippet and the importmap): change either
// script and its hash must change too.

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'sha256-bdyznYulzSGHB3rRO5uV1nvlyFAP4xEFMksag9Ti9zA=' 'sha256-mPI/Eg6Ea8jS5Iq3TsUhZ14M32IbLoYs/WxyLV6+Wb0=' https://cdn.jsdelivr.net/npm/three@0.169.0/ https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://apelyido.ruzcko.com https://*.apelyido.pages.dev",
  "font-src 'self'",
  "connect-src 'self' https://apelyido.ruzcko.com https://*.apelyido.pages.dev",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Content-Security-Policy-Report-Only": CSP,
};

// A copy of the response with the headers set (a response's own headers can be read-only).
export function secure(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(HEADERS)) out.headers.set(k, v);
  return out;
}
