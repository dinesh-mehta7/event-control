'use client';

import dynamic from 'next/dynamic';

// This legacy dashboard reads location, localStorage and document while it
// renders, so keep the existing client-side app mounted without server rendering.
const Dashboard = dynamic(() => import('../App'), { ssr: false });

export default function Page() {
  return <Dashboard />;
}
