# PoliGraph — Plan 4 : Cascade renforcée, vues `gold` et API GraphQL

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre les données consultables : une API GraphQL qui sert la fiche complète d'un député, adossée à des vues de lecture, et une cascade d'identité assez fine pour que la section financement cesse d'être vide sans jamais rattacher un compte à la mauvaise personne.

**Architecture:** Un niveau de confiance supplémentaire dans la cascade — élection puis mandat — que 604 rapprochements réels satisfont et que le cas Rousseau échoue, par construction. Puis des vues matérialisées `gold` rafraîchies en fin d'import, et un schéma GraphQL orienté fiche.

**Tech Stack:** inchangée, plus `@nestjs/graphql`, `@nestjs/apollo`, `@apollo/server`, `graphql`.

**Spec de référence:** `docs/superpowers/specs/2026-08-25-poligraph-fiche-depute-design.md` §8
**Plans précédents:** p1 fondations, p2 scrutins, p3 identité

---

## Le problème que ce plan résout

Après trois plans, une fiche de député est riche sur trois sections et vide sur une. Mesuré sur Xavier Breton, données réelles :

| Section | Contenu |
|---|---|
| Mandats | 5 |
| Groupe et commissions | 43 appartenances |
| Activité de vote | 2 769 positions |
| **Financement** | **0** |

**789 députés** ont un compte de campagne rapproché en `PROBABLE`, et aucun n'est rattaché. La CNCCFP ne publiant pas de date de naissance, la cascade ne peut pas atteindre `CONFIRMED`, et la spec (§7.5) interdit d'afficher un rattachement incertain.

La règle a bien joué son rôle — elle a empêché 856 fusions non prouvées. Mais telle quelle, elle vide une section sur six pour la totalité des fiches.

### La preuve manquante

Un député qui siège depuis 2022 dans la circonscription où un candidat du même nom s'est présenté en 2022 **est** ce candidat. Le mandat qui suit l'élection est la preuve que la date de naissance ne fournit pas.

Sauf si deux candidats du même nom se présentaient dans cette circonscription. C'est là que le cas Rousseau intervient.

### Ce que la règle donne, mesuré

Sur les 790 rapprochements `PROBABLE` de la CNCCFP :

| Critère | Cas |
|---|---|
| Total `PROBABLE` | 790 |
| Avec un mandat parlementaire débutant après le 19 juin 2022, même circonscription | 606 |
| **Et un seul candidat de ce nom dans cette circonscription** | **604** |

Les **2 cas écartés par l'unicité** sont exactement les deux Sandrine Rousseau, 9e circonscription de Paris, nuances `ECO` et `DVD`. La règle confirme 604 rattachements et refuse précisément celui qui attribuerait le compte d'une candidate battue à une députée en exercice.

Les 186 autres restent en arbitrage : candidats battus, ou élus dans une autre circonscription.

---

## Décisions de conception

1. **Le nouveau niveau s'insère entre la date de naissance et la circonscription seule.** Il est plus fort que `PROBABLE` — il apporte une corroboration indépendante — mais reste subordonné à un identifiant externe ou à une date de naissance.
2. **La cascade reste pure.** Elle reçoit les faits ; c'est l'appelant qui calcule l'unicité et fournit les mandats.
3. **`gold` est fait de vues matérialisées**, rafraîchies en fin d'import. Pas de tables dupliquées à synchroniser.
4. **Le schéma GraphQL est orienté fiche**, pas miroir des tables.
5. **La provenance reste interrogeable** : chaque objet porte ses sources, et une requête dédiée descend au champ.

---

## Task 1 : Le niveau « élection puis mandat » dans la cascade

**Files:**
- Modify: `packages/domain/src/identity-resolution.ts`
- Test: `packages/domain/tests/identity-resolution.test.ts`

- [ ] **Step 1 : Étendre les types**

`IdentityCandidate` gagne deux champs :

```ts
  /** Date de l'élection à laquelle se rapporte ce candidat, si la source en désigne une. */
  electionDate: string | null
  /** Vrai si un seul candidat de ce nom se présentait dans cette circonscription. */
  uniqueInDistrict: boolean
```

`KnownPerson` gagne :

```ts
  /** Mandats connus, pour corroborer une candidature par le mandat qui l'a suivie. */
  mandates: { territoryCode: string; startDate: string | null }[]
```

Les appels existants doivent être mis à jour : `electionDate: null`, `uniqueInDistrict: false`, `mandates: []` là où l'information n'existe pas. Le RNE ne rapporte pas d'élection ; seule la CNCCFP renseigne ces champs.

- [ ] **Step 2 : Écrire les tests qui échouent**

À ajouter à `packages/domain/tests/identity-resolution.test.ts` :

