"""Construit les fixtures de scrutins a partir des archives reelles de l'AN.

    python scripts/build-scrutins-fixture.py <dossier_archives> <dossier_fixtures>

Le dossier d'archives doit contenir Scr14.zip, Scr15.zip, Scr16.zip, Scr17.zip
telecharges depuis data.assemblee-nationale.fr.

Deux fixtures sont produites, parce que l'AN publie deux conditionnements :

  an-scrutins-eclates-sample.zip   15e, 16e, 17e : un fichier JSON par scrutin
  an-scrutins-monolithe-sample.zip 14e          : un seul JSON contenant tout

Les scrutins retenus le sont pour ce qu'ils exercent, pas au hasard :

  - au moins un scrutin ou votent PA368, PA793342 et PA841605, les trois
    deputes de la fixture AMO10, afin que la normalisation ait des personnes
    a rattacher ;
  - un scrutin de la 16e utilisant les cles au SINGULIER (pour/contre) et un
    autre utilisant le PLURIEL (pours/contres). L'AN melange les deux
    conventions au sein de cette meme legislature : un parseur qui n'en
    accepterait qu'une perdrait des votes sans lever d'erreur ;
  - des votants inconnus de la base, pour verifier qu'ils partent en attente
    avec une trace plutot que d'etre perdus.
"""
import json
import os
import sys
import zipfile

DEPUTES_AMO10 = {"PA368", "PA793342", "PA841605"}
SINGULIER = ("pour", "contre", "abstention", "nonVotant")
PLURIEL = ("pours", "contres", "abstentions", "nonVotants")


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def lire_scrutins(chemin):
    """Rend (nom_entree, scrutin) quel que soit le conditionnement."""
    archive = zipfile.ZipFile(chemin)
    entrees = archive.namelist()
    if len(entrees) == 1:
        contenu = json.loads(archive.read(entrees[0]).decode("utf-8"))
        for scrutin in contenu["scrutins"]["scrutin"]:
            yield entrees[0], scrutin
    else:
        for entree in entrees:
            if entree.endswith(".json"):
                yield entree, json.loads(archive.read(entree).decode("utf-8"))["scrutin"]


def cles_employees(scrutin):
    """Cles de decompteNominatif reellement presentes dans ce scrutin."""
    trouvees = set()
    groupes = scrutin["ventilationVotes"]["organe"]["groupes"]["groupe"]
    for groupe in as_list(groupes):
        trouvees.update(groupe["vote"]["decompteNominatif"].keys())
    return trouvees


def votants(scrutin):
    trouves = set()
    groupes = scrutin["ventilationVotes"]["organe"]["groupes"]["groupe"]
    for groupe in as_list(groupes):
        nominatif = groupe["vote"]["decompteNominatif"]
        for cle in SINGULIER + PLURIEL:
            noeud = nominatif.get(cle)
            if isinstance(noeud, dict):
                for votant in as_list(noeud.get("votant")):
                    if isinstance(votant, dict) and votant.get("acteurRef"):
                        trouves.add(votant["acteurRef"])
    return trouves


def choisir(archives):
    """Selectionne les scrutins de chaque legislature selon ce qu'ils exercent."""
    retenus = []

    # 17e : deux scrutins ou votent les deputes de la fixture AMO10.
    avec_deputes = []
    for nom, scrutin in lire_scrutins(os.path.join(archives, "Scr17.zip")):
        if DEPUTES_AMO10 & votants(scrutin):
            avec_deputes.append((17, nom, scrutin))
            if len(avec_deputes) == 2:
                break
    retenus.extend(avec_deputes)

    # 16e : un scrutin au singulier, un au pluriel.
    singulier_pris = pluriel_pris = False
    for nom, scrutin in lire_scrutins(os.path.join(archives, "Scr16.zip")):
        cles = cles_employees(scrutin)
        if not singulier_pris and (set(SINGULIER) & cles) and not (set(PLURIEL) & cles):
            retenus.append((16, nom, scrutin))
            singulier_pris = True
        elif not pluriel_pris and (set(PLURIEL) & cles) and not (set(SINGULIER) & cles):
            retenus.append((16, nom, scrutin))
            pluriel_pris = True
        if singulier_pris and pluriel_pris:
            break

    # 15e : un scrutin quelconque, pour couvrir la legislature.
    for nom, scrutin in lire_scrutins(os.path.join(archives, "Scr15.zip")):
        retenus.append((15, nom, scrutin))
        break

    return retenus


def main(archives, fixtures):
    os.makedirs(fixtures, exist_ok=True)
    eclates = choisir(archives)

    chemin_eclates = os.path.join(fixtures, "an-scrutins-eclates-sample.zip")
    with zipfile.ZipFile(chemin_eclates, "w", zipfile.ZIP_DEFLATED) as sortie:
        for _, nom, scrutin in eclates:
            sortie.writestr(nom, json.dumps({"scrutin": scrutin}, ensure_ascii=False))

    # 14e : conditionnement monolithique, deux scrutins.
    monolithe = [s for _, s in lire_scrutins(os.path.join(archives, "Scr14.zip"))][:2]
    chemin_monolithe = os.path.join(fixtures, "an-scrutins-monolithe-sample.zip")
    with zipfile.ZipFile(chemin_monolithe, "w", zipfile.ZIP_DEFLATED) as sortie:
        sortie.writestr(
            "Scrutins_XIV.json",
            json.dumps({"scrutins": {"scrutin": monolithe}}, ensure_ascii=False),
        )

    print("--- fixture eclatee (15e, 16e, 17e) ---")
    for leg, nom, scrutin in eclates:
        cles = sorted(cles_employees(scrutin))
        print(
            "  leg %2d  %-28s  %4d votants  cles=%s"
            % (leg, scrutin["uid"], len(votants(scrutin)), ",".join(cles))
        )
    print("  taille : %d octets" % os.path.getsize(chemin_eclates))

    print("--- fixture monolithe (14e) ---")
    for scrutin in monolithe:
        print(
            "  leg 14  %-28s  %4d votants  cles=%s"
            % (scrutin["uid"], len(votants(scrutin)), ",".join(sorted(cles_employees(scrutin))))
        )
    print("  taille : %d octets" % os.path.getsize(chemin_monolithe))

    connus = sum(len(DEPUTES_AMO10 & votants(s)) for _, _, s in eclates)
    print("positions rattachables aux deputes de la fixture AMO10 : %d" % connus)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(1)
    main(sys.argv[1], sys.argv[2])
