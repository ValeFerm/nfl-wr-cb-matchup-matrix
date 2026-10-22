"""Export des répétitions réelles (WR + CB + QB) pour le simulateur de tracés du site (docs/sim.js, chargé à la demande)."""
import json

import numpy as np
import pandas as pd

from load import DATA

FIELD_MID_Y = 160 / 6
ROUTE = ["gameId", "playId", "nflId"]
BALL_SPEED = 21.0  # yd/s, identique au simulateur du site (docs/wristcoach.js)


def min_catch_depth(p, tt, tc, l0, l1, q):
    """Profondeur de réception la plus courte possible sur cette répétition, avec la même règle que le simulateur :
    lancer entre la fin de la fenêtre de mesure et le vrai lancer, ballon à 21 yd/s, receveur prolongé à vitesse constante."""
    wr = [list(x) for x in (np.asarray(p, dtype=float).reshape(-1, 4)[:, :2] / 10)]
    while len(wr) <= tt + 50:
        wr.append([2 * wr[-1][0] - wr[-2][0], 2 * wr[-1][1] - wr[-2][1]])
    qx, qd = q[0] / 10, q[1] / 10
    tmin = min(tt, tc + 8 if tc >= 0 else (max(l1, 5) if l0 > 0 else tt))
    best = np.inf
    for tr in range(tmin, tt + 1):
        k = 3
        while k < 45 and np.hypot(qx - wr[tr + k][0], qd - wr[tr + k][1]) / BALL_SPEED > k / 10:
            k += 1
        best = min(best, wr[tr + k][1])
    return round(float(best), 1)


def catch_depths(reps):
    """Par receveur et par famille, profondeurs de réception minimales des répétitions utilisées par le simulateur."""
    out = {}
    for wid, rs in reps.items():
        d = {}
        for f in ("c", "v"):
            fam = [r for r in rs if r["f"] == f]
            pool = [r for r in fam if (r["tc"] >= 0 if f == "c" else r["l0"] > 0)] or fam
            d[f] = [min_catch_depth(r["p"], r["tt"], r["tc"], r["l0"], r["l1"], r["q"]) for r in pool]
        out[int(wid)] = d
    return out


def export_sim(path, frames, routes, trk, wr_ids):
    """Une entrée par route cut / verticale des WR du site, dans le repère « route tree » du WR :
    profondeur depuis la LOS, latéral positif vers l'extérieur, coordonnées en dixièmes de yard (entiers)."""
    keep = routes.loc[routes["family"].isin(["cut", "vertical"]) & routes["nflId"].isin(wr_ids),
                      ROUTE + ["family", "t_cut", "lin0", "lin1"]]
    f = frames[ROUTE + ["t", "t_throw", "x", "y", "x_db", "y_db", "los_x"]].merge(keep, on=ROUTE).sort_values(ROUTE + ["t"])

    y0 = f.groupby(ROUTE)["y"].transform("first")
    side = np.where(y0 > FIELD_MID_Y, 1.0, -1.0)  # même convention que le route tree : extérieur = +
    f = f.assign(wl=(f["y"] - y0) * side, wd=f["x"] - f["los_x"], cl=(f["y_db"] - y0) * side, cd=f["x_db"] - f["los_x"],
                 y0=y0, side=side)

    # QB : position réelle au moment du lancer, dans le même repère
    qb = trk.loc[(trk["side"] == "Q") & (trk["t"] == trk["t_throw"]), ["gameId", "playId", "x", "y"]].drop_duplicates(["gameId", "playId"])
    first = f.groupby(ROUTE, as_index=False).first()[ROUTE + ["y0", "side", "los_x"]]
    first = first.merge(qb.rename(columns={"x": "qx", "y": "qy"}), on=["gameId", "playId"])
    first = first.assign(ql=(first["qy"] - first["y0"]) * first["side"], qd=first["qx"] - first["los_x"])

    # Provenance de la répétition : semaine et adversaire
    games = pd.read_csv(DATA / "games.csv", usecols=["gameId", "week"])
    plays = pd.read_csv(DATA / "plays.csv", usecols=["gameId", "playId", "defensiveTeam"])
    first = first.merge(games, on="gameId").merge(plays, on=["gameId", "playId"])

    to_int = lambda v: np.round(v.astype("float64") * 10).astype(int)
    f = f.assign(wl=to_int(f["wl"]), wd=to_int(f["wd"]), cl=to_int(f["cl"]), cd=to_int(f["cd"]))
    meta = first.set_index(ROUTE)
    reps = {}
    for key, g in f.groupby(ROUTE, sort=False):  # ~1 500 routes : simple sérialisation, pas de calcul
        if key not in meta.index or g["t"].iloc[0] != 0 or (np.diff(g["t"].to_numpy()) != 1).any():
            continue  # route sans QB ou avec des frames manquantes : écartée du simulateur
        m, r = meta.loc[key], g.iloc[0]
        reps.setdefault(str(key[2]), []).append({
            "f": "c" if r["family"] == "cut" else "v",
            "tt": int(r["t_throw"]),
            "tc": int(r["t_cut"]) if pd.notna(r["t_cut"]) else -1,
            "l0": int(r["lin0"]) if pd.notna(r["lin0"]) else -1,
            "l1": int(r["lin1"]) if pd.notna(r["lin1"]) else -1,
            "wk": int(m["week"]), "op": m["defensiveTeam"],
            "q": [int(round(m["ql"] * 10)), int(round(m["qd"] * 10))],
            "p": g[["wl", "wd", "cl", "cd"]].to_numpy().ravel().tolist(),
        })
    path.write_text("window.SIM = " + json.dumps({"reps": reps}, separators=(",", ":")) + ";\n")
    return sum(len(v) for v in reps.values()), catch_depths(reps)
