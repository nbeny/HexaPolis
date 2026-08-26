import { fileURLToPath } from 'node:url'
import { Prisma, type PrismaClient } from '@poligraph/db'
import { buildDisplayName, normalizeNameForMatching, type IdentityCandidate } from '@poligraph/domain'
import type { ImportRunRef, NormalizeReport } from '../../contract.js'
import { readDecisions, type IdentityDecision } from '../../identity/decisions-file.js'
import { assertDecisionsAreResolvable, buildKnownPersonIndex, resolveAndRecordIdentity } from '../../identity/resolve-identity.js'
import { recordRejection } from '../../run/import-run.js'

const RESULTATS_SOURCE = 'DATA_GOUV' as const
const ELECTION_NATURAL_KEY = 'legislatives-2024'

/** `datasetExternalId` de chacune des deux ressources déclarées par `ResultatsAdapter` (voir `resultats.adapter.ts`). */
const DATASET_T1 = 'legislatives-2024-t1'
const DATASET_T2 = 'legislatives-2024-t2'

type Round = 1 | 2

/**
 * Date de chaque tour, telle que publiée par le ministère de l'Intérieur.
 * Passée à la cascade en `YYYY-MM-DD` : `resolveIdentity` compare des dates
 * lexicographiquement, jamais des `Date` — une valeur ISO complète les
 * mettrait silencieusement dans le désordre.
 */
const ROUND_DATES: Record<Round, string> = {
  1: '2024-06-30',
  2: '2024-07-07',
}
const SECOND_ROUND_DATE = new Date(`${ROUND_DATES[2]}T00:00:00.000Z`)

/** Fichier d'arbitrages versionné, rejoué à chaque import. */
const DEFAULT_DECISIONS_PATH = fileURLToPath(
  new URL('../../../../../data/identity-decisions.yaml', import.meta.url),
)

/**
 * Complète le code département à deux chiffres avant de composer la clé
 * `Territory`. Piège mesuré (plan p5) : le 1er tour omet le zéro initial des
 * départements 1 à 9 (`1`), le 2nd tour le conserve (`01`). Sans ce
 * complément, `101` (1er tour) produirait `1-1` au lieu de `01-1` : la
 * circonscription ne serait jamais retrouvée, sans lever la moindre erreur.
 */
/**
 * Alias de code département mesurés sur le fichier réel (au-delà du zéro
 * manquant ci-dessus) : le ministère publie ces circonscriptions sous un code
 * département alphabétique qui ne correspond à aucun code `Territory` en
 * base — celle-ci les porte sous leur code INSEE numérique, le même que le
 * RNE (plan 3). Sans cet alias, les 11 circonscriptions des Français établis
 * hors de France et celle de Saint-Barthélemy/Saint-Martin ne se rattachent
 * jamais, sans lever la moindre erreur : `territoryId` reste simplement
 * `null` (157 candidatures des deux tours, mesuré sur l'import réel).
 */
const DEPARTMENT_CODE_ALIASES: Record<string, string> = {
  ZZ: '099', // Français établis hors de France (11 circonscriptions)
  ZX: '977', // Saint-Barthélemy et Saint-Martin
}

function padDepartmentCode(raw: string): string {
  const aliased = DEPARTMENT_CODE_ALIASES[raw] ?? raw
  return /^\d$/.test(aliased) ? aliased.padStart(2, '0') : aliased
}

/**
 * Dérive le code `Territory` (ex. `01-1`) depuis `Code circonscription
 * législative` publié (`0101`, `101`, `ZZ09`…) — même format que le RNE
 * (plan 3), à ceci près que le département n'est pas toujours complété à
 * deux chiffres selon le tour (voir `padDepartmentCode`).
 */
export function districtCodeFromCirconscription(raw: string | null): string | null {
  if (!raw || raw.length < 3) return null
  const departement = raw.slice(0, -2)
  const circonscription = raw.slice(-2)
  const numero = Number(circonscription)
  if (Number.isNaN(numero)) return null
  return `${padDepartmentCode(departement)}-${numero}`
}

/** Un nombre publié vide signifie absent, jamais zéro. Espaces (séparateur de
 * milliers) et virgule décimale tolérés, aucun n'apparaît sur ces colonnes
 * en pratique mais mieux vaut ne pas dépendre de leur absence. */
