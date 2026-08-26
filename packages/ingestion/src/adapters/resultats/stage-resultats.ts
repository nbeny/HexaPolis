import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, StageReport } from '../../contract.js'
import { readWideCsvRows, type WideCandidate } from './wide-csv.js'

/**
 * Charge les résultats électoraux (format large) tels quels en bronze : une
 * ligne par candidat dépivoté, valeurs inchangées. Le dépivotage lui-même
 * (nombre de blocs déduit de l'en-tête, bloc vide non rendu) est déjà fait
 * par `readWideCsvRows` (tâche 2) — ce module se contente d'écrire une ligne
 * bronze par candidat rendu, sans réinterpréter quoi que ce soit.
 *
 * `(ligne, rang)` est la référence bronze : le fichier source ne porte aucun
 * identifiant de candidature.
 */
export async function stageResultats(
  prisma: PrismaClient,
  path: string,
  run: ImportRunRef,
): Promise<StageReport> {
  let staged = 0

  for await (const row of readWideCsvRows(path, 'utf-8', ';')) {
    for (const candidate of row.candidates) {
      await prisma.electionResultRaw.upsert({
        where: { importRunId_ligne_rang: { importRunId: run.id, ligne: row.ligne, rang: candidate.rang } },
        update: {},
        create: {
          importRunId: run.id,
          ligne: row.ligne,
          rang: candidate.rang,
          codeDepartement: row.fixedColumns[0] || null,
          codeCirconscription: row.fixedColumns[2] || null,
          libelleCirco: row.fixedColumns[3] || null,
          inscrits: row.fixedColumns[4] || null,
          votants: row.fixedColumns[5] || null,
          exprimes: row.fixedColumns[9] || null,
          blancs: row.fixedColumns[12] || null,
          nuls: row.fixedColumns[15] || null,
          nuance: candidate.nuance || null,
          nom: candidate.nom || null,
          prenom: candidate.prenom || null,
          sexe: candidate.sexe || null,
          voix: candidate.voix || null,
          pctInscrits: candidate.pctInscrits || null,
          pctExprimes: candidate.pctExprimes || null,
          elu: eluAsString(candidate),
          payload: { fixedColumns: row.fixedColumns, candidate: { ...candidate } },
        },
      })
      staged++
    }
  }

  return { staged, rejected: 0 }
}

/**
 * Le champ `Elu` brut du fichier est déjà réduit à un booléen par
 * `readWideCsvRows` (tâche 2) : la chaîne d'origine (« élu » ou vide) n'est
 * plus disponible à ce stade. On le recode en chaîne pour la colonne bronze
 * `elu` (typée `String?`), sans prétendre restituer le texte source exact —
 * seule la normalisation (tâche 3) lit ce champ, comme `row.elu === 'true'`.
 */
function eluAsString(candidate: WideCandidate): string {
  return String(candidate.elu)
}
