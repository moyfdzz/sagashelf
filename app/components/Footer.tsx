import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="border-border mt-12 border-t">
      <nav
        aria-label={t("footer.label")}
        className="container mx-auto flex flex-wrap gap-x-6 gap-y-2 px-4 py-6"
      >
        <Link
          to="/privacy"
          className="text-fg-muted hover:text-accent underline"
        >
          {t("footer.privacy")}
        </Link>
        <Link to="/terms" className="text-fg-muted hover:text-accent underline">
          {t("footer.terms")}
        </Link>
      </nav>
    </footer>
  );
}
