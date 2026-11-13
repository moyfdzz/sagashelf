import { useTranslation } from "react-i18next";

import { tabClass } from "~/lib/ui";

/**
 * The sections of the statistics of the administration (SAG-26), one page each. Plain anchors, like
 * `AdminNav`: each page is a session page with a security policy of its own (ADR-018).
 */
export function StatsNav({
  current,
}: {
  current:
    "overview" | "traffic" | "favorites" | "content" | "webhooks" | "providers";
}) {
  const { t } = useTranslation();
  const items = [
    {
      key: "overview",
      href: "/admin/stats",
      label: t("admin.stats.nav.overview"),
    },
    {
      key: "traffic",
      href: "/admin/stats/traffic",
      label: t("admin.stats.nav.traffic"),
    },
    {
      key: "favorites",
      href: "/admin/stats/favorites",
      label: t("admin.stats.nav.favorites"),
    },
    {
      key: "content",
      href: "/admin/stats/content",
      label: t("admin.stats.nav.content"),
    },
    {
      key: "webhooks",
      href: "/admin/stats/webhooks",
      label: t("admin.stats.nav.webhooks"),
    },
    {
      key: "providers",
      href: "/admin/stats/providers",
      label: t("admin.stats.nav.providers"),
    },
  ] as const;

  return (
    <nav aria-label={t("admin.stats.nav.label")} className="mt-6">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const active = item.key === current;
          return (
            <li key={item.key}>
              <a
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={tabClass(active)}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
