import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation } from "react-router";

import { AccountLinks } from "~/components/AccountLinks";
import { AccountMenu } from "~/components/AccountMenu";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { LogoMark } from "~/components/LogoMark";
import { ThemeSwitch } from "~/components/ThemeSwitch";
import type { Theme } from "~/lib/theme";

const focusClass =
  "focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2";

const linkClass = (active: boolean) =>
  `block rounded-md px-3 py-2 text-lg font-semibold transition-colors ${focusClass} ${
    active ? "text-accent" : "text-fg-muted hover:text-accent"
  }`;

const authLinkClass = `text-fg-muted hover:text-accent rounded-md px-3 py-2 font-semibold transition-colors ${focusClass}`;

const signUpClass = `bg-accent text-accent-fg rounded-md px-3 py-2 font-semibold transition hover:brightness-95 ${focusClass}`;

const accountItemClass = `text-fg hover:bg-fg/10 block rounded-md px-3 py-2 font-semibold ${focusClass}`;

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
 * The panel closes with Escape (which gives the focus back to the button), with a click outside and
 * when the route changes, since the links to the router's pages do not load a new document.
 */
export function Navbar({
  savedTheme,
  signedIn,
  isAdmin = false,
}: {
  savedTheme: Theme | null;
  signedIn: boolean;
  /** An administrator also finds the administration in the account links (SAG-95). */
  isAdmin?: boolean;
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

  // The library is a session page, so it is a plain anchor (ADR-018) and its highlight is read from
  // the route. The other pages are the router's.
  const navItems = [
    { label: t("nav.home"), to: "/", session: false },
    { label: t("nav.search"), to: "/search", session: false },
    ...(signedIn
      ? [
          { label: t("nav.library"), to: "/library", session: true },
          { label: t("nav.stats"), to: "/stats", session: false },
          {
            label: t("nav.recommendations"),
            to: "/recommendations",
            session: false,
          },
        ]
      : []),
  ];

  return (
    <header data-chrome className="bg-surface-raised border-border border-b">
      <div className="container mx-auto flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 xl:gap-x-4">
        <Link
          to="/"
          className="text-accent mr-auto flex shrink-0 items-center gap-2 text-2xl font-bold whitespace-nowrap xl:order-1 xl:mr-0"
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
            className={`border-input-edge text-fg-muted hover:text-accent hover:bg-fg/10 flex items-center gap-2 rounded-md border px-2 py-2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 min-[420px]:px-3 xl:hidden ${focusClass}`}
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
                    <li key={item.to}>
                      {item.session ? (
                        <a
                          href={item.to}
                          aria-current={active ? "page" : undefined}
                          className={linkClass(active)}
                        >
                          {item.label}
                        </a>
                      ) : (
                        <NavLink
                          to={item.to}
                          end
                          className={({ isActive }) => linkClass(isActive)}
                        >
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
                <AccountLinks isAdmin={isAdmin} itemClass={accountItemClass} />
              ) : (
                <>
                  <li>
                    <a href="/sign-in" className={accountItemClass}>
                      {t("nav.signIn")}
                    </a>
                  </li>
                  <li>
                    <a href="/sign-up" className={accountItemClass}>
                      {t("nav.signUp")}
                    </a>
                  </li>
                </>
              )}
            </ul>
          </div>
        </div>
        {/* Wide screens: the account is at the end of the row, as before. */}
        <div className="hidden xl:order-4 xl:block">
          {signedIn ? (
            <AccountMenu isAdmin={isAdmin} />
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
