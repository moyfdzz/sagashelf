/** A fresh, unguessable value for every HTML response (used by the CSP and by the page's own scripts). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Content Security Policy for HTML pages. Only the site's own origin is allowed,
 * plus scripts that carry this response's nonce. When a feature needs another
 * origin (Clerk, Turnstile, the image proxy), add exactly that origin to the
 * one directive that needs it, in the ticket that introduces the feature.
 */
export function buildContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Used for responses that are not pages (JSON, redirects): nothing may load or embed them. */
const nonPageContentSecurityPolicy =
  "default-src 'none'; frame-ancestors 'none'";

/** Sent with every response. The same list lives in public/_headers for static files (a test keeps them equal). */
export const baseSecurityHeaders: Readonly<Record<string, string>> = {
  // Two years, subdomains included. Not submitted to the browser preload list.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function isHtml(headers: Headers): boolean {
  return (headers.get("Content-Type") ?? "")
    .toLowerCase()
    .startsWith("text/html");
}

/**
 * Adds the security headers to any response. A page's own CSP (with its nonce)
 * is set where the page is rendered and is never replaced here.
 */
export function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(baseSecurityHeaders)) {
    headers.set(name, value);
  }
  if (!headers.has("Content-Security-Policy") && !isHtml(headers)) {
    headers.set("Content-Security-Policy", nonPageContentSecurityPolicy);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
