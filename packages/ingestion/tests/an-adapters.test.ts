import { describe, expect, it } from 'vitest'
import { AnScrutinsAdapter, LEGISLATURES_DISPONIBLES } from '../src/adapters/an/an-scrutins.adapter.js'
import { AnActeursAdapter } from '../src/adapters/an/an-acteurs.adapter.js'
import { SourceFileClient } from '../src/http/source-file-client.js'

// Ni base ni réseau : on ne vérifie que les descripteurs.
const prisma = null as never
const client = new SourceFileClient('.data/test-unused')

describe('AnScrutinsAdapter.discover', () => {
  it('couvre les quatre législatures par défaut', async () => {
    const descriptors = await new AnScrutinsAdapter(prisma, client).discover()
    expect(descriptors).toHaveLength(4)
    expect(descriptors.map((d) => d.datasetExternalId)).toEqual([
      'scrutins-14',
      'scrutins-15',
      'scrutins-16',
      'scrutins-17',
    ])
  })

  it('emploie le nom de fichier propre à chaque législature', async () => {
    const descriptors = await new AnScrutinsAdapter(prisma, client).discover()
    const parLegislature = Object.fromEntries(
      descriptors.map((d) => [d.datasetExternalId, d.url]),
    )
    expect(parLegislature['scrutins-14']).toContain('/14/loi/scrutins/Scrutins_XIV.json.zip')
    expect(parLegislature['scrutins-15']).toContain('/15/loi/scrutins/Scrutins_XV.json.zip')
    expect(parLegislature['scrutins-16']).toContain('/16/loi/scrutins/Scrutins.json.zip')
    expect(parLegislature['scrutins-17']).toContain('/17/loi/scrutins/Scrutins.json.zip')
  })

  it('distingue les ressources qui partagent un nom de fichier', async () => {
    const descriptors = await new AnScrutinsAdapter(prisma, client).discover()
    const ids = descriptors.map((d) => d.resourceExternalId)
    // Les 16e et 17e publient toutes deux « Scrutins.json.zip » : sans préfixe,
    // le cache du client HTTP servirait les octets de l'une pour l'autre.
    expect(new Set(ids).size).toBe(4)
  })

  it('restreint aux législatures demandées', async () => {
    const descriptors = await new AnScrutinsAdapter(prisma, client, [17]).discover()
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]?.datasetExternalId).toBe('scrutins-17')
  })

  it('refuse une législature non couverte', async () => {
    await expect(new AnScrutinsAdapter(prisma, client, [13]).discover()).rejects.toThrow(/13/)
  })

  it('expose les quatre législatures disponibles', () => {
    expect([...LEGISLATURES_DISPONIBLES]).toEqual([14, 15, 16, 17])
  })
})

describe('AnActeursAdapter.discover', () => {
  it('rend AMO10 puis AMO30, dans cet ordre', async () => {
    const descriptors = await new AnActeursAdapter(prisma, client).discover()
    expect(descriptors).toHaveLength(2)
    expect(descriptors[0]?.datasetExternalId).toBe('amo10-17')
    expect(descriptors[1]?.datasetExternalId).toBe('amo30-historique')
  })

  it('pointe AMO30 sur le fichier historique publié sous la 17e', async () => {
    const [, amo30] = await new AnActeursAdapter(prisma, client).discover()
    expect(amo30?.url).toContain('tous_acteurs_mandats_organes_xi_legislature')
    expect(amo30?.url).toContain('AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip')
  })
})
