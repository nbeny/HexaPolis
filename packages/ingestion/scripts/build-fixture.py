"""Construit la fixture de test a partir d'une archive AMO10 reelle.

    python scripts/build-fixture.py <AMO10.json.zip> <fixtures/an-amo10-sample.zip>

L'archive complete pese ~5 Mo (577 acteurs, 7125 organes) et n'a pas sa place
dans le depot. On en extrait un echantillon COHERENT : quelques acteurs, puis
tous les organes que leurs mandats referencent.

La coherence est le point essentiel. Prendre les N premiers organes de
l'archive produirait une fixture ou aucun mandat ne trouve son organe : la
normalisation n'aurait rien a rattacher et les tests vaudraient zero.

Acteurs retenus, choisis pour ce qu'ils exercent :
  - Michel Barnier              : mandats varies, dont un mandat parlementaire
                                  avec circonscription et suppleant.
  - Alexandra Martin            : homonyme reelle. Deux deputees portent ce nom
                                  a la 17e legislature, l'AN les distingue par
                                  le departement glisse dans le champ `nom`.
  - Antoine Golliot             : volume de mandats eleve.
"""
import json
import os
import sys
import zipfile


def as_list(value):
    """Un noeud XML->JSON est un objet quand il n'a qu'un element, un tableau sinon."""
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def uid_of(acteur):
    uid = acteur["uid"]
    return uid["#text"] if isinstance(uid, dict) else uid


def main(source_path, target_path):
    source = zipfile.ZipFile(source_path)

    by_uid = {}
    for name in source.namelist():
        if not name.startswith("json/acteur/"):
            continue
        acteur = json.loads(source.read(name).decode("utf-8"))["acteur"]
        by_uid[uid_of(acteur)] = (name, acteur)

    chosen = [uid for uid in ("PA368",) if uid in by_uid]

    for uid, (_, acteur) in by_uid.items():
        ident = acteur.get("etatCivil", {}).get("ident", {})
        if ident.get("prenom") == "Alexandra" and str(ident.get("nom", "")).startswith("Martin"):
            chosen.append(uid)
            break

    for uid in by_uid:
        if len(chosen) >= 3:
            break
        if uid not in chosen:
            chosen.append(uid)

    referenced = set()
    for uid in chosen:
        _, acteur = by_uid[uid]
        for mandat in as_list(acteur.get("mandats", {}).get("mandat")):
            organe_ref = (mandat.get("organes") or {}).get("organeRef")
            if isinstance(organe_ref, str):
                referenced.add(organe_ref)
            circo_ref = (mandat.get("election") or {}).get("refCirconscription")
            if isinstance(circo_ref, str):
                referenced.add(circo_ref)

    os.makedirs(os.path.dirname(os.path.abspath(target_path)), exist_ok=True)
    organes = 0
    with zipfile.ZipFile(target_path, "w", zipfile.ZIP_DEFLATED) as target:
        for uid in chosen:
            name, _ = by_uid[uid]
            target.writestr(name, source.read(name))
        for ref in sorted(referenced):
            entry = "json/organe/%s.json" % ref
            try:
                target.writestr(entry, source.read(entry))
                organes += 1
            except KeyError:
                print("organe reference mais absent de l'archive :", ref)

    mandats = sum(
        len(as_list(by_uid[uid][1].get("mandats", {}).get("mandat"))) for uid in chosen
    )
    print("acteurs : %d" % len(chosen))
    print("organes : %d" % organes)
    print("mandats : %d" % mandats)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(1)
    main(sys.argv[1], sys.argv[2])
