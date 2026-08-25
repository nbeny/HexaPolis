import type { PrismaClient } from '@poligraph/db'
import {
  bodyTypeFromOrganeCode,
  buildDisplayName,
  mandateTypeFromTypeOrgane,
  normalizeNameForMatching,
} from '@poligraph/domain'
import type { ImportRunRef, NormalizeReport } from '../../contract.js'
import { recordRejection } from '../../run/import-run.js'

const AN_INSTITUTION_CODE = 'ASSEMBLEE_NATIONALE'

function toDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Clé naturelle textuelle. Prisma refuse une valeur nulle dans une clé unique
 * composée, or une date de début peut manquer : on la sérialise en « NA ».
 */
function naturalKey(...parts: (string | null | undefined)[]): string {
  return parts.map((part) => part ?? 'NA').join('::')
}

async function recordProvenance(
  prisma: PrismaClient,
  run: ImportRunRef,
  entityType: string,
  entityId: string,
  bronzeTable: string,
  bronzeRef: string,
): Promise<void> {
  const existing = await prisma.provenance.findFirst({
    where: { entityType, entityId, importRunId: run.id, bronzeRef },
  })
  if (existing) return
  await prisma.provenance.create({
    data: { entityType, entityId, importRunId: run.id, bronzeTable, bronzeRef, status: 'OFFICIAL' },
  })
}

