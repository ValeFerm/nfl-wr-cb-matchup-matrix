"""Hero visualization : quadrants WR / CB + matrice de recommandation de tracés."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap

SURFACE, INK, INK_2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
CUT, VERT, NEUTRAL = "#2a78d6", "#eb6834", "#ecebe7"
DIVERGING = LinearSegmentedColormap.from_list("cut_vs_vert", [VERT, NEUTRAL, CUT])


def _style(ax):
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=INK_2, labelsize=9)
    ax.axhline(0, color=GRID, lw=1, zorder=0)
    ax.axvline(0, color=GRID, lw=1, zorder=0)


def _quadrant(ax, prof, title, xlabel, ylabel, corners, legend, n_labels=12):
    _style(ax)
    lead = prof["z_burst"] - prof["z_burn"]
    color = np.where(lead > 0, CUT, VERT)
    ax.scatter(prof["z_burn"], prof["z_burst"], s=46, c=color, edgecolor=SURFACE, linewidth=1.5, zorder=3)
    # Étiquettes sélectives : les profils les plus marqués
    extreme = (prof["z_burst"] ** 2 + prof["z_burn"] ** 2).nlargest(n_labels).index
    for i in extreme:
        r = prof.loc[i]
        ax.annotate(r["name"], (r["z_burn"], r["z_burst"]), xytext=(5, 4), textcoords="offset points",
                    fontsize=8, color=INK)
    lim = max(prof[["z_burst", "z_burn"]].abs().max().max() * 1.15, 2.5)
    ax.set(xlim=(-lim, lim), ylim=(-lim, lim))
    for (x, y, ha, va), text in zip([(-1, 1, "left", "top"), (1, 1, "right", "top"),
                                     (-1, -1, "left", "bottom"), (1, -1, "right", "bottom")], corners):
        ax.text(x * lim * 0.97, y * lim * 0.97, text, ha=ha, va=va, fontsize=9, color=INK_2, style="italic")
    ax.set_title(title, loc="left", fontsize=12, color=INK, fontweight="bold")
    for c, lab in zip((CUT, VERT), legend):
        ax.scatter([], [], s=46, c=c, label=lab)
    ax.legend(loc="lower left", bbox_to_anchor=(0, 0.06), frameon=False, fontsize=8, labelcolor=INK_2)
    ax.set_xlabel(xlabel, color=INK_2, fontsize=9)
    ax.set_ylabel(ylabel, color=INK_2, fontsize=9)


def hero_figure(wr, cb, adv_cut, adv_vert, path, top=10):
    fig = plt.figure(figsize=(20, 7.6), facecolor=SURFACE)
    gs = fig.add_gridspec(1, 3, width_ratios=[1, 1, 1.25], wspace=0.28)

    _quadrant(fig.add_subplot(gs[0]), wr, "1 · How each WR wins in man coverage",
              "Burn: downfield yards gained on the CB per second (z)  →",
              "Burst: separation gained at the break (z)  →",
              ["ROUTE TECHNICIANS", "COMPLETE THREATS", "SCHEME-DEPENDENT", "SPEED BURNERS"],
              ["stronger at the break", "stronger in a straight line"])
    _quadrant(fig.add_subplot(gs[1]), cb, "2 · Where each CB leaks separation",
              "Burn allowed: beaten over the top (z)  →",
              "Burst allowed: beaten on breaks (z)  →",
              ["STIFF ON BREAKS", "EXPLOITABLE BOTH WAYS", "LOCKDOWN", "LACKS LONG SPEED"],
              ["more vulnerable on breaks", "more vulnerable over the top"])

    # Matrice : WR et CB les plus sollicités en man ; signe = famille de tracés recommandée
    wr_top = wr.nlargest(top, "n_cut", keep="first").sort_values("z_burst", ascending=False)["name"]
    cb_top = cb.assign(n=cb["n_cut"] + cb["n_vert"]).nlargest(top, "n")["name"]
    edge = (adv_cut - adv_vert).loc[wr_top, cb_top]
    ax = fig.add_subplot(gs[2])
    vmax = np.abs(edge.to_numpy()).max()
    im = ax.imshow(edge, cmap=DIVERGING, vmin=-vmax, vmax=vmax, aspect="auto")
    best = np.maximum(adv_cut, adv_vert).loc[wr_top, cb_top]
    for i in range(edge.shape[0]):
        for j in range(edge.shape[1]):
            call = "CUT" if edge.iat[i, j] > 0 else "GO"
            weight = "bold" if best.iat[i, j] > 1 else "normal"   # duel nettement favorable au WR
            ax.text(j, i, call, ha="center", va="center", fontsize=8, color=INK, fontweight=weight)
    ax.set_xticks(range(len(cb_top)), cb_top, rotation=40, ha="right", fontsize=8.5, color=INK)
    ax.set_yticks(range(len(wr_top)), wr_top, fontsize=8.5, color=INK)
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_xticks(np.arange(-.5, len(cb_top)), minor=True)
    ax.set_yticks(np.arange(-.5, len(wr_top)), minor=True)
    ax.grid(which="minor", color=SURFACE, linewidth=2)
    ax.tick_params(which="minor", length=0)
    ax.set_title("3 · Game plan: which route family to call vs this CB", loc="left", fontsize=12,
                 color=INK, fontweight="bold")
    cbar = fig.colorbar(im, ax=ax, fraction=0.035, pad=0.02)
    cbar.set_label("← call verticals (GO)        call breaking routes (CUT) →", color=INK_2, fontsize=8.5)
    cbar.outline.set_visible(False)
    cbar.ax.tick_params(colors=INK_2, labelsize=8)
    ax.text(0, -0.24, "Bold = expected WR edge > 1 SD. Man coverage only (Cover-0/1, 2-Man), 2021 Wk 1-8.",
            transform=ax.transAxes, fontsize=8, color=INK_2)

    fig.suptitle("The WR–CB Matchup Matrix · Burst (win at the break) vs Burn (win with speed)",
                 x=0.07, ha="left", fontsize=16, color=INK, fontweight="bold", y=1.0)
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor=SURFACE)
    plt.close(fig)
