import { useTranslation } from "react-i18next";

const linkClass =
  "text-fg-muted hover:text-accent focus-visible:outline-accent rounded-md px-3 py-2 font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Jumps to the sections of the settings page. It wraps on a narrow screen instead of scrolling
 * sideways. The ids it points to are on the sections of `settings.profile`.
 */
export function SettingsNav() {
  const { t } = useTranslation();
  const sections = [
    { id: "profile", label: t("settings.nav.profile") },
    { id: "data", label: t("settings.nav.data") },
    { id: "delete", label: t("settings.nav.delete") },
  ];

  return (
    <nav aria-label={t("settings.nav.label")} className="mt-6">
      <ul className="border-border flex flex-wrap gap-x-2 gap-y-1 border-b pb-2">
        {sections.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className={linkClass}>
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
