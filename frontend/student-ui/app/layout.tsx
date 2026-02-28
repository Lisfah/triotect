import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TrioTect Cafeteria — IUT',
  description: 'IUT Cafeteria digital ordering — fast, reliable, real-time.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
