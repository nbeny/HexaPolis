import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, StageReport } from '../../contract.js'
import { readCsvRows } from '../../csv.js'

/**
 * Charge les comptes de campagne CNCCFP tels quels en bronze : valeurs
 * inchangées, montants encore sous forme de chaînes (« - » ou vide pour un
 * montant absent). C'est la normalisation qui interprète, pas le staging.
 *
 * Le fichier contient des lignes corrompues (tous les champs à `0`). Elles
 * atterrissent en bronze comme les autres — bronze est fidèle à ce qui a été
 * publié — et sont rejetées avec trace lors de la normalisation, seule étape
 * qui sait qu'un nom « 0 » est inexploitable.
 */
export async function stageCnccfp(
  prisma: PrismaClient,
  path: string,
  run: ImportRunRef,
): Promise<StageReport> {
  let staged = 0
  let ligne = 0

  for await (const row of readCsvRows(path, 'cp1252')) {
    ligne++
    await prisma.cnccfpCompteRaw.upsert({
      where: { importRunId_ligne: { importRunId: run.id, ligne } },
      update: {},
      create: {
        importRunId: run.id,
        ligne,
        candidat: row['candidat'] || null,
        nom: row['nom'] || null,
        scrutin: row['scrutin'] || null,
        circonscription: row['circonscription'] || null,
        departement: row['département'] || null,
        codeDepartement: row['code département'] || null,
        nuance: row['nuance'] || null,
        monnaie: row['monnaie'] || null,
        depensesDeclarees: row['dépenses totales déclarées'] || null,
        recettesDeclarees: row['recettes totales déclarées'] || null,
        donsDeclares: row['dons déclarés'] || null,
        apportPersonnel: row['apport personnel déclaré'] || null,
        depensesRetenues: row['depenses totales retenues'] || null,
        recettesRetenues: row['recettes totales retenues'] || null,
        decision: row['decision'] || null,
        payload: row,
      },
    })
    staged++
  }

  return { staged, rejected: 0 }
}
