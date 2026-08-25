import type { PrismaClient } from '@poligraph/db'
import { VOTE_CATEGORY_KEYS, asArray, positionFromCategoryKey } from '@poligraph/domain'
import type { ImportRunRef, StageReport } from '../../contract.js'
import { recordRejection } from '../../run/import-run.js'
import { rawString } from './raw-value.js'
import { readScrutins } from './scrutins-reader.js'

/** Nombre de positions insérées par appel. 2,46 millions de lignes à l'unité prendraient des heures. */
const BATCH_SIZE = 5000

interface PositionRow {
  importRunId: string
  scrutinUid: string
  acteurRef: string
  mandatRef: string | null
  groupeRef: string | null
  categorie: string
  parDelegation: string | null
  numPlace: string | null
}

function get(node: unknown, ...path: string[]): unknown {
  let current: unknown = node
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function extractPositions(
  scrutin: Record<string, unknown>,
  uid: string,
  runId: string,
): PositionRow[] {
  const rows: PositionRow[] = []
  const groupes = get(scrutin, 'ventilationVotes', 'organe', 'groupes', 'groupe')

  for (const groupe of asArray(groupes)) {
    const groupeRef = rawString(get(groupe, 'organeRef'))
    const nominatif = get(groupe, 'vote', 'decompteNominatif')
    if (nominatif === null || typeof nominatif !== 'object') continue

    for (const key of VOTE_CATEGORY_KEYS) {
      const categorie = positionFromCategoryKey(key)
      if (!categorie) continue

      const node = (nominatif as Record<string, unknown>)[key]
      if (node === null || node === undefined || typeof node !== 'object') continue

      for (const votant of asArray((node as { votant?: unknown }).votant)) {
        const acteurRef = rawString(get(votant, 'acteurRef'))
        if (!acteurRef) continue
        rows.push({
          importRunId: runId,
          scrutinUid: uid,
          acteurRef,
          mandatRef: rawString(get(votant, 'mandatRef')),
          groupeRef,
          categorie,
          parDelegation: rawString(get(votant, 'parDelegation')),
          numPlace: rawString(get(votant, 'numPlace')),
        })
      }
    }
  }

  return rows
}

export async function stageScrutins(
  prisma: PrismaClient,
  archivePath: string,
  run: ImportRunRef,
): Promise<StageReport> {
  let staged = 0
  let rejected = 0
  let buffer: PositionRow[] = []

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return
    await prisma.anPositionRaw.createMany({ data: buffer, skipDuplicates: true })
    buffer = []
  }

  for await (const { entryName, scrutin } of readScrutins(archivePath)) {
    const uid = rawString(scrutin.uid)
    if (!uid) {
      rejected++
      await recordRejection(prisma, run, {
        bronzeTable: 'an_scrutin_raw',
        bronzeRef: entryName,
        code: 'MISSING_UID',
        message: 'scrutin sans uid',
      })
      continue
    }

    await prisma.anScrutinRaw.upsert({
      where: { importRunId_uid: { importRunId: run.id, uid } },
      update: {},
      create: {
        importRunId: run.id,
        entryName,
        uid,
        numero: rawString(scrutin.numero),
        legislature: rawString(scrutin.legislature),
        organeRef: rawString(scrutin.organeRef),
        sessionRef: rawString(scrutin.sessionRef),
        seanceRef: rawString(scrutin.seanceRef),
        dateScrutin: rawString(scrutin.dateScrutin),
        codeTypeVote: rawString(get(scrutin, 'typeVote', 'codeTypeVote')),
        libelleTypeVote: rawString(get(scrutin, 'typeVote', 'libelleTypeVote')),
        typeMajorite: rawString(get(scrutin, 'typeVote', 'typeMajorite')),
        sortCode: rawString(get(scrutin, 'sort', 'code')),
        sortLibelle: rawString(get(scrutin, 'sort', 'libelle')),
        titre: rawString(scrutin.titre),
        demandeur: rawString(get(scrutin, 'demandeur', 'texte')),
        modePublication: rawString(scrutin.modePublicationDesVotes),
        nombreVotants: rawString(get(scrutin, 'syntheseVote', 'nombreVotants')),
        suffragesExprimes: rawString(get(scrutin, 'syntheseVote', 'suffragesExprimes')),
        nbrSuffragesRequis: rawString(get(scrutin, 'syntheseVote', 'nbrSuffragesRequis')),
        decomptePour: rawString(get(scrutin, 'syntheseVote', 'decompte', 'pour')),
        decompteContre: rawString(get(scrutin, 'syntheseVote', 'decompte', 'contre')),
        decompteAbstentions: rawString(get(scrutin, 'syntheseVote', 'decompte', 'abstentions')),
        decompteNonVotants: rawString(get(scrutin, 'syntheseVote', 'decompte', 'nonVotants')),
        payload: scrutin as object,
      },
    })
    staged++

    buffer.push(...extractPositions(scrutin, uid, run.id))
    if (buffer.length >= BATCH_SIZE) await flush()
  }

  await flush()
  return { staged, rejected }
}
