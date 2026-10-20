import { Search } from "lucide-react";
import { useState } from "react";

export const searchCategories = ["Anime", "Series", "Movies", "Books"] as const;
export type SearchCategory = (typeof searchCategories)[number];

type SearchBarProps = {
  onSearch: (category: SearchCategory, title: string) => void;
};

export function SearchBar({ onSearch }: SearchBarProps) {
  const [category, setCategory] = useState<SearchCategory>("Anime");
  const [title, setTitle] = useState("");

  return (
    <form
      className="container mx-auto px-4 py-8"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(category, title.trim());
      }}
    >
      <div className="mb-4 flex justify-center gap-2">
        {searchCategories.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
            className={`border-b-2 px-4 py-2 text-lg font-semibold transition-colors ${
              category === item
                ? "border-accent text-accent"
                : "text-fg-muted hover:text-accent border-transparent"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2">
        <input
          type="search"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label={`Search ${category}`}
          placeholder={`Type to find ${category}`}
          className="bg-surface-raised border-border placeholder:text-fg-muted focus:ring-accent w-full max-w-xl rounded-md border px-4 py-2 focus:ring-2 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Search"
          className="text-fg-muted hover:text-accent rounded-md p-2 transition-colors"
        >
          <Search />
        </button>
      </div>
    </form>
  );
}
