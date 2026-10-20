import { UserPlus, LogIn, LogOut, Lock } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useUserStore } from "../stores/useUserStore";

const Navbar = () => {
  const { user, logout } = useUserStore();
  const isAdmin = user?.role === "admin";

  const location = useLocation();

  const navItems = [
    { label: "Home", link: "/" },
    { label: "Profile", link: "/profile-section" },
    { label: "Anime", link: "/anime-section" },
    { label: "Series", link: "/series-section" },
    { label: "Movies", link: "/movies-section" },
    { label: "Books", link: "/books-section" },
    { label: "Search", link: "/search-section" },
  ];

  return (
    <header className="fixed top-0 left-0 w-full bg-gray-900 bg-opacity-90 backdrop-blur-md shadow-lg z-40 transition-all duration-300 border-b border-blue-800">
      <div className="container mx-auto px-4 py-3">
        <div className="flex flex-wrap justify-between items-center">
          <Link
            to="/"
            className="text-2xl font-bold text-blue-400 items-center space-x-2 flex"
          >
            SagaShelf
          </Link>

          <nav className="flex space-x-4">
            {navItems.map((navItem) => (
              <Link
                key={navItem.link}
                to={navItem.link}
                className={`text-lg font-semibold px-4 py-2 ${
                  location.pathname === navItem.link
                    ? "text-blue-400 border-blue-400"
                    : "text-gray-300 hover:text-blue-400"
                } transition duration-300`}
              >
                {navItem.label}
              </Link>
            ))}
          </nav>

          <div className="flex flex-wrap items-center gap-4">
            {isAdmin && (
              <Link
                className="bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded-md font-medium transition duration-300 ease-in-out flex items-center"
                to={"/secret-dashboard"}
              >
                <Lock className="inline-block mr-1" size={18} />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>
            )}

            {user ? (
              <button
                className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-md flex items-center transition duration-300 ease-in-out"
                onClick={logout}
              >
                <LogOut size={18} />
                <span className="hidden sm:inline ml-2">Log Out</span>
              </button>
            ) : (
              <>
                <Link
                  to={"/signup"}
                  className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md flex items-center transition duration-300 ease-in-out"
                >
                  <UserPlus className="mr-2" size={18} />
                  Sign Up
                </Link>
                <Link
                  to={"/login"}
                  className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-md flex items-center transition duration-300 ease-in-out"
                >
                  <LogIn className="mr-2" size={18} />
                  Login
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
