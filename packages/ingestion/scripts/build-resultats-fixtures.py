"""Construit les fixtures de resultats electoraux (format large) a partir des
fichiers reels publies par le ministere de l'Interieur.

    python scripts/build-resultats-fixtures.py <1er-tour.csv> <2nd-tour.csv> <dossier_fixtures>

Les deux fichiers sources se telechargent depuis data.gouv.fr (UTF-8, ;) :
  1er tour : resultats-definitifs-par-circonscriptions-legislatives.csv (189 colonnes, 19 blocs)
  2nd tour : resultats-definitifs-par-circonscription.csv               (54 colonnes, 4 blocs)

Le format est large : 18 colonnes fixes puis 9 colonnes par candidat,
repetees jusqu'au nombre maximum de candidats du fichier (19 au 1er tour,
4 au 2nd). Le nombre de blocs se deduit de l'entete ; le lecteur ne doit
jamais recevoir un extrait tronque en largeur, seulement en nombre de
lignes -- chaque ligne retenue garde ses 189 (ou 54) colonnes completes.

Lignes retenues, choisies pour ce qu'elles exercent :

1er tour (fixtures/resultats-t1-sample.csv)
  - ZZ09 (9e circonscription des Francais etablis hors de France) : 19
    candidats reels, remplissant tous les blocs de l'entete a 189 colonnes.
    Aucun elu (le 1er tour ne tranche presque jamais) : verifie qu'une ligne
    sans aucun bloc "Elu" rempli ne casse rien.
  - 205 (Aisne, 5e circonscription) : 5 candidats, elu au bloc 1. Cas
    simple : le vainqueur est le premier candidat de la ligne.
  - 901 (Ariege, 1re circonscription) : 4 candidats, elu au bloc 4 -- le
    dernier bloc rempli, pas le premier. Sans cette ligne, un parseur qui ne
    regarde que le premier bloc "Elu" passerait les tests a tort.

2nd tour (fixtures/resultats-t2-sample.csv)
  - 0101 (Ain, 1re circonscription) : 2 candidats, elu au bloc 2 (Xavier
    Breton) -- meme besoin qu'au 1er tour, mais sur l'entete a 54 colonnes.
  - 0103 (Ain, 3e circonscription) : 2 candidats, elu au bloc 1 (Olga
    Givernet). Cette circonscription est justement l'exemple du plan p5 sur
    les deputes multiples d'une meme legislature (01-3) : la retrouver ici
    relie la fixture au raisonnement qui a motive une decision de
    conception du plan.
  - 6908 (Rhone, 8e circonscription) : 4 candidats, remplissant tous les
    blocs de l'entete a 54 colonnes -- le cas "au maximum" du fichier le
    plus etroit.

Remarque conservee telle quelle dans la fixture, sans la corriger : le 1er
tour n'ecrit PAS le code departement ni le code circonscription sur deux et
quatre chiffres pour les departements 1 a 9 ('9' et '901'), alors que le 2nd
tour les complete ('01' et '0101'). Les deux fichiers reels different sur ce
point ; la normalisation (tache 3) doit s'en accommoder, pas ce lecteur.

Chaque fichier ne garde que l'entete et ces trois lignes : assez pour
prouver le depivotage (compte de blocs derive de l'entete, blocs vides non
rendus, champ Elu, vainqueur en fin de ligne), pas assez pour peser sur le
depot. Le cas "ligne tronquee en largeur" (moins de colonnes que l'entete)
n'existe dans aucun fichier reel -- personne ne publierait une ligne
incomplete -- il est donc construit a la main dans le test, pas ici.
"""
import csv
import os
import sys


def charger(chemin):
    with open(chemin, encoding="utf-8", newline="") as f:
        lecteur = csv.reader(f, delimiter=";")
        entete = next(lecteur)
        lignes = list(lecteur)
    return entete, lignes


def ecrire(chemin, entete, lignes):
    with open(chemin, "w", encoding="utf-8", newline="") as f:
        ecrivain = csv.writer(f, delimiter=";")
        ecrivain.writerow(entete)
        ecrivain.writerows(lignes)


def extraire(source, cible, codes_circonscription):
    entete, lignes = charger(source)
    par_code = {ligne[2]: ligne for ligne in lignes}
    retenues = [par_code[code] for code in codes_circonscription]
    ecrire(cible, entete, retenues)

    blocs = (len(entete) - 18) // 9
    print(
        "%s : %d colonnes (%d blocs), %d lignes retenues"
        % (os.path.basename(cible), len(entete), blocs, len(retenues))
    )
    for ligne in retenues:
        candidats = sum(1 for b in range(blocs) if ligne[18 + b * 9 + 2].strip())
        elu = next(
            (b + 1 for b in range(blocs) if ligne[18 + b * 9 + 8].strip()), None
        )
        print(
            "   %-6s %-30s %2d candidats  elu=bloc %s"
            % (ligne[2], ligne[3], candidats, elu)
        )
    return entete, retenues


def main(source_t1, source_t2, dossier_fixtures):
    os.makedirs(dossier_fixtures, exist_ok=True)
    extraire(
        source_t1,
        os.path.join(dossier_fixtures, "resultats-t1-sample.csv"),
        ["ZZ09", "205", "901"],
    )
    extraire(
        source_t2,
        os.path.join(dossier_fixtures, "resultats-t2-sample.csv"),
        ["0101", "0103", "6908"],
    )


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        raise SystemExit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
