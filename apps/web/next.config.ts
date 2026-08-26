import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Le front lit l'API par le réseau, pas par import : aucun paquet du
  // monorepo n'est transpilé ici. Si un jour `@poligraph/domain` est importé
  // pour partager un type, il faudra l'ajouter à `transpilePackages`.
}

export default config
