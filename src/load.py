"""Chargement des données NGS + PFF, filtrage man coverage et normalisation du sens du jeu."""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = ROOT / "cache"

SNAP_EVENTS = ["ball_snap", "autoevent_ballsnap"]
THROW_EVENTS = ["pass_forward", "autoevent_passforward"]
TRACK_COLS = ["gameId", "playId", "nflId", "frameId", "jerseyNumber", "team", "playDirection", "x", "y", "s", "o", "dir",
              "event"]
TRACK_DTYPES = {"gameId": "int64", "playId": "int32", "nflId": "float64", "frameId": "int16",
                "jerseyNumber": "float32", "x": "float32", "y": "float32", "s": "float32", "o": "float32",
                "dir": "float32"}
POST_THROW_FRAMES = 8  # marge après le lancer pour les fenêtres glissantes (direction sur 0,8 s)


def load_meta():
    plays = pd.read_csv(DATA / "plays.csv", usecols=["gameId", "playId", "playDescription", "passResult",
                                                    "pff_passCoverage", "pff_passCoverageType", "possessionTeam",
                                                    "defensiveTeam"])
    pff = pd.read_csv(DATA / "pffScoutingData.csv", usecols=["gameId", "playId", "nflId", "pff_role"])
    players = pd.read_csv(DATA / "players.csv", usecols=["nflId", "officialPosition", "displayName", "height", "weight",
                                                        "birthDate", "collegeName"])
    return plays, pff, players


def build_roster(plays, pff, players, sample=None, seed=0):
    """Actions en man + tous les coureurs de route (WR/TE/RB) et tous les défenseurs en couverture.

    Les TE/RB servent uniquement à l'assignation des duels (un CB peut suivre un TE) ; l'analyse garde les WR.
    """
    man = plays[plays["pff_passCoverageType"] == "Man"]
    if sample:
        man = man.sample(sample, random_state=seed)
    roster = pff.merge(man[["gameId", "playId"]]).merge(players[["nflId", "officialPosition"]])
    roster = roster[roster["pff_role"].isin(["Pass Route", "Coverage"])]
    roster = roster.assign(side=np.where(roster["pff_role"] == "Pass Route", "O", "D"))
    return man, roster[["gameId", "playId", "nflId", "side", "officialPosition"]]


def _read_game(game_id, play_ids):
    df = pd.read_csv(DATA / "tracking" / f"tracking_{game_id}.csv", usecols=TRACK_COLS, dtype=TRACK_DTYPES)
    return df[df["playId"].isin(play_ids)]


def load_tracking(man, roster):
    """Tracking filtré (snap -> lancer + 0,5 s), normalisé pour que toute attaque aille vers +x."""
    plays_by_game = man.groupby("gameId")["playId"].apply(set)
    trk = pd.concat([_read_game(g, p) for g, p in plays_by_game.items()], ignore_index=True)

    # Normalisation : attaque toujours vers la droite (rotation de 180° du terrain)
    left = trk["playDirection"].to_numpy() == "left"
    trk.loc[left, "x"] = 120.0 - trk.loc[left, "x"]
    trk.loc[left, "y"] = 160 / 3 - trk.loc[left, "y"]
    trk.loc[left, "dir"] = (trk.loc[left, "dir"] + 180.0) % 360.0
    trk.loc[left, "o"] = (trk.loc[left, "o"] + 180.0) % 360.0

    # Bornes temporelles par action : premier snap, premier lancer
    key = ["gameId", "playId"]
    ev = trk.loc[trk["event"].notna(), key + ["frameId", "event"]]
    snap = ev[ev["event"].isin(SNAP_EVENTS)].groupby(key)["frameId"].min().rename("snap")
    throw = ev[ev["event"].isin(THROW_EVENTS)].groupby(key)["frameId"].min().rename("throw")
    bounds = pd.concat([snap, throw], axis=1, join="inner").reset_index()
    bounds = bounds[bounds["throw"] > bounds["snap"]]

    # Ligne de mêlée = position du ballon au snap
    ball = trk[trk["nflId"].isna()].merge(bounds, on=key)
    los = ball.loc[ball["frameId"] == ball["snap"], key + ["x"]].rename(columns={"x": "los_x"})

    trk = trk.merge(roster, on=key + ["nflId"]).merge(bounds, on=key).merge(los, on=key)
    trk = trk[(trk["frameId"] >= trk["snap"]) & (trk["frameId"] <= trk["throw"] + POST_THROW_FRAMES)]
    trk = trk.assign(t=(trk["frameId"] - trk["snap"]).astype("int16"),
                     t_throw=(trk["throw"] - trk["snap"]).astype("int16"),
                     nflId=trk["nflId"].astype("int64"))
    return trk.drop(columns=["playDirection", "event", "frameId", "snap", "throw"]).reset_index(drop=True)


def player_teams(trk):
    """Équipe et numéro les plus fréquents par joueur (un joueur peut changer d'équipe en cours de saison)."""
    return (trk.groupby(["nflId", "team", "jerseyNumber"]).size().rename("n").reset_index()
            .sort_values("n").drop_duplicates("nflId", keep="last").drop(columns="n"))


def get_tracking(sample=None):
    """Point d'entrée avec cache parquet."""
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"tracking_man_{sample or 'full'}.parquet"
    plays, pff, players = load_meta()
    man, roster = build_roster(plays, pff, players, sample=sample)
    if path.exists():
        trk = pd.read_parquet(path)
    else:
        trk = load_tracking(man, roster)
        trk.to_parquet(path, index=False)
    return trk, man, players
