import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>ICON INFOSYS SERVICE MANAGEMENT</h1>
      <p>Customer service portal</p>
      <p>
        Track your computer, laptop, printer and monitor repairs, approve estimates, and download
        your invoices and receipts.
      </p>
      <p>
        <Link className="button-link" href="/account">
          Sign in to my service requests
        </Link>
      </p>
    </main>
  );
}
