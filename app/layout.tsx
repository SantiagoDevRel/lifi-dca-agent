import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LiFi DCA Agent',
  description: 'Autonomous dollar-cost averaging on Base',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  )
}