function parseInt10(raw: string | null): number | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/\s/g, '')
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isNaN(n) ? null : n
}

/** Un pourcentage publié (« 39,02% ») devient un `Decimal`, jamais recalculé :
 * c'est un fait officiel, susceptible de différer d'un arrondi maison. */
function parsePercent(raw: string | null): Prisma.Decimal | null {
  if (!raw) return null
  const trimmed = raw.trim().replace('%', '').replace(/\s/g, '').replace(',', '.')
  if (trimmed === '') return null
  return new Prisma.Decimal(trimmed)
}

/**
 * Le numéro de panneau distingue deux candidats homonymes d'une même
 * circonscription et d'un même tour — cas rarissime mais publiquement
 * possible (rien n'interdit deux « Jean Dupont » sur la même liste), et le
 * seul identifiant par-candidature que publie ce fichier. Sans lui, la clé
 * naturelle d'une `Candidacy` (élection, tour, circonscription, nom) collapse
 * deux candidatures distinctes en une seule ligne, perdant l'une des deux.
 * Lu depuis `payload`, pas une colonne bronze dédiée : `readWideCsvRows`
 * (tâche 2) le range dans `WideCandidate.numeroPanneau`, reporté tel quel
 * dans le JSON stagé (voir `stageResultats`).
 */
function numeroPanneauFromPayload(payload: Prisma.JsonValue): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const candidate = (payload as Record<string, unknown>).candidate
    if (candidate && typeof candidate === 'object') {
      const numero = (candidate as Record<string, unknown>).numeroPanneau
      if (typeof numero === 'string') return numero
    }
  }
  return ''
}

interface ExploitableRow {
  districtCode: string
  numeroPanneau: string
  matchKey: string
  displayName: string
  nuance: string | null
  votes: number | null
  votePctRegistered: Prisma.Decimal | null
  votePctExpressed: Prisma.Decimal | null
  elected: boolean
  turnout: {
    registered: number | null
    voters: number | null
    expressed: number | null
    blank: number | null
    nullVotes: number | null
  }
}

/**
 * Une décision DATA_GOUV ne s'applique qu'au tour dont sa sourceKey porte le
 * préfixe (`${round}|...`) : les deux tours partagent le même sourceId mais
 * sont deux runs distincts, chacun avec son propre espace de sourceKey (voir
 * l'appel à `assertDecisionsAreResolvable` ci-dessous). Une décision qui ne
 * vise pas DATA_GOUV (ex. un SPLIT entre deux autres sources) est laissée
 * passer telle quelle : ce filtre ne concerne que cette source.
 */
function decisionAppliesToRound(decision: IdentityDecision, round: Round): boolean {
  for (const ref of [decision.left, decision.right]) {
    if (ref.source !== RESULTATS_SOURCE) continue
    if (!ref.key.startsWith(`${round}|`)) return false
  }
  return true
}

/**
 * Détermine le tour d'un run depuis la ressource qu'il a importée : le
 * fichier bronze lui-même ne porte aucun champ « tour », les deux tours
 * partageant la même structure de colonnes fixes.
 */
async function resolveRound(prisma: PrismaClient, run: ImportRunRef): Promise<Round> {
  const resource = await prisma.datasetResource.findUniqueOrThrow({
    where: { id: run.resourceId },
    include: { dataset: true },
  })
  if (resource.dataset.externalId === DATASET_T1) return 1
  if (resource.dataset.externalId === DATASET_T2) return 2
  throw new Error(
    `Ressource inattendue pour l'import des résultats électoraux : dataset "${resource.dataset.externalId}" ` +
      `(attendu "${DATASET_T1}" ou "${DATASET_T2}")`,
  )
}

/**
 * Importe les résultats électoraux des législatives 2024. Cette source
 * dispose du nom, du prénom et de la circonscription, mais d'aucune date de
 * naissance : le rapprochement automatique plafonne à PROBABLE (niveau 3),
 * sauf pour le niveau « élection puis mandat » (niveau 2 bis), qui trouve
 * ici son terrain naturel — la source dit explicitement qui a été élu.
 *
 * La clé naturelle des `Candidacy` n'est PAS préfixée par la source
 * (contrairement à `cnccfp|...`) : elle se construit à partir de faits
 * publics (élection, tour, circonscription, numéro de panneau, nom) pour
 * qu'un futur import CNCCFP 2024, décrivant les mêmes candidatures, retrouve
 * ces lignes au lieu d'en créer de secondes. Le numéro de panneau y figure
 * pour distinguer deux homonymes exacts d'une même circonscription et d'un
 * même tour (voir `numeroPanneauFromPayload`) — sans quoi ce cas, rare mais
 * publiquement possible, écraserait silencieusement une candidature avec
 * l'autre.
 */
