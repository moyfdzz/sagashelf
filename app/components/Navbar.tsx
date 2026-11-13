import {
  Bell,
  House,
  Layers,
  Library,
  LogIn,
  Search,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation } from "react-router";

import { AccountItemLabel, AccountLinks } from "~/components/AccountLinks";
import { CountBubble } from "~/components/CountBubble";
import { NotificationBell } from "~/components/NotificationBell";
import { AccountMenu } from "~/components/AccountMenu";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { LogoMark } from "~/components/LogoMark";
import { ThemeSwitch } from "~/components/ThemeSwitch";
import { cappedCount } from "~/lib/badge";
import type { Theme } from "~/lib/theme";

const focusClass =
  "focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2";

const linkClass = (active: boolean) =>
  `flex items-center gap-2 rounded-md px-3 py-2 text-lg font-semibold transition-colors xl:px-2 xl:text-base 2xl:gap-1.5 2xl:text-lg ${focusClass} ${
    active ? "text-accent" : "text-fg-muted hover:text-accent"
  }`;

const authLinkClass = `text-fg-muted hover:text-accent rounded-md px-3 py-2 font-semibold transition-colors ${focusClass}`;

const signUpClass = `bg-accent text-accent-fg rounded-md px-3 py-2 font-semibold transition hover:brightness-95 ${focusClass}`;

const accountItemClass = `text-fg hover:bg-fg/10 block rounded-md px-3 py-2 font-semibold ${focusClass}`;

/**
 * The icon in front of a link of the row (SAG-157): drawn in the panel of a phone and from 1536 px,
 * where the row has room; from 1280 to 1535 px the links are words only. Hidden from a screen
 * reader, because the word names the link.
 */
function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Icon
      aria-hidden="true"
      className="size-5 shrink-0 xl:hidden 2xl:block 2xl:size-4"
    />
  );
}

/**
 * The header. From 1280 px up it is one row: the logo, the navigation links, the language and theme
 * switches and the account (a menu for a signed-in person, sign-in and sign-up for a visitor). On a
 * phone (SAG-96, SAG-104) it is one row too: the logo and the name on the left, and on the right the
 * language (`ES` and `EN`), the theme switch and the "Menu" button. The links, and the account ones
 * under a divider, are in a panel that button shows, which opens right under it. The links are
 * written once: the panel is a wrapper that wide screens draw as if it were not there
 * (`xl:contents`), which is why the order of the wide row is spelled out (`xl:order-*`).
 *
 * What fits was measured on 2026-11-03 (the Windows font of the development machine, so a phone
 * can differ by a few pixels): the logo and the name are 151 px, the language switch 69, the theme
 * switch 36, and the "Menu" button 96 with its word or 38 with only the icon, plus 16 px of gutter
 * on each side and 8 px between the pieces. With the word it needs 408 px, so the word is shown
 * from 420 px (a little room to spare). With only the icon it needs 350 px, so the row stays whole
 * from 360 px. Below that the switches go to a second row, as they did before SAG-104. The name of
 * the app keeps its size, and never shrinks or breaks, at any width.
 *
 * On the wide row (measured on 2026-11-04) the Spanish word "Notificaciones" with a count of three digits
 * needs 1274 px inside the 1248 px that 1280 gives, so the links have 8 px of padding on each side from
 * 1280 px up (12 px on a phone, where the panel needs the room to be tapped). "Social" (SAG-115) did
 * not fit in the 22 px that were left, so from 1280 px up the links are 16 px instead of 18. Measured
 * on 2026-11-05 with all of that, at 1280 px: one row, with about 16 px to spare in Spanish and 49 in
 * English. The row has the same width up to 1535 px. From 1536 px the row is 256 px wider, so the
 * links are 18 px again (SAG-139), with about 206 px to spare in Spanish and 243 in English, measured
 * on 2026-11-05. A picture in place of the word "Cuenta" (SAG-109) makes the account button 31 px
 * narrower in Spanish and 40 in English. A new link needs those measures again.
 *
 * "Trending" (SAG-261) took the place of "Statistics", which moved to the account links, because the
 * wide row has no room for one more link. Measured on 2026-11-12 by drawing the header and finding the
 * narrowest window where it stays on one row: the same width before and after the change, in Spanish
 * and in English, with 0, 5 and 150 notifications. The same measure found that on that machine the
 * Spanish row of a signed-in person with at least one unread notification already wraps to two rows
 * between 1280 and 1535 px (before this change too), which the numbers above do not say.
 *
 * Icons (SAG-157): each link has one in front of the word in the panel of a phone, and in the wide row
 * only from 1536 px; from 1280 to 1535 px the links are words only.
 *
 * The bell (SAG-263): on the wide row the link to the notifications is not a word but a bell, with the
 * count in a small circle over its corner (`NotificationBell`), at the end of the row next to the account.
 * The word stays in the panel of a phone. Measured on 2026-11-13 with the real scrollbar strip (15 px,
 * Chromium without `--hide-scrollbars`) and a signed-in person, free room in the row (the same with no
 * unread and with "99+", since the circle hangs over the corner): at 1280 px 96 px in Spanish and 124 in
 * English; at 1535 px 111 and 139; at 1536 px, with the icons, 139 and 169. Before the bell the room was
 * 13, 28 and 69 in Spanish with no unread, and the Spanish row with "99+" wrapped to two rows from 1280 to
 * 1535 px (from 1536 px it had room). The row has no more
 * room above 1536 px (the container stops there). A new link, or a larger icon, needs those measures
 * again. The icons of the account links are in `AccountLinks`; they are in a menu, so their width does
 * not matter.
 *
 * A signed-in person also has the link to their notifications (SAG-102) with the number of things
 * that wait for them: the unread notifications and the follow requests to answer (SAG-108). On the
 * wide row it is the bell (SAG-263, above); on a phone it is inside the panel with its word and a
 * pill with the number, so the "Menu" button carries that number too (a bubble over its corner, which
 * adds no width to the row, SAG-106) and its name says how many are pending.
 *
 * The panel closes with Escape (which gives the focus back to the button), with a click outside and
 * when the route changes, since the links to the router's pages do not load a new document.
 */
