import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";

import { linkClass } from "~/lib/ui";
import type { Route } from "./+types/community";
import { LegalList, LegalPage, LegalSection } from "~/components/LegalPage";
import { contactEmail } from "~/lib/legal";
import { getInstance } from "~/middleware/i18next";

export function loader({ context }: Route.LoaderArgs) {
  const { t } = getInstance(context);
  return {
    title: t("app.pageTitle", { title: t("community.title") }),
    description: t("community.description"),
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "description", content: loaderData?.description },
  ];
}

export default function Community() {
  const { t } = useTranslation();
  const email = contactEmail;

  return (
    <LegalPage
      title={t("community.title")}
      intro={
        <Trans
          i18nKey="community.intro"
          components={{
            terms: <Link to="/terms" className={linkClass} />,
          }}
        />
      }
    >
      <LegalSection title={t("community.respect.title")}>
        <p>{t("community.respect.intro")}</p>
        <LegalList
          items={[
            t("community.respect.harass"),
            t("community.respect.discriminate"),
            t("community.respect.impersonate"),
          ]}
        />
      </LegalSection>
      <LegalSection title={t("community.content.title")}>
        <p>{t("community.content.intro")}</p>
        <LegalList
          items={[
            t("community.content.spam"),
            t("community.content.piracy"),
            t("community.content.private"),
          ]}
        />
      </LegalSection>
      <LegalSection title={t("community.spoilers.title")}>
        <p>{t("community.spoilers.body")}</p>
      </LegalSection>
      <LegalSection title={t("community.age.title")}>
        <p>{t("community.age.body")}</p>
      </LegalSection>
      <LegalSection title={t("community.report.title")}>
        <p>{t("community.report.body", { email })}</p>
      </LegalSection>
    </LegalPage>
  );
}
