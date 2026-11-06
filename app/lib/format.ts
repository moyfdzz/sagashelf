import { useTranslation } from "react-i18next";

// Server and browser must print the same text while hydrating, so dates use a
// fixed time zone instead of each machine's own. Pass the user's zone once it is known.
export const defaultTimeZone = "UTC";

/**
 * The moderation panel is read by the owner in Monterrey, so its times are shown there (SAG-154,
 * ADR-042). A fixed zone keeps server and browser printing the same text. Mexico has no daylight
 * saving time since 2022, and the zone database would handle it if that changed. Every other page
 * stays in `defaultTimeZone`.
 */
export const adminTimeZone = "America/Monterrey";

export function formatDate(
  value: Date | number,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long" },
  timeZone: string = defaultTimeZone,
): string {
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(
    value,
  );
}

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** "Action, Drama and Mystery" / "Acción, Drama y Misterio": a list written the way the language writes it. */
export function formatList(values: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(values);
}

const relativeUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

/** "3 days ago" / "hace 3 días", choosing the unit that fits. `now` is injectable for tests. */
export function formatRelativeTime(
  value: Date | number,
  locale: string,
  now: Date | number = Date.now(),
): string {
  const diffSeconds = (Number(value) - Number(now)) / 1000;
  const [unit, secondsInUnit] = relativeUnits.find(
    ([, seconds]) => Math.abs(diffSeconds) >= seconds,
  ) ?? ["second", 1];

  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    Math.round(diffSeconds / secondsInUnit),
    unit,
  );
}

/** The same helpers, bound to the language the page is showing. */
export function useFormatters() {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return {
    formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
      formatDate(value, locale, options),
    /** A date and a time in the zone of the moderation panel: the one rule for its three lists. */
    formatPanelTime: (value: Date | number) =>
      formatDate(
        value,
        locale,
        { dateStyle: "medium", timeStyle: "short" },
        adminTimeZone,
      ),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      formatNumber(value, locale, options),
    formatRelativeTime: (value: Date | number) =>
      formatRelativeTime(value, locale),
    formatList: (values: readonly string[]) => formatList(values, locale),
  };
}
