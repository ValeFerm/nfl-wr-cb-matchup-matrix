"""Validation football : la séparation créée se traduit-elle en passes complétées quand le WR est ciblé ?"""
import numpy as np
import pandas as pd
from scipy.stats import norm

TARGET_RE = r"pass (?:incomplete )?(?:short|deep) (?:left|middle|right) (?:to|intended for) (.{0,30})"


def targeted_routes(routes, plays, players):
    """Marque les routes dont le WR est la cible de la passe (nom abrégé « C.Godwin » dans playDescription)."""
    seg = plays[["gameId", "playId"]].assign(target=plays["playDescription"].str.extract(TARGET_RE, expand=False))
    r = routes.merge(seg, on=["gameId", "playId"], how="left").merge(
        players[["nflId", "displayName"]], on="nflId", how="left")
    last = r["displayName"].str.split(" ", n=1).str[1].fillna("~")
    first = r["displayName"].str[0].fillna("~")
    # Comparaison chaîne à chaîne sur ~4 000 routes (pas de tracking) : le nom de famille doit suivre l'initiale
    r["targeted"] = [isinstance(t, str) and t.startswith(f) and f".{ln}" in t.replace(". ", ".", 1)[:len(ln) + 4]
                     or isinstance(t, str) and t.split(".", 1)[-1].startswith(ln)
                     for t, f, ln in zip(r["target"], first, last)]
    return r.drop(columns=["target", "displayName"]).merge(plays[["gameId", "playId", "passResult"]],
                                                         on=["gameId", "playId"])


def completion_by_separation(tr):
    """Taux de complétion des routes ciblées selon le gain de séparation (Burst sur cuts, Burn sur verticaux)."""
    t = tr[tr["targeted"] & tr["family"].isin(["cut", "vertical"])].copy()
    t["complete"] = (t["passResult"] == "C").astype(float)
    t["metric"] = np.where(t["family"] == "cut", t["burst"], t["burn"])
    t = t.dropna(subset=["metric"])  # vertical sans phase linéaire mesurable : pas de Burn
    # Seuils : la médiane de chaque famille sépare « a gagné le duel » / « l'a perdu »
    t["won"] = t["metric"] > t.groupby("family")["metric"].transform("median")
    out = t.groupby(["family", "won"]).agg(n=("complete", "size"), completion=("complete", "mean"),
                                           sep_throw=("sep_throw", "mean")).reset_index()
    # Test bilatéral de différence de proportions (gagné vs perdu), par famille
    g = out.pivot(index="family", columns="won", values=["n", "completion"])
    n1, n0, p1, p0 = g[("n", True)], g[("n", False)], g[("completion", True)], g[("completion", False)]
    pool = (p1 * n1 + p0 * n0) / (n1 + n0)
    z = (p1 - p0) / np.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n0))
    out["p_value"] = out["family"].map(pd.Series(2 * norm.sf(np.abs(z)), index=z.index))
    sep_bins = pd.cut(t["sep_throw"], [0, 1, 2, 3, np.inf], labels=["<1 yd", "1-2 yd", "2-3 yd", "3+ yd"])
    by_sep = t.groupby(sep_bins, observed=True)["complete"].agg(["size", "mean"]).reset_index()
    return out, by_sep, t
