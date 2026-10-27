import { useTranslation } from "react-i18next";

import type { Route } from "./+types/privacy";
import { LegalList, LegalPage, LegalSection } from "~/components/LegalPage";
import { contactEmail } from "~/lib/legal";
import { getInstance } from "~/middleware/i18next";

export function loader({ context }: Route.LoaderArgs) {
  const { t } = getInstance(context);
  return {
    title: t("app.pageTitle", { title: t("privacy.title") }),
    description: t("privacy.description"),
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "description", content: loaderData?.description },
  ];
}

export default function Privacy() {
  const { t } = useTranslation();
  const email = contactEmail;

  return (
    <LegalPage title={t("privacy.title")} intro={t("privacy.intro")}>
      <LegalSection title={t("privacy.who.title")}>
        <p>{t("privacy.who.body", { email })}</p>
      </LegalSection>
      <LegalSection title={t("privacy.data.title")}>
        <p>{t("privacy.data.intro")}</p>
        <LegalList
          items={[
            t("privacy.data.account"),
            t("privacy.data.google"),
            t("privacy.data.profile"),
            t("privacy.data.technical"),
            t("privacy.data.analytics"),
          ]}
        />
      </LegalSection>
      <LegalSection title={t("privacy.not.title")}>
        <p>{t("privacy.not.body")}</p>
      </LegalSection>
      <LegalSection title={t("privacy.processors.title")}>
        <p>{t("privacy.processors.intro")}</p>
        <LegalList
          items={[
            t("privacy.processors.clerk"),
            t("privacy.processors.neon"),
            t("privacy.processors.cloudflare"),
          ]}
        />
        <p>{t("privacy.processors.outro")}</p>
      </LegalSection>
      <LegalSection id="cookies" title={t("privacy.cookies.title")}>
        <p>{t("privacy.cookies.body")}</p>
      </LegalSection>
      <LegalSection title={t("privacy.retention.title")}>
        <p>{t("privacy.retention.body")}</p>
      </LegalSection>
      <LegalSection title={t("privacy.rights.title")}>
        <p>{t("privacy.rights.body", { email })}</p>
      </LegalSection>
      <LegalSection title={t("privacy.age.title")}>
        <p>{t("privacy.age.body")}</p>
      </LegalSection>
      <LegalSection title={t("privacy.changes.title")}>
        <p>{t("privacy.changes.body")}</p>
      </LegalSection>
      <LegalSection title={t("privacy.contact.title")}>
        <p>{t("privacy.contact.body", { email })}</p>
      </LegalSection>
    </LegalPage>
  );
}
