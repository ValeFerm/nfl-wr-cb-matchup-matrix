"""Moteur de décision : incertitude (bootstrap), probabilité de complétion et données de situation."""
import html
import re

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from load import DATA
from scoring import METRICS, fit_effects

N_BOOT = 100


def bootstrap_effects(routes, fit_info, wr_ids, cb_ids, seed=0):
    """Rééchantillonne les matchs (avec remise) et réajuste le ridge : B tirages d'effets par joueur."""
    rng = np.random.default_rng(seed)
    games = routes["gameId"].unique()
    draws = {m: (np.zeros((N_BOOT, len(wr_ids))), np.zeros((N_BOOT, len(cb_ids)))) for m in METRICS}
    for b in range(N_BOOT):  # 100 ajustements ridge creux de ~1 000 lignes : quelques secondes au total
        pick = pd.DataFrame({"gameId": rng.choice(games, len(games))})
        sample = routes.merge(pick, on="gameId")
        for m, fam in METRICS.items():
            sub = sample.loc[sample["family"] == fam, ["gameId", "nflId", "nflId_db", m]].dropna()
            _, a, c = fit_effects(sub, m, fit_info[m]["lambda"])
            draws[m][0][b] = a.reindex(wr_ids).fillna(0).to_numpy()
            draws[m][1][b] = c.reindex(cb_ids).fillna(0).to_numpy()
    return draws


def completion_model(tr):
    """Régression logistique par famille, sur les routes ciblées : P(complète) = σ(b0 + b1 · métrique)."""
    t = tr[tr["targeted"] & tr["family"].isin(["cut", "vertical"])].copy()
    t["metric"] = np.where(t["family"] == "cut", t["burst"], t["burn"])
    t = t.dropna(subset=["metric"])
    out = {}
    for fam, g in t.groupby("family"):
        x, y = g["metric"].to_numpy(), (g["passResult"] == "C").to_numpy(float)

        def nll(b):
            z = b[0] + b[1] * x
            return np.sum(np.logaddexp(0, z) - y * z)

        res = minimize(nll, np.zeros(2), method="BFGS")
        out[fam] = {"b0": float(res.x[0]), "b1": float(res.x[1]), "n": int(len(g))}
    return out


def situation_data(tr, plays_full):
    """Yards gagnés sur les passes complétées et taux d'interception, par famille (routes ciblées en man)."""
    t = tr[tr["targeted"] & tr["family"].isin(["cut", "vertical"])].merge(plays_full, on=["gameId", "playId"])
    out = {}
    for fam, g in t.groupby("family"):
        yds = g.loc[g["passResult"] == "C", "prePenaltyPlayResult"].clip(-5, 99).astype(int)
        out[fam] = {"yards": sorted(yds.tolist()), "int_rate": float((g["passResult"] == "IN").mean()),
                    "n": int(len(g))}
    return out


def bootstrap_outcomes(tr, plays_full, seed=0):
    """Même rééchantillonnage des matchs que les profils : modèle de complétion et yards réajustés à chaque tirage,
    pour que les pourcentages de simulation intègrent aussi l'incertitude des modèles de résultat."""
    rng = np.random.default_rng(seed)
    games = tr["gameId"].unique()
    comp, yards = {"cut": [], "vertical": []}, {"cut": [], "vertical": []}
    for _ in range(N_BOOT):
        sample = tr.merge(pd.DataFrame({"gameId": rng.choice(games, len(games))}), on="gameId")
        cm, sd = completion_model(sample), situation_data(sample, plays_full)
        for fam in comp:
            comp[fam].append([round(cm[fam]["b0"], 4), round(cm[fam]["b1"], 4)])
            yards[fam].append(sd[fam]["yards"])
    return {"completion": comp, "yards": yards}


def _norm_name(s):
    s = html.unescape(str(s)).lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    return re.sub(r"[^a-z]", "", s)


def forty_times(players):
    """40 yards du Combine (nflverse, données publiques) : appariement nom + école, sinon nom + poste unique."""
    path = DATA / "external" / "combine.csv"
    if not path.exists():
        return pd.DataFrame(columns=["nflId", "forty", "combine_year"])
    c = pd.read_csv(path, usecols=["player_name", "pos", "school", "forty", "draft_year", "season"]).dropna(subset=["forty"])
    c = c.assign(key=c["player_name"].map(_norm_name), school_key=c["school"].map(_norm_name))
    p = players.assign(key=players["displayName"].map(_norm_name), school_key=players["collegeName"].map(_norm_name))
    exact = p.merge(c, on=["key", "school_key"])
    rest = p[~p["nflId"].isin(exact["nflId"])]
    by_pos = c[c["pos"].isin(["WR", "CB", "DB", "S"])].drop_duplicates("key", keep=False)
    loose = rest.merge(by_pos, on="key")
    out = pd.concat([exact, loose]).drop_duplicates("nflId")
    return out.assign(combine_year=out["season"].astype(int))[["nflId", "forty", "combine_year"]]
