import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Route } from "./+types/credits";
import { LegalList, LegalPage, LegalSection } from "~/components/LegalPage";
import { getInstance } from "~/middleware/i18next";

export function loader({ context }: Route.LoaderArgs) {
  const { t } = getInstance(context);
  return {
    title: t("app.pageTitle", { title: t("credits.title") }),
    description: t("credits.description"),
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "description", content: loaderData?.description },
  ];
}

function SourceLink({
  href,
  children,
}: {
  href: string;
  children?: ReactNode;
}) {
  return (
    <a href={href} rel="noreferrer" className="text-accent underline">
      {children}
    </a>
  );
}

export default function Credits() {
  const { t } = useTranslation();

  return (
    <LegalPage title={t("credits.title")} intro={t("credits.intro")}>
      <LegalSection title={t("credits.tmdb.title")}>
        <a href="https://www.themoviedb.org/" rel="noreferrer">
          <img
            src="/tmdb-logo.svg"
            alt={t("credits.tmdb.logoAlt")}
            width={245}
            height={18}
            className="h-auto max-w-full"
          />
        </a>
        {/* TMDB requires this exact wording, so it stays in English in both languages. */}
        <p lang="en">{t("credits.tmdb.notice")}</p>
        {/* In English the courtesy line is the notice itself, so it is not repeated. */}
        {t("credits.tmdb.noticeCourtesy") !== t("credits.tmdb.notice") ? (
          <p className="text-fg-muted">{t("credits.tmdb.noticeCourtesy")}</p>
        ) : null}
        <p>{t("credits.tmdb.body")}</p>
      </LegalSection>
      <LegalSection title={t("credits.openLibrary.title")}>
        <p>
          <Trans
            i18nKey="credits.openLibrary.body"
            components={{
              site: <SourceLink href="https://openlibrary.org/" />,
            }}
          />
        </p>
      </LegalSection>
      <LegalSection title={t("credits.mangadex.title")}>
        <p>
          <Trans
            i18nKey="credits.mangadex.body"
            components={{
              site: <SourceLink href="https://mangadex.org/" />,
            }}
          />
        </p>
      </LegalSection>
      <LegalSection title={t("credits.soon.title")}>
        <p>{t("credits.soon.intro")}</p>
        <LegalList
          items={[
            <Trans
              key="tvmaze"
              i18nKey="credits.soon.tvmaze"
              components={{
                site: <SourceLink href="https://www.tvmaze.com/" />,
              }}
            />,
            <Trans
              key="wikidata"
              i18nKey="credits.soon.wikidata"
              components={{
                site: <SourceLink href="https://www.wikidata.org/" />,
              }}
            />,
            <Trans
              key="googleBooks"
              i18nKey="credits.soon.googleBooks"
              components={{
                site: <SourceLink href="https://books.google.com/" />,
              }}
            />,
          ]}
        />
      </LegalSection>
      <LegalSection title={t("credits.nonCommercial.title")}>
        <p>{t("credits.nonCommercial.body")}</p>
      </LegalSection>
      <LegalSection title={t("credits.cookies.title")}>
        <p>
          <Trans
            i18nKey="credits.cookies.body"
            components={{
              site: (
                <Link to="/privacy#cookies" className="text-accent underline" />
              ),
            }}
          />
        </p>
      </LegalSection>
    </LegalPage>
  );
}
