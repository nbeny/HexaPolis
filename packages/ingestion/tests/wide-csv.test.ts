import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  countCandidateBlocks,
  parseWideRow,
  readWideCsvRows,
  type WideResultRow,
} from '../src/adapters/resultats/wide-csv.js'

const T1 = fileURLToPath(new URL('../fixtures/resultats-t1-sample.csv', import.meta.url))
const T2 = fileURLToPath(new URL('../fixtures/resultats-t2-sample.csv', import.meta.url))

async function readAll(path: string): Promise<WideResultRow[]> {
  const rows: WideResultRow[] = []
  for await (const row of readWideCsvRows(path, 'utf-8')) rows.push(row)
  return rows
}

describe('countCandidateBlocks', () => {
  it('déduit 4 blocs d’un en-tête à 54 colonnes, et 19 d’un en-tête à 189 colonnes', () => {
    expect(countCandidateBlocks(54)).toBe(4)
    expect(countCandidateBlocks(189)).toBe(19)
  })

  it('lève une exception sur une largeur qui ne se ramène pas à 18 + un multiple de 9', () => {
    expect(() => countCandidateBlocks(53)).toThrow()
    expect(() => countCandidateBlocks(17)).toThrow()
  })
})

describe('readWideCsvRows sur les fichiers réels réduits', () => {
  it('le fichier du 1er tour (189 colonnes) rend 19 candidats pour ZZ09, tous blocs remplis', async () => {
    const rows = await readAll(T1)
    const zz09 = rows.find((r) => r.fixedColumns[2] === 'ZZ09')

    expect(zz09).toBeDefined()
    expect(zz09?.candidates).toHaveLength(19)
    expect(zz09?.candidates.map((c) => c.rang)).toEqual(
      Array.from({ length: 19 }, (_, i) => i + 1),
    )
    // 1er tour : cette circonscription ne tranche pas, aucun élu.
    expect(zz09?.candidates.every((c) => c.elu === false)).toBe(true)
  })

  it('un bloc dont le nom est vide n’est pas rendu, même sur un en-tête à 19 blocs', async () => {
    const rows = await readAll(T1)
    const circo205 = rows.find((r) => r.fixedColumns[2] === '205')

    // L'en-tête porte 19 blocs, mais seuls 5 candidats se sont présentés :
    // les 14 blocs vides ne doivent pas produire 14 enregistrements creux.
    expect(circo205?.candidates).toHaveLength(5)
    expect(circo205?.candidates.every((c) => c.nom.trim() !== '')).toBe(true)
  })

  it('le vainqueur peut être le premier candidat de la ligne', async () => {
    const rows = await readAll(T1)
    const circo205 = rows.find((r) => r.fixedColumns[2] === '205')

    const elus = circo205?.candidates.filter((c) => c.elu)
    expect(elus).toHaveLength(1)
    expect(elus?.[0]).toMatchObject({ rang: 1, nom: 'DESSIGNY', prenom: 'Jocelyn' })
  })

  it('le vainqueur peut être dans un bloc tardif, pas le premier', async () => {
    const rows = await readAll(T1)
    const circo901 = rows.find((r) => r.fixedColumns[2] === '901')

    expect(circo901?.candidates).toHaveLength(4)
    const elus = circo901?.candidates.filter((c) => c.elu)
    expect(elus).toHaveLength(1)
    expect(elus?.[0]).toMatchObject({ rang: 4, nom: 'FROGER', prenom: 'Martine' })
    // Les trois autres blocs, y compris ceux qui précèdent le vainqueur, ne sont pas élus.
    expect(circo901?.candidates.filter((c) => !c.elu)).toHaveLength(3)
  })

  it('le fichier du 2nd tour (54 colonnes) rend 4 blocs, et le cas au maximum du fichier', async () => {
    const rows = await readAll(T2)
    const circo6908 = rows.find((r) => r.fixedColumns[2] === '6908')

    expect(circo6908?.candidates).toHaveLength(4)
    expect(circo6908?.candidates.map((c) => c.rang)).toEqual([1, 2, 3, 4])
  })

  it('le champ Elu non vide devient true, vide devient false — jamais null', async () => {
    const rows = await readAll(T2)
    const circo0101 = rows.find((r) => r.fixedColumns[2] === '0101')

    const maitre = circo0101?.candidates.find((c) => c.nom === 'MAÎTRE')
    const breton = circo0101?.candidates.find((c) => c.nom === 'BRETON')
    expect(maitre?.elu).toBe(false)
    expect(breton?.elu).toBe(true)
    expect(typeof maitre?.elu).toBe('boolean')
    expect(typeof breton?.elu).toBe('boolean')
  })

  it('les voix et les pourcentages sont rendus tels quels, en chaînes, sans conversion', async () => {
    const rows = await readAll(T2)
    const circo0101 = rows.find((r) => r.fixedColumns[2] === '0101')
    const breton = circo0101?.candidates.find((c) => c.nom === 'BRETON')

    expect(breton?.voix).toBe('33889')
    expect(typeof breton?.voix).toBe('string')
    // Format source : virgule décimale et signe pourcent conservés tels quels
    // (« 39,02% », pas 0.3902) — la conversion appartient à la normalisation.
    expect(breton?.pctInscrits).toBe('39,02%')
    expect(breton?.pctExprimes).toBe('56,48%')
    expect(typeof breton?.pctInscrits).toBe('string')
    expect(typeof breton?.pctExprimes).toBe('string')
  })

  it('numérote les lignes de données à partir de 1', async () => {
    const rows = await readAll(T2)
    expect(rows.map((r) => r.ligne)).toEqual([1, 2, 3])
  })
})

describe('parseWideRow sur une ligne tronquée', () => {
  // Aucun fichier réel n'est tronqué (voir scripts/build-resultats-fixtures.py) :
  // ce cas est construit à la main pour prouver la robustesse du dépivotage.
  const header = [
    ...Array.from({ length: 18 }, (_, i) => `fixe${i + 1}`),
    'panneau1',
    'nuance1',
    'nom1',
    'prenom1',
    'sexe1',
    'voix1',
    'pctIns1',
    'pctExp1',
    'elu1',
    'panneau2',
    'nuance2',
    'nom2',
    'prenom2',
    'sexe2',
    'voix2',
    'pctIns2',
    'pctExp2',
    'elu2',
  ]

  it('ne lève pas d’exception et rend les blocs complets qu’une ligne courte contient', () => {
    // 18 colonnes fixes + 1 bloc complet (9) + un second bloc amputé de ses
    // 3 derniers champs : seul le premier bloc doit être rendu.
    const fixed = Array.from({ length: 18 }, (_, i) => `v${i + 1}`)
    const blocComplet = ['1', 'RN', 'DUPONT', 'Jean', 'MASCULIN', '100', '10,00%', '20,00%', 'élu']
    const blocAmpute = ['2', 'LR', 'MARTIN', 'Alice', 'FEMININ', '80', '8,00%']
    const row = [...fixed, ...blocComplet, ...blocAmpute]

    expect(() => parseWideRow(header, row)).not.toThrow()
    const candidates = parseWideRow(header, row)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ rang: 1, nom: 'DUPONT', elu: true })
  })

  it('rend un tableau vide, sans lever, quand même le premier bloc est absent', () => {
    const fixed = Array.from({ length: 10 }, (_, i) => `v${i + 1}`) // moins que les 18 colonnes fixes
    expect(() => parseWideRow(header, fixed)).not.toThrow()
    expect(parseWideRow(header, fixed)).toEqual([])
  })
})
