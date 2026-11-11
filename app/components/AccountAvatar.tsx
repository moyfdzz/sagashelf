import { useTranslation } from "react-i18next";

import { avatarInitial } from "~/lib/avatar";

/**
 * The picture of the person, or a circle of the same size (28 px, so nothing moves) with the
 * initial of their username when there is no picture (SAG-39). The place where it is drawn gives
 * the accessible name, so a screen reader skips it. `alt` is the name of that place.
 */
export function AccountAvatar({
  avatarUrl = null,
  username = null,
  alt,
  lazy = false,
}: {
  avatarUrl?: string | null;
  username?: string | null;
  alt: string;
  lazy?: boolean;
}) {
  const { t } = useTranslation();
  const initial = username ? avatarInitial(username) : "";
  if (!avatarUrl && !initial) return null;

  return (
    <span aria-hidden="true" className="shrink-0">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={alt || t("nav.account")}
          width={28}
          height={28}
          loading={lazy ? "lazy" : undefined}
          className="size-7 rounded-full object-cover"
        />
      ) : (
        <span
          data-avatar-initial
          className="bg-accent text-accent-fg flex size-7 items-center justify-center rounded-full text-sm font-bold"
        >
          {initial}
        </span>
      )}
    </span>
  );
}
