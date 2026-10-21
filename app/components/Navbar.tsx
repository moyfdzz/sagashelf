import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router";

import { LanguageSwitcher } from "~/components/LanguageSwitcher";

export function Navbar() {
  const { t } = useTranslation();
  const navItems = [{ label: t("nav.home"), to: "/" }];

  return (
    <header className="bg-surface-raised border-border border-b">
      <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-3">
        <Link to="/" className="text-accent text-2xl font-bold">
          {t("app.name")}
        </Link>
        <div className="flex items-center gap-4">
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
        </div>
      </div>
    </header>
  );
}
