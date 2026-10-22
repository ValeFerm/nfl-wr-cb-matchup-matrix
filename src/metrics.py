"""Duels WR-CB en man coverage, détection des cuts et métriques Burst / Burn (100 % vectorisé, sans boucle)."""
import numpy as np
import pandas as pd

FPS = 10
WIN = 8                 # fenêtre d'analyse : 0,8 s (les cuts NFL sont souvent arrondis)
RELEASE_FRAMES = 5      # on ignore la sortie de ligne (0,5 s après le snap)
EARLY_FRAMES = 10       # assignation du défenseur sur la 1re seconde
CUT_DIR_DEG = 40        # changement de direction minimal sur la fenêtre
CUT_O_DEG = 25          # rotation du corps minimale (confirme un vrai cut)
CUT_MIN_SPEED = 2.0     # yd/s avant le cut
CUT_MIN_DEPTH = 2.0     # yd au-delà de la ligne de mêlée
LIN_MAX_DEG = 15        # phase linéaire : quasi tout droit...
LIN_MIN_SPEED = 5.0     # ... à haute vitesse (yd/s)
LIN_MIN_FRAMES = 5
VERTICAL_DEPTH = 7.0    # profondeur minimale au lancer d'un tracé vertical sans cut
VERTICAL_MAX_ANGLE = 30 # écart max (°) à l'axe du terrain entre snap et lancer
MATCH_STABILITY = 0.7
MATCH_MAX_DIST = 8.0

ROUTE = ["gameId", "playId", "nflId"]


def assign_matchups(trk):
    """Déduit les duels man : paire coureur de route / défenseur *mutuellement* la plus proche sur la 1re seconde,
    restée stable jusqu'au lancer. Un défenseur ne peut suivre qu'un seul joueur (et inversement). Garde WR vs CB."""
    off = trk.loc[trk["side"] == "O", ["gameId", "playId", "nflId", "officialPosition", "t", "t_throw",
                                       "x", "y", "s", "o", "dir", "los_x"]]
    de = trk.loc[trk["side"] == "D", ["gameId", "playId", "nflId", "officialPosition", "t", "x", "y"]]
    pairs = off.merge(de, on=["gameId", "playId", "t"], suffixes=("", "_db"))
    pairs["d"] = np.hypot(pairs["x"] - pairs["x_db"], pairs["y"] - pairs["y_db"]).astype("float32")

    # Distance moyenne sur la 1re seconde, puis plus proche voisin mutuel (appariement 1-1 vectorisé)
    early = (pairs[pairs["t"] <= EARLY_FRAMES].groupby(ROUTE + ["nflId_db"], as_index=False)["d"].mean()
             .sort_values("d"))
    best_db = early.drop_duplicates(ROUTE)
    best_off = early.drop_duplicates(["gameId", "playId", "nflId_db"])
    assigned = best_db.merge(best_off, on=ROUTE + ["nflId_db", "d"])[ROUTE + ["nflId_db"]]

    # Stabilité : part des frames (jusqu'au lancer) où l'assigné reste le défenseur le plus proche
    pre = pairs[pairs["t"] <= pairs["t_throw"]]
    nearest = pre.sort_values("d").drop_duplicates(ROUTE + ["t"])[ROUTE + ["t", "nflId_db"]]
    nearest = nearest.merge(assigned, on=ROUTE, suffixes=("", "_assigned"))
    stab = ((nearest["nflId_db"] == nearest["nflId_db_assigned"]).groupby([nearest[c] for c in ROUTE]).mean()
            .rename("stability").reset_index())

    duel = pairs.merge(assigned, on=ROUTE + ["nflId_db"])
    mean_d = duel[duel["t"] <= duel["t_throw"]].groupby(ROUTE)["d"].mean().rename("mean_dist").reset_index()
    quality = assigned.merge(stab, on=ROUTE).merge(mean_d, on=ROUTE)
    ok = quality[(quality["stability"] >= MATCH_STABILITY) & (quality["mean_dist"] <= MATCH_MAX_DIST)]

    duel = duel.merge(ok[ROUTE + ["stability"]], on=ROUTE)
    duel = duel[(duel["officialPosition"] == "WR") & (duel["officialPosition_db"] == "CB")].rename(columns={"d": "sep"})
    return (duel.drop(columns=["officialPosition", "officialPosition_db"])
            .sort_values(ROUTE + ["t"]).reset_index(drop=True))


