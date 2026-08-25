import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, StageReport } from '../../contract.js'
import { readCsvRows } from '../../csv.js'

/**
 * Charge le RNE tel quel en bronze : valeurs inchangées, dates encore sous
 * forme de chaînes. C'est la normalisation qui interprète, pas le staging.
 *
 * Le RNE ne publie aucun identifiant de ligne stable ; `ligne` (le numéro de
 * ligne de données, 1-indexé) en tient lieu de référence bronze.
 */
export async function stageRne(
  prisma: PrismaClient,
  path: string,
  run: ImportRunRef,
): Promise<StageReport> {
  let staged = 0
  let ligne = 0

  for await (const row of readCsvRows(path, 'utf-8')) {
    ligne++
    await prisma.rneEluRaw.upsert({
      where: { importRunId_ligne: { importRunId: run.id, ligne } },
      update: {},
      create: {
        importRunId: run.id,
        ligne,
        codeDepartement: row['Code du département'] || null,
        libelleDepartement: row['Libellé du département'] || null,
        codeCirconscription: row['Code de la circonscription législative'] || null,
        libelleCirco: row['Libellé de la circonscription législative'] || null,
        nom: row["Nom de l'élu"] || null,
        prenom: row["Prénom de l'élu"] || null,
        codeSexe: row['Code sexe'] || null,
        dateNaissance: row['Date de naissance'] || null,
        codeCsp: row['Code de la catégorie socio-professionnelle'] || null,
        libelleCsp: row['Libellé de la catégorie socio-professionnelle'] || null,
        dateDebutMandat: row['Date de début du mandat'] || null,
        payload: row,
      },
    })
    staged++
  }

  return { staged, rejected: 0 }
}
