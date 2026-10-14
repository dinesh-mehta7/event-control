import type { Metadata } from 'next';
import '../index.css';

export const metadata: Metadata = {
  title: 'Event Command Center',
  description: 'Operations dashboard for event teams.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
