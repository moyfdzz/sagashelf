import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Route } from "./+types/account-restricted";
import { contactEmail } from "~/lib/legal";
import { linkClass, secondaryLinkClass, textLinkClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import { privateRouteHeaders } from "~server/http/cache";

export function loader({ context }: Route.LoaderArgs) {
  const { t } = getInstance(context);
  return { title: t("app.pageTitle", { title: t("restricted.title") }) };
}

// The page tells nobody anything about a person: it is the same for every restricted account, and
// it is not kept by a shared cache nor indexed.
export const headers = privateRouteHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/**
 * Where a suspended or banned person lands (SAG-148, ADR-040): what happened, where to write and a
 * way to sign out. A plain anchor to the sign-out, as every link to a session page (ADR-018).
 */
export default function AccountRestricted() {
  const { t } = useTranslation();

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold">{t("restricted.title")}</h1>
      <p className="mt-4">{t("restricted.body")}</p>
      <p className="mt-4">
        {t("restricted.contact")}{" "}
        <a href={`mailto:${contactEmail}`} className={textLinkClass}>
          {contactEmail}
        </a>
      </p>
      <p className="mt-4">
        <Link to="/community" className={linkClass}>
          {t("restricted.rules")}
        </Link>
      </p>
      <p className="mt-8">
        <a href="/sign-out" className={secondaryLinkClass}>
          {t("restricted.signOut")}
        </a>
      </p>
    </main>
  );
}
