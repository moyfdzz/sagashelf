import { useTranslation } from "react-i18next";

import type { Route } from "./+types/terms";
import { LegalList, LegalPage, LegalSection } from "~/components/LegalPage";
import { contactEmail } from "~/lib/legal";
import { getInstance } from "~/middleware/i18next";

export function loader({ context }: Route.LoaderArgs) {
  const { t } = getInstance(context);
  return {
    title: t("app.pageTitle", { title: t("terms.title") }),
    description: t("terms.description"),
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "description", content: loaderData?.description },
  ];
}

export default function Terms() {
  const { t } = useTranslation();
  const email = contactEmail;

  return (
    <LegalPage title={t("terms.title")} intro={t("terms.intro")}>
      <LegalSection title={t("terms.service.title")}>
        <p>{t("terms.service.body")}</p>
      </LegalSection>
      <LegalSection title={t("terms.account.title")}>
        <p>{t("terms.account.body")}</p>
      </LegalSection>
      <LegalSection title={t("terms.use.title")}>
        <p>{t("terms.use.intro")}</p>
        <LegalList
          items={[
            t("terms.use.harass"),
            t("terms.use.spam"),
            t("terms.use.piracy"),
            t("terms.use.abuse"),
            t("terms.use.impersonate"),
          ]}
        />
      </LegalSection>
      <LegalSection title={t("terms.content.title")}>
        <p>{t("terms.content.body")}</p>
      </LegalSection>
      <LegalSection title={t("terms.suspension.title")}>
        <p>{t("terms.suspension.body")}</p>
      </LegalSection>
      <LegalSection title={t("terms.liability.title")}>
        <p>{t("terms.liability.body")}</p>
      </LegalSection>
      <LegalSection title={t("terms.changes.title")}>
        <p>{t("terms.changes.body")}</p>
      </LegalSection>
      <LegalSection title={t("terms.contact.title")}>
        <p>{t("terms.contact.body", { email })}</p>
      </LegalSection>
    </LegalPage>
  );
}