```ts
describe('resolveIdentity — niveau élection puis mandat', () => {
  const elu: KnownPerson = {
    personId: 'p-elu',
    matchKey: 'xavier|breton',
    birthDate: null,
    externalIds: [],
    districtCodes: ['01-1'],
    mandates: [{ territoryCode: '01-1', startDate: '2022-06-22' }],
  }

  it('confirme quand un mandat suit l’élection dans la même circonscription', () => {
    const verdict = resolveIdentity(
      {
        matchKey: 'xavier|breton',
        birthDate: null,
        externalIds: [],
        districtCode: '01-1',
        electionDate: '2022-06-19',
        uniqueInDistrict: true,
      },
      [elu],
    )

    expect(verdict.confidence).toBe('CONFIRMED')
    expect(verdict.autoMergeable).toBe(true)
    expect(verdict.evidence).toContain('ELECTED_MANDATE')
  })

  it('refuse de confirmer si deux candidats du même nom se présentaient', () => {
    // Cas réel : deux Sandrine Rousseau, 9e circonscription de Paris, en 2022.
    const verdict = resolveIdentity(
      {
        matchKey: 'xavier|breton',
        birthDate: null,
        externalIds: [],
        districtCode: '01-1',
        electionDate: '2022-06-19',
        uniqueInDistrict: false,
      },
      [elu],
    )

    expect(verdict.confidence).toBe('PROBABLE')
    expect(verdict.autoMergeable).toBe(false)
  })

  it('refuse de confirmer si le mandat précède l’élection', () => {
    const ancien: KnownPerson = {
      ...elu,
      mandates: [{ territoryCode: '01-1', startDate: '2017-06-21' }],
    }
    const verdict = resolveIdentity(
      {
        matchKey: 'xavier|breton',
        birthDate: null,
        externalIds: [],
        districtCode: '01-1',
        electionDate: '2022-06-19',
        uniqueInDistrict: true,
      },
      [ancien],
    )

    expect(verdict.confidence).toBe('PROBABLE')
    expect(verdict.autoMergeable).toBe(false)
  })

  it('refuse de confirmer si le mandat porte sur une autre circonscription', () => {
    const ailleurs: KnownPerson = {
      ...elu,
      mandates: [{ territoryCode: '75-9', startDate: '2022-06-22' }],
    }
    const verdict = resolveIdentity(
      {
        matchKey: 'xavier|breton',
        birthDate: null,
        externalIds: [],
        districtCode: '01-1',
        electionDate: '2022-06-19',
        uniqueInDistrict: true,
      },
      [ailleurs],
    )

    expect(verdict.confidence).toBe('PROBABLE')
    expect(verdict.autoMergeable).toBe(false)
  })

  it('reste subordonné à la date de naissance quand elle est disponible', () => {
    // Une date de naissance discordante doit écarter, même avec un mandat corroborant.
    const verdict = resolveIdentity(
      {
        matchKey: 'xavier|breton',
        birthDate: '1990-01-01',
        externalIds: [],
        districtCode: '01-1',
        electionDate: '2022-06-19',
        uniqueInDistrict: true,
      },
      [{ ...elu, birthDate: '1962-11-25' }],
    )

    expect(verdict.confidence).toBe('UNMATCHED')
  })

  it('ne confirme pas si deux personnes connues ont toutes deux un mandat corroborant', () => {
    const autre: KnownPerson = { ...elu, personId: 'p-autre' }
    const verdict = resolveIdentity(
      {
        matchKey: 'xavier|breton',
        birthDate: null,
        externalIds: [],
        districtCode: '01-1',
        electionDate: '2022-06-19',
        uniqueInDistrict: true,
      },
      [elu, autre],
    )

    expect(verdict.autoMergeable).toBe(false)
    expect(verdict.confidence).toBe('AMBIGUOUS')
  })
})
```

- [ ] **Step 3 : Implémenter**

Le niveau s'insère **après** le niveau 2 (date de naissance) et **avant** le niveau 3 (circonscription seule), et opère sur les homonymes déjà élagués :

```ts
  // Niveau 2 bis — élection puis mandat.
  // Un député siégeant dans la circonscription où un candidat du même nom s'est
  // présenté, avec un mandat commençant après ce scrutin, EST ce candidat —
  // à condition qu'un seul candidat de ce nom s'y présentait. Deux homonymes
  // dans la même circonscription rendent la corroboration muette.
  if (candidate.districtCode && candidate.electionDate && candidate.uniqueInDistrict) {
    const corrobores = homonymes.filter((person) =>
      person.mandates.some(
        (mandat) =>
          mandat.territoryCode === candidate.districtCode &&
          mandat.startDate !== null &&
          mandat.startDate >= (candidate.electionDate as string),
      ),
    )
    if (corrobores.length === 1 && corrobores[0]) {
      return {
        confidence: 'CONFIRMED',
        personId: corrobores[0].personId,
        autoMergeable: true,
        evidence: ['NAME', 'DISTRICT', 'ELECTED_MANDATE'],
        alternatives: [],
      }
    }
    if (corrobores.length > 1) {
      return {
        confidence: 'AMBIGUOUS',
        personId: null,
        autoMergeable: false,
        evidence: ['NAME', 'DISTRICT', 'ELECTED_MANDATE'],
        alternatives: corrobores.map((person) => person.personId),
      }
    }
  }
```

