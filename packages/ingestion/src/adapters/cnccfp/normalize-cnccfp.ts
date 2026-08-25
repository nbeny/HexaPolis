import { fileURLToPath } from 'node:url'
import { Prisma, type PrismaClient } from '@poligraph/db'
import { buildDisplayName, normalizeNameForMatching, splitCnccfpName, type IdentityCandidate } from '@poligraph/domain'
import type { ImportRunRef, NormalizeReport } from '../../contract.js'
import { readDecisions } from '../../identity/decisions-file.js'
import { assertDecisionsAreResolvable, buildKnownPersonIndex, resolveAndRecordIdentity } from '../../identity/resolve-identity.js'
import { recordRejection } from '../../run/import-run.js'

const CNCCFP_SOURCE = 'CNCCFP' as const
const CNCCFP_CANDIDATE_ID_KIND = 'CANDIDAT_ID'
const ELECTION_NATURAL_KEY = 'legislatives-2022'
/**
 * Second tour des élections législatives 2022. Un mandat parlementaire
 * commençant à cette date ou après corrobore la candidature qui l'a précédé
 * (niveau 2 bis de la cascade). Portée par l'`Election`, jamais par la boucle
 * de résolution : un futur import d'un autre scrutin fournira sa propre date,
 * sans jamais retomber silencieusement sur celle-ci.
 */
const SECOND_ROUND_DATE_2022 = new Date('2022-06-19T00:00:00.000Z')

/** Fichier d'arbitrages versionné, rejoué à chaque import. */
const DEFAULT_DECISIONS_PATH = fileURLToPath(
  new URL('../../../../../data/identity-decisions.yaml', import.meta.url),
)

/**
 * Le `code département` de la CNCCFP omet le zéro initial pour les
 * départements à un chiffre (« 1 » pour l'Ain), contrairement à la forme des
 * codes `Territory` en base (« 01 »). Les codes à trois chiffres (outre-mer,
 * ex. « 988 ») n'ont jamais besoin de ce complément.
 */
function normalizeDepartmentCode(raw: string): string {
  return /^\d$/.test(raw) ? raw.padStart(2, '0') : raw
}

/**
 * Extrait le numéro d'ordre de la circonscription depuis le texte libre
 * publié (« Paris - 9e circonscription », « Ain - 1re circonscription »).
 * Une « circonscription unique » (département à un seul siège, ex. la
 * Creuse) est numérotée 1, la convention observée dans les codes Territory
 * déjà en base.
 */
function parseCirconscriptionOrdinal(raw: string): number | null {
  if (/circonscription unique/i.test(raw)) return 1
  const match = raw.match(/(\d+)\s*(?:re|ère|ème|e)?\s*circonscription/i)
  return match?.[1] ? Number(match[1]) : null
}

/**
 * Dérive le code `Territory` (ex. `01-1`) depuis le département et la
 * circonscription en texte libre publiés par la CNCCFP. Ne matche que des
 * `Territory` déjà en base — créés par l'import AN — et n'en invente jamais :
 * une circonscription non reconnue laisse `territoryId` à `null`.
 */
function districtCodeFromRow(codeDepartement: string | null, circonscription: string | null): string | null {
  if (!codeDepartement || !circonscription) return null
  const ordinal = parseCirconscriptionOrdinal(circonscription)
  if (ordinal === null) return null
  return `${normalizeDepartmentCode(codeDepartement)}-${ordinal}`
}

/**
 * Un montant publié `-` ou vide signifie absent, jamais zéro : une dépense
 * déclarée à 0 et une dépense non déclarée sont deux faits différents, et les
 * confondre reviendrait à prétendre à tort qu'une campagne n'a rien dépensé.
 * Les montants sont lus en `Decimal`, jamais en flottant binaire : ce sont
 * des sommes officielles.
 */
function parseAmount(raw: string | null): Prisma.Decimal | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '-') return null
  return new Prisma.Decimal(trimmed.replace(/\s/g, '').replace(',', '.'))
}

interface ExploitableRow {
  candidat: string
  circonscriptionCode: string | null
  nuance: string | null
  monnaie: string
  displayName: string
  matchKey: string
  amounts: {
    declaredExpenses: Prisma.Decimal | null
    declaredIncome: Prisma.Decimal | null
    declaredDonations: Prisma.Decimal | null
    personalFunds: Prisma.Decimal | null
    retainedExpenses: Prisma.Decimal | null
    retainedIncome: Prisma.Decimal | null
  }
  decisionCode: string | null
}

