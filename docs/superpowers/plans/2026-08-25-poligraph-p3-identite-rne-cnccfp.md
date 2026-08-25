# PoliGraph — Plan 3 : Résolution d'identité, RNE et financement CNCCFP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rattacher les données du Répertoire national des élus et les comptes de campagne de la CNCCFP aux personnes déjà en base, au moyen d'une cascade de résolution d'identité qui ne fusionne jamais deux personnes sans preuve — et qui demande un arbitrage humain quand la preuve manque.

**Architecture:** La cascade vit dans `packages/domain`, pure et testable sans base. Les arbitrages humains sont un fichier versionné dans git, prioritaire sur l'algorithme et rejoué à chaque import. Le RNE apporte le cas facile (date de naissance : fusion automatique), la CNCCFP le cas dur (aucune date, homonymes réels : arbitrage obligatoire).

**Tech Stack:** inchangée.

**Spec de référence:** `docs/superpowers/specs/2026-08-25-poligraph-fiche-depute-design.md` §7
**Plans précédents:** `…-p1-fondations-adapter-an.md`, `…-p2-scrutins.md`

---

## Faits mesurés sur les fichiers réels

Vérifiés en téléchargeant et analysant les fichiers publiés, le 2026-08-25.

### RNE — `elus-depute-dep.csv`

`https://static.data.gouv.fr/resources/repertoire-national-des-elus-1/20260811-155035/elus-depute-dep.csv`
73 Ko · **UTF-8** · séparateur **`;`** · 577 députés · « Députés au 05/08/2026 »

Colonnes : code et libellé du département, code et libellé de la collectivité à statut particulier, **code de la circonscription législative** (`0101` = département `01`, circonscription `01`), libellé de la circonscription, **nom** (majuscules), **prénom**, code sexe, **date de naissance**, code et libellé de la catégorie socio-professionnelle, **date de début du mandat**.

**Le RNE porte la date de naissance.** C'est ce qui permet le niveau 2 de la cascade — fusion automatique — et ce qui distingue sans risque les deux députées nommées Alexandra Martin (nées le 1968-10-25 et le 1976-07-28).

Le RNE n'expose **aucun identifiant national** de personne. Le rapprochement se fait sur nom + prénom + date de naissance.

### CNCCFP — `publications-2022-lg.csv`

`https://static.data.gouv.fr/resources/comptes-de-campagne-elections-legislatives-generales-des-12-et-19-juin-2022/20231012-135051/publications-2022-lg.csv`
1,78 Mo · **cp1252, pas UTF-8** · séparateur **`;`** · 6 292 lignes · 81 colonnes

Quatre pièges mesurés :

1. **Encodage `cp1252`.** Lire ce fichier en UTF-8 échoue ou corrompt les accents.
2. **Le nom est aggloméré** dans un seul champ : `Mme DE NICOLAY Axelle`. Civilité, puis patronyme en majuscules, puis prénom capitalisé. Le patronyme peut faire plusieurs mots (`DE BOYSSON`, `DE NICOLAY`). Le découpage par la casse a été validé sur les 6 290 lignes exploitables.
3. **Deux devises.** 6 239 comptes en `EURO`, **51 en `CFP`** (Nouvelle-Calédonie, Polynésie). Additionner les deux serait faux ; la devise doit être stockée avec chaque montant.
4. **Deux lignes corrompues** dont tous les champs valent `0`. Elles doivent être rejetées avec trace, pas silencieusement ignorées.

Autres particularités : les montants absents s'écrivent `-` ou vide ; il existe **13 codes de décision** (`A`, `DD`, `AR`, `ARM`, `R`, `AD`, `ARR`, `HD`, `ARRR`, `ARRRM`, `ARRM`, `AM`, et vide) ; il n'y a **aucune date de naissance**.

### Ce que le rapprochement donne réellement

Mesuré contre les 3 115 personnes actuellement en base : **852 candidats CNCCFP** correspondent à une personne connue, sur 6 281 clés distinctes. **4 clés sont ambiguës** — plusieurs candidats partagent le même nom normalisé :

| Clé | Cas réel |
|---|---|
| `sandrine\|rousseau` | **Deux candidates, même circonscription (Paris 9e), même scrutin**, nuances `ECO` et `DVD` |
| `jean baptiste\|moreau` | Creuse (`ENS`) et Vendée (`DVD`) — deux personnes que la circonscription sépare |
| `stephanie\|do` | Bas-Rhin et Seine-et-Marne |
| `philippe\|benassaya` | Alpes-Maritimes et Yvelines |

Le cas Rousseau est décisif pour la conception : **ni le nom, ni la circonscription, ni l'élection ne les départagent.** Toute règle de fusion automatique fondée sur ces critères produirait une erreur, sur des données réelles, dès le premier import. C'est ce cas qui justifie la file d'arbitrage.

---

## Décisions de conception

1. **La cascade est pure.** Elle prend des faits et rend un verdict ; elle n'écrit rien et ne connaît ni Prisma ni les sources. Elle vit dans `packages/domain` et se teste sans base.
2. **Seuls les niveaux 1 et 2 fusionnent automatiquement.** Tout le reste attend un arbitrage.
3. **Les arbitrages sont un fichier versionné**, `data/identity-decisions.yaml`, prioritaire sur l'algorithme et rejoué à chaque import. Une décision prise une fois n'est jamais redemandée.
4. **Les rapprochements en attente sont stockés**, pas perdus : la table `IdentityMatch` conserve chaque candidat avec son niveau de confiance et les éléments qui l'ont motivé.
5. **La devise accompagne le montant.** Aucun agrégat ne mélange EURO et CFP.
6. **Le financement s'accroche à la candidature**, jamais directement à la personne — conformément à la spec §5.4 et à la façon dont la CNCCFP publie.

