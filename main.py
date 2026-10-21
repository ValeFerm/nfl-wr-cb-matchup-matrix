"""WR-CB Matchup Matrix : pipeline complet (tracking NGS -> profils Burst/Burn -> matrice de duels).

Usage : python main.py [--sample N]
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from load import ROOT, get_tracking  # noqa: E402
from metrics import assign_matchups, route_features  # noqa: E402
from scoring import matchup_matrix, player_profiles, split_half_reliability  # noqa: E402
from viz import hero_figure  # noqa: E402

OUT = ROOT / "outputs"


def main(sample=None):
    t0 = time.time()
    OUT.mkdir(exist_ok=True)
    trk, man, players = get_tracking(sample)
    duel = assign_matchups(trk)
    routes, _ = route_features(duel)
    print(f"{len(man)} man plays | {duel.groupby(['gameId', 'playId', 'nflId']).ngroups} WR-CB duels | "
          f"{routes['family'].value_counts().to_dict()}")

    wr = player_profiles(routes, players, "nflId")
    cb = player_profiles(routes, players, "nflId_db")
    adv_cut, adv_vert = matchup_matrix(wr, cb)
    print(f"Eligible: {len(wr)} WR, {len(cb)} CB")
    for who, label in (("nflId", "WR"), ("nflId_db", "CB")):
        rel = split_half_reliability(routes, who)
        print(f"Split-half reliability {label}: " + ", ".join(f"{k} r={r:.2f} (n={n})" for k, (r, n) in rel.items()))
    for fam, metric in (("cut", "burst"), ("vertical", "burn")):
        r = routes[routes["family"] == fam]
        print(f"Route-level corr({metric}, separation at throw) = {r[metric].corr(r['sep_throw']):.2f}")

    routes.to_csv(OUT / "routes.csv", index=False)
    wr.to_csv(OUT / "wr_profiles.csv", index=False)
    cb.to_csv(OUT / "cb_profiles.csv", index=False)
    (adv_cut - adv_vert).round(2).to_csv(OUT / "matchup_edge_cut_minus_vertical.csv")
    hero_figure(wr, cb, adv_cut, adv_vert, OUT / "matchup_matrix.png")
    print(f"Done in {time.time() - t0:.1f}s -> {OUT}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=None, help="prototype on N random man plays")
    main(parser.parse_args().sample)
