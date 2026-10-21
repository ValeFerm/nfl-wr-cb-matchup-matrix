"""Export des données de l'interface web (docs/data.js, servi par GitHub Pages)."""
import html
import json

import numpy as np
import pandas as pd

FIELD_MID_Y = 160 / 6
PATH_STEP = 2  # une frame sur deux (5 Hz) suffit pour dessiner les routes


def _archetype(df, labels):
    """Quadrant (z Burst, z Burn) -> étiquette de scouting."""
    hi_b, hi_n = df["z_burst"] >= 0, df["z_burn"] >= 0
    return np.select([hi_b & hi_n, hi_b & ~hi_n, ~hi_b & hi_n], labels[:3], labels[3])


def _age(birth):
    return ((pd.Timestamp("2021-10-01") - pd.to_datetime(birth, errors="coerce")).dt.days / 365.25).round(1)


def _players(df, labels):
    out = df.assign(archetype=_archetype(df, labels), age=_age(df["birthDate"]))
    out = out.astype({c: "float64" for c in out.select_dtypes("float32").columns})
    for c in ("name", "collegeName"):  # players.csv contient des entités HTML (« Texas A&amp;M »)
        out[c] = out[c].map(lambda v: html.unescape(v) if isinstance(v, str) else v)
    cols = ["nflId", "name", "team", "jerseyNumber", "height", "weight", "collegeName", "age", "archetype",
            "burst", "burn", "z_burst", "z_burn", "pct_burst", "pct_burn", "n_cut", "n_vert",
            "raw_burst", "raw_burn", "tier", "forty", "combine_year"]
    out = out[cols].round({"burst": 3, "burn": 3, "z_burst": 2, "z_burn": 2, "raw_burst": 2, "raw_burn": 2})
    return json.loads(out.to_json(orient="records"))


def _route_paths(frames, routes, wr_ids):
    """Tracés des WR éligibles, repère « route tree » : profondeur depuis la LOS, latéral positif vers l'extérieur."""
    keep = routes[routes["family"].isin(["cut", "vertical"]) & routes["nflId"].isin(wr_ids)]
    f = frames.merge(keep[["gameId", "playId", "nflId", "family"]], on=["gameId", "playId", "nflId"])
    f = f[(f["t"] <= f["t_throw"]) & (f["t"] % PATH_STEP == 0)]
    y0 = f.groupby(["gameId", "playId", "nflId"])["y"].transform("first")
    side = np.where(y0 > FIELD_MID_Y, 1.0, -1.0)  # le WR proche de la touche haute « sort » vers +y
    f = f.assign(d=(f["x"].astype("float64") - f["los_x"]).round(1),
                 l=((f["y"].astype("float64") - y0) * side).round(1))
    paths = {}
    for (wr, fam), g in f.groupby(["nflId", "family"]):
        reps = g.groupby(["gameId", "playId"])
        paths.setdefault(str(wr), {})[fam] = [list(zip(r["l"].tolist(), r["d"].tolist())) for _, r in reps]
    return paths


def _with_draws(records, draws, side):
    """Ajoute à chaque joueur ses B tirages bootstrap d'effets Burst / Burn (incertitude côté navigateur)."""
    for i, r in enumerate(records):
        r["draws"] = {m: np.round(d[side][:, i], 3).tolist() for m, d in draws.items()}
    return records


def export(path, wr, cb, routes, frames, fit_info, validation, meta, draws, completion, situation, forty):
    wr, cb = wr.merge(forty, on="nflId", how="left"), cb.merge(forty, on="nflId", how="left")
    raw = {fam: routes[routes["family"] == fam] for fam in ("cut", "vertical")}
    for df, who in ((wr, "nflId"), (cb, "nflId_db")):
        df["raw_burst"] = df["nflId"].map(raw["cut"].groupby(who)["burst"].mean())
        df["raw_burn"] = df["nflId"].map(raw["vertical"].groupby(who)["burn"].mean())
    data = {
        "meta": meta,
        "fit": {m: {k: float(v) for k, v in d.items()} for m, d in fit_info.items()},
        "validation": validation,
        "completion": completion,
        "situation": situation,
        "wr": _with_draws(_players(wr, ["Complete threat", "Route technician", "Speed burner", "Scheme-dependent"]),
                          draws, 0),
        "cb": _with_draws(_players(cb, ["Exploitable both ways", "Stiff on breaks", "Lacks long speed", "Lockdown"]),
                          draws, 1),
        "paths": _route_paths(frames, routes, set(wr["nflId"])),
    }
    path.parent.mkdir(exist_ok=True)
    path.write_text("window.DATA = " + json.dumps(data, separators=(",", ":")) + ";\n")
