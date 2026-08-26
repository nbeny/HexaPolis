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
  //
  // L'ordre de lecture est imposé, il ne peut pas être laissé au moteur.
  // Plusieurs mandats publiés partagent parfois la même clé naturelle (voir
  // `earliestTakingOffice` ci-dessous) : le dernier upsert du groupe écrase
  // alors `endDate`, `endCause` et `territoryId` des précédents. Sans `orderBy`,
  // ce « dernier » est l'ordre physique des lignes bronze, que n'importe quel
  // UPDATE sur la table redistribue — un simple remplissage de colonne a suffi
  // à faire basculer 17 mandats de la 17e législature d'un état à l'autre, et
  // avec eux la présence de députés en exercice dans `gold.deputy_card`.
  //
  // Trier par date de prise de fonction croissante fait gagner le mandat le
  // plus récemment pris : c'est le dernier état publié du siège, donc la seule
  // `endDate` qui décrit la situation d'aujourd'hui. Un ancien ministre revenu
  // siéger garde ainsi son mandat ouvert au lieu de porter la date de fin de
  // son premier passage. `uid` départage à égalité de date, pour que deux
  // exécutions sur le même bronze produisent le même silver.
  const mandats = await prisma.anMandatRaw.findMany({
    where: { importRunId: run.id },
    orderBy: [{ datePriseFonction: { sort: 'asc', nulls: 'first' } }, { uid: 'asc' }],
  })

  /**
   * Clé naturelle d'un mandat non-organe. Extraite pour que le passage
   * préalable ci-dessous et l'upsert plus bas ne puissent pas diverger.
   */
  const mandateKey = (personId: string, kind: string, dateDebut: string | null): string =>
    naturalKey(personId, institution.id, kind, dateDebut)

  /**
   * Date d'entrée en fonction la plus ancienne par clé naturelle de mandat.
   *
   * L'Assemblée publie parfois plusieurs mandats de même `dateDebut` pour une
   * même personne — un député élu aux générales, nommé au gouvernement, puis
   * reprenant son mandat en produit deux, tous deux ouverts au 2024-07-07 mais
   * avec des `datePriseFonction` différentes. Ces mandats partagent donc la
   * clé naturelle et se fondent déjà en une seule ligne silver : 120 groupes
   * sur les 4 531 mandats ASSEMBLEE du bronze, dont 27 sur la 17e législature.
   *
   * La clé naturelle n'est délibérément pas modifiée pour les séparer : en
   * changer la formule est une migration de données, pas une correction de
   * code (spec §6.2, incident réel sur `BodyMembership`). Il faut donc choisir
   * une valeur pour la ligne fusionnée, et ce passage préalable retient la
   * plus ancienne :
   *
   * - c'est la seule qui ne retranche du dénominateur de participation aucune
   *   période réellement exercée — retenir la plus récente effacerait le
   *   premier passage à l'Assemblée d'un ancien ministre ;
   * - elle ne dépend pas de l'ordre de lecture des lignes bronze, contrairement
   *   au « dernier écrit gagne » qu'un simple upsert dans la boucle
   *   produirait : le dénominateur serait alors différent d'un import à
   *   l'autre sans qu'aucune donnée n'ait changé.
   *
   * Les dates AN sont au format `YYYY-MM-DD` (vérifié : longueur 10 sur les
   * 4 531 valeurs publiées), dont l'ordre lexicographique est l'ordre
   * chronologique.
   */
  const earliestTakingOffice = new Map<string, string>()
  for (const mandat of mandats) {
    if (!mandat.datePriseFonction) continue
    const personId = acteurToPerson.get(mandat.acteurRef)
    if (!personId) continue
    const kind = mandateTypeFromTypeOrgane(mandat.typeOrgane)
    if (!kind || kind === 'PARTY_AFFILIATION' || kind === 'BODY_MEMBERSHIP') continue

    const key = mandateKey(personId, kind, mandat.dateDebut)
    const known = earliestTakingOffice.get(key)
    if (known === undefined || mandat.datePriseFonction < known) {
      earliestTakingOffice.set(key, mandat.datePriseFonction)
    }
  }

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
      // La qualité fait partie de la clé : un député peut être à la fois
      // membre et titulaire d'une fonction (président, secrétaire...) du
      // même organe à la même date. Ce sont deux faits distincts publiés
      // séparément par l'AN ; sans la qualité dans la clé, le second upsert
      // écrase silencieusement le premier (ex. une présidence de commission
      // disparaît derrière la simple appartenance, ou l'inverse selon
      // l'ordre de traitement).
      const key = naturalKey(personId, bodyId, mandat.dateDebut, mandat.codeQualite)
      // Contrairement à Person/Body, cet upsert réécrit endDate/quality sur une
      // ligne existante : ce n'est jamais un no-op, donc « updated » et non
      // « unchanged » lorsque la ligne préexistait déjà.
      const existingMembership = await prisma.bodyMembership.findUnique({ where: { naturalKey: key } })
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
      if (existingMembership) {
        report.updated++
      } else {
        report.created++
      }
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

    const key = mandateKey(personId, kind, mandat.dateDebut)
    // `startDate` porte `dateDebut` — l'ouverture du mandat du siège — et
    // `takingOfficeDate` la date d'entrée en fonction de la personne. La
    // seconde n'écrase pas la première : ce sont deux faits publiés, tous deux
    // vrais, qui répondent à deux questions différentes. C'est la vue
    // `gold.deputy_card` qui choisit laquelle ouvre la fenêtre de
    // participation, et elle retombe explicitement sur `startDate` quand la
    // source ne publie pas d'entrée en fonction.
    //
    // Écrite aussi dans `update` : sans cela, une renormalisation sur des
    // mandats déjà écrits laisserait la colonne vide, puisque la clé naturelle
    // est inchangée et que toutes les lignes existantes passent par cette
    // branche. La valeur vient du passage préalable, jamais de `mandat`
    // directement : voir `earliestTakingOffice`.
    const takingOfficeDate = toDate(earliestTakingOffice.get(key) ?? null)
    // Comme pour BodyMembership, cet upsert réécrit endDate/endCause/territoryId
    // sur une ligne existante : « updated », jamais « unchanged ».
    const existingMandate = await prisma.mandate.findUnique({ where: { naturalKey: key } })
    const created = await prisma.mandate.upsert({
      where: { naturalKey: key },
      update: {
        endDate: toDate(mandat.dateFin),
        endCause: mandat.causeFin,
        territoryId,
        takingOfficeDate,
      },
      create: {
        naturalKey: key,
        personId,
        institutionId: institution.id,
        legislatureId: legislature?.id ?? null,
        territoryId,
        kind,
        startDate: toDate(mandat.dateDebut),
        takingOfficeDate,
        endDate: toDate(mandat.dateFin),
        endCause: mandat.causeFin,
      },
    })
    if (existingMandate) {
      report.updated++
    } else {
      report.created++
    }

    await recordProvenance(prisma, run, 'Mandate', created.id, 'an_mandat_raw', mandat.uid)
  }

  return report
}
