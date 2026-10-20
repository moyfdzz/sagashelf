// Catch-all route: unmatched URLs render the 404 page from the root ErrorBoundary.
export function loader() {
  throw new Response("Not Found", { status: 404 });
}

export default function NotFound() {
  return null;
}
