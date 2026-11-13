import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";

import { CountBubble } from "~/components/CountBubble";
import { cappedCount } from "~/lib/badge";

/**
 * The link to the notifications of a signed-in person on the wide row (SAG-263): a bell, with the
 * number of things that wait for them hanging from its corner. On a phone the link is in the panel
 * of the menu, with its word, so this is drawn from 1280 px up only. It is a plain anchor, because
 * `/notifications` is a page of the session (ADR-018). The word is its name (and its tooltip), and
 * the number is part of the name, since the circle is hidden from a screen reader.
 */
export function NotificationBell({ unread }: { unread: number }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const active =
    pathname === "/notifications" || pathname.startsWith("/notifications/");
  const shown = cappedCount(unread);
  // One whole sentence per language, not two pieces put together: word order is the translator's.
  const name =
    unread > 0
      ? t("nav.notificationsPending", { shown })
      : t("nav.notifications");

  return (
    <a
      href="/notifications"
      title={t("nav.notifications")}
      aria-current={active ? "page" : undefined}
      className={`relative flex size-10 items-center justify-center rounded-md transition-colors focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2 ${
        active ? "text-accent" : "text-fg-muted hover:text-accent"
      }`}
    >
      <Bell aria-hidden="true" className="size-5" />
      {unread > 0 ? <CountBubble shown={shown} /> : null}
      <span className="sr-only">{name}</span>
    </a>
  );
}