export async function normalizeResultats(
  prisma: PrismaClient,
  run: ImportRunRef,
  decisionsPath: string = DEFAULT_DECISIONS_PATH,
): Promise<NormalizeReport> {
  const report: NormalizeReport = { created: 0, updated: 0, unchanged: 0, rejected: 0, pending: 0 }
  const round = await resolveRound(prisma, run)
  const electionDate = ROUND_DATES[round]

  const rows = await prisma.electionResultRaw.findMany({
    where: { importRunId: run.id },
    orderBy: [{ ligne: 'asc' }, { rang: 'asc' }],
  })

  const exploitable: ExploitableRow[] = []
  for (const row of rows) {
    const bronzeRef = `${row.ligne}/${row.rang}`

    if (!row.nom || !row.prenom) {
      report.rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'election_result_raw',
        bronzeRef,
        code: 'MISSING_NAME',
        message: 'nom ou prénom absent',
      })
      continue
    }

    const districtCode = districtCodeFromCirconscription(row.codeCirconscription)
    if (!districtCode) {
      report.rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'election_result_raw',
        bronzeRef,
        code: 'UNPARSEABLE_DISTRICT_CODE',
        message: `code circonscription inexploitable : "${row.codeCirconscription ?? ''}"`,
      })
      continue
    }

    exploitable.push({
      districtCode,
      numeroPanneau: numeroPanneauFromPayload(row.payload),
      matchKey: normalizeNameForMatching(row.prenom, row.nom),
      displayName: buildDisplayName({ civ: null, prenom: row.prenom, nom: row.nom }),
      nuance: row.nuance,
      votes: parseInt10(row.voix),
      votePctRegistered: parsePercent(row.pctInscrits),
      votePctExpressed: parsePercent(row.pctExprimes),
      elected: row.elu === 'true',
      turnout: {
        registered: parseInt10(row.inscrits),
        voters: parseInt10(row.votants),
        expressed: parseInt10(row.exprimes),
        blank: parseInt10(row.blancs),
        nullVotes: parseInt10(row.nuls),
      },
    })
  }

  const decisions = await readDecisions(decisionsPath)
  // Les deux tours partagent le même sourceId (DATA_GOUV) mais sont deux runs
  // distincts, chacun ne connaissant que les sourceKey de son propre fichier
  // (préfixées par le tour, ex. `2|53-3|3|...`). Une décision visant le 2nd
  // tour ne peut donc jamais se vérifier pendant le run du 1er : sans ce
  // filtre, assertDecisionsAreResolvable la déclarerait introuvable alors
  // qu'elle sera bien résolue par le run du tour auquel elle appartient.
  const decisionsForThisRound = decisions.filter((decision) => decisionAppliesToRound(decision, round))
  assertDecisionsAreResolvable(
    decisionsForThisRound,
    RESULTATS_SOURCE,
    new Set(exploitable.map((entry) => `${round}|${entry.districtCode}|${entry.numeroPanneau}|${entry.matchKey}`)),
    decisionsPath,
  )

  const index = await buildKnownPersonIndex(prisma)

  const election = await prisma.election.upsert({
    where: { naturalKey: ELECTION_NATURAL_KEY },
    update: { secondRoundDate: SECOND_ROUND_DATE },
    create: {
      naturalKey: ELECTION_NATURAL_KEY,
      type: 'LEGISLATIVE',
      label: 'Élections législatives 2024',
      year: 2024,
      secondRoundDate: SECOND_ROUND_DATE,
    },
  })

  /**
   * Unicité par circonscription et par nom, comptée sur L'ENSEMBLE du
   * fichier importé (ce tour), avant de résoudre quoi que ce soit. Sans
   * cette passe séparée, un homonyme découvert plus loin dans le fichier ne
   * pourrait jamais défaire une confirmation déjà rendue pour le premier —
   * exactement le défaut qu'une implémentation en flux introduirait.
   */
  const countByDistrictAndName = new Map<string, number>()
  for (const entry of exploitable) {
    const key = `${entry.districtCode}|${entry.matchKey}`
    countByDistrictAndName.set(key, (countByDistrictAndName.get(key) ?? 0) + 1)
  }

  const turnoutWritten = new Set<string>()

  for (const entry of exploitable) {
    const districtNameKey = `${entry.districtCode}|${entry.matchKey}`
    // Le numéro de panneau distingue deux homonymes de la même circonscription
    // et du même tour (voir `numeroPanneauFromPayload`) : sans lui, deux
    // candidatures distinctes partageraient la même clé et se remplaceraient
    // l'une l'autre au lieu de coexister. L'unicité par nom (`districtNameKey`,
    // ci-dessus) reste calculée SANS lui : c'est justement le fait que deux
    // candidatures différentes partagent le même nom qui doit invalider la
    // corroboration « élection puis mandat ».
    const sourceKey = `${round}|${entry.districtCode}|${entry.numeroPanneau}|${entry.matchKey}`

    const candidate: IdentityCandidate = {
      matchKey: entry.matchKey,
      birthDate: null,
      districtCode: entry.districtCode,
      externalIds: [],
      electionDate,
      uniqueInDistrict: countByDistrictAndName.get(districtNameKey) === 1,
    }

    // Comme pour la CNCCFP : aucun identifiant externe n'est attaché à la
    // personne. Le seul chemin automatique vers CONFIRMED ici est le niveau
    // 2 bis, dont la preuve (uniqueInDistrict) est recalculée à chaque
    // import sur l'ensemble du fichier ; l'attacher figerait un verdict qui
    // doit au contraire pouvoir se rétracter si un homonyme apparaît.
    const verdict = await resolveAndRecordIdentity(prisma, index, decisions, {
      sourceId: RESULTATS_SOURCE,
      sourceKey,
      candidate,
    })
    if (!verdict.autoMergeable) report.pending++

    const territory = await prisma.territory.findUnique({
      where: { type_code: { type: 'CIRCONSCRIPTION', code: entry.districtCode } },
    })

    const naturalKey = `${ELECTION_NATURAL_KEY}|${round}|${entry.districtCode}|${entry.numeroPanneau}|${entry.matchKey}`
    const existing = await prisma.candidacy.findUnique({ where: { naturalKey } })
    const personId = verdict.autoMergeable ? verdict.personId : null

    const data = {
      personId,
      territoryId: territory?.id ?? null,
      nuance: entry.nuance,
      displayName: entry.displayName,
      round,
      votes: entry.votes,
      votePctRegistered: entry.votePctRegistered,
      votePctExpressed: entry.votePctExpressed,
      elected: entry.elected,
    }

    await prisma.candidacy.upsert({
      where: { naturalKey },
      update: data,
      create: { naturalKey, electionId: election.id, ...data },
    })

    if (existing) report.unchanged++
    else report.created++

    // Les chiffres de participation sont portés par la circonscription, pas
    // par le candidat : une seule écriture par circonscription pour ce tour,
    // même si plusieurs candidats de cette circonscription sont exploitables.
    if (territory && !turnoutWritten.has(entry.districtCode)) {
      turnoutWritten.add(entry.districtCode)
      const t = entry.turnout
      if (t.registered !== null && t.voters !== null && t.expressed !== null && t.blank !== null && t.nullVotes !== null) {
        await prisma.electionTurnout.upsert({
          where: { electionId_territoryId_round: { electionId: election.id, territoryId: territory.id, round } },
          update: {
            registered: t.registered,
            voters: t.voters,
            abstentions: t.registered - t.voters,
            expressed: t.expressed,
            blank: t.blank,
            nullVotes: t.nullVotes,
          },
          create: {
            naturalKey: `${ELECTION_NATURAL_KEY}|${round}|${entry.districtCode}`,
            electionId: election.id,
            territoryId: territory.id,
            round,
            registered: t.registered,
            voters: t.voters,
            abstentions: t.registered - t.voters,
            expressed: t.expressed,
            blank: t.blank,
            nullVotes: t.nullVotes,
          },
        })
      }
    }
  }

  return report
}
