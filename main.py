"""WR-CB Matchup Matrix : pipeline complet (tracking NGS -> profils Burst/Burn -> matrice de duels -> web).

Usage : python main.py [--sample N]
"""
import argparse
import sys
import time
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from decision import bootstrap_effects, bootstrap_outcomes, completion_model, forty_times, situation_data  # noqa: E402
from export_web import export  # noqa: E402
from sim_export import export_sim  # noqa: E402
from load import ROOT, get_tracking, load_meta, player_teams  # noqa: E402
from metrics import assign_matchups, route_features  # noqa: E402
from scoring import LIMITED, eligible, matchup_matrix, player_effects, split_half_reliability  # noqa: E402
from validate import completion_by_separation, targeted_routes  # noqa: E402
from viz import hero_figure  # noqa: E402

OUT = ROOT / "outputs"


def main(sample=None):
    t0 = time.time()
    out = OUT / "sample" if sample else OUT  # le prototype n'écrase jamais les résultats complets ni le site
    out.mkdir(parents=True, exist_ok=True)
    trk, man, players = get_tracking(sample)
    plays = load_meta()[0]
    duel = assign_matchups(trk)
    routes, frames = route_features(duel)
    n_duels = len(routes)
    fam = routes["family"].value_counts().to_dict()
    print(f"{len(man)} man plays | {n_duels} WR-CB duels | {fam}")

    # Profils ajustés à l'adversaire (ridge WR + CB, lambda choisi par validation croisée sur les matchs)
    wr_all, cb_all, fit_info = player_effects(routes)
    teams = player_teams(trk)
    wr, cb = eligible(wr_all, players, teams), eligible(cb_all, players, teams)
    edge_cut, edge_vert = matchup_matrix(wr, cb, fit_info)
    print(f"Eligible: {len(wr)} WR, {len(cb)} CB")
    for m, d in fit_info.items():
        print(f"  {m}: lambda={d['lambda']}, out-of-sample R2={d['oos_r2']:.3f}, n={d['n']}")
    rel = {lab: split_half_reliability(routes, who) for lab, who in (("WR", "nflId"), ("CB", "nflId_db"))}
    for lab, r in rel.items():
        print(f"  split-half {lab}: " + ", ".join(f"{k} r={v:.2f} (n={n})" for k, (v, n) in r.items()))

    # Validation football : complétion des routes ciblées selon le duel gagné / perdu
    tr = targeted_routes(routes, plays, players)
    by_won, by_sep, _ = completion_by_separation(tr)
    print(by_won.round(3).to_string(index=False))
    print(by_sep.round(3).to_string(index=False))

    routes.to_csv(out / "routes.csv", index=False)
    wr.to_csv(out / "wr_profiles.csv", index=False)
    cb.to_csv(out / "cb_profiles.csv", index=False)
    if sample:
        print(f"Prototype done in {time.time() - t0:.1f}s -> {out} (figure and web export need the full dataset)")
        return
    (edge_cut - edge_vert).round(3).to_csv(out / "matchup_edge_cut_minus_vertical.csv")
    hero_figure(wr, cb, edge_cut, edge_vert, out / "matchup_matrix.png")

    validation = {
        "by_won": by_won.to_dict(orient="records"),
        "by_sep": by_sep.rename(columns={"sep_throw": "bin"}).astype({"bin": str}).to_dict(orient="records"),
        "reliability": {lab: {k: [round(v, 3), n] for k, (v, n) in r.items()} for lab, r in rel.items()},
        "n_targeted": int(tr["targeted"].sum()),
    }
    # Site : profils complets + échantillons limités, incertitude bootstrap, modèle de complétion, situations
    wr_web, cb_web = eligible(wr_all, players, teams, *LIMITED), eligible(cb_all, players, teams, *LIMITED)
    draws = bootstrap_effects(routes, fit_info, wr_web["nflId"], cb_web["nflId"])
    completion = completion_model(tr)
    plays_full = __import__("pandas").read_csv(ROOT / "data" / "plays.csv", usecols=["gameId", "playId", "prePenaltyPlayResult"])
    situation = situation_data(tr, plays_full)
    situation["draws"] = bootstrap_outcomes(tr, plays_full)
    print(f"Web: {len(wr_web)} WR, {len(cb_web)} CB | completion model {completion}")
    meta = {"man_plays": len(man), "duels": n_duels, "families": fam, "n_wr": len(wr), "n_cb": len(cb),
            "n_wr_web": len(wr_web), "n_cb_web": len(cb_web), "games": int(trk["gameId"].nunique()), "n_boot": len(draws["burst"][0])}
    # Simulateur : répétitions réelles (sim.js) + profondeur de réception de chacune (intégrée au modèle du labo)
    n_reps, depths = export_sim(ROOT / "docs" / "sim.js", frames, routes, trk, set(wr_web["nflId"]))
    print(f"Simulator: {n_reps} real reps exported")
    export(ROOT / "docs" / "data.js", wr_web, cb_web, routes, frames, fit_info, validation, meta, draws, completion,
           situation, forty_times(players), depths)
    print(f"Done in {time.time() - t0:.1f}s -> {out}, docs/data.js and docs/sim.js")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=None, help="prototype on N random man plays")
    main(parser.parse_args().sample)
