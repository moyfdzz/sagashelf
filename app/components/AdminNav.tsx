import { useTranslation } from "react-i18next";

import { tabClass } from "~/lib/ui";

/**
 * The sections of the administration, as tabs like the types of the library. Plain anchors: each
 * one is a session page and has a security policy of its own, which only a whole new document
 * gets (ADR-018).
 */
export function AdminNav({
  current,
}: {
  current: "sagas" | "moderation" | "messages";
}) {
  const { t } = useTranslation();
  const items = [
    { key: "sagas", href: "/admin/sagas", label: t("admin.nav.sagas") },
    {
      key: "moderation",
      href: "/admin/moderation",
      label: t("admin.nav.moderation"),
    },
    {
      key: "messages",
      href: "/admin/messages",
      label: t("admin.nav.messages"),
    },
  ] as const;

  return (
    <nav aria-label={t("admin.nav.label")} className="mb-6">
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
