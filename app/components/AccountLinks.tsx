import { useTranslation } from "react-i18next";

import { AccountAvatar } from "~/components/AccountAvatar";

/**
 * The links of the account of a signed-in person, as list items: the profile (SAG-114), the lists, the
 * statistics (SAG-261: they left the row of the header to make room for "Trending"), settings, the
 * administration (only for an administrator, SAG-95) and sign-out. The account menu of a wide screen and the panel of the
 * menu of a phone (SAG-96) both show them, so they are written once. Each one is a plain anchor, so
 * it loads a whole new page: these pages have a security policy of their own, which only a new
 * document gets (ADR-018).
 */
export function AccountLinks({
  isAdmin,
  username = null,
  avatarUrl = null,
  withAvatar = false,
  itemClass,
}: {
  isAdmin: boolean;
  /** The username of the person, for the link to their profile (SAG-114). Without it there is none. */
  username?: string | null;
  /** The picture, or the initial, next to the link to the profile, on a phone (SAG-109, SAG-39). */
  avatarUrl?: string | null;
  /** Draws the picture or the initial next to the profile link: on a phone, where there is no button with it. */
  withAvatar?: boolean;
  itemClass: string;
}) {
  const { t } = useTranslation();

  return (
    <>
      {username ? (
        <li>
          <a href={`/u/${encodeURIComponent(username)}`} className={itemClass}>
            {withAvatar || avatarUrl ? (
              <span className="flex items-center gap-2">
                {/* The link says what it is, so a screen reader skips the picture. */}
                <AccountAvatar
                  avatarUrl={avatarUrl}
                  username={username}
                  alt={t("nav.profile")}
                  lazy
                />
                {t("nav.profile")}
              </span>
            ) : (
              t("nav.profile")
            )}
          </a>
        </li>
      ) : null}
      <li>
        <a href="/lists" className={itemClass}>
          {t("nav.lists")}
        </a>
      </li>
      <li>
        <a href="/stats" className={itemClass}>
          {t("nav.stats")}
        </a>
      </li>
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
