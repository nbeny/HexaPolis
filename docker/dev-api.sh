#!/bin/sh
set -e

# NestJS et @nestjs/graphql construisent le schéma en lisant les métadonnées de
# type émises par `emitDecoratorMetadata` (apps/api/tsconfig.json). tsx compile
# avec esbuild, qui ne sait pas les émettre : le serveur démarre, puis meurt sur
# « TypeError: Cannot read properties of undefined (reading '0') » au moment de
# construire le schéma. C'est la même raison qui fait passer
# apps/api/vitest.config.ts par unplugin-swc plutôt que par le transformateur
# par défaut de vitest.
#
# On reste donc sur tsc, le seul compilateur du dépôt qui émette ces
# métadonnées : une passe de compilation, puis `tsc --watch` en arrière-plan et
# `node --watch` sur sa sortie.
cd /app/apps/api

# Les stratégies de surveillance par scrutation sont indispensables : src/ est
# un bind mount Windows, qui ne remonte aucun événement inotify. dist/, lui, est
# un volume nommé — `node --watch` y voit les événements normalement.
WATCH_FLAGS='--watchFile dynamicPriorityPolling --watchDirectory dynamicPriorityPolling'

echo '[dev-api] compilation initiale'
pnpm exec tsc -p tsconfig.json

echo '[dev-api] tsc --watch en arrière-plan, puis node --watch'
# shellcheck disable=SC2086
pnpm exec tsc -p tsconfig.json --watch --preserveWatchOutput $WATCH_FLAGS &

exec node --watch dist/main.js serve
