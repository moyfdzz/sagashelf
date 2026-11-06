import { useTranslation } from "react-i18next";

import { linkClass } from "~/lib/ui";

/**
 * The two sections of the administration. Plain anchors: each one is a session page and has a
 * security policy of its own, which only a whole new document gets (ADR-018).
 */
export function AdminNav({ current }: { current: "sagas" | "moderation" }) {
  const { t } = useTranslation();
  const items = [
    { key: "sagas", href: "/admin/sagas", label: t("admin.nav.sagas") },
    {
      key: "moderation",
      href: "/admin/moderation",
      label: t("admin.nav.moderation"),
    },
  ] as const;

  return (
    <nav aria-label={t("admin.nav.label")} className="mb-6">
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {items.map((item) => (
          <li key={item.key}>
            <a
              href={item.href}
              className={linkClass}
              aria-current={item.key === current ? "page" : undefined}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
