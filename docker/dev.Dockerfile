# Image de développement partagée par les services `api` et `web`.
#
# Elle ne contient volontairement aucun code applicatif : le monorepo est monté
# en bind mount au démarrage et l'entrypoint installe les dépendances dans le
# conteneur. C'est ce qui donne le rechargement à chaud, et surtout ce qui évite
# de réutiliser le node_modules de l'hôte : sous Windows il contient des
# binaires natifs win32 (@swc/core, les moteurs Prisma, le binaire SWC de Next)
# inexploitables sous Linux. docker-compose.yml masque donc chaque node_modules
# et chaque dist par un volume nommé.
#
# Node 22 plutôt que la 24 de l'hôte : c'est la version sur laquelle tourne la
# CI, et `engines` ne demande rien de plus.
FROM node:22-bookworm-slim

# OpenSSL est requis par le moteur de requêtes Prisma ; ca-certificates par les
# téléchargements de corepack et de pnpm.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

# La version de pnpm est celle du champ `packageManager` de la racine. On la
# fige à la construction pour ne pas dépendre d'un téléchargement au démarrage.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

COPY docker/dev-entrypoint.sh /usr/local/bin/dev-entrypoint.sh
RUN chmod +x /usr/local/bin/dev-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/dev-entrypoint.sh"]
