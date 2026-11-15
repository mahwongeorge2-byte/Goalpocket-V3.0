import type { Metadata, Viewport } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-jakarta' });

export const metadata: Metadata = {
  title: 'Goalpocket',
  description: 'Know what is in every pocket. An AI money companion for cash, mobile money and two currencies.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0F6B4F' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body>{children}</body>
    </html>
  );
}
