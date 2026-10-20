import { Link, NavLink } from "react-router";

const navItems = [{ label: "Home", to: "/" }];

export function Navbar() {
  return (
    <header className="bg-surface-raised border-border border-b">
      <div className="container mx-auto flex items-center justify-between px-4 py-3">
        <Link to="/" className="text-accent text-2xl font-bold">
          SagaShelf
        </Link>
        <nav aria-label="Main" className="flex gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-lg font-semibold transition-colors ${
                  isActive ? "text-accent" : "text-fg-muted hover:text-accent"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
