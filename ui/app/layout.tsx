import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from 'sonner'
import './globals.css'

export const viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
}

export const metadata: Metadata = {
  title: 'Voltgate | Multi-Account Control',
  description: 'Voltgate multi-account control for Claude, Antigravity, and Codex with failover routing',
  generator: 'v0.app',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-mono antialiased">
        {children}
        <Toaster richColors theme="dark" position="bottom-right" />
        <Analytics />
      </body>
    </html>
  )
}
