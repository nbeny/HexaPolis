# HexaPolis

Monorepo pnpm + Turborepo : ingestion des données publiques de l'Assemblée
nationale (bronze → silver → gold), API GraphQL NestJS, front Next.js.

- `packages/db` — schéma Prisma et migrations (schémas `bronze`, `silver`, `gold`)
- `packages/domain` — règles métier pures
- `packages/ingestion` — adaptateurs de sources, étages du pipeline, vues gold
- `apps/api` — serveur GraphQL et CLI d'import
- `apps/web` — front Next.js

Les plans d'implémentation vivent dans `docs/superpowers/plans/`.

## Démarrer

```sh
cp .env.example .env
pnpm install
pnpm stack:up     # postgres, api et web
pnpm db:migrate
```

Le front est alors sur <http://localhost:30000>, l'API GraphQL sur
<http://localhost:30001/graphql>.

## La stack compose

Trois services, tous publiés dans la plage réservée au projet à partir de
30000 :

| Service | Hôte | Conteneur | Rôle |
| --- | --- | --- | --- |
| `web` | 30000 | 3100 | Next.js en `next dev` |
| `api` | 30001 | 4000 | serveur GraphQL |
| `postgres` | 30002 | 5432 | base de développement et base de test |

C'est une stack de **développement** : le monorepo est monté en bind mount et
les deux applications se rechargent à chaud. `apps/api/src` et `apps/web/src`
sont surveillés ; une modification dans `packages/*` demande en revanche un
`docker compose restart api`, car ces paquets sont importés par leur `dist/`,
construit une fois au démarrage du conteneur.

Trois points valent d'être connus avant de toucher à `docker-compose.yml` :

- **Les `node_modules` et les `dist` sont masqués par des volumes nommés.**
  Le bind mount expose l'arborescence de l'hôte, où les binaires natifs sont
  compilés pour Windows (`@swc/core`, les moteurs Prisma, le binaire SWC de
  Next) : inutilisables sous Linux. Le conteneur installe donc ses propres
  dépendances, isolées de celles de l'hôte.
- **L'API ne peut pas tourner sous `tsx`.** NestJS et `@nestjs/graphql`
  construisent le schéma à partir des métadonnées de `emitDecoratorMetadata`,
  qu'esbuild n'émet pas ; le serveur démarre puis meurt sur un
  `TypeError: Cannot read properties of undefined`. `docker/dev-api.sh` passe
  donc par `tsc --watch` plus `node --watch`, pour la même raison qui fait
  passer `apps/api/vitest.config.ts` par `unplugin-swc`.
- **Les watchers sont en scrutation.** Les bind mounts de Docker Desktop ne
  propagent aucun événement inotify depuis l'hôte Windows, d'où
  `CHOKIDAR_USEPOLLING`, `WATCHPACK_POLLING` et les options `--watchFile` de
  `tsc`.

Les variables d'environnement définies dans `docker-compose.yml` l'emportent
sur le `.env` racine monté avec le code : `process.loadEnvFile` ne remplace
jamais une variable déjà présente dans l'environnement. C'est ce qui permet au
conteneur de viser `postgres:5432` pendant que l'hôte vise `127.0.0.1:30002`.

## Commandes

| Commande | Effet |
| --- | --- |
| `pnpm build` / `pnpm typecheck` / `pnpm test` | via Turborepo |
| `pnpm build:seq` / `pnpm typecheck:seq` / `pnpm test:seq` | mêmes tâches sans Turborepo, en séquence |
| `pnpm stack:up` / `pnpm stack:down` / `pnpm stack:logs` | la stack complète |
| `pnpm db:up` | démarre Postgres seul, sans les applications |
| `pnpm db:migrate` | applique les migrations en développement |
| `pnpm db:status` | vérifie que la base est à jour |

### Si `turbo` refuse de démarrer sous Windows

`pnpm build`, `pnpm typecheck` et `pnpm test` peuvent échouer sur
`Error: spawn UNKNOWN` : Smart App Control (Windows 11) bloque le binaire
`turbo.exe`, qui n'est pas signé de manière reconnue. On le confirme en lançant
l'exécutable à la main — Windows répond alors « Une stratégie de contrôle
d'application a bloqué ce fichier » — ou en lisant l'état de la stratégie :

```powershell
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState
```

Une valeur de `1` signifie que la stratégie est appliquée. Les variantes `:seq`
existent pour ce cas : elles lancent les mêmes scripts de paquet via `pnpm -r`,
dans l'ordre topologique et sans parallélisme entre paquets. Elles ne
remplacent pas Turborepo — ni cache ni graphe de dépendances entre tâches —
mais elles couvrent l'ensemble du workspace. La CI tourne sous Linux et n'est
pas concernée.

## Base de test

Les suites de `packages/ingestion` partagent la base `poligraph_test`, créée
par `docker/init-test-db.sql` au premier démarrage du conteneur.
`fileParallelism` y est désactivé pour cette raison. Après un redémarrage du
conteneur, attendre `pg_isready` : la toute première requête reste lente et
peut faire expirer un hook de test.
