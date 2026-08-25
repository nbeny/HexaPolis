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
 */
export async function recountBallots(prisma: PrismaClient): Promise<RecountReport> {
  const report: RecountReport = { checked: 0, skipped: 0, mismatches: [] }

  const scrutins = await prisma.anScrutinRaw.findMany({
    select: {
      uid: true,
      legislature: true,
      modePublication: true,
      decomptePour: true,
      decompteContre: true,
      decompteAbstentions: true,
      decompteNonVotants: true,
    },
  })

  const comptes = await prisma.anPositionRaw.groupBy({
    by: ['scrutinUid', 'categorie'],
    _count: { _all: true },
  })

  const parScrutin = new Map<string, Record<string, number>>()
  for (const ligne of comptes) {
    const courant = parScrutin.get(ligne.scrutinUid) ?? {}
    courant[ligne.categorie] = ligne._count._all
    parScrutin.set(ligne.scrutinUid, courant)
  }

  for (const scrutin of scrutins) {
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
