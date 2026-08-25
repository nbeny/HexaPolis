"""Construit les fixtures RNE et CNCCFP a partir des fichiers reels.

    python scripts/build-identite-fixtures.py <rne.csv> <cnccfp.csv> <dossier_fixtures>

Les deux fichiers sources se telechargent depuis data.gouv.fr :
  RNE    : repertoire-national-des-elus-1/.../elus-depute-dep.csv      (UTF-8, ;)
  CNCCFP : comptes-de-campagne-...-2022/.../publications-2022-lg.csv   (cp1252, ;)

Les lignes retenues le sont pour ce qu'elles exercent :

RNE
  - les deputes presents dans la fixture AMO10, pour que le rapprochement
    par date de naissance ait matiere a s'exercer ;
  - les deux Alexandra Martin, homonymes que seule la circonscription separe.

CNCCFP
  - les deux Sandrine Rousseau : meme nom, meme circonscription, meme
    scrutin, nuances differentes. Ni le nom ni le lieu ne les departagent :
    c'est le cas qui interdit toute fusion automatique ;
  - les deux Jean-Baptiste Moreau, que la circonscription separe ;
  - un compte libelle en francs CFP, devise qu'on ne doit jamais additionner
    a des euros ;
  - une ligne corrompue dont tous les champs valent « 0 », a rejeter avec trace ;
  - quelques candidats ordinaires en euros.
"""
import csv
import io
import os
import sys

DEPUTES_FIXTURE = {"BARNIER", "MARTIN", "GOLLIOT"}


def construire_rne(source, cible):
    lignes = list(csv.DictReader(io.open(source, encoding="utf-8"), delimiter=";"))
    entetes = list(lignes[0].keys())
    nom_col = next(c for c in entetes if c.startswith("Nom"))

    retenues = [l for l in lignes if l[nom_col].strip().upper() in DEPUTES_FIXTURE]
    # Complete avec quelques deputes ordinaires pour avoir du volume.
    for ligne in lignes:
        if len(retenues) >= 8:
            break
        if ligne not in retenues:
            retenues.append(ligne)

    with io.open(cible, "w", encoding="utf-8", newline="") as sortie:
        writer = csv.DictWriter(sortie, fieldnames=entetes, delimiter=";")
        writer.writeheader()
        writer.writerows(retenues)

    print("RNE    : %d deputes" % len(retenues))
    for ligne in retenues:
        prenom_col = next(c for c in entetes if c.startswith("Pr"))
        naissance = next(c for c in entetes if "naissance" in c)
        print("   %-18s %-14s ne(e) %s" % (ligne[nom_col], ligne[prenom_col], ligne[naissance]))
    return len(retenues)


def construire_cnccfp(source, cible):
    lignes = list(csv.DictReader(io.open(source, encoding="cp1252"), delimiter=";"))
    entetes = list(lignes[0].keys())

    def choisir(predicat, limite=None):
        trouvees = [l for l in lignes if predicat(l)]
        return trouvees[:limite] if limite else trouvees

    retenues = []
    retenues += choisir(lambda l: "ROUSSEAU" in l["nom"] and "Sandrine" in l["nom"])
    retenues += choisir(lambda l: "MOREAU" in l["nom"] and "Jean-Baptiste" in l["nom"])
    retenues += choisir(lambda l: l["monnaie"] == "CFP", 2)
    retenues += choisir(lambda l: l["nom"].strip() == "0", 1)
    retenues += choisir(
        lambda l: l["monnaie"] == "EURO" and l["decision"] == "A" and l not in retenues, 4
    )

    with io.open(cible, "w", encoding="cp1252", newline="") as sortie:
        writer = csv.DictWriter(sortie, fieldnames=entetes, delimiter=";")
        writer.writeheader()
        writer.writerows(retenues)

    print("CNCCFP : %d comptes" % len(retenues))
    for ligne in retenues:
        print(
            "   %-28s %-5s %-40s decision=%s"
            % (ligne["nom"][:28], ligne["monnaie"], ligne["circonscription"][:40], ligne["decision"])
        )
    return len(retenues)


def main(rne_source, cnccfp_source, fixtures):
    os.makedirs(fixtures, exist_ok=True)
    construire_rne(rne_source, os.path.join(fixtures, "rne-deputes-sample.csv"))
    print()
    construire_cnccfp(cnccfp_source, os.path.join(fixtures, "cnccfp-legislatives-2022-sample.csv"))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        raise SystemExit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
