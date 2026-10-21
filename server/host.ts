export const apexHost = "sagashelf.app";

/** `www.` is the same site as the apex domain: send visitors, and search engines, to one address. */
export function apexRedirectUrl(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (url.hostname !== `www.${apexHost}`) return null;
  return `https://${apexHost}${url.pathname}${url.search}`;
}
