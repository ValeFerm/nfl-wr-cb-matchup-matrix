"""Profils joueurs (WR et CB), seuil d'éligibilité et matrice d'avantage de duel."""
import numpy as np
import pandas as pd

MIN_ROUTES = 15        # tracés cut + vertical minimum par joueur
MIN_PER_FAMILY = 5     # au moins 5 cuts et 5 verticaux pour noter les deux axes
SHRINK_K = 5           # rétrécissement bayésien empirique vers la moyenne ligue (k tracés « fictifs »)


def _shrunk_mean(routes, who, metric, family):
    """Moyenne par joueur rétrécie vers la moyenne ligue : réduit le bruit des petits échantillons."""
    sub = routes.loc[routes["family"] == family, [who, metric]].dropna()
    league = sub[metric].mean()
    agg = sub.groupby(who)[metric].agg(["sum", "count"])
    return ((agg["sum"] + SHRINK_K * league) / (agg["count"] + SHRINK_K)).rename(metric), agg["count"]


def player_profiles(routes, players, who):
    """who='nflId' -> profil WR (séparation créée) ; who='nflId_db' -> profil CB (séparation concédée)."""
    burst, n_cut = _shrunk_mean(routes, who, "burst", "cut")
    burn, n_vert = _shrunk_mean(routes, who, "burn", "vertical")
    prof = pd.concat([burst, burn, n_cut.rename("n_cut"), n_vert.rename("n_vert")], axis=1).fillna({"n_cut": 0, "n_vert": 0})
    prof = prof[(prof["n_cut"] + prof["n_vert"] >= MIN_ROUTES)
                & (prof["n_cut"] >= MIN_PER_FAMILY) & (prof["n_vert"] >= MIN_PER_FAMILY)].copy()
    for m in ("burst", "burn"):
        prof[f"z_{m}"] = (prof[m] - prof[m].mean()) / prof[m].std()
    names = players.set_index("nflId")["displayName"]
    prof["name"] = names.reindex(prof.index).to_numpy()
    return prof.rename_axis("nflId").reset_index()


def split_half_reliability(routes, who):
    """Corrélation des scores bruts entre matchs pairs et impairs (stabilité de la métrique)."""
    out = {}
    for metric, family in (("burst", "cut"), ("burn", "vertical")):
        sub = routes[routes["family"] == family]
        half = sub.groupby(who)["gameId"].rank(method="dense") % 2
        means = sub.groupby([sub[who], half])[metric].agg(["mean", "count"]).unstack()
        means = means[(means["count"] >= 3).all(axis=1)]["mean"]
        out[metric] = (means.iloc[:, 0].corr(means.iloc[:, 1]), len(means))
    return out


def matchup_matrix(wr, cb):
    """Avantage attendu par famille de tracés : z(WR crée) + z(CB concède). Broadcasting WR x CB."""
    cut = wr["z_burst"].to_numpy()[:, None] + cb["z_burst"].to_numpy()[None, :]
    vert = wr["z_burn"].to_numpy()[:, None] + cb["z_burn"].to_numpy()[None, :]
    idx, cols = pd.Index(wr["name"], name="WR"), pd.Index(cb["name"], name="CB")
    return pd.DataFrame(cut, idx, cols), pd.DataFrame(vert, idx, cols)
