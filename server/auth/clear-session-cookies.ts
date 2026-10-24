// Clerk's cookies for the session token (`__session`) and for "someone is signed in"
// (`__client_uat`), with the suffix Clerk adds in some setups.
const sessionCookie = /^(__session|__client_uat)(_.+)?$/;

/**
 * `Set-Cookie` values that expire the session cookies the request carries. Once an account is
 * deleted its session token still verifies without a call to Clerk until it expires (60 seconds),
 * so the page that follows would still show the person as signed in. Each cookie is expired for
 * this host and for the site's parent domain, because Clerk's script may have set it on either.
 */
export function clearSessionCookies(request: Request): string[] {
  const names = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((pair) => pair.split("=")[0].trim())
    .filter((name) => sessionCookie.test(name));

  const labels = new URL(request.url).hostname.split(".");
  const parent = labels.length >= 2 ? labels.slice(-2).join(".") : null;
  const expire = "Path=/; Max-Age=0; Secure; SameSite=Lax";

  return [...new Set(names)].flatMap((name) => [
    `${name}=; ${expire}`,
    ...(parent ? [`${name}=; Domain=${parent}; ${expire}`] : []),
  ]);
}