export async function normalizeAn(
  prisma: PrismaClient,
  run: ImportRunRef,
): Promise<NormalizeReport> {
  const report: NormalizeReport = {
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    pending: 0,
  }

  const institution = await prisma.institution.upsert({
    where: { code: AN_INSTITUTION_CODE },
    update: {},
    create: { code: AN_INSTITUTION_CODE, label: 'Assemblée nationale' },
  })

  // --- Organes : Body pour les organes parlementaires, Territory pour les circonscriptions
  const organeToBody = new Map<string, string>()
  const organeToTerritory = new Map<string, string>()

  const organes = await prisma.anOrganeRaw.findMany({ where: { importRunId: run.id } })
  for (const organe of organes) {
    if (organe.codeType === 'CIRCONSCRIPTION') {
      const code = `${organe.departementCode ?? '00'}-${organe.numero ?? '0'}`
      const territory = await prisma.territory.upsert({
        where: { type_code: { type: 'CIRCONSCRIPTION', code } },
        update: { label: organe.libelle ?? code },
        create: { type: 'CIRCONSCRIPTION', code, label: organe.libelle ?? code },
      })
      organeToTerritory.set(organe.uid, territory.id)
      continue
    }

    const bodyType = bodyTypeFromOrganeCode(organe.codeType)
    if (!bodyType) continue

    const existingId = await prisma.externalIdentifier.findUnique({
      where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ORGANE_UID', value: organe.uid } },
    })

    let bodyId = existingId?.ownerId
    if (!bodyId) {
      const legislature = organe.legislature
        ? await prisma.legislature.upsert({
            where: { number: Number(organe.legislature) },
            update: {},
            create: { number: Number(organe.legislature) },
          })
        : null

      const body = await prisma.body.create({
        data: {
          type: bodyType,
          label: organe.libelle ?? organe.uid,
          shortLabel: organe.libelleAbrege ?? organe.libelleAbrev,
          legislatureId: legislature?.id ?? null,
          startDate: toDate(organe.dateDebut),
          endDate: toDate(organe.dateFin),
          color: organe.couleurAssociee,
        },
      })
      bodyId = body.id
      report.created++
      await prisma.externalIdentifier.create({
        data: { ownerType: 'Body', ownerId: body.id, sourceId: 'AN', kind: 'ORGANE_UID', value: organe.uid },
      })
      await recordProvenance(prisma, run, 'Body', body.id, 'an_organe_raw', organe.uid)
    } else {
      report.unchanged++
    }
    organeToBody.set(organe.uid, bodyId)
  }

  // --- Acteurs : Person + identifiant externe
  const acteurToPerson = new Map<string, string>()
  const acteurs = await prisma.anActeurRaw.findMany({ where: { importRunId: run.id } })

  for (const acteur of acteurs) {
    if (!acteur.prenom || !acteur.nom) {
      report.rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'an_acteur_raw',
        bronzeRef: acteur.uid,
        code: 'MISSING_NAME',
        message: 'prénom ou nom absent',
      })
      continue
    }

    const identifier = await prisma.externalIdentifier.findUnique({
      where: { sourceId_kind_value: { sourceId: 'AN', kind: 'ACTEUR_UID', value: acteur.uid } },
    })

    let personId = identifier?.ownerId
    if (!personId) {
      const person = await prisma.person.create({
        data: {
          displayName: buildDisplayName({ civ: acteur.civ, prenom: acteur.prenom, nom: acteur.nom }),
          firstName: acteur.prenom,
          lastName: acteur.nom,
          matchKey: normalizeNameForMatching(acteur.prenom, acteur.nom),
          civility: acteur.civ,
          birthDate: toDate(acteur.dateNais),
          birthPlace: acteur.villeNais,
          deathDate: toDate(acteur.dateDeces),
          profession: acteur.profession,
        },
      })
      personId = person.id
      report.created++
      await prisma.externalIdentifier.create({
        data: { ownerType: 'Person', ownerId: person.id, sourceId: 'AN', kind: 'ACTEUR_UID', value: acteur.uid },
      })
      await recordProvenance(prisma, run, 'Person', person.id, 'an_acteur_raw', acteur.uid)
    } else {
      report.unchanged++
    }

    await prisma.personNameVariant.upsert({
      where: {
        personId_form_sourceId: {
          personId,
          form: `${acteur.nom} ${acteur.prenom}`,
          sourceId: 'AN',
        },
      },
      update: {},
      create: { personId, form: `${acteur.nom} ${acteur.prenom}`, sourceId: 'AN' },
    })

    acteurToPerson.set(acteur.uid, personId)
  }

  // --- Mandats
  const mandats = await prisma.anMandatRaw.findMany({ where: { importRunId: run.id } })
  for (const mandat of mandats) {
    const personId = acteurToPerson.get(mandat.acteurRef)
    if (!personId) {
      report.pending++
      continue
    }

    const kind = mandateTypeFromTypeOrgane(mandat.typeOrgane)
    if (!kind) continue

    // Une adhésion à un parti n'est pas un mandat parlementaire : elle attend
    // l'entité PoliticalParty (plan 3) plutôt que d'être rattachée à la mauvaise institution.
    if (kind === 'PARTY_AFFILIATION') {
      report.pending++
      continue
    }

    if (kind === 'BODY_MEMBERSHIP') {
      const bodyId = mandat.organeRef ? organeToBody.get(mandat.organeRef) : undefined
      if (!bodyId) {
        report.pending++
        continue
      }
      const key = naturalKey(personId, bodyId, mandat.dateDebut)
      await prisma.bodyMembership.upsert({
        where: { naturalKey: key },
        update: { endDate: toDate(mandat.dateFin), quality: mandat.codeQualite },
        create: {
          naturalKey: key,
          personId,
          bodyId,
          quality: mandat.codeQualite,
          startDate: toDate(mandat.dateDebut),
          endDate: toDate(mandat.dateFin),
        },
      })
      continue
    }

    const legislature = mandat.legislature
      ? await prisma.legislature.upsert({
          where: { number: Number(mandat.legislature) },
          update: {},
          create: { number: Number(mandat.legislature) },
        })
      : null

    const territoryId = mandat.refCirconscription
      ? (organeToTerritory.get(mandat.refCirconscription) ?? null)
      : null

    const key = naturalKey(personId, institution.id, kind, mandat.dateDebut)
    const created = await prisma.mandate.upsert({
      where: { naturalKey: key },
      update: { endDate: toDate(mandat.dateFin), endCause: mandat.causeFin, territoryId },
      create: {
        naturalKey: key,
        personId,
        institutionId: institution.id,
        legislatureId: legislature?.id ?? null,
        territoryId,
        kind,
        startDate: toDate(mandat.dateDebut),
        endDate: toDate(mandat.dateFin),
        endCause: mandat.causeFin,
      },
    })

    await recordProvenance(prisma, run, 'Mandate', created.id, 'an_mandat_raw', mandat.uid)
  }

  return report
}
