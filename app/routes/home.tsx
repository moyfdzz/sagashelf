export function meta() {
  return [
    { title: "SagaShelf" },
    {
      name: "description",
      content:
        "Search and track anime, movies, series, books and manga, with sagas that group every format of a story.",
    },
  ];
}

export default function Home() {
  return (
    <main className="container mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold">SagaShelf</h1>
      <p className="text-fg-muted mt-4 max-w-2xl text-lg">
        Search and track anime, movies, series, books and manga. Sagas group
        every format of a story in one place.
      </p>
    </main>
  );
}
