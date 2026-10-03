import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const sans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'poof', template: '%s · poof' },
  description: 'Short-lived workers that split late work, and the numbers on when that helps.',
  applicationName: 'poof',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9f9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d0d' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-line bg-surface">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              poof
            </Link>
            <div className="flex gap-4 text-sm text-muted">
              <Link href="/" className="hover:text-foreground">
                Live
              </Link>
              <Link href="/results" className="hover:text-foreground">
                Results
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        <footer className="border-t border-line px-4 py-4 text-center text-xs text-faint">
          One small server, one box of workers, and everything measured.
        </footer>
      </body>
    </html>
  )
}
