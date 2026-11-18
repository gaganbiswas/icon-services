import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Repair estimate',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function EstimateLayout({ children }: { children: ReactNode }) {
  return children;
}
