import type { Metadata } from 'next';
import '../index.css';

export const metadata: Metadata = {
  title: 'Event Command Center',
  description: 'Operations dashboard for event teams.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&display=swap" />
      </head>
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