/**
 * Importe les comptes de campagne CNCCFP. La CNCCFP ne publie aucune date de
 * naissance : le meilleur niveau de rapprochement automatique atteignable
 * depuis cette source est PROBABLE (niveau 3, circonscription) — jamais
 * CONFIRMED. `Candidacy.personId` ne reflète donc qu'un verdict fusionnable
 * automatiquement (niveaux 1 et 2) ; tout le reste attend un arbitrage humain
 * sans que le compte de campagne — un fait publié réel — cesse d'exister.
 */
export async function normalizeCnccfp(
  prisma: PrismaClient,
  run: ImportRunRef,
  decisionsPath: string = DEFAULT_DECISIONS_PATH,
): Promise<NormalizeReport> {
  const report: NormalizeReport = { created: 0, updated: 0, unchanged: 0, rejected: 0, pending: 0 }

  const rows = await prisma.cnccfpCompteRaw.findMany({ where: { importRunId: run.id }, orderBy: { ligne: 'asc' } })

  const exploitable: ExploitableRow[] = []
  for (const row of rows) {
    const parsedName = row.nom ? splitCnccfpName(row.nom) : null
    if (!parsedName || !row.candidat) {
      report.rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'cnccfp_compte_raw',
        bronzeRef: String(row.ligne),
        code: 'UNPARSEABLE_NAME',
        message: `champ "nom" inexploitable : "${row.nom ?? ''}"`,
      })
      continue
    }

    // Une devise est indispensable à un compte de campagne : aucun montant
    // n'a de sens sans elle, et `CampaignAccount.currency` est obligatoire.
    if (!row.monnaie) {
      report.rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'cnccfp_compte_raw',
        bronzeRef: String(row.ligne),
        code: 'MISSING_CURRENCY',
        message: 'devise absente : impossible de publier un compte de campagne sans devise',
      })
      continue
    }

    exploitable.push({
      candidat: row.candidat,
      circonscriptionCode: districtCodeFromRow(row.codeDepartement, row.circonscription),
      nuance: row.nuance,
      monnaie: row.monnaie,
      displayName: buildDisplayName({
        civ: parsedName.civility,
        prenom: parsedName.firstName,
        nom: parsedName.lastName,
      }),
      matchKey: normalizeNameForMatching(parsedName.firstName, parsedName.lastName),
      amounts: {
        declaredExpenses: parseAmount(row.depensesDeclarees),
        declaredIncome: parseAmount(row.recettesDeclarees),
        declaredDonations: parseAmount(row.donsDeclares),
        personalFunds: parseAmount(row.apportPersonnel),
        retainedExpenses: parseAmount(row.depensesRetenues),
        retainedIncome: parseAmount(row.recettesRetenues),
      },
      decisionCode: row.decision,
    })
  }

  const decisions = await readDecisions(decisionsPath)
  assertDecisionsAreResolvable(
    decisions,
    CNCCFP_SOURCE,
    new Set(exploitable.map((entry) => entry.candidat)),
    decisionsPath,
  )

  const index = await buildKnownPersonIndex(prisma)

  const election = await prisma.election.upsert({
    where: { naturalKey: ELECTION_NATURAL_KEY },
    // `secondRoundDate` doit être rétro-alimentée même sur une `Election`
    // déjà en base : ce champ n'existait pas avant la Task 2, si bien que la
    // base de dev porte déjà une ligne `legislatives-2022` créée par un
    // import antérieur, avec cette colonne à `null`. Laisser `update: {}`
    // aurait désactivé silencieusement toute corroboration « élection puis
    // mandat » pour de bon, sans qu'aucun test sur base vierge (toujours
    // repartie de zéro) ne puisse jamais le détecter.
    update: { secondRoundDate: SECOND_ROUND_DATE_2022 },
    create: {
      naturalKey: ELECTION_NATURAL_KEY,
      type: 'LEGISLATIVE',
      label: 'Élections législatives 2022',
      year: 2022,
      secondRoundDate: SECOND_ROUND_DATE_2022,
    },
  })
  const electionDate = election.secondRoundDate ? election.secondRoundDate.toISOString().slice(0, 10) : null

  /**
   * Unicité par circonscription, comptée sur l'ENSEMBLE du fichier importé
   * avant de résoudre quoi que ce soit. Indispensable : un candidat vu tôt
   * dans le fichier et son homonyme vu bien plus tard doivent tous deux savoir
   * qu'ils sont deux, y compris celui déjà résolu au moment où l'autre est lu.
   * Une version qui compterait au fil de la boucle de résolution confirmerait
   * à tort le premier avant même d'avoir lu le second — précisément le cas
   * Sandrine Rousseau que cette règle existe pour empêcher.
   */
  const countByDistrictAndName = new Map<string, number>()
  for (const entry of exploitable) {
    if (!entry.circonscriptionCode) continue
    const key = `${entry.circonscriptionCode}|${entry.matchKey}`
    countByDistrictAndName.set(key, (countByDistrictAndName.get(key) ?? 0) + 1)
  }

  for (const entry of exploitable) {
    const districtNameKey = entry.circonscriptionCode ? `${entry.circonscriptionCode}|${entry.matchKey}` : null
    const candidate: IdentityCandidate = {
      matchKey: entry.matchKey,
      birthDate: null,
      districtCode: entry.circonscriptionCode,
      externalIds: [{ source: CNCCFP_SOURCE, kind: CNCCFP_CANDIDATE_ID_KIND, value: entry.candidat }],
      electionDate,
      uniqueInDistrict: districtNameKey !== null && countByDistrictAndName.get(districtNameKey) === 1,
    }

    // Ne JAMAIS attacher l'identifiant candidat CNCCFP à la personne : à la
    // différence du RNE (nom + date de naissance, un fait immuable), le seul
    // chemin CNCCFP vers CONFIRMED est le niveau 2 bis (élection puis mandat),
    // dont la preuve — `uniqueInDistrict` — est un instantané recalculé à
    // chaque import sur l'ensemble du fichier. L'attacher figerait ce verdict
    // pour de bon : un réimport ultérieur retrouverait la personne au niveau 1
    // (identifiant externe déjà connu) et ne reconsidérerait plus jamais la
    // preuve, même si un homonyme découvert entretemps devrait la retirer.
    // Sans attache, chaque import recalcule le verdict à neuf, et le
    // rattachement de la Candidacy (plus bas) suit alors fidèlement.
    const verdict = await resolveAndRecordIdentity(prisma, index, decisions, {
      sourceId: CNCCFP_SOURCE,
      sourceKey: entry.candidat,
      candidate,
    })
    if (!verdict.autoMergeable) report.pending++

    const territory = entry.circonscriptionCode
      ? await prisma.territory.findUnique({
          where: { type_code: { type: 'CIRCONSCRIPTION', code: entry.circonscriptionCode } },
        })
      : null

    const naturalKey = `cnccfp|${entry.candidat}`
    const existing = await prisma.candidacy.findUnique({ where: { naturalKey } })

    // Seul un verdict fusionnable automatiquement (niveaux 1 et 2) rattache la
    // candidature à une personne. PROBABLE, POSSIBLE et AMBIGUOUS suggèrent
    // sans jamais fusionner : la candidature reste en attente d'arbitrage.
    const personId = verdict.autoMergeable ? verdict.personId : null

    const candidacy = await prisma.candidacy.upsert({
      where: { naturalKey },
      update: {
        personId,
        territoryId: territory?.id ?? null,
        nuance: entry.nuance,
        displayName: entry.displayName,
      },
      create: {
        naturalKey,
        electionId: election.id,
        personId,
        territoryId: territory?.id ?? null,
        nuance: entry.nuance,
        displayName: entry.displayName,
      },
    })

    await prisma.campaignAccount.upsert({
      where: { candidacyId: candidacy.id },
      update: {
        currency: entry.monnaie,
        declaredExpenses: entry.amounts.declaredExpenses,
        declaredIncome: entry.amounts.declaredIncome,
        declaredDonations: entry.amounts.declaredDonations,
        personalFunds: entry.amounts.personalFunds,
        retainedExpenses: entry.amounts.retainedExpenses,
        retainedIncome: entry.amounts.retainedIncome,
        decisionCode: entry.decisionCode,
      },
      create: {
        candidacyId: candidacy.id,
        currency: entry.monnaie,
        declaredExpenses: entry.amounts.declaredExpenses,
        declaredIncome: entry.amounts.declaredIncome,
        declaredDonations: entry.amounts.declaredDonations,
        personalFunds: entry.amounts.personalFunds,
        retainedExpenses: entry.amounts.retainedExpenses,
        retainedIncome: entry.amounts.retainedIncome,
        decisionCode: entry.decisionCode,
      },
    })

    if (existing) report.unchanged++
    else report.created++
  }

  return report
}
