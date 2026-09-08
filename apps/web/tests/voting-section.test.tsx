import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pageLabel } from '@/components/vote-history'
import { VotingSection } from '@/components/sections/voting-section'

/**
 * `VotingSection` monte désormais `VoteHistory`, un composant client qui
 * requête l'API depuis le navigateur (tâche 5). Ces tests portent sur la
 * synthèse de participation, restée côté serveur : ils ne vérifient rien de
 * l'historique de vote, mais le montage de `VoteHistory` appellerait `fetch`
 * pour de vrai sans ce bouchon. On le neutralise avec une réponse `deputy:
 * null` : `VoteHistory` reste alors en chargement, ce qu'aucun test ici
 * n'observe.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: { deputy: null } }), { status: 200 })),
  )
})
afterEach(() => vi.unstubAllGlobals())

const SLUG = 'pa000000-test'

/** Espace fine insécable (U+202F) : celle que `Intl.NumberFormat('fr-FR')` produit réellement. */
const NNBSP = ' '

/**
 * Deux normalisations, toutes deux nécessaires pour comparer le rendu réel :
 *
 * - `Intl.NumberFormat('fr-FR')` sépare les milliers par une espace fine
 *   insécable (U+202F) ; la comparer à une espace ordinaire échouerait ;
 * - les apostrophes du JSX passent par `&apos;` (U+0027) alors que les
 *   chaînes de `voting-section.tsx` portent l'apostrophe typographique
 *   (U+2019). Les deux sont ramenées à la même.
 */
