/**
 * The address of a Discord webhook, and nothing else (SAG-27, ADR-029). The Worker will send a POST
 * to whatever address a person saves, so the address is the whole of the server-side request
 * forgery defence: only these two hosts, only this path, and the address that is saved is built from
 * the parts that were checked, never from the text that was typed.
 *
 * The two hosts and the path come from the ticket and from how Discord writes the address of a
 * webhook; the pages of Discord's documentation that were read (2026-11-02) do not list the hosts.
 * An address that is not exactly this is refused, even if Discord would answer it.
 */

const allowedHosts = new Set(["discord.com", "discordapp.com"]);

// /api/webhooks/<id>/<token>. The id is a number and the token uses URL-safe characters; the
// lengths are generous on purpose, so a change in how long Discord makes them does not refuse a
// good address.
const pathShape = /^\/api\/webhooks\/(\d{15,25})\/([A-Za-z0-9_-]{20,120})$/;

/** The longest address that is looked at. A real one is about 120 characters. */
export const maxWebhookUrlLength = 200;

export type DiscordWebhookUrl = {
  /** Built from the checked parts: always `https`, the host as it is, no port, query or fragment. */
  url: string;
  /** The id of the webhook, which is not a secret on its own (the token is). */
  id: string;
};

// A space, a control character or a backslash never belongs to the address. The URL parser would
// quietly turn some of them into something else (a backslash into a slash), so they are refused
// before it sees the text.
function hasForbiddenCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/** The checked address, or null when the text is not the address of a Discord webhook. */
export function parseDiscordWebhookUrl(
  input: string,
): DiscordWebhookUrl | null {
  const text = input.trim();
  if (text.length === 0 || text.length > maxWebhookUrlLength) return null;
  if (hasForbiddenCharacter(text)) return null;

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  // The parser lowercases the host and turns lookalike letters into `xn--`, so an exact match is a
  // match of the real name. A trailing dot, a subdomain and an address in numbers are all different.
  if (!allowedHosts.has(parsed.hostname)) return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.port !== "" || parsed.search !== "" || parsed.hash !== "") {
    return null;
  }
  const match = pathShape.exec(parsed.pathname);
  if (!match) return null;
  const [, id, token] = match;
  if (!id || !token) return null;
  return { url: `https://${parsed.hostname}/api/webhooks/${id}/${token}`, id };
}

/**
 * What the page shows of a saved address: the host, the id and the last four characters of the
 * token. The rest of the token is what lets anyone post in the channel, so it is never shown again
 * after it was saved, and never logged.
 */
export function maskWebhookUrl(url: string): string {
  const parsed = parseDiscordWebhookUrl(url);
  if (!parsed) return "…";
  const token = parsed.url.slice(parsed.url.lastIndexOf("/") + 1);
  return `https://${new URL(parsed.url).hostname}/api/webhooks/${parsed.id}/…${token.slice(-4)}`;
}
