import { Link } from "react-router";

type ErrorPageProps = {
  status: number;
  title: string;
  message: string;
};

export function ErrorPage({ status, title, message }: ErrorPageProps) {
  return (
    <main className="container mx-auto px-4 py-24 text-center">
      <title>{`${title} | SagaShelf`}</title>
      <p className="text-accent text-6xl font-bold">{status}</p>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <p className="text-fg-muted mt-2">{message}</p>
      <Link
        to="/"
        className="bg-accent text-accent-fg mt-8 inline-block rounded-md px-4 py-2 font-medium"
      >
        Back to home
      </Link>
    </main>
  );
}