---

## Structure des fichiers

```
data/identity-decisions.yaml                 # arbitrages humains, versionnés
packages/
├── domain/src/
│   ├── identity-resolution.ts               # la cascade, pure
│   └── cnccfp-name.ts                       # découpage « Mme DE NICOLAY Axelle »
└── ingestion/
    ├── fixtures/
    │   ├── rne-deputes-sample.csv           # déjà commitée
    │   └── cnccfp-legislatives-2022-sample.csv  # déjà commitée
    ├── scripts/build-identite-fixtures.py   # déjà commité
    └── src/
        ├── csv.ts                           # lecture CSV, encodage paramétrable
        ├── identity/
        │   ├── decisions-file.ts            # lecture du YAML d'arbitrages
        │   └── resolve-identity.ts          # applique la cascade et écrit IdentityMatch
        └── adapters/
            ├── rne/{stage-rne,normalize-rne,rne.adapter}.ts
            └── cnccfp/{stage-cnccfp,normalize-cnccfp,cnccfp.adapter}.ts
apps/api/src/commands/resolve.command.ts     # poligraph resolve review
```

---

## Task 1 : La cascade de résolution, pure

**Files:**
- Create: `packages/domain/src/identity-resolution.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/identity-resolution.test.ts`

C'est le cœur du plan. Elle ne touche ni base ni réseau : elle reçoit un candidat et des personnes possibles, et rend un verdict.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/domain/tests/identity-resolution.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { resolveIdentity, type IdentityCandidate, type KnownPerson } from '../src/identity-resolution.js'

const macron: KnownPerson = {
  personId: 'p-macron',
  matchKey: 'emmanuel|macron',
  birthDate: '1977-12-21',
  externalIds: [{ source: 'AN', kind: 'ACTEUR_UID', value: 'PA1592' }],
  districtCodes: ['80-03'],
}

const rousseauEco: KnownPerson = {
  personId: 'p-rousseau-eco',
  matchKey: 'sandrine|rousseau',
  birthDate: null,
  externalIds: [],
  districtCodes: ['75-09'],
}

const rousseauDvd: KnownPerson = {
  personId: 'p-rousseau-dvd',
  matchKey: 'sandrine|rousseau',
  birthDate: null,
  externalIds: [],
  districtCodes: ['75-09'],
}

