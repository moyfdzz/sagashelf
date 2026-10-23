import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router";

import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { LogoMark } from "~/components/LogoMark";
import { ThemeSwitch } from "~/components/ThemeSwitch";
import type { Theme } from "~/lib/theme";

export function Navbar({ savedTheme }: { savedTheme: Theme | null }) {
  const { t } = useTranslation();
  const navItems = [{ label: t("nav.home"), to: "/" }];

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
        </div>
      </div>
    </header>
  );
}
