import type { PrismaClient } from '@poligraph/db'
import type { ImportRunRef, NormalizeReport } from '../../contract.js'

/** Le volume (2,46 millions de positions) interdit tout traitement ligne à ligne. */
const BATCH_SIZE = 5000

function toDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function toInt(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

function naturalKey(...parts: (string | null | undefined)[]): string {
  return parts.map((part) => part ?? 'NA').join('::')
}

export async function normalizeScrutins(
  prisma: PrismaClient,
  run: ImportRunRef,
): Promise<NormalizeReport> {
  const report: NormalizeReport = { created: 0, updated: 0, unchanged: 0, rejected: 0, pending: 0 }

  // Résolution des députés et des groupes en une fois : réinterroger la base
  // pour chacune des 2,46 millions de positions serait rédhibitoire.
  const personByActeur = new Map<string, string>()
  for (const identifier of await prisma.externalIdentifier.findMany({
    where: { sourceId: 'AN', kind: 'ACTEUR_UID', ownerType: 'Person' },
    select: { value: true, ownerId: true },
  })) {
    personByActeur.set(identifier.value, identifier.ownerId)
  }

  const bodyByOrgane = new Map<string, string>()
  for (const identifier of await prisma.externalIdentifier.findMany({
    where: { sourceId: 'AN', kind: 'ORGANE_UID', ownerType: 'Body' },
    select: { value: true, ownerId: true },
  })) {
    bodyByOrgane.set(identifier.value, identifier.ownerId)
  }

  const legislatureByNumber = new Map<number, string>()
  async function resolveLegislature(raw: string | null): Promise<string | null> {
    if (!raw) return null
    const number = Number(raw)
    if (Number.isNaN(number)) return null
    const cached = legislatureByNumber.get(number)
    if (cached) return cached
    const legislature = await prisma.legislature.upsert({
      where: { number },
      update: {},
      create: { number },
    })
    legislatureByNumber.set(number, legislature.id)
    return legislature.id
  }

  const ballotByUid = new Map<string, string>()
  const scrutins = await prisma.anScrutinRaw.findMany({ where: { importRunId: run.id } })

  for (const scrutin of scrutins) {
    const key = naturalKey('AN', scrutin.uid)
    const legislatureId = await resolveLegislature(scrutin.legislature)

    const existing = await prisma.parliamentaryBallot.findUnique({ where: { naturalKey: key } })

    const ballot = await prisma.parliamentaryBallot.upsert({
      where: { naturalKey: key },
      update: { outcomeCode: scrutin.sortCode, outcomeLabel: scrutin.sortLibelle },
      create: {
        naturalKey: key,
        legislatureId,
        number: scrutin.numero,
        date: toDate(scrutin.dateScrutin),
        title: scrutin.titre,
        voteTypeCode: scrutin.codeTypeVote,
        voteTypeLabel: scrutin.libelleTypeVote,
        outcomeCode: scrutin.sortCode,
        outcomeLabel: scrutin.sortLibelle,
        publicationMode: scrutin.modePublication,
        officialFor: toInt(scrutin.decomptePour),
        officialAgainst: toInt(scrutin.decompteContre),
        officialAbstention: toInt(scrutin.decompteAbstentions),
        officialNonVoting: toInt(scrutin.decompteNonVotants),
      },
    })

    if (existing) {
      report.updated++
    } else {
      report.created++
      await prisma.provenance.create({
        data: {
          entityType: 'ParliamentaryBallot',
          entityId: ballot.id,
          importRunId: run.id,
          bronzeTable: 'an_scrutin_raw',
          bronzeRef: scrutin.uid,
          status: 'OFFICIAL',
        },
      })
    }

    ballotByUid.set(scrutin.uid, ballot.id)
  }

  // Positions : lues et écrites par lots. L'unicité de natural_key est déjà
  // garantie par la contrainte en base ; dupliquer cette invariance dans un
  // Set JS coûterait environ un demi-gigaoctet à l'échelle de production
  // (2,46 millions de lignes) pour ne rien apporter de plus. createMany avec
  // skipDuplicates suffit, y compris pour les doublons internes à un même lot.
  let cursor: bigint | undefined
  let buffer: {
    naturalKey: string
    ballotId: string
    personId: string
    position: string
    byDelegation: boolean
    bodyIdAtVote: string | null
  }[] = []

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return
    const attempted = buffer.length
    const inserted = await prisma.ballotPosition.createMany({ data: buffer, skipDuplicates: true })
    report.created += inserted.count
    report.unchanged += attempted - inserted.count
    buffer = []
  }

  for (;;) {
    const page = await prisma.anPositionRaw.findMany({
      where: { importRunId: run.id },
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: BATCH_SIZE,
    })
    if (page.length === 0) break
    cursor = page[page.length - 1]?.id

    for (const raw of page) {
      const ballotId = ballotByUid.get(raw.scrutinUid)
      const personId = personByActeur.get(raw.acteurRef)
      if (!ballotId || !personId) {
        report.pending++
        continue
      }

      buffer.push({
        naturalKey: naturalKey(ballotId, personId),
        ballotId,
        personId,
        position: raw.categorie,
        byDelegation: raw.parDelegation === 'true',
        bodyIdAtVote: raw.groupeRef ? (bodyByOrgane.get(raw.groupeRef) ?? null) : null,
      })
    }

    if (buffer.length >= BATCH_SIZE) await flush()
  }

  await flush()
  return report
}
