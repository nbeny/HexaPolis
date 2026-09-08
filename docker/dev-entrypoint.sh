#!/bin/sh
set -e

# Les dépendances vivent dans des volumes nommés, pas dans le bind mount. Elles
# survivent aux redémarrages, mais on repasse par pnpm à chaque démarrage pour
# rattraper un lockfile qui aurait bougé. `--frozen-lockfile` garantit qu'on ne
# dérive jamais du pnpm-lock.yaml versionné.
echo '[dev-entrypoint] pnpm install'
pnpm install --frozen-lockfile

# apps/api importe @poligraph/{db,domain,ingestion} par leur champ `main`,
# c'est-à-dire par leur dist/. Le `tsc --watch` de docker/dev-api.sh ne compile
# que apps/api : ces trois paquets doivent donc être construits avant que le
# serveur démarre. `@poligraph/db` enchaîne `prisma generate`, ce qui produit
# ici le moteur Prisma pour Linux — celui de l'hôte est un binaire Windows.
#
# Conséquence assumée : apps/api/src et apps/web/src sont rechargés à chaud,
# mais une modification dans packages/* demande un `docker compose restart api`.
if [ "${BUILD_WORKSPACE_LIBS:-0}" = '1' ]; then
  echo '[dev-entrypoint] build des paquets @poligraph/db, domain, ingestion'
  pnpm --filter @poligraph/db --filter @poligraph/domain --filter @poligraph/ingestion run build
fi

exec "$@"
