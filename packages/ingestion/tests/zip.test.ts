import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readJsonEntries } from '../src/zip.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/an-amo10-sample.zip', import.meta.url))

describe('readJsonEntries', () => {
  it('itère uniquement les entrées du préfixe demandé', async () => {
    const names: string[] = []
    for await (const entry of readJsonEntries(FIXTURE, 'json/acteur/')) {
      names.push(entry.name)
    }
    expect(names).toHaveLength(3)
    expect(names.every((n) => n.startsWith('json/acteur/'))).toBe(true)
  })

  it('itère les organes du même fichier', async () => {
    const names: string[] = []
    for await (const entry of readJsonEntries(FIXTURE, 'json/organe/')) {
      names.push(entry.name)
    }
    expect(names).toHaveLength(36)
  })

  it('décode le JSON en UTF-8', async () => {
    for await (const entry of readJsonEntries(FIXTURE, 'json/acteur/')) {
      expect(entry.json).toHaveProperty('acteur')
      return
    }
    throw new Error('aucune entrée lue')
  })

  it('renvoie une itération vide pour un préfixe inconnu', async () => {
    const names: string[] = []
    for await (const entry of readJsonEntries(FIXTURE, 'json/inexistant/')) {
      names.push(entry.name)
    }
    expect(names).toEqual([])
  })
})
