import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@poligraph/db'
import { toNumber } from '../common/numeric.js'
import { FactStatus } from '../common/fact-status.enum.js'
import { PRISMA_CLIENT } from '../prisma.provider.js'

export interface MandateRow {
  id: string
  kind: string
  institutionLabel: string
  legislatureNumber: number | null
  territoryCode: string | null
  territoryLabel: string | null
  startDate: Date | null
  endDate: Date | null
  endCause: string | null
}

export interface BodyMembershipRow {
  id: string
  bodyType: string
  bodyLabel: string
  bodyShortLabel: string | null
  bodyColor: string | null
  quality: string | null
  startDate: Date | null
  endDate: Date | null
}

export interface CampaignAccountRow {
  currency: string
  declaredExpenses: number | null
  declaredIncome: number | null
  declaredDonations: number | null
  personalFunds: number | null
  retainedExpenses: number | null
  retainedIncome: number | null
  decisionCode: string | null
}

export interface CandidacyRow {
  id: string
  electionLabel: string
  electionYear: number
  territoryCode: string | null
  territoryLabel: string | null
  partyName: string | null
  nuance: string | null
  displayName: string
  round: number | null
  votes: number | null
  votePctRegistered: number | null
  votePctExpressed: number | null
  elected: boolean
  account: CampaignAccountRow | null
}

export interface ProvenanceRow {
  entityType: string
  entityId: string
  field: string | null
  importRunId: string
  bronzeTable: string
  bronzeRef: string
  status: FactStatus
  source: { sourceId: string; label: string; importedAt: Date | null } | null
}

export interface SourceRefRow {
  sourceId: string
  label: string
  importedAt: Date | null
}

/**
 * Lit `silver` directement pour tout ce que `gold` ne projette pas :
 * mandats, appartenances (groupes et commissions), candidatures, provenance.
 * Toujours à jour au dernier import — contrairement à `gold.deputy_card` et
 * `gold.deputy_vote`, jamais figé par le rafraîchissement des vues. Voir
 * l'auto-revue de tâche.
 */
