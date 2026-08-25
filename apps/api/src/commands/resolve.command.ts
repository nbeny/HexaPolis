import { Injectable } from '@nestjs/common'
import { Command, CommandRunner, Option } from 'nest-commander'
import { getPrisma, type IdentityMatch, type PrismaClient } from '@poligraph/db'

/** Niveaux de confiance qui n'ont *pas* été fusionnés automatiquement par la
 * cascade et qui attendent donc un arbitrage humain. `CONFIRMED` en est
 * délibérément absent : ces enregistrements-là sont déjà résolus. */
const PENDING_CONFIDENCES = [
  'PROBABLE',
  'POSSIBLE',
  'AMBIGUOUS',
  'CONFLICT',
  'UNMATCHED',
] as const
type PendingConfidence = (typeof PENDING_CONFIDENCES)[number]

/** Du plus grave au moins grave : une contradiction entre sources mérite d'être
 * vue avant une simple absence de correspondance. */
const SEVERITY_ORDER: readonly PendingConfidence[] = [
  'CONFLICT',
  'AMBIGUOUS',
  'PROBABLE',
  'POSSIBLE',
  'UNMATCHED',
]

const SOURCES = ['RNE', 'CNCCFP', 'AN', 'DATA_GOUV'] as const
type SourceKeyOption = (typeof SOURCES)[number]

const ACTIONS = ['review'] as const

const DEFAULT_LIMIT = 50

interface ResolveCommandOptions {
  source?: SourceKeyOption
  confidence?: PendingConfidence
  limit?: number
}

interface PersonSummary {
  personId: string
  displayName: string
  birthDate: string | null
  constituency: string | null
  /** Référence externe (source, clé) permettant de retrouver cette personne au
   * niveau 1 de la cascade — voir `resolvePersonForRecord` dans
   * `packages/ingestion/src/identity/resolve-identity.ts`. `null` si cette
   * personne n'a, anormalement, aucun identifiant externe connu. */
  anchor: { source: string; key: string } | null
}

@Injectable()
@Command({
  name: 'resolve',
  arguments: '<action>',
  description:
    "Lit la file d'arbitrage d'identité (silver.identity_match) sans jamais l'écrire",
})
export class ResolveCommand extends CommandRunner {
  async run(passedParams: string[], options: ResolveCommandOptions): Promise<void> {
    const [action] = passedParams

    if (!action || !(ACTIONS as readonly string[]).includes(action)) {
      console.error(`Action inconnue : ${action ?? '(aucune)'}`)
      console.error(`Actions disponibles : ${ACTIONS.join(', ')}`)
      process.exitCode = 1
      return
    }

    const prisma = getPrisma()
    try {
      await this.review(prisma, options)
    } finally {
      await prisma.$disconnect()
    }
  }

  @Option({
    flags: '--source <source>',
    description: `Filtre par source (${SOURCES.join(', ')})`,
  })
  parseSource(value: string): SourceKeyOption {
    if (!(SOURCES as readonly string[]).includes(value)) {
      throw new Error(`Source inconnue : ${value}. Valeurs acceptées : ${SOURCES.join(', ')}.`)
    }
    return value as SourceKeyOption
  }

  @Option({
    flags: '--confidence <niveau>',
    description: `Filtre par un niveau de confiance (${PENDING_CONFIDENCES.join(', ')})`,
  })
  parseConfidence(value: string): PendingConfidence {
    if (!(PENDING_CONFIDENCES as readonly string[]).includes(value)) {
      throw new Error(
        `Niveau de confiance inconnu : ${value}. Valeurs acceptées : ${PENDING_CONFIDENCES.join(', ')}.`,
      )
    }
    return value as PendingConfidence
  }

