import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router";

import { AccountMenu } from "~/components/AccountMenu";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { LogoMark } from "~/components/LogoMark";
import { ThemeSwitch } from "~/components/ThemeSwitch";
import type { Theme } from "~/lib/theme";

const linkClass =
  "text-fg-muted hover:text-accent focus-visible:outline-accent rounded-md px-3 py-2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";

export function Navbar({
  savedTheme,
  signedIn,
  isAdmin = false,
}: {
  savedTheme: Theme | null;
  signedIn: boolean;
  /** An administrator also finds the administration in the account menu (SAG-95). */
  isAdmin?: boolean;
}) {
  const { t } = useTranslation();
  const navItems = [
    { label: t("nav.home"), to: "/" },
    { label: t("nav.search"), to: "/search" },
  ];

  return (
    <header data-chrome className="bg-surface-raised border-border border-b">
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <Link
          to="/"
          className="text-accent flex items-center gap-2 text-2xl font-bold"
        >
          <LogoMark className="h-8 w-8 shrink-0" />
          {t("app.name")}
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <nav aria-label={t("nav.label")} className="flex gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-lg font-semibold transition-colors ${
                    isActive ? "text-accent" : "text-fg-muted hover:text-accent"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <LanguageSwitcher />
          <ThemeSwitch saved={savedTheme} />
          {signedIn ? (
            <AccountMenu isAdmin={isAdmin} />
          ) : (
            // Plain anchors: the sign-in and sign-up pages have their own, wider security policy,
            // which only a new document gets.
            <div className="flex items-center gap-2">
              <a href="/sign-in" className={linkClass}>
                {t("nav.signIn")}
              </a>
              <a
                href="/sign-up"
                className="bg-accent text-accent-fg focus-visible:outline-accent rounded-md px-3 py-2 font-semibold transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t("nav.signUp")}
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
