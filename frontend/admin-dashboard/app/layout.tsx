import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TrioTect Admin — IUT Cafeteria',
  description: 'Admin monitoring and chaos engineering dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
