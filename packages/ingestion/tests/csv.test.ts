import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readCsvRows } from '../src/csv.js'

const RNE = fileURLToPath(new URL('../fixtures/rne-deputes-sample.csv', import.meta.url))
const CNCCFP = fileURLToPath(
  new URL('../fixtures/cnccfp-legislatives-2022-sample.csv', import.meta.url),
)

describe('readCsvRows', () => {
  it('lit un CSV UTF-8 séparé par des points-virgules', async () => {
    const rows = []
    for await (const row of readCsvRows(RNE, 'utf-8')) rows.push(row)

    expect(rows).toHaveLength(8)
    // L'apostrophe de l'en-tête RNE est l'ASCII U+0027, vérifié sur les octets
    // du fichier : accéder à la forme typographique renverrait undefined.
    expect(rows[0]?.["Nom de l'élu"]).toBeDefined()
  })

  it('lit un CSV cp1252 sans corrompre les accents', async () => {
    const rows = []
    for await (const row of readCsvRows(CNCCFP, 'cp1252')) rows.push(row)

    expect(rows).toHaveLength(11)
    const gueraud = rows.find((r) => String(r['nom']).includes('RAUD'))
    // Lu en UTF-8, cet accent deviendrait un caractère de remplacement.
    expect(gueraud?.['nom']).toContain('É')
  })

  it('conserve les valeurs telles quelles, sans conversion', async () => {
    const rows = []
    for await (const row of readCsvRows(CNCCFP, 'cp1252')) rows.push(row)

    const cfp = rows.find((r) => r['monnaie'] === 'CFP')
    expect(typeof cfp?.['dépenses totales déclarées']).toBe('string')
  })

  it('libère le fichier si le consommateur s’arrête en cours de route', async () => {
    let lues = 0
    for await (const _ of readCsvRows(CNCCFP, 'cp1252')) {
      lues++
      if (lues === 2) break
    }
    expect(lues).toBe(2)

    // Une relecture complète juste après doit fonctionner : Node détruit le flux
    // via le protocole d'itération asynchrone, sans qu'un `finally` soit requis
    // — contrairement à `readJsonEntries`, où le handle yauzl se ferme à la main.
    const toutes = []
    for await (const row of readCsvRows(CNCCFP, 'cp1252')) toutes.push(row)
    expect(toutes).toHaveLength(11)
  })
})