Les comparaisons de dates se font sur des chaînes `YYYY-MM-DD`, dont l'ordre lexicographique coïncide avec l'ordre chronologique. C'est volontaire : la cascade reste pure et sans dépendance à un objet `Date`.

- [ ] **Step 4 : Lancer, vérifier, committer**

Expected: 6 nouveaux tests. Tous les tests existants doivent rester verts — si l'un change de comportement, **s'arrêter et le signaler** plutôt que de l'ajuster.

```bash
git commit -m "feat(domain): confirme une candidature par le mandat qui l'a suivie"
```

---

## Task 2 : Alimenter le nouveau niveau depuis la CNCCFP

**Files:**
- Modify: `packages/ingestion/src/identity/resolve-identity.ts`
- Modify: `packages/ingestion/src/adapters/cnccfp/normalize-cnccfp.ts`
- Modify: `packages/ingestion/src/adapters/rne/normalize-rne.ts`
- Tests: les fichiers correspondants

- [ ] **Step 1 : Enrichir l'index des personnes**

`buildKnownPersonIndex` doit désormais charger les mandats de chaque personne — code du territoire et date de début — en une requête, comme il le fait déjà pour les circonscriptions. Aucun N+1.

- [ ] **Step 2 : Calculer l'unicité par circonscription**

Avant la boucle de normalisation CNCCFP, construire une fois : `Map<'territoryCode|matchKey', number>` comptant les candidats de ce nom dans cette circonscription, **sur l'ensemble du fichier importé**, pas sur les seules lignes déjà traitées. Un candidat vu en ligne 10 et un autre en ligne 5 000 doivent tous deux savoir qu'ils sont deux.

- [ ] **Step 3 : Renseigner la date d'élection**

L'`Election` créée porte son année ; le fichier 2022 correspond au scrutin des 12 et 19 juin 2022. Utiliser la date du second tour, `2022-06-19`, comme borne : un mandat commençant à cette date ou après corrobore.

Le RNE passe `electionDate: null` et `uniqueInDistrict: false` — il ne rapporte pas de candidature.

- [ ] **Step 4 : Tests**

Sur la fixture CNCCFP :
- Xavier Breton, avec un mandat ensemencé au 2022-06-22 dans `01-1`, résout `CONFIRMED` et **sa candidature est rattachée** (`Candidacy.personId` non null).
- Les deux Sandrine Rousseau, avec des mandats ensemencés, restent non rattachées : `uniqueInDistrict` vaut faux pour les deux.
- Un candidat dont la personne n'a qu'un mandat antérieur à l'élection reste `PROBABLE`.

- [ ] **Step 5 : Rejouer sur les données réelles**

```bash
pnpm --filter @poligraph/api cli import cnccfp:comptes --renormalize
```

Attendu, mesuré : **604 rapprochements passent en `CONFIRMED`** et autant de candidatures se rattachent. Rapporter les chiffres réels. Un écart notable doit être expliqué, pas absorbé.

Vérifier ensuite qu'aucune des deux Sandrine Rousseau n'est rattachée, et que le nombre de personnes reste 3 119.

---

## Task 3 : Vues `gold`

**Files:**
- Create: `packages/db/prisma/migrations/…` (SQL manuel)
- Create: `packages/ingestion/src/gold/refresh.ts`

Prisma ne gère pas les vues matérialisées ; elles se créent en SQL dans une migration écrite à la main.

- [ ] **Step 1 : `gold.deputy_card`**

Une ligne par député de la 17e législature : identité, circonscription, groupe courant, et les agrégats qu'une fiche affiche en tête — nombre de mandats, de commissions, de votes, part de participation aux scrutins de la législature.

Les agrégats sont des données **calculées**, pas officielles. La vue doit porter une colonne permettant à l'interface de les présenter comme telles (§5.7 de la spec).

- [ ] **Step 2 : `gold.deputy_vote`**

Une ligne par position de vote d'un député, jointe au scrutin : date, intitulé, position, groupe au moment du vote, mode de publication du scrutin. C'est la vue qui alimente l'onglet « activité de vote », paginée.

