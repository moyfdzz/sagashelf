import { useTranslation } from "react-i18next";

const linkClass =
  "text-fg-muted hover:text-accent focus-visible:outline-accent rounded-md px-3 py-2 font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Jumps to the sections of the settings page, and links to the notifications page (SAG-27). It wraps
 * on a narrow screen instead of scrolling sideways. The ids it points to are on the sections of
 * `settings.profile`; the notifications page is a plain link, as every link to a session page is
 * (ADR-018), and it is the only one that leaves the page.
 */
export function SettingsNav() {
  const { t } = useTranslation();
  const sections = [
    { href: "#profile", label: t("settings.nav.profile") },
    { href: "#data", label: t("settings.nav.data") },
    { href: "#delete", label: t("settings.nav.delete") },
    { href: "/settings/notifications", label: t("settings.nav.notifications") },
    { href: "/settings/people", label: t("settings.nav.people") },
  ];

  return (
    <nav aria-label={t("settings.nav.label")} className="mt-6">
      <ul className="border-border flex flex-wrap gap-x-2 gap-y-1 border-b pb-2">
        {sections.map((section) => (
          <li key={section.href}>
            <a href={section.href} className={linkClass}>
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