  @Option({
    flags: '--limit <n>',
    description: `Nombre maximal d'entrées affichées (défaut : ${DEFAULT_LIMIT})`,
  })
  parseLimit(value: string): number {
    const n = Number.parseInt(value, 10)
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`--limit doit être un entier positif (reçu : ${value})`)
    }
    return n
  }

  private async review(prisma: PrismaClient, options: ResolveCommandOptions): Promise<void> {
    const limit = options.limit ?? DEFAULT_LIMIT

    const matches = await prisma.identityMatch.findMany({
      where: {
        confidence: options.confidence ? options.confidence : { not: 'CONFIRMED' },
        ...(options.source ? { sourceId: options.source } : {}),
      },
      orderBy: [{ sourceId: 'asc' }, { sourceKey: 'asc' }],
    })

    // La sortie non nulle guette une CONTRADICTION entre sources, pas
    // seulement ce qui est affiché : un --limit qui tronque la liste ne doit
    // jamais masquer un CONFLICT présent dans le résultat filtré.
    const hasConflict = matches.some((match) => match.confidence === 'CONFLICT')

    const ordered = [...matches].sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.confidence as PendingConfidence) -
        SEVERITY_ORDER.indexOf(b.confidence as PendingConfidence),
    )
    const total = ordered.length
    const displayed = ordered.slice(0, limit)

    if (total === 0) {
      console.log("Aucun rapprochement en attente : la file d'arbitrage est vide.")
    } else {
      const candidateIds = [
        ...new Set(
          displayed.flatMap((match) =>
            [match.personId, ...match.alternatives].filter((id): id is string => Boolean(id)),
          ),
        ),
      ]
      const people = await this.loadPeople(prisma, candidateIds)

      let currentGroup: string | null = null
      for (const match of displayed) {
        if (match.confidence !== currentGroup) {
          currentGroup = match.confidence
          const count = displayed.filter((m) => m.confidence === currentGroup).length
          console.log(`\n=== ${currentGroup} (${count}) ===`)
        }
        this.printEntry(match, people)
      }

      if (total > displayed.length) {
        console.log(
          `\n… ${total - displayed.length} entrée(s) supplémentaire(s) non affichée(s) (total : ${total}). Utilisez --limit pour en voir plus.`,
        )
      }

      console.log("\n--- Bloc YAML à coller dans data/identity-decisions.yaml ---")
      this.printYamlBlock(displayed, people)
    }

    const filtres = [
      options.source ? `source ${options.source}` : null,
      options.confidence ? `confiance ${options.confidence}` : null,
    ].filter((f): f is string => f !== null)
    const suffix = filtres.length > 0 ? ` (${filtres.join(', ')})` : ''
    console.log(`\nTotal : ${total} rapprochement(s) en attente${suffix}.`)

    // Une contradiction entre sources doit arrêter une chaîne automatisée ;
    // un simple rapprochement en attente, non.
    if (hasConflict) {
      process.exitCode = 1
    }
  }

  private async loadPeople(
    prisma: PrismaClient,
    personIds: string[],
  ): Promise<Map<string, PersonSummary>> {
    const summaries = new Map<string, PersonSummary>()
    if (personIds.length === 0) return summaries

    const persons = await prisma.person.findMany({
      where: { id: { in: personIds } },
      select: {
        id: true,
        displayName: true,
        birthDate: true,
        mandates: {
          orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }],
          take: 1,
          select: { territory: { select: { code: true, label: true } } },
        },
      },
    })

    const identifiers = await prisma.externalIdentifier.findMany({
      where: { ownerType: 'Person', ownerId: { in: personIds } },
    })
    const anchorsByPerson = new Map<string, { source: string; key: string }>()
    for (const identifier of identifiers) {
      const existing = anchorsByPerson.get(identifier.ownerId)
      // Préfère un identifiant AN : chaque personne existante a été créée par
      // l'import AN, qui lui attache systématiquement un tel identifiant
      // (`normalize.ts`) — c'est donc l'ancre la plus fiable pour qu'une
      // décision de rapprochement retrouve la personne au prochain import.
      if (!existing || (identifier.sourceId === 'AN' && existing.source !== 'AN')) {
        anchorsByPerson.set(identifier.ownerId, {
          source: identifier.sourceId,
          key: identifier.value,
        })
      }
    }

    for (const person of persons) {
      const mandate = person.mandates[0]
      summaries.set(person.id, {
        personId: person.id,
        displayName: person.displayName,
        birthDate: person.birthDate ? person.birthDate.toISOString().slice(0, 10) : null,
        constituency: mandate?.territory ? `${mandate.territory.label} (${mandate.territory.code})` : null,
        anchor: anchorsByPerson.get(person.id) ?? null,
      })
    }
    return summaries
  }

  private candidateIdsOf(match: IdentityMatch): string[] {
    return [...new Set([match.personId, ...match.alternatives].filter((id): id is string => Boolean(id)))]
  }

  private printEntry(match: IdentityMatch, people: Map<string, PersonSummary>): void {
    console.log(`\n${match.sourceId} / ${match.sourceKey}  [${match.confidence}]`)
    console.log(`  Preuves    : ${match.evidence.length > 0 ? match.evidence.join(', ') : '(aucune)'}`)

    const candidateIds = this.candidateIdsOf(match)
    if (candidateIds.length === 0) {
      console.log('  Candidats  : aucun (aucune personne connue ne correspond)')
      return
    }

    console.log('  Candidats  :')
    for (const id of candidateIds) {
      const person = people.get(id)
      if (!person) {
        console.log(`    - ${id} (personne introuvable en base — anomalie)`)
        continue
      }
      const naissance = person.birthDate ?? 'date de naissance inconnue'
      const circo = person.constituency ?? 'aucun mandat connu'
      const marker = id === match.personId ? '*' : ' '
      console.log(`    ${marker} ${person.displayName} — né(e) le ${naissance} — ${circo}  [${person.personId}]`)
    }
  }

  /**
   * Un bloc YAML prêt à coller, jamais à écrire nous-mêmes : l'arbitrage
   * reste un acte humain, tracé dans git. `reason` est laissé vide à
   * dessein — une raison pré-remplie par la machine viderait le fichier de
   * son sens (voir l'en-tête de `data/identity-decisions.yaml`).
   */
  private printYamlBlock(displayed: IdentityMatch[], people: Map<string, PersonSummary>): void {
    const today = new Date().toISOString().slice(0, 10)
    const notes: string[] = []
    const entries: string[] = []

    for (const match of displayed) {
      const candidateIds = this.candidateIdsOf(match)

      if (candidateIds.length === 0) {
        // UNMATCHED : la cascade n'a proposé personne. Un MERGE n'a de sens
        // que si l'humain retrouve lui-même la bonne personne par un autre
        // moyen (recherche manuelle) — nous ne pouvons pas deviner "right".
        notes.push(
          `# ${match.sourceId} / ${match.sourceKey} [UNMATCHED] : aucun candidat proposé. ` +
            `Un MERGE n'est possible que si vous identifiez vous-même la personne visée ` +
            `(recherche manuelle) ; complétez alors "right" à la main. Sinon, aucune décision requise.`,
        )
        continue
      }

      for (const id of candidateIds) {
        const person = people.get(id)
        const anchor = person?.anchor
        const rightSourceLine = anchor
          ? `      source: ${JSON.stringify(anchor.source)}`
          : `      source: "A_COMPLETER"  # aucun identifiant externe connu pour ${JSON.stringify(person?.displayName ?? id)} — à renseigner après vérification manuelle`
        const rightKeyLine = anchor
          ? `      key: ${JSON.stringify(anchor.key)}`
          : `      key: "A_COMPLETER"`

        entries.push(
          [
            `  - decision: MERGE  # ou SPLIT si ce n'est PAS la même personne`,
            `    left:`,
            `      source: ${JSON.stringify(match.sourceId)}`,
            `      key: ${JSON.stringify(match.sourceKey)}`,
            `    right:`,
            rightSourceLine,
            rightKeyLine,
            `    reason: ""  # OBLIGATOIRE : à remplir par l'humain qui arbitre`,
            `    decidedOn: ${JSON.stringify(today)}`,
          ].join('\n'),
        )
      }
    }

    if (notes.length > 0) {
      console.log(notes.join('\n'))
    }
    console.log('decisions:')
    console.log(entries.length > 0 ? entries.join('\n') : '  []')
  }
}