const normalise = (texte: string): string =>
  texte.replace(/\s/g, ' ').replace(/[’']/g, "'")

function texteVisible(fragment: string) {
  return screen.getByText((contenu) => normalise(contenu).includes(normalise(fragment)))
}

function textesVisibles(fragment: string) {
  return screen.getAllByText((contenu) => normalise(contenu).includes(normalise(fragment)))
}

function texteAbsent(fragment: string) {
  return screen.queryByText((contenu) => normalise(contenu).includes(normalise(fragment)))
}

const resume = {
  status: 'COMPUTED' as const,
  mandateCount: 1,
  committeeCount: 2,
  voteCount: 412,
  participationBallotCount: 500,
  participationNamedCount: 412,
  participationExpressedCount: 400,
  participationNonVotingCount: 12,
  participationExpressedRate: 0.8,
}

/**
 * Date d'entrée en fonction publiée par l'Assemblée pour le mandat en cours.
 * Affichée à côté du dénominateur : c'est elle qui dit sur quelle fenêtre le
 * taux est calculé.
 */
const PRISE_FONCTION = '2024-07-08'


describe('VotingSection', () => {
  it('marque les chiffres de participation comme calculés', () => {
    render(<VotingSection summary={resume} slug={SLUG} takingOfficeDate={PRISE_FONCTION} sources={[]} />)
    expect(screen.getByText(/80,00 %/)).toBeInTheDocument()
    expect(screen.getAllByText(/calculé par PoliGraph/i).length).toBeGreaterThan(0)
  })

  it('décompose la participation au lieu de publier un pourcentage seul', () => {
    render(<VotingSection summary={resume} slug={SLUG} takingOfficeDate={PRISE_FONCTION} sources={[]} />)

    // Les quatre décomptes dont le taux est tiré sont sur la fiche, dans
    // l'ordre du plus large au plus étroit.
    expect(screen.getByText(/Scrutins éligibles au calcul/)).toBeInTheDocument()
    expect(screen.getByText(/Scrutins où l’Assemblée nomme ce député/)).toBeInTheDocument()
    expect(screen.getByText(/dont position exprimée \(pour, contre, abstention\)/)).toBeInTheDocument()
    expect(screen.getByText('dont non-votant')).toBeInTheDocument()
    expect(texteVisible('412 sur 500')).toBeInTheDocument()
    expect(screen.getByText('400')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()

    // Le libellé du taux nomme son numérateur et son dénominateur, et ne
    // contient plus « taux de participation » — c'est ce libellé qui
    // autorisait deux lectures opposées du même chiffre.
    expect(
      screen.getByText('Positions exprimées rapportées aux scrutins éligibles'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Taux de participation/i)).not.toBeInTheDocument()
  })

  it("ne compte plus les non-votes comme de la participation (cas Yaël Braun-Pivet)", () => {
    // Chiffres réels relevés en base au 26 août 2026 : 8 434 scrutins
    // éligibles, l'Assemblée la nomme sur les 8 434, dont 93 positions
    // exprimées et 8 341 NON_VOTANT. L'ancienne vue publiait « Taux de
    // participation : 100,00 % ».
    render(
      <VotingSection
        summary={{
          ...resume,
          voteCount: 8434,
          participationBallotCount: 8434,
          participationNamedCount: 8434,
          participationExpressedCount: 93,
          participationNonVotingCount: 8341,
          participationExpressedRate: 0.011,
        }}
        slug={SLUG}
        takingOfficeDate={PRISE_FONCTION}
        sources={[]}
      />,
    )

    expect(screen.queryByText('100,00 %')).not.toBeInTheDocument()
    // Le 1,10 % ne reste pas seul : le décompte des non-votes est sur la même
    // fiche, et c'est lui qui rend le taux lisible.
    expect(screen.getByText('1,10 %')).toBeInTheDocument()
    expect(texteVisible('8 434 sur 8 434')).toBeInTheDocument()
    expect(screen.getByText('93')).toBeInTheDocument()
    expect(texteVisible('8 341')).toBeInTheDocument()
  })

  it("n'explique jamais pourquoi un député est non-votant", () => {
    render(
      <VotingSection
        summary={{
          ...resume,
          participationNonVotingCount: 8341,
          participationExpressedCount: 93,
          participationExpressedRate: 0.011,
        }}
        slug={SLUG}
        takingOfficeDate={PRISE_FONCTION}
        sources={[]}
      />,
    )

    // PoliGraph publie le décompte, pas son motif : la source ne le publie
    // pas, et l'inventer serait un fait fabriqué sur une personne nommée.
    for (const motif of [/présid/i, /convention/i, /perchoir/i, /par fonction/i, /absentéis/i]) {
      expect(screen.queryByText(motif)).not.toBeInTheDocument()
    }
    expect(texteVisible('publiée sans motif')).toBeInTheDocument()
    expect(texteVisible("n'applique de traitement particulier à aucun député")).toBeInTheDocument()
  })

  it("affiche l'absence quand le dénominateur est invérifiable, jamais 0 %", () => {
    render(
      <VotingSection
        summary={{
          ...resume,
          participationBallotCount: null,
          participationNamedCount: null,
          participationExpressedCount: null,
          participationNonVotingCount: null,
          participationExpressedRate: null,
        }}
        slug={SLUG}
        takingOfficeDate={PRISE_FONCTION}
        sources={[]}
      />,
    )
    expect(screen.queryByText('0,00 %')).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(texteVisible('non calculable')).toBeInTheDocument()
    expect(textesVisibles("le dénominateur n'existe pas").length).toBeGreaterThan(0)
  })

  it("distingue un numérateur introuvable d'un dénominateur absent, et n'en tire pas 0 %", () => {
    // Cas réel de Chantal Bouloux (PA793528) : 8 434 scrutins éligibles
    // recoupent son mandat de 17e législature, mais l'AN ne la nomme sur
    // aucun. Le dénominateur existe, le numérateur non : dire « le
    // dénominateur n'existe pas » serait faux, et « 0 % » le serait aussi.
    // Distinction établie par 20260826150500 et conservée ici — elle s'étend
    // désormais aux trois décomptes de la décomposition.
    render(
      <VotingSection
        summary={{
          ...resume,
          voteCount: 0,
          participationBallotCount: 8434,
          participationNamedCount: null,
          participationExpressedCount: null,
          participationNonVotingCount: null,
          participationExpressedRate: null,
        }}
        slug={SLUG}
        takingOfficeDate={PRISE_FONCTION}
        sources={[]}
      />,
    )
    expect(screen.queryByText('0,00 %')).not.toBeInTheDocument()
    expect(texteAbsent("le dénominateur n'existe pas")).toBeNull()
    // Le dénominateur, lui, reste publié : c'est un fait vérifiable.
    expect(screen.getByText((c) => normalise(c) === '8 434')).toBeInTheDocument()
    expect(texteVisible('le numérateur est introuvable, il ne vaut pas zéro')).toBeInTheDocument()
    // Les deux sous-décomptes ne se replient pas sur zéro non plus.
    expect(textesVisibles('Zéro serait un chiffre inventé')).toHaveLength(2)
    // Trois motifs d'absence mentionnent les 8 434 scrutins éligibles : les
    // deux sous-décomptes et le taux.
    expect(textesVisibles('aucun des 8 434 scrutins éligibles de son mandat')).toHaveLength(3)
  })

  it("publie un zéro constaté quand la source nomme le député (cas Alexis Corbière)", () => {
    // 1 610 scrutins où l'AN le nomme, 1 610 positions exprimées, 0
    // NON_VOTANT. Ici zéro est un fait observé, pas un silence : le taire
    // serait aussi faux que d'inventer un chiffre ailleurs.
    render(
      <VotingSection
        summary={{
          ...resume,
          voteCount: 1610,
          participationBallotCount: 8434,
          participationNamedCount: 1610,
          participationExpressedCount: 1610,
          participationNonVotingCount: 0,
          participationExpressedRate: 0.1909,
        }}
        slug={SLUG}
        takingOfficeDate={PRISE_FONCTION}
        sources={[]}
      />,
    )
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('19,09 %')).toBeInTheDocument()
    expect(texteVisible('1 610 sur 8 434')).toBeInTheDocument()
  })

  it("ne présente jamais une absence de ligne comme une absence du député", () => {
    render(<VotingSection summary={resume} slug={SLUG} takingOfficeDate={PRISE_FONCTION} sources={[]} />)
    // 412 scrutins nommés sur 500 éligibles : les 88 restants ne sont PAS des
    // absences constatées — l'AN ne nomme sur un scrutin que les députés pour
    // lesquels une position a été enregistrée.
    expect(texteVisible('ne publie pas le détail nominatif')).toBeInTheDocument()
    expect(texteVisible("ne se lit pas comme un nombre d'absences")).toBeInTheDocument()
  })

  it("affiche la date d'entrée en fonction à côté du dénominateur qu'elle explique", () => {
    // Cas réel de Marie-Sophie Bernadeau (PA793924), entrée en fonction le
    // 2026-07-20 : 17 scrutins éligibles, l'Assemblée la nomme sur 4. Avant
    // l'écart 11, la fiche affichait « 4 sur 8 434 — 0,05 % ». Le taux corrigé
    // est exact mais repose sur dix-sept scrutins : il ne se compare pas aux
    // 8 434 d'un collègue en fonction depuis l'ouverture, et la fiche doit
    // donner au lecteur de quoi le voir.
    render(
      <VotingSection
        summary={{
          ...resume,
          voteCount: 4,
          participationBallotCount: 17,
          participationNamedCount: 4,
          participationExpressedCount: 4,
          participationNonVotingCount: 0,
          participationExpressedRate: 0.2353,
        }}
        slug={SLUG}
        takingOfficeDate="2026-07-20"
        sources={[]}
      />,
    )

    expect(screen.getByText('20 juillet 2026')).toBeInTheDocument()
    expect(texteVisible('4 sur 17')).toBeInTheDocument()
    expect(texteVisible("s'ouvre à la date d'entrée en fonction")).toBeInTheDocument()
    expect(texteVisible('ne se comparent pas')).toBeInTheDocument()
    // Aucune phrase ne qualifie le député : la fiche publie des dates et des
    // décomptes, la lecture appartient au lecteur.
    for (const jugement of [/absentéis/i, /assidu/i, /nouveau venu/i, /peu présent/i]) {
      expect(screen.queryByText(jugement)).not.toBeInTheDocument()
    }
  })

  it("dit que la fenêtre retombe sur la date de début quand la source ne publie pas d'entrée en fonction", () => {
    render(
      <VotingSection summary={resume} slug={SLUG} takingOfficeDate={null} sources={[]} />,
    )

    // Pas de date inventée, pas de repli silencieux sur la date de début : le
    // motif d'absence dit où le lecteur trouve la date réellement utilisée.
    expect(
      texteVisible("ne publie pas de date d'entrée en fonction pour le mandat en cours"),
    ).toBeInTheDocument()
    expect(texteVisible('la section « Mandats »')).toBeInTheDocument()
  })
})

describe('pageLabel', () => {
  it('décrit la tranche affichée, pas seulement son nombre', () => {
    expect(pageLabel(0, 25, 2518)).toBe(`1-25 sur 2${NNBSP}518`)
  })

  it('compte depuis la position réelle sur une page du milieu', () => {
    expect(pageLabel(50, 25, 2518)).toBe(`51-75 sur 2${NNBSP}518`)
  })

  it('ne dépasse jamais le total sur la dernière page', () => {
    expect(pageLabel(2500, 25, 2518)).toBe(`2${NNBSP}501-2${NNBSP}518 sur 2${NNBSP}518`)
  })

  it('reste lisible quand il n’y a rien à afficher', () => {
    expect(pageLabel(0, 25, 0)).toBe('aucune position de vote')
  })
})
