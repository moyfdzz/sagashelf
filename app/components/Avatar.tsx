import { useTranslation } from "react-i18next";

/**
 * The picture of a person, or the first letter of their name on the accent color. The name is
 * always written next to it, so a screen reader skips both.
 */
export function Avatar({
  name,
  url,
  size = "md",
}: {
  name: string;
  url: string | null;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const box = size === "sm" ? "size-10" : "size-12";
  const pixels = size === "sm" ? 40 : 48;
  return url ? (
    <span aria-hidden="true" className="shrink-0">
      <img
        src={url}
        alt={t("profile.avatarAlt", { name })}
        width={pixels}
        height={pixels}
        loading="lazy"
        className={`${box} rounded-full object-cover`}
      />
    </span>
  ) : (
    <div
      aria-hidden="true"
      className={`bg-accent text-accent-fg flex ${box} shrink-0 items-center justify-center rounded-full font-bold`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
