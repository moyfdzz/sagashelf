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
export function buildContentSecurityPolicy(
  nonce: string,
  clerkFrontendApi?: string,
  clerkUse: "auth" | "session" = "auth",
): string {
  if (clerkFrontendApi) {
    return clerkUse === "session"
      ? buildSessionContentSecurityPolicy(nonce, clerkFrontendApi)
      : buildAuthContentSecurityPolicy(nonce, clerkFrontendApi);
  }

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

/**
 * The CSP of the sign-in and sign-up pages only (SAG-10). Clerk's embedded components load
 * their code from the instance's Frontend API host, run a Cloudflare Turnstile and Clerk
 * Protect check, and style themselves at runtime, so these pages need the origins and the
 * `style-src 'unsafe-inline'` below. Every other page keeps the strict policy above.
 * Source: https://clerk.com/docs/guides/secure/best-practices/csp-headers (read 2026-10-21).
 */
function buildAuthContentSecurityPolicy(
  nonce: string,
  frontendApi: string,
): string {
  const fapi = `https://${frontendApi}`;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${fapi} https://challenges.cloudflare.com https://*.protect.clerk.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://img.clerk.com",
    "font-src 'self'",
    `connect-src 'self' ${fapi} https://*.protect.clerk.com:*`,
    "frame-src https://challenges.cloudflare.com https://*.protect.clerk.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** The only pages that embed Clerk's components, and so the only ones with the wider CSP. */
export function isAuthPage(pathname: string): boolean {
  return /^\/(sign-in|sign-up)(\/|$)/.test(pathname);
}

/**
 * Pages of a signed-in person where a form can stay open for a while. Clerk's session token
 * lasts 60 seconds and only Clerk's script renews it, so these pages load that script (with no
 * visible component) to keep the session alive, and get the narrow policy below. The sign-out
 * page (SAG-38) needs the same script to end the session, and the same origins. The library
 * (SAG-18) is here because its entry page has a form that can stay open, and so is the
 * administration (SAG-92), whose forms are edited for a while.
 */
export function isSessionPage(pathname: string): boolean {
  return /^\/(settings|sign-out|library|admin)(\/|$)/.test(pathname);
}

/**
 * The CSP of the pages in `isSessionPage` (SAG-12): the strict policy, plus the two origins that
 * Clerk's script needs to load and to renew the session, and `blob:` workers. There is nothing
 * to draw, so no inline styles, no images and no frames are added.
 * Source: https://clerk.com/docs/guides/secure/best-practices/csp-headers (read 2026-10-21).
 */
function buildSessionContentSecurityPolicy(
  nonce: string,
  frontendApi: string,
): string {
  const fapi = `https://${frontendApi}`;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${fapi}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${fapi}`,
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * The Frontend API host of a Clerk instance, which its publishable key encodes
 * (`pk_test_` + base64 of "host$"). Null when the key is not in that shape.
 */
export function clerkFrontendApiHost(publishableKey: string): string | null {
  const encoded = /^pk_(?:test|live)_(.+)$/.exec(publishableKey)?.[1];
  if (!encoded) return null;
  try {
    const host = atob(encoded);
    return /^[a-z0-9.-]+\$$/i.test(host) ? host.slice(0, -1) : null;
  } catch {
    return null;
  }
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