export function Navbar({
  savedTheme,
  signedIn,
  isAdmin = false,
  username = null,
  avatarUrl = null,
  unread: unreadCount = 0,
}: {
  savedTheme: Theme | null;
  signedIn: boolean;
  /** An administrator also finds the administration in the account links (SAG-95). */
  isAdmin?: boolean;
  /** The username of the person, for the link "Perfil" of the account (SAG-114). */
  username?: string | null;
  /** The picture of the person (SAG-109), for the account menu and the panel of a phone. */
  avatarUrl?: string | null;
  /** Unread notifications (SAG-102), 100 or more meaning "more than 99". Zero draws nothing. */
  unread?: number;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  // The route the panel was last looked at on: another route closes it.
  const [openOn, setOpenOn] = useState(pathname);
  if (openOn !== pathname) {
    setOpenOn(pathname);
    setOpen(false);
  }
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target))
        setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // A visitor has none, whatever the page was given.
  const unread = signedIn ? unreadCount : 0;
  // 99 is the most the header counts to; one more says "99+".
  const shown = cappedCount(unread);
  // The library and the notifications are session pages, so they are plain anchors (ADR-018) and
  // their highlight is read from the route. The other pages are the router's.
  const navItems: {
    icon: LucideIcon;
    label: string;
    to: string;
    session: boolean;
    badge: number;
    /** On the wide row it is a bell next to the account (SAG-263): the link is only in the panel. */
    phoneOnly?: boolean;
  }[] = [
    { icon: House, label: t("nav.home"), to: "/", session: false, badge: 0 },
    {
      icon: Search,
      label: t("nav.search"),
      to: "/search",
      session: false,
      badge: 0,
    },
    {
      icon: Layers,
      label: t("nav.sagas"),
      to: "/sagas",
      session: false,
      badge: 0,
    },
    {
      icon: TrendingUp,
      label: t("nav.trending"),
      to: "/trending",
      session: false,
      badge: 0,
    },
    ...(signedIn
      ? [
          {
            icon: Library,
            label: t("nav.library"),
            to: "/library",
            session: true,
            badge: 0,
          },
          {
            icon: Users,
            label: t("nav.social"),
            to: "/social",
            session: false,
            badge: 0,
          },
          {
            icon: Bell,
            label: t("nav.notifications"),
            to: "/notifications",
            session: true,
            badge: unread,
            phoneOnly: true,
          },
          {
            icon: Sparkles,
            label: t("nav.recommendations"),
            to: "/recommendations",
            session: false,
            badge: 0,
          },
        ]
      : []),
  ];

  return (
    <header data-chrome className="bg-surface-raised border-border border-b">
      <div className="container mx-auto flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 xl:gap-x-4">
        <Link
          to="/"
          className="text-accent mr-auto flex min-h-10 shrink-0 items-center gap-2 text-xl font-bold sm:text-2xl whitespace-nowrap xl:order-1 xl:mr-0"
        >
          <LogoMark className="h-8 w-8 shrink-0" />
          {t("app.name")}
        </Link>
        <div className="flex items-center gap-2 max-[360px]:order-3 max-[360px]:basis-full xl:order-3 xl:gap-4">
          <LanguageSwitcher />
          <ThemeSwitch saved={savedTheme} />
        </div>
        {/* The button and the panel share a box, so the panel opens right under the button. Wide
            screens draw neither the box nor the button, only the links of the panel. */}
        <div className="relative max-[360px]:order-2 xl:contents">
          <button
            ref={button}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className={`border-input-edge text-fg-muted hover:text-accent hover:bg-fg/10 flex min-h-10 items-center gap-2 rounded-md border px-2 py-2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 min-[420px]:px-3 xl:hidden ${focusClass}`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="size-5"
              fill="currentColor"
            >
              <path d="M3 5.25A.75.75 0 0 1 3.75 4.5h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 5.25Zm0 4.75a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 10Zm.75 4a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H3.75Z" />
            </svg>
            {/* Below 420 px only the icon is drawn; the word is still the name of the button. */}
            <span className="max-[420px]:sr-only">{t("nav.menu")}</span>
            {/* The count of what is unread, since the link is in the panel. It hangs over the corner,
                so it adds no width to the row. */}
            {unread > 0 ? (
              <>
                <CountBubble shown={shown} className="xl:hidden" />
                <span className="sr-only">{t("nav.pending", { shown })}</span>
              </>
            ) : null}
          </button>
          <div
            ref={panel}
            id={panelId}
            className={`border-border bg-surface-raised absolute top-full right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 rounded-md border p-2 shadow-lg xl:contents ${
              open ? "flex" : "hidden"
            }`}
          >
            <nav aria-label={t("nav.label")} className="xl:order-2 xl:ml-auto">
              <ul className="flex flex-col gap-1 xl:flex-row xl:gap-2">
                {navItems.map((item) => {
                  const active =
                    pathname === item.to ||
                    (item.to !== "/" && pathname.startsWith(`${item.to}/`));
                  return (
                    <li
                      key={item.to}
                      className={item.phoneOnly ? "xl:hidden" : undefined}
                    >
                      {item.session ? (
                        <a
                          href={item.to}
                          aria-current={active ? "page" : undefined}
                          className={linkClass(active)}
                        >
                          <NavIcon icon={item.icon} />
                          {item.label}
                          {item.badge > 0 ? (
                            <>
                              <span
                                aria-hidden="true"
                                className="bg-accent text-accent-fg inline-block min-w-6 rounded-full px-1.5 text-center text-sm font-bold"
                              >
                                {shown}
                              </span>
                              <span className="sr-only">
                                {t("nav.pending", { shown })}
                              </span>
                            </>
                          ) : null}
                        </a>
                      ) : (
                        <NavLink
                          to={item.to}
                          end
                          className={({ isActive }) => linkClass(isActive)}
                        >
                          <NavIcon icon={item.icon} />
                          {item.label}
                        </NavLink>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
            {/* On a phone the account is part of the panel, after a divider. */}
            <ul className="border-border flex flex-col gap-1 border-t pt-2 xl:hidden">
              {signedIn ? (
                <AccountLinks
                  isAdmin={isAdmin}
                  username={username}
                  avatarUrl={avatarUrl}
                  withAvatar
                  itemClass={accountItemClass}
                />
              ) : (
                <>
                  <li>
                    <a href="/sign-in" className={accountItemClass}>
                      <AccountItemLabel icon={LogIn}>
                        {t("nav.signIn")}
                      </AccountItemLabel>
                    </a>
                  </li>
                  <li>
                    <a href="/sign-up" className={accountItemClass}>
                      <AccountItemLabel icon={UserPlus}>
                        {t("nav.signUp")}
                      </AccountItemLabel>
                    </a>
                  </li>
                </>
              )}
            </ul>
          </div>
        </div>
        {/* Wide screens: the account is at the end of the row, as before. */}
        <div className="hidden xl:order-4 xl:flex xl:items-center xl:gap-2">
          {signedIn ? (
            <>
              <NotificationBell unread={unread} />
              <AccountMenu
                isAdmin={isAdmin}
                username={username}
                avatarUrl={avatarUrl}
              />
            </>
          ) : (
            // Plain anchors: the sign-in and sign-up pages have their own, wider security policy,
            // which only a new document gets.
            <div className="flex items-center gap-2">
              <a href="/sign-in" className={authLinkClass}>
                {t("nav.signIn")}
              </a>
              <a href="/sign-up" className={signUpClass}>
                {t("nav.signUp")}
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
