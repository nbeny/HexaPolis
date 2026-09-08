import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BodiesSection } from '@/components/sections/bodies-section'
import { ElectionsSection } from '@/components/sections/elections-section'
import { FundingSection } from '@/components/sections/funding-section'
import { IdentitySection } from '@/components/sections/identity-section'
import { MandatesSection } from '@/components/sections/mandates-section'
import { VotingSection } from '@/components/sections/voting-section'
import type { SectionSource } from '@/components/section-card'
import type { DeputyQuery, DeputyQueryVariables } from '@/gql/generated'
import { graphqlFetch } from '@/lib/graphql-fetch'
import { DEPUTY_QUERY } from '@/lib/queries'

/**
 * Aucun `try`/`catch` ici, volontairement. Une panne de l'API doit remonter en
 * page d'erreur : une fiche qui se dégraderait en six sections « donnée non
 * disponible » affirmerait, dans la voix du site, qu'un député réel n'a ni
 * mandat ni vote. `notFound()` ne couvre que le cas où l'API répond
 * correctement qu'aucun député ne porte ce slug.
 */
async function loadDeputy(slug: string): Promise<DeputyQuery['deputy']> {
  const data = await graphqlFetch<DeputyQuery>(DEPUTY_QUERY, {
    slug,
  } satisfies DeputyQueryVariables)
  return data.deputy
}

/**
 * `deputy.sources` est la provenance de la *personne* : toutes les sections
 * n'en dépendent pas. Chacune ne se voit attribuer que les sources qui portent
 * réellement sa donnée ; quand aucune ne correspond, la section n'affiche
 * aucune ligne de provenance plutôt qu'une provenance empruntée.
 */
function sourcesFrom(sources: SectionSource[], ids: string[]): SectionSource[] {
  return sources.filter((source) => ids.includes(source.sourceId))
}

export async function generateMetadata({
  params,
}: {
  // `params` est une promesse depuis Next 15 — l'attendre n'est pas optionnel.
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const deputy = await loadDeputy(slug)
  if (!deputy) return { title: 'Député introuvable — PoliGraph' }
  return {
    title: `${deputy.displayName} — PoliGraph`,
    description: `Fiche de transparence de ${deputy.displayName}${
      deputy.constituencyLabel ? `, ${deputy.constituencyLabel}` : ''
    } : mandats, votes, élections, financement.`,
  }
}

export default async function DeputyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const deputy = await loadDeputy(slug)
  if (!deputy) notFound()

  const anSources = sourcesFrom(deputy.sources, ['AN'])
  const identitySources = sourcesFrom(deputy.sources, ['AN', 'RNE'])
  const electionSources = sourcesFrom(deputy.sources, ['DATA_GOUV'])
  const fundingSources = sourcesFrom(deputy.sources, ['CNCCFP'])

  return (
    <article>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900">{deputy.displayName}</h1>
        <p className="mt-1 text-sm text-stone-600">
          {deputy.constituencyLabel ?? 'Circonscription non publiée'}
          {deputy.currentGroupLabel ? ` · ${deputy.currentGroupLabel}` : ''}
        </p>
      </header>

      <IdentitySection deputy={deputy} sources={identitySources} />
      <MandatesSection mandates={deputy.mandates} sources={anSources} />
      <BodiesSection
        groupMemberships={deputy.groupMemberships}
        committees={deputy.committees}
        sources={anSources}
      />
      <VotingSection
        summary={deputy.votingSummary}
        slug={deputy.slug}
        takingOfficeDate={deputy.takingOfficeDate}
        sources={anSources}
      />
      <ElectionsSection candidacies={deputy.candidacies} sources={electionSources} />
      <FundingSection candidacies={deputy.candidacies} sources={fundingSources} />
    </article>
  )
}