def _angle_between(ux, uy, vx, vy):
    """Angle non signé (degrés) entre deux vecteurs, vectorisé."""
    return np.degrees(np.arctan2(np.abs(ux * vy - uy * vx), ux * vx + uy * vy))


def route_features(duel):
    """Une ligne par route : famille (cut / vertical), Burst et Burn Separation."""
    # Vecteur direction (convention NGS : 0° = +y, sens horaire), lissé sur 3 frames
    rad = np.radians(duel["dir"].to_numpy())
    df = duel.assign(vx=np.sin(rad), vy=np.cos(rad))
    g = df.groupby(ROUTE, sort=False)
    for c in ("vx", "vy"):
        df[c] = (g[c].shift(1).fillna(df[c]) + df[c] + g[c].shift(-1).fillna(df[c])) / 3

    fut = g[["vx", "vy", "o", "sep"]].shift(-WIN)
    df["d_dir"] = _angle_between(df["vx"], df["vy"], fut["vx"], fut["vy"])
    df["d_o"] = np.abs((fut["o"] - df["o"] + 180) % 360 - 180)
    df["sep_fut"] = fut["sep"]
    df["depth"] = df["x"] - df["los_x"]

    # Cut : rupture de direction + rotation du corps sur 0,8 s, à vitesse et profondeur suffisantes.
    # La fenêtre doit se terminer avant le lancer : on mesure le duel tel que le QB le voit, sans fuite
    # (après le lancer, un pass breakup rapproche mécaniquement le CB et biaiserait le Burst).
    cand = ((df["d_dir"] >= CUT_DIR_DEG) & (df["d_o"] >= CUT_O_DEG) & (df["s"] >= CUT_MIN_SPEED)
            & (df["t"] >= RELEASE_FRAMES) & (df["depth"] >= CUT_MIN_DEPTH) & (df["t"] + WIN <= df["t_throw"]))
    cuts = (df[cand].sort_values("d_dir", ascending=False).drop_duplicates(ROUTE)
            .assign(burst=lambda c: c["sep_fut"] - c["sep"])
            [ROUTE + ["t", "d_dir", "burst"]].rename(columns={"t": "t_cut", "d_dir": "cut_angle"}))

    # Phase linéaire rapide : terrain gagné vers l'avant sur le CB, par seconde.
    # (La distance brute baisse quand le WR mange le coussin d'un CB en off : elle ne mesure pas la vitesse.)
    pre = df[df["t"] <= df["t_throw"]].copy()
    pre["dlead"] = pre.groupby(ROUTE, sort=False)["x"].diff() - pre.groupby(ROUTE, sort=False)["x_db"].diff()
    lin = pre[(pre["d_dir"] < LIN_MAX_DEG) & (pre["s"] >= LIN_MIN_SPEED) & (pre["t"] >= RELEASE_FRAMES)]
    burn = lin.groupby(ROUTE).agg(lin_frames=("dlead", "size"), lin_gain=("dlead", "sum"),
                                  lin0=("t", "min"), lin1=("t", "max")).reset_index()
    burn = burn[burn["lin_frames"] >= LIN_MIN_FRAMES]
    burn["burn"] = burn["lin_gain"] / (burn["lin_frames"] / FPS)

    start = pre[pre["t"] == 0].set_index(ROUTE)["y"].rename("y_snap")
    at_throw = pre.loc[pre["t"] == pre["t_throw"], ROUTE + ["nflId_db", "sep", "depth", "y"]].rename(
        columns={"sep": "sep_throw", "depth": "depth_throw"}).join(start, on=ROUTE)
    at_throw["axis_angle"] = np.degrees(np.arctan2(np.abs(at_throw["y"] - at_throw["y_snap"]), at_throw["depth_throw"]))
    routes = at_throw.merge(cuts, on=ROUTE, how="left").merge(burn[ROUTE + ["burn", "lin0", "lin1"]], on=ROUTE, how="left")
    routes["family"] = np.select(
        [routes["t_cut"].notna(),
         (routes["depth_throw"] >= VERTICAL_DEPTH) & (routes["axis_angle"] <= VERTICAL_MAX_ANGLE)], ["cut", "vertical"], "other")
    routes.loc[routes["family"] != "vertical", "burn"] = np.nan
    return routes.drop(columns=["y", "y_snap"]), df
