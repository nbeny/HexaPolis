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
 * Alias de code département mesurés sur le fichier réel de la CNCCFP (au-delà
 * du zéro manquant traité par `normalizeDepartmentCode`) : la commission
 * publie la Corse sous les codes `20A` / `20B`, qui ne correspondent à aucun
 * code `Territory` en base — celle-ci porte les codes INSEE `2A` / `2B`, les
 * mêmes que l'Assemblée nationale (plan 1) et que le RNE (plan 3). Sans cet
 * alias, `20A-1` ne se rattache jamais, sans lever la moindre erreur :
 * `territoryId` reste simplement `null` (43 lignes bronze, mesuré sur l'import
 * réel — les 43 seules candidatures de 2022 sans territoire).
 *
 * Même intention que `DEPARTMENT_CODE_ALIASES` de
 * `adapters/resultats/normalize-resultats.ts`, qui traite l'équivalent pour le
 * ministère de l'Intérieur (`ZZ` → `099`, `ZX` → `977`). Les codes cibles sont
 * délibérément identiques d'une source à l'autre : deux sources qui décriraient
 * la même circonscription sous deux codes différents se contrediraient.
 */
const DEPARTMENT_CODE_ALIASES: Record<string, string> = {
  '20A': '2A', // Corse-du-Sud (23 lignes)
  '20B': '2B', // Haute-Corse (20 lignes)
}

/**
 * Code département des `Territory` des Français établis hors de France, le
 * même que celui posé par l'import des résultats du ministère de l'Intérieur
 * (`ZZ` → `099`) et par l'import de l'Assemblée nationale.
 */
const FRANCAIS_ETRANGER_DEPARTMENT_CODE = '099'

/**
 * Les onze circonscriptions des Français établis hors de France sont publiées
 * par la CNCCFP sous `code département = 75` et `département = « Paris »` —
 * le lieu de dépôt du compte, pas le territoire représenté (149 lignes bronze,
 * mesuré sur l'import réel). Le seul endroit où figure la circonscription
 * réelle est le libellé, d'où cette reconnaissance sur le texte : la dériver du
 * code département produirait `75-N`, **une vraie circonscription de Paris**,
 * c'est-à-dire une affirmation fausse et vraisemblable attachée à une personne
 * nommée, bien pire qu'une absence.
 */
const FRANCAIS_ETRANGER_LABEL = /fran[çc]ais\s+[ée]tablis\s+hors\s+de\s+france/i

/**
 * Le `code département` de la CNCCFP omet le zéro initial pour les
 * départements à un chiffre (« 1 » pour l'Ain), contrairement à la forme des
 * codes `Territory` en base (« 01 »). Les codes à trois chiffres (outre-mer,
 * ex. « 988 ») n'ont jamais besoin de ce complément.
 */
function normalizeDepartmentCode(raw: string): string {
  const aliased = DEPARTMENT_CODE_ALIASES[raw] ?? raw
  return /^\d$/.test(aliased) ? aliased.padStart(2, '0') : aliased
}

/**
 * Extrait le numéro d'ordre explicitement écrit dans le libellé publié
 * (« Paris - 9e circonscription », « Ain - 1re circonscription »). Rend `null`
 * si aucun numéro n'y figure : c'est le seul verdict honnête quand la source
 * ne dit pas de quelle circonscription elle parle.
 */
function parseNumberedCirconscription(raw: string): number | null {
  const match = raw.match(/(\d+)\s*(?:re|ère|ème|e)?\s*circonscription/i)
  return match?.[1] ? Number(match[1]) : null
}

/**
 * Extrait le numéro d'ordre de la circonscription depuis le texte libre
 * publié. Une « circonscription unique » (département à un seul siège, ex. la
 * Creuse, Saint-Pierre-et-Miquelon, Wallis-et-Futuna) est numérotée 1, la
 * convention observée dans les codes Territory déjà en base.
 */
function parseCirconscriptionOrdinal(raw: string): number | null {
  if (/circonscription unique/i.test(raw)) return 1
  return parseNumberedCirconscription(raw)
}

/**
 * Dérive le code `Territory` (ex. `01-1`) depuis le département et la
 * circonscription en texte libre publiés par la CNCCFP. Ne matche que des
 * `Territory` déjà en base — créés par l'import AN — et n'en invente jamais :
 * une circonscription non reconnue laisse `territoryId` à `null`.
 *
 * Les Français établis hors de France sont le seul cas où le libellé prime sur
 * le code département publié (voir `FRANCAIS_ETRANGER_LABEL`). Le numéro y est
 * exigé explicitement : le repli « circonscription unique » n'y a aucun sens
 * (elles sont onze) et rendrait la 1ère au hasard. Un libellé de cette famille
 * sans numéro rend donc `null` — une absence consignée, jamais une supposition.
 */
function districtCodeFromRow(codeDepartement: string | null, circonscription: string | null): string | null {
  if (!circonscription) return null

  if (FRANCAIS_ETRANGER_LABEL.test(circonscription)) {
    const ordinal = parseNumberedCirconscription(circonscription)
    return ordinal === null ? null : `${FRANCAIS_ETRANGER_DEPARTMENT_CODE}-${ordinal}`
  }

  if (!codeDepartement) return null
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
