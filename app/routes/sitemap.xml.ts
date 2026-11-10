import { listSagas } from "~server/db/sagas";
import { getDb } from "~server/runtime-env";
import { sitemapXml } from "~server/sitemap";

// The same for everybody and it changes only when a saga is published, so a shared cache may keep
// it for an hour.
const sitemapHeaders = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
};

/** The pages of the sagas, with an address on the apex domain. The rest of the site is not listed. */
export async function loader() {
  const sagas = await listSagas(await getDb(), { search: "", locale: "es" });
  return new Response(sitemapXml(sagas), { headers: sitemapHeaders });
}
