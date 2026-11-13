import { apexHost } from "./host";

/** The characters that must not appear as they are inside an XML text. */
const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * The sitemap of the public pages of the sagas: the list and each published saga. Every address is
 * on the apex domain, never on `www.` or a preview host, so a search engine is given one address
 * for each page. A slug is lower case letters, digits and hyphens, but it is escaped anyway.
 */
export function sitemapXml(sagas: readonly { slug: string }[]): string {
  const base = `https://${apexHost}`;
  const urls = [
    "/sagas",
    "/trending",
    ...sagas.map((saga) => `/sagas/${saga.slug}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${escapeXml(`${base}${path}`)}</loc></url>`).join("\n")}
</urlset>
`;
}
