import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { AppHeader } from '@/components/shell/AppHeader'
import './globals.css'

export const metadata: Metadata = {
  title: 'NewLeanSim',
  description: 'Simulador de procesos para demostrar principios Lean',
}

export const viewport: Viewport = {
  themeColor: '#0b0e14',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <div className="flex min-h-dvh flex-col">
            <AppHeader />
            <main className="flex-1">{children}</main>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
