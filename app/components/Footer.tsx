import { useTranslation } from "react-i18next";
import { linkClass } from "~/lib/ui";
import { Link } from "react-router";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="border-border mt-12 border-t">
      <nav
        aria-label={t("footer.label")}
        className="container mx-auto flex flex-wrap gap-x-6 gap-y-2 px-4 py-6"
      >
        <Link to="/privacy" className={linkClass}>
          {t("footer.privacy")}
        </Link>
        <Link to="/terms" className={linkClass}>
          {t("footer.terms")}
        </Link>
        <Link to="/community" className={linkClass}>
          {t("footer.community")}
        </Link>
        <Link to="/credits" className={linkClass}>
          {t("footer.credits")}
        </Link>
      </nav>
    </footer>
  );
}