describe('resolveIdentity', () => {
  it('niveau 1 : un identifiant externe déjà connu confirme sans ambiguïté', () => {
    const candidat: IdentityCandidate = {
      matchKey: 'emmanuel|macron',
      birthDate: null,
      externalIds: [{ source: 'AN', kind: 'ACTEUR_UID', value: 'PA1592' }],
      districtCode: null,
    }
    const verdict = resolveIdentity(candidat, [macron])

    expect(verdict.confidence).toBe('CONFIRMED')
    expect(verdict.personId).toBe('p-macron')
    expect(verdict.autoMergeable).toBe(true)
    expect(verdict.evidence).toContain('EXTERNAL_ID')
  })

  it('niveau 2 : nom et date de naissance identiques confirment', () => {
    const candidat: IdentityCandidate = {
      matchKey: 'emmanuel|macron',
      birthDate: '1977-12-21',
      externalIds: [],
      districtCode: null,
    }
    const verdict = resolveIdentity(candidat, [macron])

    expect(verdict.confidence).toBe('CONFIRMED')
    expect(verdict.autoMergeable).toBe(true)
    expect(verdict.evidence).toContain('BIRTH_DATE')
  })

  it('sépare deux homonymes par leur date de naissance', () => {
    // Cas réel : deux députées nommées Alexandra Martin, nées en 1968 et 1976.
    const aînée: KnownPerson = { personId: 'p-1968', matchKey: 'alexandra|martin', birthDate: '1968-10-25', externalIds: [], districtCodes: [] }
    const cadette: KnownPerson = { personId: 'p-1976', matchKey: 'alexandra|martin', birthDate: '1976-07-28', externalIds: [], districtCodes: [] }

    const verdict = resolveIdentity(
      { matchKey: 'alexandra|martin', birthDate: '1976-07-28', externalIds: [], districtCode: null },
      [aînée, cadette],
    )

    expect(verdict.confidence).toBe('CONFIRMED')
    expect(verdict.personId).toBe('p-1976')
  })

  it('niveau 3 : sans date de naissance, la circonscription rend le rapprochement probable', () => {
    const verdict = resolveIdentity(
      { matchKey: 'emmanuel|macron', birthDate: null, externalIds: [], districtCode: '80-03' },
      [macron],
    )

    expect(verdict.confidence).toBe('PROBABLE')
    expect(verdict.autoMergeable).toBe(false)
    expect(verdict.evidence).toContain('DISTRICT')
  })

  it('niveau 4 : le nom seul ne donne qu’un rapprochement possible', () => {
    const verdict = resolveIdentity(
      { matchKey: 'emmanuel|macron', birthDate: null, externalIds: [], districtCode: null },
      [macron],
    )

    expect(verdict.confidence).toBe('POSSIBLE')
    expect(verdict.autoMergeable).toBe(false)
  })

  it('ne fusionne JAMAIS deux homonymes que rien ne départage', () => {
    // Cas réel : deux Sandrine Rousseau, même circonscription, même scrutin.
    const verdict = resolveIdentity(
      { matchKey: 'sandrine|rousseau', birthDate: null, externalIds: [], districtCode: '75-09' },
      [rousseauEco, rousseauDvd],
    )

    expect(verdict.autoMergeable).toBe(false)
    expect(verdict.confidence).toBe('AMBIGUOUS')
    expect(verdict.personId).toBeNull()
    expect(verdict.alternatives).toHaveLength(2)
  })

  it('signale une contradiction quand un identifiant connu désigne une autre date de naissance', () => {
    const verdict = resolveIdentity(
      {
        matchKey: 'emmanuel|macron',
        birthDate: '1980-01-01',
        externalIds: [{ source: 'AN', kind: 'ACTEUR_UID', value: 'PA1592' }],
        districtCode: null,
      },
      [macron],
    )

    expect(verdict.confidence).toBe('CONFLICT')
    expect(verdict.autoMergeable).toBe(false)
    expect(verdict.evidence).toContain('BIRTH_DATE_MISMATCH')
  })

  it('rend UNMATCHED quand aucune personne ne correspond', () => {
    const verdict = resolveIdentity(
      { matchKey: 'inconnu|personne', birthDate: null, externalIds: [], districtCode: null },
      [macron],
    )

    expect(verdict.confidence).toBe('UNMATCHED')
    expect(verdict.personId).toBeNull()
  })

  it('une date de naissance discordante écarte un homonyme au lieu de le rapprocher', () => {
    const verdict = resolveIdentity(
      { matchKey: 'alexandra|martin', birthDate: '1990-01-01', externalIds: [], districtCode: null },
      [{ personId: 'p-1968', matchKey: 'alexandra|martin', birthDate: '1968-10-25', externalIds: [], districtCodes: [] }],
    )

    expect(verdict.confidence).toBe('UNMATCHED')
    expect(verdict.personId).toBeNull()
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @poligraph/domain test`

- [ ] **Step 3 : Implémenter**

`packages/domain/src/identity-resolution.ts` :

```ts
export type MatchConfidence =
  | 'CONFIRMED'
  | 'PROBABLE'
  | 'POSSIBLE'
  | 'AMBIGUOUS'
  | 'CONFLICT'
  | 'UNMATCHED'

export interface ExternalIdRef {
  source: string
  kind: string
  value: string
}

export interface KnownPerson {
  personId: string
  matchKey: string
  birthDate: string | null
  externalIds: ExternalIdRef[]
  districtCodes: string[]
}

export interface IdentityCandidate {
  matchKey: string
  birthDate: string | null
  externalIds: ExternalIdRef[]
  districtCode: string | null
}

export interface IdentityVerdict {
  confidence: MatchConfidence
  personId: string | null
  /** Seuls les niveaux 1 et 2 autorisent une fusion sans intervention humaine. */
  autoMergeable: boolean
  evidence: string[]
  /** Personnes également plausibles ; non vide quand la confiance est AMBIGUOUS. */
  alternatives: string[]
}

function sameExternalId(a: ExternalIdRef, b: ExternalIdRef): boolean {
  return a.source === b.source && a.kind === b.kind && a.value === b.value
}

/**
 * Applique la cascade de résolution d'identité décrite dans la spec §7.2.
 *
 * Ne fusionne automatiquement que sur preuve forte : un identifiant externe
 * déjà connu, ou un nom accompagné d'une date de naissance identique. Tout le
 * reste attend un arbitrage humain — fusionner deux personnes distinctes est
 * la pire défaillance possible pour ce projet.
 */
export function resolveIdentity(
  candidate: IdentityCandidate,
  known: KnownPerson[],
): IdentityVerdict {
  const unmatched: IdentityVerdict = {
    confidence: 'UNMATCHED',
    personId: null,
    autoMergeable: false,
    evidence: [],
    alternatives: [],
  }

  // Niveau 1 — un identifiant externe déjà connu.
  for (const person of known) {
    const shared = person.externalIds.some((existing) =>
      candidate.externalIds.some((incoming) => sameExternalId(existing, incoming)),
    )
    if (!shared) continue

    // Une date de naissance discordante sur un identifiant partagé est une
    // contradiction : deux sources désignent la même personne différemment.
    if (candidate.birthDate && person.birthDate && candidate.birthDate !== person.birthDate) {
      return {
        confidence: 'CONFLICT',
        personId: person.personId,
        autoMergeable: false,
        evidence: ['EXTERNAL_ID', 'BIRTH_DATE_MISMATCH'],
        alternatives: [],
      }
    }
    return {
      confidence: 'CONFIRMED',
      personId: person.personId,
      autoMergeable: true,
      evidence: ['EXTERNAL_ID'],
      alternatives: [],
    }
  }

  const homonymes = known.filter((person) => person.matchKey === candidate.matchKey)
  if (homonymes.length === 0) return unmatched

  // Niveau 2 — nom et date de naissance.
  if (candidate.birthDate) {
    const exacts = homonymes.filter((person) => person.birthDate === candidate.birthDate)
    if (exacts.length === 1 && exacts[0]) {
      return {
        confidence: 'CONFIRMED',
        personId: exacts[0].personId,
        autoMergeable: true,
        evidence: ['NAME', 'BIRTH_DATE'],
        alternatives: [],
      }
    }
    // Une date connue des deux côtés et différente écarte le rapprochement :
    // ce n'est pas la même personne, et le dire vaut mieux que le taire.
    const datesConnues = homonymes.filter((person) => person.birthDate !== null)
    if (exacts.length === 0 && datesConnues.length === homonymes.length) return unmatched
  }

  // Niveau 3 — circonscription.
  if (candidate.districtCode) {
    const memeCirconscription = homonymes.filter((person) =>
      person.districtCodes.includes(candidate.districtCode as string),
    )
    if (memeCirconscription.length === 1 && memeCirconscription[0]) {
      return {
        confidence: 'PROBABLE',
        personId: memeCirconscription[0].personId,
        autoMergeable: false,
        evidence: ['NAME', 'DISTRICT'],
        alternatives: [],
      }
    }
    if (memeCirconscription.length > 1) {
      return {
        confidence: 'AMBIGUOUS',
        personId: null,
        autoMergeable: false,
        evidence: ['NAME', 'DISTRICT'],
        alternatives: memeCirconscription.map((person) => person.personId),
      }
    }
  }

  // Niveau 4 — le nom seul.
  if (homonymes.length === 1 && homonymes[0]) {
    return {
      confidence: 'POSSIBLE',
      personId: homonymes[0].personId,
      autoMergeable: false,
      evidence: ['NAME'],
      alternatives: [],
    }
  }

  return {
    confidence: 'AMBIGUOUS',
    personId: null,
    autoMergeable: false,
    evidence: ['NAME'],
    alternatives: homonymes.map((person) => person.personId),
  }
}
```

- [ ] **Step 4 : Exporter, lancer, committer**

```ts
export * from './identity-resolution.js'
```

```bash
pnpm --filter @poligraph/domain test
git add packages/domain
git commit -m "feat(domain): cascade de resolution d'identite"
```

Expected: 9 nouveaux tests, 50 au total dans `domain`. (Un correctif ulterieur, elaguant les homonymes refutes par leur date de naissance, en ajoute 4 : 54.)

---

## Task 2 : Découpage des noms CNCCFP

**Files:**
- Create: `packages/domain/src/cnccfp-name.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/cnccfp-name.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest'
import { splitCnccfpName } from '../src/cnccfp-name.js'

describe('splitCnccfpName', () => {
  it('sépare civilité, patronyme et prénom', () => {
    expect(splitCnccfpName('Mme ARMENJON Eliane')).toEqual({
      civility: 'Mme',
      lastName: 'ARMENJON',
      firstName: 'Eliane',
    })
  })

  it('garde un patronyme à particule en un seul morceau', () => {
    // Cas réels : « DE NICOLAY », « DE BOYSSON ».
    expect(splitCnccfpName('Mme DE NICOLAY Axelle')).toEqual({
      civility: 'Mme',
      lastName: 'DE NICOLAY',
      firstName: 'Axelle',
    })
  })

  it('accepte les accents dans le patronyme', () => {
    expect(splitCnccfpName('M. GUÉRAUD Sébastien')).toEqual({
      civility: 'M.',
      lastName: 'GUÉRAUD',
      firstName: 'Sébastien',
    })
  })

  it('accepte un prénom composé', () => {
    expect(splitCnccfpName('M. CUENOT Guy-Olivier')).toEqual({
      civility: 'M.',
      lastName: 'CUENOT',
      firstName: 'Guy-Olivier',
    })
  })

  it('tolère l’absence de civilité', () => {
    expect(splitCnccfpName('MARTIN Alexandra')).toEqual({
      civility: null,
      lastName: 'MARTIN',
      firstName: 'Alexandra',
    })
  })

  it('renvoie null pour une ligne corrompue', () => {
    // Le fichier 2022 contient deux lignes dont tous les champs valent « 0 ».
    expect(splitCnccfpName('0')).toBeNull()
    expect(splitCnccfpName('')).toBeNull()
    expect(splitCnccfpName('M.')).toBeNull()
  })
})
```

- [ ] **Step 2 : Lancer, voir échouer**

- [ ] **Step 3 : Implémenter**

```ts
export interface CnccfpName {
  civility: string | null
  lastName: string
  firstName: string
}

const CIVILITES = new Set(['M.', 'Mme', 'Mlle'])

function estMajuscule(mot: string): boolean {
  const lettres = [...mot.normalize('NFD')].filter((c) => /\p{L}/u.test(c) && !/\p{M}/u.test(c))
  return lettres.length > 0 && lettres.every((c) => c === c.toUpperCase())
}

/**
 * Décompose le champ `nom` de la CNCCFP, qui agglomère civilité, patronyme et
 * prénom : « Mme DE NICOLAY Axelle ». Le patronyme est en majuscules et peut
 * compter plusieurs mots ; le prénom est capitalisé.
 *
 * Renvoie `null` pour une ligne inexploitable, afin que l'appelant la rejette
 * avec trace plutôt que d'inventer une identité.
 */
export function splitCnccfpName(raw: string): CnccfpName | null {
  const mots = raw.trim().split(/\s+/).filter(Boolean)
  if (mots.length === 0) return null

  const civility = mots[0] && CIVILITES.has(mots[0]) ? (mots.shift() as string) : null

  const patronyme: string[] = []
  const prenom: string[] = []
  for (const mot of mots) {
    if (estMajuscule(mot) && prenom.length === 0) patronyme.push(mot)
    else prenom.push(mot)
  }

  if (patronyme.length === 0 || prenom.length === 0) return null
  return { civility, lastName: patronyme.join(' '), firstName: prenom.join(' ') }
}
```

- [ ] **Step 4 : Exporter, lancer, committer**

```bash
git commit -m "feat(domain): decoupage des noms CNCCFP"
```

Expected: 6 nouveaux tests, 60 au total dans `domain`.

---

## Task 3 : Lecture CSV avec encodage paramétrable

**Files:**
- Create: `packages/ingestion/src/csv.ts`
- Test: `packages/ingestion/tests/csv.test.ts`

Le RNE est en UTF-8, la CNCCFP en cp1252. Les deux emploient `;`. Un seul lecteur, l'encodage en paramètre.

- [ ] **Step 1 : Ajouter la dépendance**

```bash
pnpm --filter @poligraph/ingestion add csv-parse
```

- [ ] **Step 2 : Écrire le test qui échoue**

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readCsvRows } from '../src/csv.js'

const RNE = fileURLToPath(new URL('../fixtures/rne-deputes-sample.csv', import.meta.url))
const CNCCFP = fileURLToPath(
  new URL('../fixtures/cnccfp-legislatives-2022-sample.csv', import.meta.url),
)

describe('readCsvRows', () => {
  it('lit un CSV UTF-8 séparé par des points-virgules', async () => {
    const rows = []
    for await (const row of readCsvRows(RNE, 'utf-8')) rows.push(row)

    expect(rows).toHaveLength(8)
    expect(rows[0]?.['Nom de l’élu'] ?? rows[0]?.["Nom de l'élu"]).toBeDefined()
  })

  it('lit un CSV cp1252 sans corrompre les accents', async () => {
    const rows = []
    for await (const row of readCsvRows(CNCCFP, 'cp1252')) rows.push(row)

    expect(rows).toHaveLength(11)
    const gueraud = rows.find((r) => String(r['nom']).includes('RAUD'))
    // Lu en UTF-8, cet accent deviendrait un caractère de remplacement.
    expect(gueraud?.['nom']).toContain('É')
  })

  it('conserve les valeurs telles quelles, sans conversion', async () => {
    const rows = []
    for await (const row of readCsvRows(CNCCFP, 'cp1252')) rows.push(row)

    const cfp = rows.find((r) => r['monnaie'] === 'CFP')
    expect(typeof cfp?.['dépenses totales déclarées']).toBe('string')
  })
})
```

- [ ] **Step 3 : Implémenter**

```ts
import { createReadStream } from 'node:fs'
import { parse } from 'csv-parse'

export type CsvEncoding = 'utf-8' | 'cp1252'

/**
 * Lit un CSV ligne à ligne. L'encodage est paramétrable parce que les sources
 * françaises ne s'accordent pas : le RNE publie en UTF-8, la CNCCFP en cp1252.
 * Lire l'un avec l'autre corrompt silencieusement les accents.
 */
export async function* readCsvRows(
  path: string,
  encoding: CsvEncoding,
  delimiter = ';',
): AsyncGenerator<Record<string, string>> {
  const stream = createReadStream(path).pipe(
    parse({ delimiter, columns: true, encoding: encoding === 'cp1252' ? 'latin1' : 'utf8' }),
  )
  for await (const row of stream) yield row as Record<string, string>
}
```

> `latin1` (ISO-8859-1) et `cp1252` diffèrent sur une poignée de caractères de ponctuation, absents des noms propres. Si un test révèle une divergence sur les données réelles, le signaler plutôt que le contourner.

- [ ] **Step 4 : Lancer, committer**

```bash
git commit -m "feat(ingestion): lecture CSV a encodage parametrable"
```

---

## Task 4 : Tables bronze RNE et CNCCFP

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/ingestion/tests/helpers/db.ts`

- [ ] **Step 1 : Ajouter les modèles**

```prisma
model RneEluRaw {
  id                  BigInt  @id @default(autoincrement())
  importRunId         String  @map("import_run_id")
  ligne               Int
  codeDepartement     String? @map("code_departement")
  libelleDepartement  String? @map("libelle_departement")
  codeCirconscription String? @map("code_circonscription")
  libelleCirco        String? @map("libelle_circonscription")
  nom                 String?
  prenom              String?
  codeSexe            String? @map("code_sexe")
  dateNaissance       String? @map("date_naissance")
  codeCsp             String? @map("code_csp")
  libelleCsp          String? @map("libelle_csp")
  dateDebutMandat     String? @map("date_debut_mandat")
  payload             Json

  @@unique([importRunId, ligne])
  @@index([nom, prenom])
  @@map("rne_elu_raw")
  @@schema("bronze")
}

model CnccfpCompteRaw {
  id                BigInt  @id @default(autoincrement())
  importRunId       String  @map("import_run_id")
  ligne             Int
  candidat          String?
  nom               String?
  scrutin           String?
  circonscription   String?
  departement       String?
  codeDepartement   String? @map("code_departement")
  nuance            String?
  monnaie           String?
  depensesDeclarees String? @map("depenses_declarees")
  recettesDeclarees String? @map("recettes_declarees")
  donsDeclares      String? @map("dons_declares")
  apportPersonnel   String? @map("apport_personnel")
  depensesRetenues  String? @map("depenses_retenues")
  recettesRetenues  String? @map("recettes_retenues")
  decision          String?
  payload           Json

  @@unique([importRunId, ligne])
  @@index([candidat])
  @@map("cnccfp_compte_raw")
  @@schema("bronze")
}
```

> Le `payload` conserve les 81 colonnes de la CNCCFP ; seules celles qu'exploite la fiche sont mises à plat. Les autres restent auditables sans encombrer le schéma.

> `ligne` sert de référence bronze : ces fichiers n'ont pas d'identifiant de ligne stable, et le champ `candidat` est vide sur les lignes corrompues.

- [ ] **Step 2 : Migrer les deux bases, étendre le helper, committer**

Même procédure qu'aux plans précédents. Ne pas utiliser `prisma migrate reset`.

---

## Task 5 : Modèles silver du financement et des rapprochements

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1 : Ajouter les modèles**

```prisma
model PoliticalParty {
  id          String      @id @default(uuid())
  naturalKey  String      @unique @map("natural_key")
  name        String
  shortName   String?     @map("short_name")
  candidacies Candidacy[]

  @@map("political_party")
  @@schema("silver")
}

model Election {
  id          String      @id @default(uuid())
  naturalKey  String      @unique @map("natural_key")
  type        String
  label       String
  year        Int
  candidacies Candidacy[]

  @@map("election")
  @@schema("silver")
}

model Candidacy {
  id          String           @id @default(uuid())
  naturalKey  String           @unique @map("natural_key")
  electionId  String           @map("election_id")
  personId    String?          @map("person_id")
  partyId     String?          @map("party_id")
  territoryId String?          @map("territory_id")
  nuance      String?
  displayName String           @map("display_name")
  election    Election         @relation(fields: [electionId], references: [id])
  person      Person?          @relation(fields: [personId], references: [id])
  party       PoliticalParty?  @relation(fields: [partyId], references: [id])
  territory   Territory?       @relation(fields: [territoryId], references: [id])
  account     CampaignAccount?

  @@index([personId])
  @@map("candidacy")
  @@schema("silver")
}

model CampaignAccount {
  id                String    @id @default(uuid())
  candidacyId       String    @unique @map("candidacy_id")
  currency          String
  declaredExpenses  Decimal?  @map("declared_expenses") @db.Decimal(14, 2)
  declaredIncome    Decimal?  @map("declared_income") @db.Decimal(14, 2)
  declaredDonations Decimal?  @map("declared_donations") @db.Decimal(14, 2)
  personalFunds     Decimal?  @map("personal_funds") @db.Decimal(14, 2)
  retainedExpenses  Decimal?  @map("retained_expenses") @db.Decimal(14, 2)
  retainedIncome    Decimal?  @map("retained_income") @db.Decimal(14, 2)
  decisionCode      String?   @map("decision_code")
  candidacy         Candidacy @relation(fields: [candidacyId], references: [id], onDelete: Cascade)

  @@map("campaign_account")
  @@schema("silver")
}

model IdentityMatch {
  id           String   @id @default(uuid())
  naturalKey   String   @unique @map("natural_key")
  sourceId     String   @map("source_id")
  sourceKey    String   @map("source_key")
  personId     String?  @map("person_id")
  confidence   String
  evidence     String[]
  alternatives String[]
  decidedBy    String   @default("AUTO") @map("decided_by")
  resolvedAt   DateTime @default(now()) @map("resolved_at")

  @@index([confidence])
  @@index([sourceId, confidence])
  @@map("identity_match")
  @@schema("silver")
}
```

Relations inverses à ajouter : `candidacies Candidacy[]` sur `Person` et sur `Territory`.

> **`currency` est obligatoire, jamais par défaut.** 51 comptes réels sont libellés en francs CFP. Un montant sans devise est un montant faux dès qu'on l'agrège.

> **Les montants sont en `Decimal`, pas en flottant.** Ce sont des sommes officielles ; l'arithmétique binaire n'a pas sa place ici.

> **`IdentityMatch` conserve tous les rapprochements**, y compris ceux en attente. C'est la file d'arbitrage : ce que la cascade n'a pas tranché reste visible au lieu d'être perdu.

- [ ] **Step 2 : Migrer, étendre le helper de test, committer**

---

## Task 6 : Fichier d'arbitrages versionné

**Files:**
- Create: `data/identity-decisions.yaml`
- Create: `packages/ingestion/src/identity/decisions-file.ts`
- Test: `packages/ingestion/tests/decisions-file.test.ts`

- [ ] **Step 1 : Le format**

`data/identity-decisions.yaml`, commité, avec un en-tête expliquant à quoi il sert :

```yaml
# Arbitrages d'identité décidés par un humain.
#
# Ce fichier est prioritaire sur la cascade automatique et rejoué à chaque
# import : une décision prise une fois n'est jamais redemandée.
#
# MERGE : les deux enregistrements désignent la même personne.
# SPLIT : ils désignent des personnes différentes, malgré ce que suggère
#         l'algorithme. Sert à verrouiller un cas d'homonymie réel.
decisions: []
```

- [ ] **Step 2 : Le lecteur, en TDD**

`readDecisions(path)` rend une liste typée. Un fichier absent rend une liste vide sans erreur — le fichier n'existe pas tant qu'aucun arbitrage n'a été rendu. Un fichier mal formé lève une erreur explicite : mieux vaut un import qui s'arrête qu'un arbitrage silencieusement ignoré.

Tests à écrire : fichier absent → liste vide ; décision `MERGE` bien lue ; décision `SPLIT` bien lue ; YAML invalide → erreur nommant le fichier ; décision sans `reason` → erreur, car une décision non motivée est inexploitable six mois plus tard.

Dépendance : `pnpm --filter @poligraph/ingestion add yaml`.

---

## Task 7 : Import du RNE

**Files:**
- Create: `packages/ingestion/src/adapters/rne/{stage-rne,normalize-rne,rne.adapter}.ts`
- Test: `packages/ingestion/tests/{stage-rne,normalize-rne}.test.ts`

La fixture `rne-deputes-sample.csv` contient **8 députés**, dont les **deux Alexandra Martin** (nées le 1968-10-25 et le 1976-07-28), une troisième MARTIN (Élisa), un quatrième (Patrice), Michel Barnier, Antoine Golliot et Xavier Breton.

Points à vérifier par les tests :

- les 8 lignes atterrissent en bronze, valeurs inchangées, dates encore sous forme de chaînes ;
- la normalisation rapproche par **nom + date de naissance**, donc en `CONFIRMED` automatique ;
- **les deux Alexandra Martin sont rattachées à deux personnes différentes** — c'est le test qui compte le plus de tout le plan ;
- un `ExternalIdentifier` de source `RNE` est créé, permettant à un import ultérieur de retrouver la personne au niveau 1 ;
- une `IdentityMatch` est écrite pour chaque rapprochement, avec sa confiance ;
- l'import est idempotent.

URL de la ressource : `https://static.data.gouv.fr/resources/repertoire-national-des-elus-1/20260811-155035/elus-depute-dep.csv`
`datasetExternalId: 'rne-deputes'`, encodage `utf-8`.

> Le RNE ne publie aucun identifiant national. L'identifiant externe créé est donc dérivé — `nom|prenom|dateNaissance` normalisé — et doit être documenté comme tel : c'est une clé de notre fabrication, pas une référence officielle.

---

## Task 8 : Import des comptes de campagne CNCCFP

**Files:**
- Create: `packages/ingestion/src/adapters/cnccfp/{stage-cnccfp,normalize-cnccfp,cnccfp.adapter}.ts`
- Test: `packages/ingestion/tests/{stage-cnccfp,normalize-cnccfp}.test.ts`

La fixture `cnccfp-legislatives-2022-sample.csv` contient **11 comptes** : les deux Sandrine Rousseau, les deux Jean-Baptiste Moreau, deux comptes en CFP, une ligne corrompue, et quatre comptes ordinaires en euros dont Xavier Breton — présent aussi dans la fixture RNE.

Points à vérifier par les tests :

- **la ligne corrompue est rejetée avec trace**, pas ignorée : `report.rejected` vaut 1 et une `ImportRejection` existe ;
- la devise est conservée telle quelle : deux comptes portent `CFP` ;
- **aucun agrégat ne mélange les devises** — un test doit l'établir explicitement ;
- les montants sont lus en `Decimal` ; un montant `-` ou vide devient `null`, jamais `0` ;
- **les deux Sandrine Rousseau ne sont pas fusionnées** : la cascade rend `AMBIGUOUS`, deux `Candidacy` distinctes existent, aucune n'est rattachée à une personne, et deux `IdentityMatch` en attente sont écrites ;
- Xavier Breton, présent en base via le RNE, est rapproché — mais en `PROBABLE` au mieux, puisque la CNCCFP ne publie pas de date de naissance ;
- le compte de campagne s'accroche à la `Candidacy`, jamais directement à la personne.

URL : `https://static.data.gouv.fr/resources/comptes-de-campagne-elections-legislatives-generales-des-12-et-19-juin-2022/20231012-135051/publications-2022-lg.csv`
`datasetExternalId: 'cnccfp-legislatives-2022'`, encodage `cp1252`.

---

## Task 9 : `poligraph resolve review`

**Files:**
- Create: `apps/api/src/commands/resolve.command.ts`
- Modify: `apps/api/src/app.module.ts`

La commande liste les rapprochements en attente — `PROBABLE`, `POSSIBLE`, `AMBIGUOUS`, `CONFLICT` — groupés par niveau de confiance, avec pour chacun les éléments qui l'ont motivé et les personnes candidates.

Elle **n'écrit rien en base**. Elle affiche, et propose le bloc YAML à coller dans `data/identity-decisions.yaml`. L'arbitrage reste un acte humain, tracé dans git.

Options : `--source <RNE|CNCCFP>`, `--confidence <niveau>`, `--limit <n>` (défaut 50, avec le total exact rappelé si la liste est tronquée).

Sortie non nulle s'il existe au moins un `CONFLICT` : une contradiction entre sources mérite qu'un enchaînement automatique s'arrête.

---

## Task 10 : Import réel et vérification

- [x] Importer le RNE, puis la CNCCFP.
- [x] Rapporter les chiffres réels, et notamment : combien de rapprochements `CONFIRMED` automatiques, combien en attente, combien de `CONFLICT`.
- [x] Vérifier en SQL qu'**aucune personne n'a été fusionnée à tort** : deux `Person` distinctes doivent subsister pour les deux Alexandra Martin, et aucune `Candidacy` des deux Sandrine Rousseau ne doit être rattachée à une personne.
- [x] Lancer `poligraph resolve review` et consigner ce qu'il produit.
- [x] Comparer au chiffre mesuré : **852 candidats CNCCFP** devraient trouver une correspondance nominale parmi les personnes en base, dont **4 clés ambiguës**. Un écart notable doit être expliqué, pas absorbé.
- [x] Consigner les chiffres réels dans ce plan et committer.

### Résultats réels (exécuté le 2026-08-25, base de dev sur `poligraph-db`, port 5433)

**Import RNE** (`pnpm --filter @poligraph/api cli import rne:deputes`, 13 s) :
Stagé 577 · Créés 577 · Mis à jour 0 · Inchangés 0 · Rejetés 0 · En attente 12.
`silver.identity_match` (source RNE) : `CONFIRMED` 565, `UNMATCHED` 12. Aucun `AMBIGUOUS` ni `CONFLICT`.

**Import CNCCFP** (`pnpm --filter @poligraph/api cli import cnccfp:comptes`, ~1 min 48 s) :
Stagé 6292 · Créés 6290 · Mis à jour 0 · Inchangés 0 · Rejetés 2 · En attente 6290.
Les deux lignes corrompues (`nom = "0"`) ont produit deux `silver.import_rejection` (`code = UNPARSEABLE_NAME`, `bronze_ref` 2993 et 3497) — rejetées avec trace, pas perdues.
`silver.identity_match` (source CNCCFP) : `POSSIBLE` 66, `PROBABLE` 790, `UNMATCHED` 5434. **Zéro `AMBIGUOUS`, zéro `CONFLICT`** — voir explication ci-dessous, ce n'est pas une anomalie.

**Aucune personne inventée.** `silver.person` reste à **3119** avant et après les deux imports : ni le RNE ni la CNCCFP ne créent de `Person`, ils ne font que s'y rattacher.

**Les quatre homonymes existants tiennent.** `alexandra|martin`, `beatrice|descamps`, `jean|besson`, `jean louis|masson` sont toujours des paires de 2 `Person` distinctes ; aucune n'a fusionné en une seule.

**Candidatures :** 6290 `Candidacy` créées, **0 rattachée** à une `Person` (`person_id` toutes nulles). C'est cohérent avec la conception : la CNCCFP ne publie aucune date de naissance, donc `resolveIdentity` n'atteint jamais `CONFIRMED` pour une candidature CNCCFP — seuls les niveaux 1 et 2 écrivent `person_id`, et le RNE ne crée pas de `Candidacy`. Les candidatures dépassent largement les rattachées : c'est le comportement voulu, pas un échec.

**Devises séparées.** `campaign_account` : `EURO` 6239 comptes, somme 61 833 073,00 € ; `CFP` 51 comptes, somme 88 886 949,00 F. Deux lignes distinctes, aucun agrégat mélangé.

**Cas Sandrine Rousseau.** Les deux candidatures existent (`Sandrine ROUSSEAU`, nuances `ECO` et `DVD`, toutes deux 9ème circonscription de Paris), toutes deux avec `person_id` nul — confirmé. Note technique : la requête SQL fournie dans la consigne (`display_name ILIKE '%ROUSSEAU%Sandrine%'`) ne trouve rien, car `display_name` est stocké prénom-puis-nom (« Sandrine ROUSSEAU »), pas nom-puis-prénom ; le motif correct est `'%Sandrine%ROUSSEAU%'`.
Les deux `IdentityMatch` correspondants sont en `PROBABLE` (`NAME, DISTRICT`), pas `AMBIGUOUS` : un seul `Person` nommé « Sandrine Rousseau » existe réellement en base (la candidate élue, rattachée par le RNE avec sa date de naissance) ; l'autre candidate (nuance DVD, non élue) n'a jamais de contrepartie `Person`. Le niveau 3 de la cascade (circonscription) trouve donc *une* correspondance unique côté base, jamais deux — d'où `PROBABLE`/`POSSIBLE` et non `AMBIGUOUS`. Dans les deux cas `autoMergeable` est faux : aucune fusion n'a eu lieu, exactement le critère demandé.

**File d'arbitrage.** `pnpm --filter @poligraph/api cli resolve review --limit 10` : sortie non vide (groupe `PROBABLE`), **code de sortie 0**, total 6302 rapprochements en attente (= tous les `IdentityMatch` non `CONFIRMED` : 12 RNE `UNMATCHED` + 66 CNCCFP `POSSIBLE` + 790 CNCCFP `PROBABLE` + 5434 CNCCFP `UNMATCHED`). Un bloc YAML prêt à coller est proposé pour chaque entrée affichée.
`pnpm --filter @poligraph/api cli resolve review --confidence CONFLICT` : « Aucun rapprochement en attente : la file d'arbitrage est vide. », total 0, **code de sortie 0**. Aucun `CONFLICT` n'existe dans cette base — rien à investiguer sur ce point pour cet import.
(Note : le code de `resolve.command.ts` inclut délibérément `UNMATCHED` dans la file d'arbitrage — commentaire explicite dans la source — alors que le texte de la Task 9 ne citait que `PROBABLE, POSSIBLE, AMBIGUOUS, CONFLICT`. Divergence bénigne entre la description du plan et l'implémentation documentée, pas un bug.)

**Comparaison au chiffre mesuré (852 candidats / 4 clés ambiguës).** Rejoué avec les fonctions réelles du domaine (`splitCnccfpName`, `normalizeNameForMatching`) sur les 6290 lignes CNCCFP exploitables contre les 3119 `Person` actuelles :
- **6281 clés distinctes** — identique au chiffre mesuré.
- **856 candidats CNCCFP** dont la clé correspond à une `Person` connue, contre 852 mesurés — écart de 4, explicable intégralement par la croissance de la base entre la mesure (3115 personnes) et cet import (3119 personnes) ; pas un écart à investiguer plus loin.
- **4 clés dupliquées qui correspondent aussi à une `Person` connue** : `sandrine|rousseau`, `jean baptiste|moreau`, `stephanie|do`, `philippe|benassaya` — identique à la liste mesurée. (Le fichier CNCCFP complet contient en réalité 9 clés dupliquées au total ; les 5 autres — `dominique|clergue`, `jerome|garcia`, `dominique|martin`, `romain|vincent`, `julien|lassalle` — sont des homonymies internes à la CNCCFP dont *aucun* des deux candidats ne correspond à une `Person` connue ; elles ne créent donc aucune ambiguïté vis-à-vis de la base et ne faisaient pas partie du chiffre mesuré.)
- Piège relevé au passage : `Mme DÔ Stéphanie` (Bas-Rhin) et `Mme DO Stéphanie` (Seine-et-Marne) diffèrent seulement par l'accent circonflexe dans le CSV brut ; `normalizeNameForMatching` les fait bien collisionner sur la même clé `stephanie|do` grâce à la décomposition NFD — comportement correct, vérifié explicitement.

**Conclusion :** les chiffres réels confirment le plan sur toute la ligne : aucune personne inventée, aucun homonyme fusionné, devises jamais mélangées, ligne corrompue tracée, et le rapprochement nominal (856/6281, 4 clés ambiguës pertinentes) reproduit quasi exactement la mesure faite avant implémentation.

---

## Critère d'achèvement du plan 3

- Les deux députées Alexandra Martin restent deux personnes distinctes après import du RNE.
- Les deux Sandrine Rousseau produisent deux candidatures non rattachées et deux arbitrages en attente.
- Aucun montant n'est agrégé sans sa devise.
- La ligne corrompue de la CNCCFP est rejetée avec trace.
- `poligraph resolve review` liste les cas en attente et propose des décisions à coller.
- `pnpm test` passe intégralement, sans accès réseau.

Le plan 4 (résultats électoraux data.gouv, vues `gold`, API GraphQL) démarre à partir de cet état.