- [ ] **Step 3 : `refreshGold()`**

Rafraîchit les vues, appelé en fin d'import par la CLI. Une commande `poligraph gold refresh` l'expose aussi seule.

- [ ] **Step 4 : Mesurer**

Rapporter le temps de rafraîchissement sur les données réelles (2,46 millions de positions). S'il dépasse la minute, le signaler : une vue trop lente à rafraîchir finit par ne plus l'être.

---

## Task 4 : Schéma GraphQL

**Files:**
- Create: `apps/api/src/graphql/*`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1 : Dépendances et module**

```bash
pnpm --filter @poligraph/api add @nestjs/graphql @nestjs/apollo @apollo/server graphql
```

Approche code-first. Le serveur GraphQL cohabite avec la CLI dans la même application : `main.ts` distingue le mode serveur du mode commande.

- [ ] **Step 2 : Le schéma**

Conforme à la spec §8.1 :

```graphql
type Query {
  deputy(slug: String!): Deputy
  deputies(legislature: Int, groupId: ID, departmentCode: String,
           first: Int, after: String): DeputyConnection!
  search(query: String!, first: Int): [SearchHit!]!
  provenance(entityType: String!, entityId: ID!, field: String): [ProvenanceRecord!]!
}
```

`Deputy` expose identité, mandats, appartenances, commissions, positions de vote paginées en connexion Relay, synthèse de vote, candidatures et sources.

Le slug est bâti sur l'identifiant AN : `/deputes/pa721234-xavier-breton`. Les homonymes existent — un slug nominal en écraserait un.

- [ ] **Step 3 : Garde-fous**

Limite de profondeur, limite de complexité, limitation de débit. Une API GraphQL publique sans ces trois-là est une invitation au déni de service par requête imbriquée.

- [ ] **Step 4 : Tests**

Sur base ensemencée : la fiche d'un député renvoie ses mandats et ses votes ; la pagination des votes fonctionne ; `provenance` descend jusqu'à la ligne bronze ; une requête trop profonde est refusée.

---

## Task 5 : Vérification sur données réelles

- [ ] Interroger l'API pour Xavier Breton et rapporter la réponse complète.
- [ ] Vérifier que les six sections de la fiche sont alimentées, **financement compris**.
- [ ] Vérifier qu'un député dont le compte n'est pas rattaché affiche une absence explicite, pas un zéro.
- [ ] Mesurer le temps de réponse d'une fiche complète.
- [ ] Consigner les chiffres réels et committer.

---

## Critère d'achèvement du plan 4

- 604 candidatures rattachées, aucune Sandrine Rousseau parmi elles.
- Le nombre de personnes reste 3 119.
- Une requête GraphQL rend la fiche complète d'un député, ses six sections alimentées.
- Les données calculées sont distinguables des données officielles dans la réponse.
- `pnpm test` passe intégralement, sans accès réseau.

Le plan 5 (front Next.js) et le plan 6 (résultats électoraux data.gouv) partent de cet état.

---

## Validation des tests : la cause de l'instabilite, trouvee

**Symptome.** Pendant plusieurs heures, la suite d'integration complete de
`packages/ingestion` a echoue de facon erratique : entre 4 et 13 fichiers en
echec, **differents a chaque execution**, alors que chaque fichier passait
isolement. Les erreurs nommaient des internes Prisma
(`PrismaClientKnownRequestError`, `Can't reach database server`) et non des
valeurs attendues.

**Cause reelle.** `localhost` resout **en IPv6 d'abord** (`::1`, puis
`127.0.0.1`). Docker Desktop ecoute sur les deux, mais son proxy IPv6 lache
sous charge soutenue. Toutes les connexions passant par `localhost` etaient
donc exposees a une coupure aleatoire.

**Correctif.** Forcer l'IPv4 dans les URL de connexion : `@127.0.0.1:5433` au
lieu de `@localhost:5433`. Applique a `.env.example` et au workflow CI.

**Resultat mesure.** La suite complete passe integralement :

```
Test Files  20 passed (20)
Tests      156 passed (156)
Duration   183.76s
```

Pistes ecartees en chemin, pour memoire : `connection_limit=1` **aggrave** le
probleme (13 fichiers en echec au lieu de 4, 520 s au lieu de 280) ; la memoire
n'etait pas en cause (38 Mo consommes sur 15,5 Go).

**Lecon.** Un echec dont la composition change a chaque execution designe
l'environnement, pas le code. Un agent a failli « corriger » un jeu de donnees
parfaitement correct avant que la vraie cause ne soit trouvee : distinguer un
echec de connexion (qui nomme des internes) d'un echec d'assertion (qui nomme
une valeur attendue et une valeur recue) evite de reparer ce qui n'est pas
casse.
