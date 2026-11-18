import { Outlet, createRootRoute } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return <Outlet />;
}

function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p className="muted">The page you requested does not exist.</p>
    </main>
  );
}
