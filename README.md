# 🏈 WR–CB Matchup Matrix : Burst vs Burn

### ▶ [Ouvrir l'outil : valeferm.github.io/nfl-wr-cb-matchup-matrix](https://valeferm.github.io/nfl-wr-cb-matchup-matrix/)

[![WR–CB Matchup Matrix : NFL Paris Game, Saints vs Steelers](docs/assets/screens/home.png)](https://valeferm.github.io/nfl-wr-cb-matchup-matrix/)

**Nous avons construit un outil de décision pour les coordinateurs offensifs et défensifs : pour un down et une distance donnés, il dit quel tracé appeler (à cassure ou vertical) contre un cornerback précis en man coverage, et quel corner attaquer ou affecter.** L'idée : un receveur bat son défenseur soit sur la cassure (**Burst**, séparation gagnée en changeant de direction), soit en vitesse pure (**Burn**, terrain gagné sur le CB en ligne droite), et chaque corner cède sur l'un ou l'autre. À partir de 3 865 duels WR–CB reconstruits depuis le tracking Next Gen Stats (2021, semaines 1 à 8), un modèle ajusté à l'adversaire, jugé uniquement sur des matchs qu'il n'a jamais vus, profile 73 receveurs et 75 cornerbacks pour anticiper les duels à venir, et 100 simulations donnent le pourcentage de confiance de chaque recommandation. Ces duels décident des passes : quand le receveur ciblé gagne sa cassure, la passe est complétée **71 % du temps contre 41 %** (p < 0,001). Limites : 8 semaines de données et des tracés déduits de la géométrie, d'où des profils volontairement prudents, à lire comme des tendances de scouting.

**Comment lancer**

```bash
pip install -r requirements.txt   # pandas, numpy, scipy, matplotlib, pyarrow
python main.py                    # ~5 s ; attend le dossier data/ du dépôt officiel à la racine
```

Méthode détaillée, validation et hypothèses : page **[Méthode](https://valeferm.github.io/nfl-wr-cb-matchup-matrix/#method)** et **[La preuve](https://valeferm.github.io/nfl-wr-cb-matchup-matrix/#proof)** du site. Code : `main.py` et `src/` (calcul entièrement vectorisé : pandas, NumPy, SciPy).
