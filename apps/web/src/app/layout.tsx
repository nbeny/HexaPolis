import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'PoliGraph — transparence parlementaire',
  description:
    "Fiches de transparence des députés, bâties uniquement sur des données publiques officielles.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white">
          <nav className="mx-auto flex max-w-4xl items-baseline gap-6 px-4 py-4">
            <Link href="/" className="text-lg font-semibold">
              PoliGraph
            </Link>
            <Link href="/deputes" className="text-sm text-stone-600 hover:text-stone-900">
              Députés
            </Link>
            <Link href="/carte" className="text-sm text-stone-600 hover:text-stone-900">
              Carte
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-4xl px-4 py-8 text-xs text-stone-500">
          Données publiques : Assemblée nationale, ministère de l&apos;Intérieur, CNCCFP, RNE.
          PoliGraph ne produit aucune analyse : les chiffres calculés sont signalés comme tels.
        </footer>
      </body>
    </html>
  )
}
