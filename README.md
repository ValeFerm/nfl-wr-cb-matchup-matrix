# The WR–CB Matchup Matrix — Burst vs Burn

Un receveur ne bat pas son défenseur d'une seule façon : nous décomposons la séparation en **man coverage** en **Burst** (séparation gagnée dans les 0,8 s d'un *cut*, rupture de direction ≥ 40° avec rotation du corps) et **Burn** (yards gagnés vers l'avant sur le CB, par seconde, sur un tracé vertical à pleine vitesse). Sur 4 219 duels WR–CB reconstruits automatiquement depuis le tracking NGS (Cover-0/1, 2-Man, semaines 1 à 8 de 2021), nous profilons 44 WR et 57 CB (≥ 15 tracés chacun) ; les deux métriques sont corrélées à la séparation au moment du lancer (r = 0,23 et 0,49), donc à ce que voit le QB. Le résultat est une matrice de game-planning pour le coordinateur offensif : face à Patrick Surtain, qui gagne du terrain sur les cuts mais concède 2,0 yd/s en vertical (moyenne CB : 1,8), on appelle des **GO** ; face à Byron Jones, vulnérable sur les ruptures mais le plus dur à battre en vitesse, Mike Evans doit jouer des **CUT**. Limite : avec 8 semaines de données, la stabilité d'une moitié de saison à l'autre est faible (r ≈ 0,1 à 0,2), donc les profils sont rétrécis vers la moyenne ligue (Bayes empirique) et se lisent comme des tendances de scouting, pas comme des certitudes.

![WR–CB Matchup Matrix](outputs/matchup_matrix.png)

## Comment lancer

```bash
pip install -r requirements.txt
# placer le dossier data/ du dépôt officiel (games.csv, plays.csv, players.csv, pffScoutingData.csv, tracking/) à la racine
python main.py            # jeu complet, environ 5 s (lecture des CSV puis cache parquet)
python main.py --sample 50  # prototype sur 50 actions
```

Sorties dans `outputs/` : `matchup_matrix.png`, `wr_profiles.csv`, `cb_profiles.csv`, `matchup_edge_cut_minus_vertical.csv`, `routes.csv`.

## Méthode (résumé)

- **Normalisation** : quand `playDirection == left`, on fait pivoter le terrain de 180° (x, y, `dir`, `o`) pour que toutes les attaques aillent vers +x.
- **Duel man** : le CB assigné à un WR est le défenseur en couverture le plus proche en moyenne sur la 1re seconde après le snap. Le duel n'est gardé que si ce défenseur reste le plus proche sur au moins 70 % des frames jusqu'au lancer, à 8 yd en moyenne au maximum.
- **Familles de tracés** : un tracé est **cut** si on détecte une rupture (changement de `dir` ≥ 40° et de `o` ≥ 25° en 0,8 s, vitesse ≥ 2 yd/s, au moins 2 yd au-delà de la ligne de mêlée). Il est **vertical** s'il n'y a pas de rupture, qu'il dépasse 7 yd de profondeur et qu'il reste à moins de 30° de l'axe du terrain. Les autres tracés (screens, flats) sont écartés.
- **Matrice** : l'avantage attendu par famille vaut z(ce que le WR crée) + z(ce que le CB concède). Le calcul est vectorisé de bout en bout (pandas + NumPy, avec broadcasting pour la matrice WR × CB).
