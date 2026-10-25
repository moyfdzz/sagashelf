import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useFormatters } from "~/lib/format";
import { legalUpdatedAt } from "~/lib/legal";

export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="text-fg-muted mt-2">
        {t("legal.updated", { date: formatDate(legalUpdatedAt) })}
      </p>
      <p className="mt-6 text-lg">{intro}</p>
      {children}
    </main>
  );
}

export function LegalSection({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-8">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-6">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
