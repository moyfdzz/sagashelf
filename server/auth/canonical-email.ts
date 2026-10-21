// Gmail ignores dots and everything after a plus sign, and googlemail.com is the same inbox.
const gmailDomains = new Set(["gmail.com", "googlemail.com"]);

// The longest address email allows (RFC 5321).
const maxLength = 254;

const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * An ASCII host name of two or more labels, each 1 to 63 characters of letters, digits and
 * hyphens that do not start or end with a hyphen. The URL parser does not enforce this, and it
 * turns things like `127.1` into an IP address, so a name whose last label is only digits is out.
 */
function isDomainName(domain: string): boolean {
  if (domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => dnsLabel.test(label))) return false;
  return !/^\d+$/.test(labels[labels.length - 1] ?? "");
}

/**
 * The form of an address that is compared and stored as unique (`users.email_canonical`), so one
 * inbox cannot register many accounts. Returns `null` when the address cannot be a real one.
 *
 * - trimmed, Unicode NFKC (full-width letters become plain letters), lowercase
 * - the domain in its ASCII form (IDN to punycode), without a trailing dot
 * - Gmail and Googlemail: one domain, no dots, nothing after a `+` in the name, and only ASCII
 *   (Gmail has no other kind of name, so a look-alike character means another address, not the same inbox)
 *
 * The address used for sending is kept as typed, in Clerk; this value is only for comparing.
 */
export function canonicalEmail(address: string): string | null {
  const normalized = address
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFKC");
  if (normalized.length === 0 || normalized.length > maxLength) return null;

  const at = normalized.lastIndexOf("@");
  if (at < 1 || at === normalized.length - 1) return null;
  let name = normalized.slice(0, at);
  const rawDomain = normalized.slice(at + 1).replace(/\.$/, "");
  if (name.includes("@") || /\s/.test(normalized)) return null;

  // The WHATWG URL parser applies IDNA: it returns the punycode form and rejects invalid hosts.
  let domain: string;
  try {
    domain = new URL(`http://${rawDomain}`).hostname;
  } catch {
    return null;
  }
  if (!isDomainName(domain)) return null;

  if (gmailDomains.has(domain)) {
    // eslint-disable-next-line no-control-regex -- the point is to detect anything outside ASCII
    if (/[^\u0000-\u007f]/.test(name)) return null;
    name = name.split("+")[0] ?? "";
    name = name.replaceAll(".", "");
    if (name.length === 0) return null;
    domain = "gmail.com";
  }

  return `${name}@${domain}`;
}
