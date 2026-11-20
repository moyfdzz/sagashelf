import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BackLink } from "~/components/BackLink";

/**
 * The link back to where the person came from: the search, or the entry of the library. It is read
 * from the `Referer` of the first load. After a button of the library the loader runs again with
 * this very page as the `Referer`, and then the loader has none, so the link is kept here from
 * the first load. A new title (another `key`) starts again.
 */
export function WayBack({
  toSearch,
  toEntry,
}: {
  toSearch: string | null;
  toEntry: string | null;
}) {
  const { t } = useTranslation();
  const [first] = useState({ toSearch, toEntry });

  if (first.toSearch) {
    return (
      <p className="mb-6">
        <BackLink to={first.toSearch} router>
          {t("media.backToSearch")}
        </BackLink>
      </p>
    );
  }
  if (first.toEntry) {
    return (
      <p className="mb-6">
        {/* A plain link: the entry page has its own security policy, which only a new document
            gets. */}
        <BackLink to={first.toEntry}>{t("media.backToEntry")}</BackLink>
      </p>
    );
  }
  return null;
}
