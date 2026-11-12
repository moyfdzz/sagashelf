import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { Route } from "./+types/privacy";
import { LegalList, LegalPage, LegalSection } from "~/components/LegalPage";
import { contactEmail } from "~/lib/legal";
import { textLinkClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";

/** A link to the section on usage statistics, inside the sentence of the list of data. */
function SectionLink({ children }: { children?: ReactNode }) {
  return (
    <a href="#stats" className={textLinkClass}>
      {children}
    </a>
  );
}

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
            t("privacy.data.library"),
            t("privacy.data.viewings"),
            t("privacy.data.social"),
            t("privacy.data.reports"),
            t("privacy.data.contact"),
            t("privacy.data.technical"),
            <Trans
              key="analytics"
              i18nKey="privacy.data.analytics"
              components={{ stats: <SectionLink /> }}
            />,
          ]}
        />
      </LegalSection>
      <LegalSection id="stats" title={t("privacy.stats.title")}>
        <p>{t("privacy.stats.intro")}</p>
        <LegalList
          items={[
            t("privacy.stats.pages"),
            t("privacy.stats.source"),
            t("privacy.stats.time"),
            t("privacy.stats.search"),
            t("privacy.stats.steps"),
            t("privacy.stats.place"),
          ]}
        />
        <p>{t("privacy.stats.notStored")}</p>
        <p>{t("privacy.stats.visitor")}</p>
        <p>{t("privacy.stats.optOut")}</p>
        <p>{t("privacy.stats.keep")}</p>
      </LegalSection>
      <LegalSection id="profile" title={t("privacy.profile.title")}>
        <p>{t("privacy.profile.intro")}</p>
        <LegalList
          items={[
            t("privacy.profile.public"),
            t("privacy.profile.friends"),
            t("privacy.profile.private"),
          ]}
        />
        <p>{t("privacy.profile.rules")}</p>
        <p>{t("privacy.profile.requests")}</p>
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
            t("privacy.processors.github"),
            t("privacy.processors.sightengine"),
            t("privacy.processors.titles"),
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
