import type { PrismaClient } from '@poligraph/db'
import { asArray, textOf } from '@poligraph/domain'
import type { ImportRunRef, StageReport } from '../../contract.js'
import { recordRejection } from '../../run/import-run.js'
import { readJsonEntries } from '../../zip.js'
import { rawString } from './raw-value.js'

interface MandatNode {
  uid?: string
  acteurRef?: string
  legislature?: unknown
  typeOrgane?: string
  dateDebut?: unknown
  dateFin?: unknown
  infosQualite?: { codeQualite?: unknown }
  organes?: { organeRef?: unknown }
  election?: {
    lieu?: {
      region?: unknown
      departement?: unknown
      numDepartement?: unknown
      numCirco?: unknown
    }
    causeMandat?: unknown
    refCirconscription?: unknown
  }
  mandature?: { causeFin?: unknown }
}

interface ActeurNode {
  uid?: unknown
  etatCivil?: {
    ident?: {
      civ?: unknown
      prenom?: unknown
      nom?: unknown
      alpha?: unknown
      trigramme?: unknown
    }
    infoNaissance?: {
      dateNais?: unknown
      villeNais?: unknown
      depNais?: unknown
      paysNais?: unknown
    }
    dateDeces?: unknown
  }
  profession?: { libelleCourant?: unknown }
  uri_hatvp?: unknown
  mandats?: { mandat?: MandatNode | MandatNode[] | null }
}

export async function stageActeurs(
  prisma: PrismaClient,
  archivePath: string,
  run: ImportRunRef,
): Promise<StageReport> {
  let staged = 0
  let rejected = 0

  for await (const entry of readJsonEntries(archivePath, 'json/acteur/')) {
    const acteur = (entry.json as { acteur?: ActeurNode }).acteur
    const uid = textOf(acteur?.uid)

    if (!acteur || !uid) {
      rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'an_acteur_raw',
        bronzeRef: entry.name,
        code: 'MISSING_UID',
        message: 'acteur sans uid exploitable',
      })
      continue
    }

    const ident = acteur.etatCivil?.ident
    const naissance = acteur.etatCivil?.infoNaissance

    await prisma.anActeurRaw.upsert({
      where: { importRunId_uid: { importRunId: run.id, uid } },
      update: {},
      create: {
        importRunId: run.id,
        entryName: entry.name,
        uid,
        civ: rawString(ident?.civ),
        prenom: rawString(ident?.prenom),
        nom: rawString(ident?.nom),
        alpha: rawString(ident?.alpha),
        trigramme: rawString(ident?.trigramme),
        dateNais: rawString(naissance?.dateNais),
        villeNais: rawString(naissance?.villeNais),
        depNais: rawString(naissance?.depNais),
        paysNais: rawString(naissance?.paysNais),
        dateDeces: rawString(acteur.etatCivil?.dateDeces),
        profession: rawString(acteur.profession?.libelleCourant),
        uriHatvp: rawString(acteur.uri_hatvp),
        payload: acteur as object,
      },
    })
    staged++

    for (const mandat of asArray(acteur.mandats?.mandat)) {
      if (!mandat.uid || !mandat.typeOrgane) {
        rejected++
        await recordRejection(prisma, run, {
          bronzeTable: 'an_mandat_raw',
          bronzeRef: entry.name,
          code: 'MISSING_MANDAT_FIELDS',
          message: `mandat sans uid ou typeOrgane pour ${uid}`,
        })
        continue
      }

      await prisma.anMandatRaw.upsert({
        where: { importRunId_uid: { importRunId: run.id, uid: mandat.uid } },
        update: {},
        create: {
          importRunId: run.id,
          uid: mandat.uid,
          acteurRef: mandat.acteurRef ?? uid,
          legislature: rawString(mandat.legislature),
          typeOrgane: mandat.typeOrgane,
          dateDebut: rawString(mandat.dateDebut),
          dateFin: rawString(mandat.dateFin),
          codeQualite: rawString(mandat.infosQualite?.codeQualite),
          organeRef: rawString(mandat.organes?.organeRef),
          numCirco: rawString(mandat.election?.lieu?.numCirco),
          numDepartement: rawString(mandat.election?.lieu?.numDepartement),
          region: rawString(mandat.election?.lieu?.region),
          departement: rawString(mandat.election?.lieu?.departement),
          causeMandat: rawString(mandat.election?.causeMandat),
          refCirconscription: rawString(mandat.election?.refCirconscription),
          causeFin: rawString(mandat.mandature?.causeFin),
          payload: mandat as object,
        },
      })
    }
  }

  return { staged, rejected }
}
