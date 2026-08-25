import { fileURLToPath } from 'node:url'
import type { PrismaClient } from '@poligraph/db'
import { normalizeNameForMatching, type IdentityCandidate } from '@poligraph/domain'
import type { ImportRunRef, NormalizeReport } from '../../contract.js'
import { readDecisions } from '../../identity/decisions-file.js'
import { assertDecisionsAreResolvable, buildKnownPersonIndex, resolveAndRecordIdentity } from '../../identity/resolve-identity.js'
import { recordRejection } from '../../run/import-run.js'

const RNE_SOURCE = 'RNE' as const
const RNE_DERIVED_KEY_KIND = 'RNE_DERIVED_KEY'

/** Fichier d'arbitrages versionné, rejoué à chaque import. */
const DEFAULT_DECISIONS_PATH = fileURLToPath(
  new URL('../../../../../data/identity-decisions.yaml', import.meta.url),
)

/**
 * Normalise `Code de la circonscription législative` (ex. `0608` = département
 * `06`, circonscription `08`) vers la forme des codes `Territory` déjà en base
 * (ex. `06-8`, vérifiée sur les données réelles importées par l'AN). Sans cette
 * conversion, la circonscription ne fait jamais correspondre quoi que ce soit :
 * les deux formats ne s'écrivent jamais pareil.
 */
function normalizeDistrictCode(rawCode: string | null): string | null {
  if (!rawCode || rawCode.length < 3) return null
  const departement = rawCode.slice(0, -2)
  const circonscription = rawCode.slice(-2)
  const numero = Number(circonscription)
  if (Number.isNaN(numero)) return null
  return `${departement}-${numero}`
}

/**
 * Importe le Répertoire national des élus. Le RNE ne publie aucun identifiant
 * national : le rapprochement se fait sur nom + prénom + date de naissance, et
 * l'identifiant externe qu'on attache en conséquence est une clé de notre
 * fabrication (`RNE_DERIVED_KEY`), pas une référence officielle.
 *
 * N'écrit jamais de `Person` : un candidat qui ne se rapproche pas
 * automatiquement d'une personne déjà connue reste en attente d'arbitrage
 * (`IdentityMatch` sans `personId`), jamais créé à la volée.
 */
export async function normalizeRne(
  prisma: PrismaClient,
  run: ImportRunRef,
  decisionsPath: string = DEFAULT_DECISIONS_PATH,
): Promise<NormalizeReport> {
  const report: NormalizeReport = { created: 0, updated: 0, unchanged: 0, rejected: 0, pending: 0 }

  const rows = await prisma.rneEluRaw.findMany({ where: { importRunId: run.id }, orderBy: { ligne: 'asc' } })

  const candidates: Array<{ sourceKey: string; candidate: IdentityCandidate }> = []
  for (const row of rows) {
    if (!row.nom || !row.prenom || !row.dateNaissance) {
      report.rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'rne_elu_raw',
        bronzeRef: String(row.ligne),
        code: 'MISSING_IDENTITY_FIELDS',
        message: 'nom, prénom ou date de naissance absent',
      })
      continue
    }

    const matchKey = normalizeNameForMatching(row.prenom, row.nom)
    const sourceKey = `${matchKey}|${row.dateNaissance}`

    candidates.push({
      sourceKey,
      candidate: {
        matchKey,
        birthDate: row.dateNaissance,
        districtCode: normalizeDistrictCode(row.codeCirconscription),
        externalIds: [{ source: RNE_SOURCE, kind: RNE_DERIVED_KEY_KIND, value: sourceKey }],
        // Le RNE ne rapporte pas d'élection ; seule la CNCCFP renseigne ces champs.
        electionDate: null,
        uniqueInDistrict: false,
      },
    })
  }

  const decisions = await readDecisions(decisionsPath)
  assertDecisionsAreResolvable(
    decisions,
    RNE_SOURCE,
    new Set(candidates.map((entry) => entry.sourceKey)),
    decisionsPath,
  )

  const index = await buildKnownPersonIndex(prisma)

  for (const { sourceKey, candidate } of candidates) {
    const existing = await prisma.identityMatch.findUnique({
      where: { naturalKey: `${RNE_SOURCE}|${sourceKey}` },
    })

    const verdict = await resolveAndRecordIdentity(prisma, index, decisions, {
      sourceId: RNE_SOURCE,
      sourceKey,
      candidate,
      attachExternalIdentifier: { kind: RNE_DERIVED_KEY_KIND, value: sourceKey },
    })

    if (existing) {
      report.unchanged++
    } else {
      report.created++
    }
    if (!verdict.autoMergeable) report.pending++
  }

  return report
}