@Injectable()
export class SilverRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async mandatesForPerson(personId: string): Promise<MandateRow[]> {
    const mandates = await this.prisma.mandate.findMany({
      where: { personId },
      include: { institution: true, legislature: true, territory: true },
      orderBy: [{ startDate: 'desc' }],
    })
    return mandates.map((m) => ({
      id: m.id,
      kind: m.kind,
      institutionLabel: m.institution.label,
      legislatureNumber: m.legislature?.number ?? null,
      territoryCode: m.territory?.code ?? null,
      territoryLabel: m.territory?.label ?? null,
      startDate: m.startDate,
      endDate: m.endDate,
      endCause: m.endCause,
    }))
  }

  async membershipsForPerson(
    personId: string,
    bodyType: 'PARLIAMENTARY_GROUP' | 'COMMITTEE',
  ): Promise<BodyMembershipRow[]> {
    const memberships = await this.prisma.bodyMembership.findMany({
      where: { personId, body: { type: bodyType } },
      include: { body: true },
      orderBy: [{ startDate: 'desc' }],
    })
    return memberships.map((bm) => ({
      id: bm.id,
      bodyType: bm.body.type,
      bodyLabel: bm.body.label,
      bodyShortLabel: bm.body.shortLabel,
      bodyColor: bm.body.color,
      quality: bm.quality,
      startDate: bm.startDate,
      endDate: bm.endDate,
    }))
  }

  async candidaciesForPerson(personId: string): Promise<CandidacyRow[]> {
    const candidacies = await this.prisma.candidacy.findMany({
      where: { personId },
      include: { election: true, territory: true, party: true, account: true },
      orderBy: [{ election: { year: 'desc' } }],
    })
    return candidacies.map((c) => ({
      id: c.id,
      electionLabel: c.election.label,
      electionYear: c.election.year,
      territoryCode: c.territory?.code ?? null,
      territoryLabel: c.territory?.label ?? null,
      partyName: c.party?.name ?? null,
      nuance: c.nuance,
      displayName: c.displayName,
      round: c.round,
      votes: c.votes,
      votePctRegistered: toNumber(c.votePctRegistered),
      votePctExpressed: toNumber(c.votePctExpressed),
      elected: c.elected,
      account: c.account
        ? {
            currency: c.account.currency,
            declaredExpenses: toNumber(c.account.declaredExpenses),
            declaredIncome: toNumber(c.account.declaredIncome),
            declaredDonations: toNumber(c.account.declaredDonations),
            personalFunds: toNumber(c.account.personalFunds),
            retainedExpenses: toNumber(c.account.retainedExpenses),
            retainedIncome: toNumber(c.account.retainedIncome),
            decisionCode: c.account.decisionCode,
          }
        : null,
    }))
  }

  /**
   * Descend jusqu'à la ligne bronze (spec §8.2). `field` non fourni renvoie
   * toute la provenance de l'entité, faits au niveau champ compris ; fourni,
   * il filtre sur ce champ précis (`p.field = field`, pas d'égalité NULL).
   */
  async provenanceFor(
    entityType: string,
    entityId: string,
    field?: string,
  ): Promise<ProvenanceRow[]> {
    interface Raw {
      entity_type: string
      entity_id: string
      field: string | null
      import_run_id: string
      bronze_table: string
      bronze_ref: string
      status: string
      source_id: string | null
      source_label: string | null
      imported_at: Date | null
    }

    const rows =
      field === undefined
        ? await this.prisma.$queryRaw<Raw[]>`
            SELECT p.entity_type, p.entity_id, p.field, p.import_run_id, p.bronze_table,
                   p.bronze_ref, p.status,
                   s.id AS source_id, s.label AS source_label, ir.finished_at AS imported_at
            FROM silver.provenance p
            LEFT JOIN silver.import_run ir ON ir.id = p.import_run_id
            LEFT JOIN silver.dataset_resource r ON r.id = ir.resource_id
            LEFT JOIN silver.dataset d ON d.id = r.dataset_id
            LEFT JOIN silver.source s ON s.id = d.source_id
            WHERE p.entity_type = ${entityType} AND p.entity_id = ${entityId}
          `
        : await this.prisma.$queryRaw<Raw[]>`
            SELECT p.entity_type, p.entity_id, p.field, p.import_run_id, p.bronze_table,
                   p.bronze_ref, p.status,
                   s.id AS source_id, s.label AS source_label, ir.finished_at AS imported_at
            FROM silver.provenance p
            LEFT JOIN silver.import_run ir ON ir.id = p.import_run_id
            LEFT JOIN silver.dataset_resource r ON r.id = ir.resource_id
            LEFT JOIN silver.dataset d ON d.id = r.dataset_id
            LEFT JOIN silver.source s ON s.id = d.source_id
            WHERE p.entity_type = ${entityType} AND p.entity_id = ${entityId} AND p.field = ${field}
          `

    return rows.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      field: r.field,
      importRunId: r.import_run_id,
      bronzeTable: r.bronze_table,
      bronzeRef: r.bronze_ref,
      status: (r.status as FactStatus) ?? FactStatus.OFFICIAL,
      source:
        r.source_id && r.source_label
          ? { sourceId: r.source_id, label: r.source_label, importedAt: r.imported_at }
          : null,
    }))
  }

  /** Sources distinctes référencées par la provenance d'une entité — spec §8.2, niveau objet. */
  async sourcesForEntity(entityType: string, entityId: string): Promise<SourceRefRow[]> {
    interface Raw {
      source_id: string
      label: string
      imported_at: Date | null
    }
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT DISTINCT ON (s.id) s.id AS source_id, s.label, ir.finished_at AS imported_at
      FROM silver.provenance p
      JOIN silver.import_run ir ON ir.id = p.import_run_id
      JOIN silver.dataset_resource r ON r.id = ir.resource_id
      JOIN silver.dataset d ON d.id = r.dataset_id
      JOIN silver.source s ON s.id = d.source_id
      WHERE p.entity_type = ${entityType} AND p.entity_id = ${entityId}
      ORDER BY s.id, ir.finished_at DESC NULLS LAST
    `
    return rows.map((r) => ({ sourceId: r.source_id, label: r.label, importedAt: r.imported_at }))
  }
}
