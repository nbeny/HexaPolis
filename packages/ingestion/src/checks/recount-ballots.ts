import type { PrismaClient } from '@poligraph/db'

export interface BallotMismatch {
  scrutinUid: string
  legislature: string | null
  official: Record<string, number>
  counted: Record<string, number>
}

export interface RecountReport {
  checked: number
  skipped: number
  mismatches: BallotMismatch[]
}

/** Seul ce mode garantit que toutes les positions sont publiées nominativement. */
const MODE_COMPLET = 'DecompteNominatif'

const CATEGORIES = ['POUR', 'CONTRE', 'ABSTENTION', 'NON_VOTANT'] as const

/**
 * Recompte les positions importées et les confronte aux décomptes publiés par l'AN.
 * Un écart révèle un défaut de lecture : c'est le contrôle le plus rentable du projet.
 *
 * Les scrutins publiés en « dissidents et position de groupe » sont écartés :
 * l'AN n'y nomme que les dissidents et les non-votants, l'écart y est donc normal.
 * Les signaler noierait les anomalies réelles sous des centaines de fausses alertes.
 *
 * L'AN republie régulièrement ses archives ; chaque republication ouvre un
 * nouveau run et laisse en place les lignes bronze du précédent (le bronze
 * garde l'historique par conception). Un même scrutin peut donc avoir
 * plusieurs lignes bronze, une par run qui l'a importé : on ne recompte que
 * celle du run le plus récent, sans quoi une republication ferait crier au
 * loup sur des milliers de scrutins parfaitement sains.
 */
export async function recountBallots(prisma: PrismaClient): Promise<RecountReport> {
  const report: RecountReport = { checked: 0, skipped: 0, mismatches: [] }

  const scrutins = await prisma.anScrutinRaw.findMany({
    select: {
      uid: true,
      importRunId: true,
      legislature: true,
      modePublication: true,
      decomptePour: true,
      decompteContre: true,
      decompteAbstentions: true,
      decompteNonVotants: true,
    },
  })
  if (scrutins.length === 0) return report

  // `importRunId` est un UUID, non ordonnable en lui-même : on passe par
  // `ImportRun.startedAt` pour savoir quel run est le plus récent.
  const runIds = [...new Set(scrutins.map((s) => s.importRunId))]
  const runs = await prisma.importRun.findMany({
    where: { id: { in: runIds } },
    select: { id: true, startedAt: true },
  })
  const startedAtByRun = new Map(runs.map((r) => [r.id, r.startedAt.getTime()]))

  // Une seule ligne bronze retenue par scrutin : celle du run le plus récent.
  const dernierParUid = new Map<string, (typeof scrutins)[number]>()
  for (const scrutin of scrutins) {
    const precedent = dernierParUid.get(scrutin.uid)
    const startedAt = startedAtByRun.get(scrutin.importRunId) ?? 0
    const startedAtPrecedent = precedent ? (startedAtByRun.get(precedent.importRunId) ?? 0) : -1
    if (!precedent || startedAt > startedAtPrecedent) {
      dernierParUid.set(scrutin.uid, scrutin)
    }
  }

  const comptes = await prisma.anPositionRaw.groupBy({
    by: ['scrutinUid', 'importRunId', 'categorie'],
    where: { scrutinUid: { in: [...dernierParUid.keys()] } },
    _count: { _all: true },
  })

  const parScrutin = new Map<string, Record<string, number>>()
  for (const ligne of comptes) {
    // Les positions d'un run qui n'est plus le dernier pour ce scrutin sont
    // ignorées : ce sont les mêmes votes, importés deux fois.
    const retenu = dernierParUid.get(ligne.scrutinUid)
    if (!retenu || retenu.importRunId !== ligne.importRunId) continue

    const courant = parScrutin.get(ligne.scrutinUid) ?? {}
    courant[ligne.categorie] = ligne._count._all
    parScrutin.set(ligne.scrutinUid, courant)
  }

  for (const scrutin of dernierParUid.values()) {
    if (scrutin.modePublication !== MODE_COMPLET) {
      report.skipped++
      continue
    }
    report.checked++

    const official: Record<string, number> = {
      POUR: Number(scrutin.decomptePour ?? 0),
      CONTRE: Number(scrutin.decompteContre ?? 0),
      ABSTENTION: Number(scrutin.decompteAbstentions ?? 0),
      NON_VOTANT: Number(scrutin.decompteNonVotants ?? 0),
    }
    const brut = parScrutin.get(scrutin.uid) ?? {}
    const counted: Record<string, number> = {}
    for (const categorie of CATEGORIES) counted[categorie] = brut[categorie] ?? 0

    if (!CATEGORIES.every((c) => official[c] === counted[c])) {
      report.mismatches.push({
        scrutinUid: scrutin.uid,
        legislature: scrutin.legislature,
        official,
        counted,
      })
    }
  }

  return report
}
