import {
  ChartColumn,
  ListChecks,
  LogOut,
  Settings,
  ShieldCheck,
  User,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AccountAvatar } from "~/components/AccountAvatar";

/**
 * The icon and the word of a link of the account (SAG-157). The icon sits in a box as wide as the
 * picture of the profile link (28 px), so the words of every row start at the same place, and it is
 * hidden from a screen reader because the word names the link.
 */
export function AccountItemLabel({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="flex w-7 shrink-0 justify-center">
        <Icon className="size-5" />
      </span>
      {children}
    </span>
  );
}

/**
 * The links of the account of a signed-in person, as list items: the profile (SAG-114), the lists, the
 * statistics (SAG-261: they left the row of the header to make room for "Trending"), settings, the
 * administration (only for an administrator, SAG-95) and sign-out, each with an icon (SAG-157). The account menu of a wide screen and the panel of the
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
              <AccountItemLabel icon={User}>
                {t("nav.profile")}
              </AccountItemLabel>
            )}
          </a>
        </li>
      ) : null}
      <li>
        <a href="/lists" className={itemClass}>
          <AccountItemLabel icon={ListChecks}>
            {t("nav.lists")}
          </AccountItemLabel>
        </a>
      </li>
      <li>
        <a href="/stats" className={itemClass}>
          <AccountItemLabel icon={ChartColumn}>
            {t("nav.stats")}
          </AccountItemLabel>
        </a>
      </li>
      <li>
        <a href="/settings/profile" className={itemClass}>
          <AccountItemLabel icon={Settings}>
            {t("nav.settings")}
          </AccountItemLabel>
        </a>
      </li>
      {isAdmin ? (
        <li>
          <a href="/admin/sagas" className={itemClass}>
            <AccountItemLabel icon={ShieldCheck}>
              {t("nav.admin")}
            </AccountItemLabel>
          </a>
        </li>
      ) : null}
      <li>
        <a href="/sign-out" className={itemClass}>
          <AccountItemLabel icon={LogOut}>{t("nav.signOut")}</AccountItemLabel>
        </a>
      </li>
    </>
  );
}
