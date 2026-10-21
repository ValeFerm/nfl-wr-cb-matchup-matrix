"""Profils joueurs ajustés à l'adversaire (ridge WR + CB), éligibilité et matrice d'avantage de duel."""
import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse.linalg import lsqr

MIN_ROUTES = 15        # tracés cut + vertical minimum par joueur
MIN_PER_FAMILY = 5     # au moins 5 cuts et 5 verticaux pour noter les deux axes
LAMBDAS = [1, 2, 5, 10, 20, 50, 100, 200, 500]
METRICS = {"burst": "cut", "burn": "vertical"}


def _design(sub, wr_ids, cb_ids):
    """Matrice creuse one-hot [WR | CB] : chaque route = effet du WR + effet du CB qui le couvre."""
    n = len(sub)
    rows = np.r_[np.arange(n), np.arange(n)]
    cols = np.r_[wr_ids.get_indexer(sub["nflId"]), len(wr_ids) + cb_ids.get_indexer(sub["nflId_db"])]
    keep = cols >= 0
    return sparse.csr_matrix((np.ones(keep.sum()), (rows[keep], cols[keep])), shape=(n, len(wr_ids) + len(cb_ids)))


def fit_effects(sub, metric, lam):
    """Ridge : metric = mu + a_WR + b_CB + bruit. lsqr(damp) minimise ||Xb - y||² + lam·||b||²."""
    wr_ids, cb_ids = pd.Index(sub["nflId"].unique()), pd.Index(sub["nflId_db"].unique())
    mu = sub[metric].mean()
    coef = lsqr(_design(sub, wr_ids, cb_ids), sub[metric].to_numpy() - mu, damp=np.sqrt(lam))[0]
    return mu, pd.Series(coef[:len(wr_ids)], wr_ids), pd.Series(coef[len(wr_ids):], cb_ids)


def cross_validate(routes, metric):
    """Validation croisée 2 plis par matchs (pairs / impairs) : choisit lambda, mesure le R² hors échantillon."""
    sub = routes.loc[routes["family"] == METRICS[metric], ["gameId", "nflId", "nflId_db", metric]].dropna()
    fold = sub["gameId"].rank(method="dense").to_numpy() % 2
    base, scores = 0.0, {}
    for lam in LAMBDAS:
        sse = 0.0
        for f in (0, 1):
            train, test = sub[fold != f], sub[fold == f]
            mu, a, b = fit_effects(train, metric, lam)
            pred = mu + a.reindex(test["nflId"]).fillna(0).to_numpy() + b.reindex(test["nflId_db"]).fillna(0).to_numpy()
            sse += ((test[metric].to_numpy() - pred) ** 2).sum()
            if lam == LAMBDAS[0]:
                base += ((test[metric].to_numpy() - train[metric].mean()) ** 2).sum()
        scores[lam] = sse
    best = min(scores, key=scores.get)
    return best, 1 - scores[best] / base, sub


def player_effects(routes):
    """Effets WR (séparation créée) et CB (séparation concédée) pour Burst et Burn, + volumes."""
    out, fit_info = {"WR": [], "CB": []}, {}
    for metric, family in METRICS.items():
        lam, r2, sub = cross_validate(routes, metric)
        mu, a, b = fit_effects(sub, metric, lam)
        fit_info[metric] = {"lambda": lam, "oos_r2": r2, "mu": mu, "route_sd": sub[metric].std(), "n": len(sub)}
        out["WR"].append(a.rename(metric))
        out["CB"].append(b.rename(metric))
    counts = {"WR": "nflId", "CB": "nflId_db"}
    profiles = {}
    for side, col in counts.items():
        n = routes[routes["family"] != "other"].groupby(col)["family"].value_counts().unstack(fill_value=0)
        prof = pd.concat(out[side], axis=1).join(n.rename(columns={"cut": "n_cut", "vertical": "n_vert"}), how="inner")
        prof = prof.fillna(0.0)
        profiles[side] = prof.rename_axis("nflId").reset_index()
    return profiles["WR"], profiles["CB"], fit_info


def eligible(prof, players, teams):
    """Seuil de volume, z-scores et percentiles (calculés parmi les éligibles), infos joueur."""
    p = prof[(prof["n_cut"] + prof["n_vert"] >= MIN_ROUTES)
             & (prof["n_cut"] >= MIN_PER_FAMILY) & (prof["n_vert"] >= MIN_PER_FAMILY)].copy()
    for m in METRICS:
        p[f"z_{m}"] = (p[m] - p[m].mean()) / p[m].std()
        p[f"pct_{m}"] = (p[m].rank(pct=True) * 100).round().astype(int)
    return p.merge(players, on="nflId", how="left").merge(teams, on="nflId", how="left").rename(
        columns={"displayName": "name"})


def matchup_matrix(wr, cb, fit_info):
    """Avantage attendu WR x CB par famille, en écarts-types de route (unité commune). Broadcasting NumPy.

    Burst attendu (yd) = mu + a_WR + b_CB ; Burn attendu (yd/s) idem. Un CB peu fiable a un effet rétréci
    vers 0 par le ridge : il pèse donc naturellement moins que le WR dans la recommandation.
    """
    edges = {}
    for m in METRICS:
        edges[m] = (wr[m].to_numpy()[:, None] + cb[m].to_numpy()[None, :]) / fit_info[m]["route_sd"]
    idx, cols = pd.Index(wr["name"], name="WR"), pd.Index(cb["name"], name="CB")
    return pd.DataFrame(edges["burst"], idx, cols), pd.DataFrame(edges["burn"], idx, cols)


def split_half_reliability(routes, who):
    """Corrélation des moyennes brutes entre matchs pairs et impairs (stabilité de la métrique)."""
    out = {}
    for metric, family in METRICS.items():
        sub = routes[routes["family"] == family]
        half = sub.groupby(who)["gameId"].rank(method="dense") % 2
        means = sub.groupby([sub[who], half])[metric].agg(["mean", "count"]).unstack()
        means = means[(means["count"] >= 3).all(axis=1)]["mean"] if "count" in means else pd.DataFrame()
        ok = means.shape[1] == 2 and len(means) >= 3  # échantillon trop petit (mode --sample) : non calculable
        out[metric] = (means.iloc[:, 0].corr(means.iloc[:, 1]) if ok else float("nan"), len(means))
    return out
