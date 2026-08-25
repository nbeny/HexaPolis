import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, StageReport } from '../../contract.js'
import { recordRejection } from '../../run/import-run.js'
import { readJsonEntries } from '../../zip.js'
import { rawString } from './raw-value.js'

interface OrganeNode {
  uid?: string
  codeType?: string
  libelle?: string
  libelleAbrege?: string
  libelleAbrev?: string
  viMoDe?: { dateDebut?: unknown; dateFin?: unknown }
  legislature?: unknown
  numero?: unknown
  couleurAssociee?: unknown
  lieu?: {
    region?: { libelle?: unknown }
    departement?: { code?: unknown }
  }
}

export async function stageOrganes(
  prisma: PrismaClient,
  archivePath: string,
  run: ImportRunRef,
): Promise<StageReport> {
  let staged = 0
  let rejected = 0

  for await (const entry of readJsonEntries(archivePath, 'json/organe/')) {
    const organe = (entry.json as { organe?: OrganeNode }).organe
    if (!organe?.uid || !organe.codeType) {
      rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'an_organe_raw',
        bronzeRef: entry.name,
        code: 'MISSING_UID_OR_TYPE',
        message: 'organe sans uid ou sans codeType',
      })
      continue
    }

    await prisma.anOrganeRaw.upsert({
      where: { importRunId_uid: { importRunId: run.id, uid: organe.uid } },
      update: {},
      create: {
        importRunId: run.id,
        uid: organe.uid,
        codeType: organe.codeType,
        libelle: rawString(organe.libelle),
        libelleAbrege: rawString(organe.libelleAbrege),
        libelleAbrev: rawString(organe.libelleAbrev),
        dateDebut: rawString(organe.viMoDe?.dateDebut),
        dateFin: rawString(organe.viMoDe?.dateFin),
        legislature: rawString(organe.legislature),
        numero: rawString(organe.numero),
        regionLibelle: rawString(organe.lieu?.region?.libelle),
        departementCode: rawString(organe.lieu?.departement?.code),
        couleurAssociee: rawString(organe.couleurAssociee),
        payload: organe as object,
      },
    })
    staged++
  }

  return { staged, rejected }
}
