import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <main>
      <h1>ICON INFOSYS SERVICE MANAGEMENT</h1>
      <p>Staff admin panel</p>
      <p className="muted">Foundation build. Staff sign-in will be added in Phase 2.</p>
    </main>
  );
}
