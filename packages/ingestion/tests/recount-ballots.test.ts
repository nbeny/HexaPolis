import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { recountBallots } from '../src/checks/recount-ballots.js'
import { stageScrutins } from '../src/adapters/an/stage-scrutins.js'
import { openImportRun } from '../src/run/import-run.js'
import { resetDatabase, testPrisma } from './helpers/db.js'
import type { ResourceDescriptor } from '../src/contract.js'

const ECLATES = fileURLToPath(new URL('../fixtures/an-scrutins-eclates-sample.zip', import.meta.url))
const MONOLITHE = fileURLToPath(
  new URL('../fixtures/an-scrutins-monolithe-sample.zip', import.meta.url),
)
const prisma = testPrisma()

const descriptor: ResourceDescriptor = {
  sourceKey: 'AN',
  datasetExternalId: 'scrutins',
  datasetTitle: 'Scrutins',
  resourceExternalId: 'Scrutins.json.zip',
  url: 'https://example.invalid/Scrutins.json.zip',
  format: 'zip',
}

async function stage(fixture: string, checksum: string): Promise<void> {
  const run = await openImportRun(prisma, descriptor, checksum)
  if (!run) throw new Error('run attendu')
  await stageScrutins(prisma, fixture, run)
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('recountBallots', () => {
  it('ne signale aucun écart quand le détail nominatif est complet', async () => {
    await stage(ECLATES, 'c1')

    const report = await recountBallots(prisma)

    expect(report.checked).toBe(5)
    expect(report.skipped).toBe(0)
    expect(report.mismatches).toHaveLength(0)
  })

  it('écarte les scrutins publiés sans détail nominatif complet', async () => {
    await stage(MONOLITHE, 'c2')

    const report = await recountBallots(prisma)

    // VTANR5L14V1 est en DecompteNominatif et doit être vérifié.
    // VTANR5L14V2 est en DecompteDissidentsPositionGroupe : la source ne
    // publie que les dissidents et les non-votants, l'écart y est normal.
    expect(report.checked).toBe(1)
    expect(report.skipped).toBe(1)
    expect(report.mismatches).toHaveLength(0)
  })

  it('signale un écart réel avec le détail des catégories', async () => {
    await stage(ECLATES, 'c3')

    // On retire deux positions « pour » d'un scrutin dont le détail est complet :
    // c'est exactement ce que produirait un parseur qui en perdrait en silence.
    const victimes = await prisma.anPositionRaw.findMany({
      where: { scrutinUid: 'VTANR5L17V2657', categorie: 'POUR' },
      take: 2,
    })
    await prisma.anPositionRaw.deleteMany({ where: { id: { in: victimes.map((v) => v.id) } } })

    const report = await recountBallots(prisma)

    expect(report.mismatches).toHaveLength(1)
    const ecart = report.mismatches[0]
    expect(ecart?.scrutinUid).toBe('VTANR5L17V2657')
    expect(ecart?.legislature).toBe('17')
    expect(ecart?.official.POUR).toBe(121)
    expect(ecart?.counted.POUR).toBe(119)
    // Les autres catégories restent identiques et ne doivent pas être signalées à tort.
    expect(ecart?.official.CONTRE).toBe(ecart?.counted.CONTRE)
  })

  it('détecte aussi un excédent, pas seulement un manque', async () => {
    await stage(ECLATES, 'c4')

    const modele = await prisma.anPositionRaw.findFirstOrThrow({
      where: { scrutinUid: 'VTANR5L17V2657', categorie: 'POUR' },
    })
    await prisma.anPositionRaw.create({
      data: {
        importRunId: modele.importRunId,
        scrutinUid: modele.scrutinUid,
        acteurRef: 'PA000000',
        categorie: 'POUR',
        groupeRef: modele.groupeRef,
        mandatRef: null,
        parDelegation: 'false',
        numPlace: null,
      },
    })

    const report = await recountBallots(prisma)

    expect(report.mismatches).toHaveLength(1)
    expect(report.mismatches[0]?.counted.POUR).toBe(122)
  })

  it('ne signale rien quand aucun scrutin n’est importé', async () => {
    const report = await recountBallots(prisma)

    expect(report.checked).toBe(0)
    expect(report.skipped).toBe(0)
    expect(report.mismatches).toHaveLength(0)
  })

  it('ne recompte pas en double un scrutin republié dans un nouvel import', async () => {
    // L'AN republie régulièrement Scrutins.json.zip. Un nouveau checksum ouvre
    // un nouveau run, et le bronze garde l'ancienne ligne : les deux jeux de
    // lignes bronze coexistent pour les mêmes scrutins, exactement comme le
    // laisserait une vraie republication.
    await stage(ECLATES, 'c5-premier-import')
    await stage(ECLATES, 'c5-second-import')

    const report = await recountBallots(prisma)

    expect(report.checked).toBe(5)
    expect(report.mismatches).toHaveLength(0)
  })
})
