import { useTranslation } from "react-i18next";

/**
 * The links of the account of a signed-in person, as list items: the profile (SAG-114), settings, the
 * administration (only for an administrator, SAG-95) and sign-out. The account menu of a wide screen and the panel of the
 * menu of a phone (SAG-96) both show them, so they are written once. Each one is a plain anchor, so
 * it loads a whole new page: these pages have a security policy of their own, which only a new
 * document gets (ADR-018).
 */
export function AccountLinks({
  isAdmin,
  username = null,
  itemClass,
}: {
  isAdmin: boolean;
  /** The username of the person, for the link to their profile (SAG-114). Without it there is none. */
  username?: string | null;
  itemClass: string;
}) {
  const { t } = useTranslation();

  return (
    <>
      {username ? (
        <li>
          <a href={`/u/${encodeURIComponent(username)}`} className={itemClass}>
            {t("nav.profile")}
          </a>
        </li>
      ) : null}
      <li>
        <a href="/settings/profile" className={itemClass}>
          {t("nav.settings")}
        </a>
      </li>
      {isAdmin ? (
        <li>
          <a href="/admin/sagas" className={itemClass}>
            {t("nav.admin")}
          </a>
        </li>
      ) : null}
      <li>
        <a href="/sign-out" className={itemClass}>
          {t("nav.signOut")}
        </a>
      </li>
    </>
  );
}
