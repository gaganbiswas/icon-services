import type { Metadata } from 'next';

import { CustomerPortal } from './CustomerPortal';

export const metadata: Metadata = { title: 'My service requests — ICON INFOSYS' };

/** Signed-in customer area (cookie session, ADR 0012). */
export default function AccountPage() {
  return <CustomerPortal />;
}
