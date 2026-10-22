"use strict";
/* ==========================================================================
   Wrist Coach : le coach lève l'avant-bras, son brassard numérique vient remplir l'écran,
   puis le simulateur génère un tracé fidèle au modèle (famille tirée selon le % du labo,
   vraie répétition du receveur recalibrée sur ce duel), et enfin l'action complète.
   Dépend des globales du site (index.html) : evaluate, FIT, CMP, SIT, state, LANG, needYards, esc, WR, CB, byId.
   ========================================================================== */
const WristCoach = (() => {
  const TXT = {
    en: {
      btn: "Generate the route on the wrist coach", brand: "WRIST COACH", loading: "Loading real routes…",
      ball: "Ball on", call: "The call", cut: "CUT", go: "GO", cutName: "Break it off", goName: "Go vertical",
      drawn: "Drawn with the lab's split: over many snaps, this call comes out {p} of the time (Thompson sampling).",
      src: "Real route of {w} · Week {wk} vs {op} · recalibrated to face {c}",
      burstK: "Separation won at the break", burnK: "Ground gained on the CB", target: "model for this duel: {v}",
      release: "Separation at release", pcmp: "Completion probability", pcmpS: "this snap, from the model",
      full: "▶ Full play", fullIn: "▶ Full play", again: "↻ New snap", twenty: "≡ 20 snaps", back: "Back to the lab",
      complete: "Complete", incomplete: "Incomplete", pbu: "Pass breakup", int: "Intercepted", td: "Touchdown",
      first: "First down", success: "Successful play", short: "{n} yd short of the target", gain: "+{n} yd",
      routeOn: "Route in progress…", decision: "Release: the QB lets it go.", playOn: "Ball in the air…",
      tally: "20 simulated snaps vs the model", calls: "CUT calls", cmps: "Completions", succ: "Successes", exp: "exp. {v}",
      post: "Tracking stops ~0.3 s after the throw: the rest of the play is projected from each player's last real velocity, and the result is drawn with the model's probabilities.",
      brk: "BREAK", burnL: "BURN", yd: "yd", yds: "yd/s", esc: "Esc", close: "Close"
    },
    fr: {
      btn: "Générer le tracé sur le wrist coach", brand: "WRIST COACH", loading: "Chargement des tracés réels…",
      ball: "Ballon sur", call: "L'appel", cut: "CUT", go: "GO", cutName: "Tracé à cassure", goName: "Attaque verticale",
      drawn: "Tiré selon la répartition du labo : sur un grand nombre de snaps, cet appel sort {p} du temps (Thompson sampling).",
      src: "Vrai tracé de {w} · semaine {wk} contre {op} · recalibré face à {c}",
      burstK: "Séparation gagnée sur la cassure", burnK: "Terrain gagné sur le CB", target: "modèle pour ce duel : {v}",
      release: "Séparation au lancer", pcmp: "Probabilité de complétion", pcmpS: "sur ce snap, d'après le modèle",
      full: "▶ Action complète", fullIn: "▶ Action complète", again: "↻ Nouveau snap", twenty: "≡ 20 snaps", back: "Retour au labo",
      complete: "Complétée", incomplete: "Incomplète", pbu: "Passe déviée", int: "Interceptée", td: "Touchdown",
      first: "Premier down", success: "Action réussie", short: "à {n} yd de l'objectif", gain: "+{n} yd",
      routeOn: "Tracé en cours…", decision: "Lancer : le QB lâche le ballon.", playOn: "Ballon en l'air…",
      tally: "20 snaps simulés contre le modèle", calls: "Appels CUT", cmps: "Complétées", succ: "Réussites", exp: "att. {v}",
      post: "Le tracking s'arrête ~0,3 s après le lancer : la suite est projetée à partir de la dernière vitesse réelle de chaque joueur, et le résultat est tiré avec les probabilités du modèle.",
      brk: "CASSURE", burnL: "BURN", yd: "yd", yds: "yd/s", esc: "Échap", close: "Fermer"
    }
  };
  const tx = (k, v) => {
    let s = (TXT[typeof LANG !== "undefined" ? LANG : "en"] || TXT.en)[k] ?? TXT.en[k] ?? k;
    if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll("{" + a + "}", b);
    return s;
  };
  const fr = () => typeof LANG !== "undefined" && LANG === "fr";
  const nf = (v, d = 1) => fr() ? v.toFixed(d).replace(".", ",") : v.toFixed(d);
  const pc = v => Math.round(v * 100) + (fr() ? " %" : "%");
  const sg = (v, d = 1) => (v >= 0 ? "+" : "−") + nf(Math.abs(v), d);
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="6" width="14" height="12" rx="2.5"/><path d="M8 6V3h8v3M8 18v3h8v-3M9 14l2.2-3 2 2L15 10"/></svg>`;

  const DBG = new URLSearchParams(location.search).has("wcDebug");
  const log = (...a) => { if (DBG) console.log("[wc]", Math.round(performance.now()), ...a); };
  // ---------------------------------------------------------------- données
  let simPromise = null;
  const loadSim = () => window.SIM ? Promise.resolve(window.SIM) : (simPromise ||= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "sim.js"; s.onload = () => res(window.SIM); s.onerror = rej;
    document.head.appendChild(s);
  }));

  // ---------------------------------------------------------------- simulation d'un snap
  const BALL_SPEED = 21;      // yd/s au sol, vol d'une passe NFL typique
  const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const sigm = z => 1 / (1 + Math.exp(-z));
  const MIN_SEP = 0.35;  // distance mini entre les centres des deux joueurs (contact)

  function decode(rep) {
    const wr = [], cb = [];
    for (let i = 0; i < rep.p.length; i += 4) { wr.push([rep.p[i] / 10, rep.p[i + 1] / 10]); cb.push([rep.p[i + 2] / 10, rep.p[i + 3] / 10]); }
    return { wr, cb };
  }
  function keepApart(wr, cb, t) {  // aucun chevauchement des deux joueurs après recalibrage
    const s = dist(wr[t], cb[t]);
    if (s >= MIN_SEP) return;
    const ux = s > 1e-6 ? (cb[t][0] - wr[t][0]) / s : 1, uy = s > 1e-6 ? (cb[t][1] - wr[t][1]) / s : 0;
    cb[t] = [wr[t][0] + ux * MIN_SEP, wr[t][1] + uy * MIN_SEP];
  }
  // Cut : la séparation gagnée sur la fenêtre de 0,8 s devient exactement la cible (rampe linéaire sur la fenêtre)
  function recalibrateCut(wr, cb, tc, delta) {
    for (let t = tc; t < wr.length; t++) {
      const k = Math.min((t - tc) / 8, 1), s = dist(wr[t], cb[t]);
      if (s < 1e-6) continue;
      const ns = Math.max(MIN_SEP, s + delta * k), f = ns / s;
      cb[t] = [wr[t][0] + (cb[t][0] - wr[t][0]) * f, wr[t][1] + (cb[t][1] - wr[t][1]) * f];
    }
  }
  // Vertical : le CB perd (ou reprend) « delta » yd/s de profondeur pendant la phase linéaire du vrai tracé
  function recalibrateBurn(wr, cb, a, b, delta) {
    for (let t = a + 1; t < wr.length; t++) {
      const k = Math.min(t - a, b - a) / 10;
      cb[t] = [cb[t][0], cb[t][1] - delta * k];
      keepApart(wr, cb, t);
    }
  }
  // Après le lancer, le tracking s'arrête vite : on prolonge avec la dernière vitesse réelle (le CB poursuit le WR)
  function extendWR(wr, upto) {
    while (wr.length <= upto) { const n = wr.length; wr.push([2 * wr[n - 1][0] - wr[n - 2][0], 2 * wr[n - 1][1] - wr[n - 2][1]]); }
  }
  const catchFrame = (wr, q, tt) => { let k = 3; while (k < 45 && dist(q, wr[tt + k]) / BALL_SPEED > k / 10) k++; return tt + k; };
  // Caractéristiques géométriques d'une répétition (indépendantes du CB) : séparation au début de la cassure et, pour
  // chaque instant de lancer possible (du vrai lancer jusqu'à la fin de la mesure Burst/Burn), la profondeur de réception
  function repInfo(rep) {
    if (rep._info) return rep._info;
    const { wr, cb } = decode(rep), q = [rep.q[0] / 10, rep.q[1] / 10];
    extendWR(wr, rep.tt + 50);
    const tmin = Math.min(rep.tt, rep.tc >= 0 ? rep.tc + 8 : rep.l0 > 0 ? Math.max(rep.l1, 5) : rep.tt);
    const releases = [];
    for (let tr = tmin; tr <= rep.tt; tr++) releases.push([tr, wr[catchFrame(wr, q, tr)][1]]);
    return (rep._info = { s0: rep.tc >= 0 ? dist(wr[rep.tc], cb[rep.tc]) : 0, releases, minDepth: Math.min(...releases.map(r => r[1])) });
  }
  function extend(wr, cb, upto) {
    const vel = (arr) => { const n = arr.length; return [arr[n - 1][0] - arr[n - 2][0], arr[n - 1][1] - arr[n - 2][1]]; };
    while (wr.length <= upto) {
      const vw = vel(wr), vc = vel(cb), n = wr.length;
      const w = [wr[n - 1][0] + vw[0], wr[n - 1][1] + vw[1]];
      const sc = Math.max(Math.hypot(vc[0], vc[1]), 0.55), to = [w[0] - cb[n - 1][0], w[1] - cb[n - 1][1]], d = Math.hypot(to[0], to[1]) || 1;
      const dir = [0.55 * vc[0] / sc + 0.45 * to[0] / d, 0.55 * vc[1] / sc + 0.45 * to[1] / d], dn = Math.hypot(dir[0], dir[1]) || 1;
      wr.push(w); cb.push([cb[n - 1][0] + dir[0] / dn * sc, cb[n - 1][1] + dir[1] / dn * sc]);
      keepApart(wr, cb, wr.length - 1);
    }
  }

  function simulate(w, c, ev, forced) {
    // 1. Famille : tirée avec la probabilité affichée dans le labo (part des simulations où l'appel est le meilleur)
    const isCut = forced ? forced === "cut" : Math.random() < ev.shareCut;
    const fam = isCut ? "cut" : "vertical", mkey = isCut ? "burst" : "burn";
    // 2. Cible du duel : espérance du modèle (WR + CB, ajusté adversaire) + variabilité réelle d'une répétition à l'autre
    const expected = isCut ? ev.mC : ev.mG;
    const target = expected + FIT[mkey].route_sd * randn();
    // 3. Résultat : P(complétion) du modèle logistique pour cette séparation, P(INT) ligue ; 4. gain : distribution du labo
    const pCmp = sigm(CMP[fam].b0 + CMP[fam].b1 * target), pInt = SIT[fam].int_rate, u = Math.random();
    const outcome = u < pCmp ? "complete" : u < pCmp + pInt ? "int" : "incomplete";
    // 4. Répétition réelle du receveur (séparation cible atteignable), puis 5. gain : distribution ligue tronquée à la
    //    profondeur où il reçoit le ballon sur cette répétition, exactement comme dans le labo
    const all = window.SIM.reps[String(w.nflId)] || [];
    let pool = all.filter(r => r.f === (isCut ? "c" : "v") && (isCut ? r.tc >= 0 : r.l0 > 0));
    if (!pool.length) pool = all.filter(r => r.f === (isCut ? "c" : "v"));
    if (isCut) { const ok = pool.filter(r => repInfo(r).s0 + target >= MIN_SEP); if (ok.length) pool = ok; }
    const rep = pool[Math.floor(Math.random() * pool.length)];
    let gain = 0;
    if (outcome === "complete") {
      const d = repInfo(rep).minDepth, ys = SIT[fam].yards.filter(y => y >= d - 0.5);
      gain = Math.min(ys.length ? ys[Math.floor(Math.random() * ys.length)] : Math.round(d), state.toGoal);
    }
    const { wr, cb } = decode(rep);
    // Instant du lancer : le vrai, sauf si le gain tiré impose une réception plus courte (lancer « dans le timing »,
    // jamais avant la fin de la fenêtre de mesure) ; on garde le plus tardif compatible pour rester proche du réel
    let tt = rep.tt;
    if (outcome === "complete") {
      const R = repInfo(rep).releases, ok = R.filter(r => r[1] <= gain + 0.5);
      tt = ok.length ? ok[ok.length - 1][0] : R.reduce((m, r) => r[1] < m[1] ? r : m)[0];
    }
    let realized;
    if (isCut) {
      const tc = rep.tc, sepGain = () => dist(wr[tc + 8], cb[tc + 8]) - dist(wr[tc], cb[tc]);
      recalibrateCut(wr, cb, tc, target - sepGain());
      realized = sepGain();
    } else {
      const a = rep.l0 - 1, b = rep.l1, lead = t => wr[t][1] - cb[t][1], rate = () => (lead(b) - lead(a)) / ((b - a) / 10);
      recalibrateBurn(wr, cb, a, b, target - rate());
      realized = rate();
    }
    const q = [rep.q[0] / 10, rep.q[1] / 10];
    extend(wr, cb, tt + 60);

    // Vol du ballon : premier instant où le ballon (21 yd/s) rejoint le receveur
    const tCatch = catchFrame(wr, q, tt), catchPt = wr[tCatch].slice();
    const sepRelease = dist(wr[tt], cb[tt]), sepCatch = dist(wr[tCatch], cb[tCatch]);
    let tEnd = tCatch + 8, carrier = null, land = null;
    const cut = (arr, from) => arr.splice(from);
    if (outcome === "complete") {
      const depth = catchPt[1];
      if (depth >= state.toGoal) gain = state.toGoal;  // réception dans l'en-but
      else if (gain < depth - 0.5) gain = Math.round(depth);
      const yac = Math.max(0, gain - depth);
      const v = [wr[tCatch][0] - wr[tCatch - 1][0], wr[tCatch][1] - wr[tCatch - 1][1]], vn = Math.hypot(v[0], v[1]) || 1;
      let dir = [0.3 * v[0] / vn, 0.3 * v[1] / vn + 0.7]; const dn = Math.hypot(dir[0], dir[1]); dir = [dir[0] / dn, dir[1] / dn];
      const L = yac / Math.max(dir[1], 0.4), steps = Math.max(2, Math.ceil(L / 0.72));
      cut(wr, tCatch + 1); cut(cb, tCatch + 1);
      for (let i = 1; i <= steps; i++) {
        const p = [catchPt[0] + dir[0] * L * i / steps, catchPt[1] + dir[1] * L * i / steps];
        const prev = cb[cb.length - 1], to = [p[0] - prev[0], p[1] - prev[1]], d = Math.hypot(to[0], to[1]) || 1, st = Math.min(0.8, Math.max(d - 0.9, 0));
        wr.push(p); cb.push([prev[0] + to[0] / d * st, prev[1] + to[1] / d * st]);
      }
      for (let i = 0; i < 6; i++) { wr.push(wr[wr.length - 1].slice()); cb.push(cb[cb.length - 1].slice()); }
      tEnd = wr.length - 1; carrier = "wr";
    } else if (outcome === "int") {
      for (let i = 4; i >= 0; i--) {  // le CB attaque le ballon
        const t = tCatch - i, f = (4 - i) / 4;
        cb[t] = [cb[t][0] + (catchPt[0] + 0.4 - cb[t][0]) * f, cb[t][1] + (catchPt[1] + 0.3 - cb[t][1]) * f];
      }
      const ret = 4 + Math.random() * 12, steps = Math.ceil(ret / 0.75);
      cut(wr, tCatch + 1); cut(cb, tCatch + 1);
      for (let i = 1; i <= steps; i++) {
        const p = [cb[tCatch][0] + 0.25 * ret * i / steps, cb[tCatch][1] - ret * i / steps];
        const prev = wr[wr.length - 1], to = [p[0] - prev[0], p[1] - prev[1]], d = Math.hypot(to[0], to[1]) || 1, st = Math.min(0.78, Math.max(d - 0.9, 0));
        cb.push(p); wr.push([prev[0] + to[0] / d * st, prev[1] + to[1] / d * st]);
      }
      for (let i = 0; i < 6; i++) { wr.push(wr[wr.length - 1].slice()); cb.push(cb[cb.length - 1].slice()); }
      tEnd = wr.length - 1; carrier = "cb";
    } else {
      const fd = [catchPt[0] - q[0], catchPt[1] - q[1]], fn = Math.hypot(fd[0], fd[1]) || 1;
      land = [catchPt[0] + fd[0] / fn * 3, catchPt[1] + fd[1] / fn * 3];
      cut(wr, tCatch + 1); cut(cb, tCatch + 1);
      for (let i = 1; i <= 8; i++) {  // les deux joueurs ralentissent
        const f = Math.max(0, 1 - i / 8);
        for (const arr of [wr, cb]) { const n = arr.length; arr.push([arr[n - 1][0] + (arr[n - 1][0] - arr[n - 2][0]) * f, arr[n - 1][1] + (arr[n - 1][1] - arr[n - 2][1]) * f]); }
      }
      tEnd = wr.length - 1;
    }
    // Point de cassure visible : courbure maximale du tracé dans la fenêtre de mesure de 0,8 s
    let tb = rep.tc;
    if (isCut) {
      let best = -1;
      for (let t = rep.tc + 1; t <= rep.tc + 7; t++) {
        const a = [wr[t][0] - wr[t - 1][0], wr[t][1] - wr[t - 1][1]], b = [wr[t + 1][0] - wr[t][0], wr[t + 1][1] - wr[t][1]];
        const ang = Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
        if (ang > best) { best = ang; tb = t; }
      }
    }
    const need = needYards();
    return { fam: isCut ? "cut" : "go", rep, wr, cb, q, tt, tCatch, tEnd, catchPt, land, carrier, outcome, gain, tb,
      success: outcome === "complete" && gain >= need, td: outcome === "complete" && gain >= state.toGoal,
      target, expected, realized, sepRelease, sepCatch, pCmp, tc: rep.tc, l0: rep.l0, l1: rep.l1 };
  }

  // ---------------------------------------------------------------- dessin du terrain (SVG)
  const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  function at(arr, t) {  // Catmull-Rom : mouvement fluide entre deux frames réelles (10 Hz)
    const n = arr.length - 1;
    if (t <= 0) return arr[0].slice();
    if (t >= n) return arr[n].slice();
    const i = Math.floor(t), f = t - i, p0 = arr[Math.max(i - 1, 0)], p1 = arr[i], p2 = arr[Math.min(i + 1, n)], p3 = arr[Math.min(i + 2, n)];
    const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
    return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
  }

  function viewFor(snaps, box) {
    let minL = Infinity, maxL = -Infinity, minD = Infinity, maxD = -Infinity;
    for (const s of snaps) {
      for (const p of [...s.wr.slice(0, s.tEnd + 1), ...s.cb.slice(0, s.tEnd + 1), s.q]) {
        minL = Math.min(minL, p[0]); maxL = Math.max(maxL, p[0]); minD = Math.min(minD, p[1]); maxD = Math.max(maxD, p[1]);
      }
    }
    minL -= 4; maxL += 4; minD = Math.min(minD, -2) - 3; maxD = Math.max(maxD + 4, Math.min(state.togo, 30) + 3, 12);
    const s = Math.min(box.w / (maxL - minL), box.h / (maxD - minD));
    const cx = (minL + maxL) / 2, cy = (minD + maxD) / 2;
    return { s, X: l => box.w / 2 + (l - cx) * s, Y: d => box.h / 2 - (d - cy) * s, minL: cx - box.w / 2 / s, maxL: cx + box.w / 2 / s,
      minD: cy - box.h / 2 / s, maxD: cy + box.h / 2 / s };
  }

  function drawField(svg, v, box) {
    svg.setAttribute("viewBox", `0 0 ${box.w} ${box.h}`);
    svg.innerHTML = "";
    const defs = el("defs", {}, svg);
    const glow = el("filter", { id: "wcGlow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
    el("feGaussianBlur", { stdDeviation: 3, result: "b" }, glow);
    const m = el("feMerge", {}, glow); el("feMergeNode", { in: "b" }, m); el("feMergeNode", { in: "SourceGraphic" }, m);
    const g = el("g", {}, svg);
    el("rect", { x: 0, y: 0, width: box.w, height: box.h, rx: 14, fill: "#164a20" }, g);
    const d0 = Math.floor(v.minD / 5) * 5;
    for (let d = d0; d < v.maxD; d += 5) el("rect", { x: 0, y: v.Y(d + 5), width: box.w, height: 5 * v.s, fill: (Math.round(d / 5) % 2) ? "#195325" : "#164a20" }, g);
    const goal = state.toGoal;
    if (goal < v.maxD) {  // en-but
      el("rect", { x: 0, y: 0, width: box.w, height: Math.max(0, v.Y(goal)), fill: "#2a78d6", "fill-opacity": .22 }, g);
      el("text", { x: box.w / 2, y: Math.max(18, v.Y(goal) - 14), "text-anchor": "middle", "font-size": 14, "font-weight": 700, fill: "#fff", "fill-opacity": .5, "letter-spacing": "6", "font-family": "Oswald, sans-serif" }, g).textContent = "END ZONE";
    }
    for (let d = Math.ceil(v.minD); d < v.maxD; d++) {
      if (d % 5 === 0) {
        el("line", { x1: 0, x2: box.w, y1: v.Y(d), y2: v.Y(d), stroke: "#fff", "stroke-opacity": d === goal ? .95 : .5, "stroke-width": d === goal ? 4 : 1.5 }, g);
        if (d > 0 && d % 10 === 0) for (const [x, a] of [[16, "start"], [box.w - 16, "end"]])
          el("text", { x, y: v.Y(d) + 5, "text-anchor": a, "font-size": 15, "font-weight": 700, fill: "#fff", "fill-opacity": .55, "font-family": "Oswald, sans-serif" }, g).textContent = d;
      } else for (const x of [6, box.w - 14]) el("line", { x1: x, x2: x + 8, y1: v.Y(d), y2: v.Y(d), stroke: "#fff", "stroke-opacity": .4 }, g);
    }
    el("line", { x1: 0, x2: box.w, y1: v.Y(0), y2: v.Y(0), stroke: "#4aa3ff", "stroke-width": 3.5 }, g);
    if (state.togo < goal) el("line", { x1: 0, x2: box.w, y1: v.Y(state.togo), y2: v.Y(state.togo), stroke: "#ffd400", "stroke-width": 3.5 }, g);
    return { trails: el("g", {}, svg), notes: el("g", {}, svg), tokens: el("g", {}, svg), ball: el("g", {}, svg) };
  }

  let clipSeq = 0;
  function token(parent, kind, player) {
    const g = el("g", { class: "tok" }, parent), r = 15;
    const ring = kind === "wr" ? "#4a9cff" : kind === "cb" ? "#ff5a5f" : "#ffffff";
    el("circle", { r: r + 7, fill: ring, "fill-opacity": .16 }, g);
    el("circle", { r, fill: kind === "qb" ? "#f2f4f7" : "#101722" }, g);
    if (player) {
      const id = "wcClip" + (++clipSeq), cp = el("clipPath", { id }, g); el("circle", { r: r - 1 }, cp);
      const img = el("image", { href: `assets/players/${player.nflId}.png`, x: -r, y: -r, width: 2 * r, height: 2 * r, "clip-path": `url(#${id})`, preserveAspectRatio: "xMidYMid slice" }, g);
      const num = el("text", { "text-anchor": "middle", y: 5, "font-size": 13, "font-weight": 700, fill: "#fff", "font-family": "Oswald, sans-serif", visibility: "hidden" }, g);
      num.textContent = player.jerseyNumber != null ? Math.round(player.jerseyNumber) : "";
      img.addEventListener("error", () => { img.remove(); num.setAttribute("visibility", "visible"); });
    } else el("text", { "text-anchor": "middle", y: 4.5, "font-size": 11, "font-weight": 800, fill: "#0a0c11", "font-family": "Oswald, sans-serif" }, g).textContent = "QB";
    el("circle", { r, fill: "none", stroke: ring, "stroke-width": 3 }, g);
    return g;
  }
  function ballGlyph(parent) {
    const g = el("g", {}, parent);
    const sh = el("ellipse", { rx: 7, ry: 3.5, fill: "#000", "fill-opacity": .35 }, g);
    const b = el("g", {}, g);
    el("ellipse", { rx: 8.5, ry: 5, fill: "#8a4b22", stroke: "#3b1d0b", "stroke-width": 1 }, b);
    el("line", { x1: -3.5, x2: 3.5, y1: 0, y2: 0, stroke: "#fff", "stroke-width": 1.4 }, b);
    return { g, sh, b };
  }

  // ---------------------------------------------------------------- intro : le bras et le brassard
  function armSVG(W, H) {
    // Avant-bras de coach vu à la 1re personne : manche de veste (passepoil), poignet côtelé, poing ganté, wrist coach sanglé.
    // Dessiné en mode paysage (écran = [0,A]×[0,B]) puis pivoté de 90° si l'écran est en portrait.
    const portrait = H > W, A = portrait ? H : W, B = portrait ? W : H, cy = B / 2;
    const p = 0.07 * B, R = 0.1 * B, x0 = -0.09 * A, x1 = 2.1 * A, hw0 = 0.57 * B, hw1 = 0.76 * B;
    const hwAt = x => hw0 + (hw1 - hw0) * (x - x0) / (x1 - x0);
    const xm = (x0 + x1) / 2;
    const xh1 = x0 - 0.15 * B, xh0 = xh1 - 0.8 * B;     // gant : du poignet (droite) aux phalanges (gauche)
    const strap = xc => { const h = hwAt(xc) + 0.045 * B, w = 0.3 * B;
      return `<rect x="${xc - w / 2}" y="${cy - h}" width="${w}" height="${2 * h}" rx="${0.06 * B}" fill="url(#wcStrap)" stroke="#2c323d" stroke-width="${0.005 * B}"/>
        <rect x="${xc - w / 2 + 0.03 * B}" y="${cy - h + 0.028 * B}" width="${w - 0.06 * B}" height="${2 * h - 0.056 * B}" rx="${0.045 * B}" fill="url(#wcVelcro)" stroke="#3b4250" stroke-width="${0.004 * B}" stroke-dasharray="${0.016 * B} ${0.011 * B}"/>`; };
    // Phalanges : un seul contour festonné (4 doigts repliés), rainures entre les doigts
    const kTop = cy - 0.5 * B, kStep = 0.25 * B, kx = xh0 + 0.1 * B;
    let fist = `M${xh1} ${cy - 0.56 * B} L${kx} ${kTop - 0.01 * B}`;
    for (let i = 0; i < 4; i++) {
      const ya = kTop + i * kStep, yb = ya + kStep;
      fist += ` C${xh0 - 0.07 * B} ${ya + 0.015 * B} ${xh0 - 0.07 * B} ${yb - 0.015 * B} ${kx} ${yb}`;
    }
    fist += ` L${xh1} ${cy + 0.56 * B} Z`;
    const grooves = [1, 2, 3].map(i => `<path d="M${kx - 0.015 * B} ${kTop + i * kStep} q ${0.12 * B} ${0.004 * B} ${0.22 * B} ${0.01 * B}" stroke="#07090c" stroke-width="${0.012 * B}" stroke-linecap="round" fill="none" opacity=".8"/>`).join("");
    const kHi = [0, 1, 2, 3].map(i => `<ellipse cx="${xh0 + 0.02 * B}" cy="${kTop + (i + 0.45) * kStep}" rx="${0.05 * B}" ry="${0.07 * B}" fill="#ffffff" opacity=".07"/>`).join("");
    const ribs = Array.from({ length: 9 }, (_, i) => `<line x1="${x0 - 0.16 * B + i * 0.032 * B}" x2="${x0 - 0.16 * B + i * 0.032 * B}" y1="${cy - hw0 - 0.02 * B}" y2="${cy + hw0 + 0.02 * B}" stroke="#22344f" stroke-width="${0.012 * B}"/>`).join("");
    const art = `
      <path d="M${x0} ${cy - hw0} Q${xm} ${cy - hw1 - 0.05 * B} ${x1} ${cy - hw1} L${x1} ${cy + hw1} Q${xm} ${cy + hw1 + 0.02 * B} ${x0} ${cy + hw0} Z" fill="url(#wcJacket)"/>
      <path d="M${x0} ${cy - hw0} Q${xm} ${cy - hw1 - 0.05 * B} ${x1} ${cy - hw1} L${x1} ${cy + hw1} Q${xm} ${cy + hw1 + 0.02 * B} ${x0} ${cy + hw0} Z" fill="url(#wcWeave)" opacity=".55"/>
      <ellipse cx="${xm * 0.7}" cy="${cy - hw0 * 0.45}" rx="${A * 0.9}" ry="${0.13 * B}" fill="#9fc2ff" opacity=".06" filter="url(#wcSoft)"/>
      <path d="M${x0 + 0.2 * B} ${cy - hw0 * 0.5} Q${xm} ${cy - hw1 * 0.56} ${x1} ${cy - hw1 * 0.5}" stroke="#e9eef6" stroke-width="${0.03 * B}" fill="none" opacity=".9"/>
      <path d="M${x0 + 0.2 * B} ${cy - hw0 * 0.5 + 0.035 * B} Q${xm} ${cy - hw1 * 0.56 + 0.035 * B} ${x1} ${cy - hw1 * 0.5 + 0.035 * B}" stroke="#c8102e" stroke-width="${0.018 * B}" fill="none" opacity=".95"/>
      <path d="M${x0 + 0.12 * B} ${cy + hw0 * 0.25} q ${0.18 * B} ${-0.05 * B} ${0.34 * B} ${0.02 * B} M${x0 + 0.1 * B} ${cy + hw0 * 0.55} q ${0.2 * B} ${-0.06 * B} ${0.42 * B} ${0.01 * B} M${x0 + 0.14 * B} ${cy - hw0 * 0.1} q ${0.14 * B} ${-0.03 * B} ${0.26 * B} ${0.015 * B}"
        stroke="#02050a" stroke-width="${0.014 * B}" fill="none" opacity=".45" stroke-linecap="round"/>
      ${strap(0.1 * A)}${strap(0.9 * A)}
      <g filter="url(#wcShadow)">
        <path d="M${xh0 + 0.32 * B} ${cy + 0.46 * B} C${xh0 + 0.12 * B} ${cy + 0.52 * B} ${xh0 + 0.1 * B} ${cy + 0.7 * B} ${xh0 + 0.3 * B} ${cy + 0.72 * B} L${xh1 - 0.06 * B} ${cy + 0.66 * B} L${xh1} ${cy + 0.5 * B} Z" fill="url(#wcThumb)"/>
        <path d="${fist}" fill="url(#wcGlove)"/>
        ${grooves}${kHi}
        <rect x="${xh0 + 0.36 * B}" y="${cy - 0.38 * B}" width="${xh1 - xh0 - 0.42 * B}" height="${0.76 * B}" rx="${0.16 * B}" fill="#262c36" stroke="#3a4150" stroke-width="${0.005 * B}"/>
        <path d="M${xh0 + 0.42 * B} ${cy - 0.18 * B} H${xh1 - 0.1 * B} M${xh0 + 0.42 * B} ${cy + 0.18 * B} H${xh1 - 0.1 * B}" stroke="#4a5262" stroke-width="${0.005 * B}" stroke-dasharray="${0.022 * B} ${0.016 * B}"/>
        <rect x="${xh1 - 0.3 * B}" y="${cy - 0.06 * B}" width="${0.16 * B}" height="${0.12 * B}" rx="${0.025 * B}" fill="#c8102e"/>
        <path d="M${xh0 + 0.36 * B} ${cy + 0.5 * B} q ${0.22 * B} ${0.03 * B} ${0.44 * B} ${-0.02 * B}" stroke="#ffffff" stroke-width="${0.006 * B}" opacity=".08" fill="none"/>
        <rect x="${x0 - 0.17 * B}" y="${cy - hw0 - 0.03 * B}" width="${0.3 * B}" height="${2 * hw0 + 0.06 * B}" rx="${0.09 * B}" fill="#0c1626"/>
        <g clip-path="url(#wcCuffClip)">${ribs}</g>
        <rect x="${x0 - 0.17 * B}" y="${cy - hw0 - 0.03 * B}" width="${0.3 * B}" height="${2 * hw0 + 0.06 * B}" rx="${0.09 * B}" fill="url(#wcCuffShade)"/>
      </g>
      <g filter="url(#wcShadow)">
        <rect x="${-p}" y="${-p}" width="${A + 2 * p}" height="${B + 2 * p}" rx="${R}" fill="url(#wcBody)" stroke="rgba(255,255,255,.16)" stroke-width="${0.004 * B}"/>
        <rect x="${-0.35 * p}" y="${-0.35 * p}" width="${A + 0.7 * p}" height="${B + 0.7 * p}" rx="${R * 0.62}" fill="#020305"/>
        <rect x="${0.7 * A}" y="${-p - 0.03 * B}" width="${0.09 * A}" height="${0.045 * B}" rx="${0.02 * B}" fill="#2a303a"/>
        <circle cx="${A - 0.035 * A}" cy="${-0.6 * p}" r="${0.012 * B}" fill="#3fd17a"/>
        <text x="${A / 2}" y="${B + 0.74 * p}" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="700" font-size="${0.42 * p}" letter-spacing="${0.18 * p}" fill="#6b7482">WRIST COACH</text>
      </g>`;
    const tr = portrait ? `translate(${W},0) rotate(90)` : "";
    return `<svg class="wc-arm" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <defs>
        <linearGradient id="wcJacket" gradientUnits="userSpaceOnUse" x1="0" y1="${cy - hw1}" x2="0" y2="${cy + hw1}">
          <stop offset="0" stop-color="#04070d"/><stop offset=".18" stop-color="#101d31"/><stop offset=".44" stop-color="#21375a"/>
          <stop offset=".58" stop-color="#1b2f4d"/><stop offset=".84" stop-color="#0c1726"/><stop offset="1" stop-color="#03060b"/></linearGradient>
        <pattern id="wcWeave" width="${0.024 * B}" height="${0.024 * B}" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
          <rect width="${0.012 * B}" height="${0.024 * B}" fill="#ffffff" opacity=".03"/></pattern>
        <filter id="wcSoft" x="-10%" y="-200%" width="120%" height="500%"><feGaussianBlur stdDeviation="${0.05 * B}"/></filter>
        <linearGradient id="wcStrap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0e13"/><stop offset=".5" stop-color="#1b2029"/><stop offset="1" stop-color="#0b0e13"/></linearGradient>
        <pattern id="wcVelcro" width="${0.012 * B}" height="${0.012 * B}" patternUnits="userSpaceOnUse"><rect width="${0.012 * B}" height="${0.012 * B}" fill="#171b23"/><circle cx="${0.006 * B}" cy="${0.006 * B}" r="${0.0025 * B}" fill="#262c37"/></pattern>
        <radialGradient id="wcGlove" gradientUnits="userSpaceOnUse" cx="${xh0 + 0.45 * B}" cy="${cy - 0.18 * B}" r="${0.75 * B}">
          <stop offset="0" stop-color="#363d4a"/><stop offset=".55" stop-color="#1d222b"/><stop offset="1" stop-color="#0c0f14"/></radialGradient>
        <linearGradient id="wcThumb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c323d"/><stop offset="1" stop-color="#0e1116"/></linearGradient>
        <linearGradient id="wcCuffShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".25" stop-color="#000" stop-opacity="0"/>
          <stop offset=".75" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>
        <clipPath id="wcCuffClip"><rect x="${x0 - 0.17 * B}" y="${cy - hw0 - 0.03 * B}" width="${0.3 * B}" height="${2 * hw0 + 0.06 * B}" rx="${0.09 * B}"/></clipPath>
        <linearGradient id="wcBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a404b"/><stop offset=".08" stop-color="#232831"/><stop offset="1" stop-color="#0e1116"/></linearGradient>
        <filter id="wcShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${0.02 * B}" stdDeviation="${0.025 * B}" flood-color="#000" flood-opacity=".6"/></filter>
      </defs>
      <g transform="${tr}">${art}</g></svg>`;
  }

  // ---------------------------------------------------------------- état et rendu de l'écran
  let S = null;  // session ouverte

  function screenHTML(w, c) {
    const downs = t("downs");
    return `<div class="wc-ui${S.W < S.H ? " wc-portrait" : ""}">
      <div class="wc-top"><span class="wc-brand"><i></i>${tx("brand")}</span>
        <span class="wc-sit"><b>${downs[state.down - 1]} &amp; ${state.togo}</b> · ${tx("ball")} ${ballLabel(state.toGoal)} · ${esc(w.name)} vs ${esc(c.name)}</span>
        <button class="wc-close" type="button" data-wc-close aria-label="${tx("close")}">✕</button></div>
      <div class="wc-main"><div class="wc-fieldbox"><svg role="img" aria-label="Route simulation"></svg></div>
        <div class="wc-panel" aria-live="polite"></div></div></div>`;
  }

  function panelHTML() {
    const { w, c, ev, snap, phase } = S;
    const photo = p => `<img src="assets/players/${p.nflId}.png" alt="" onerror="this.style.visibility='hidden'">`;
    let h = `<div class="wc-duel"><div class="wc-p">${photo(w)}<div><b>${esc(w.name)}</b><small>WR · ${esc(w.team)}</small></div></div><span class="wc-vs">VS</span>
      <div class="wc-p r">${photo(c)}<div><b>${esc(c.name)}</b><small>CB · ${esc(c.team)}</small></div></div></div>`;
    if (!snap) return h + `<p class="wc-note">${tx("loading")}</p>`;
    if (phase === "twenty") return h + tallyHTML();
    const go = snap.fam === "go", cutP = Math.round(ev.shareCut * 100), goP = 100 - cutP;
    h += `<div class="wc-call ${go ? "go" : ""}"><div class="wc-k">${tx("call")}</div><h3>${go ? tx("go") : tx("cut")} · ${go ? tx("goName") : tx("cutName")}</h3>
      <div class="wc-split"><div class="c ${go ? "" : "drawn"}" style="width:${cutP}%">${cutP >= 15 ? "CUT " + cutP + (fr() ? " %" : "%") : ""}</div><div class="g ${go ? "drawn" : ""}" style="width:${goP}%">${goP >= 15 ? "GO " + goP + (fr() ? " %" : "%") : ""}</div></div>
      <p>${tx("drawn", { p: pc(go ? 1 - ev.shareCut : ev.shareCut) })}</p></div>
      <p class="wc-note">${tx("src", { w: esc(w.name), wk: snap.rep.wk, op: esc(snap.rep.op), c: esc(c.name) })}</p>`;
    const routeDone = !["route", "ready", "boot"].includes(phase);
    const metricV = `${sg(snap.realized, 2)} ${go ? tx("yds") : tx("yd")}`, targetV = `${sg(snap.expected, 2)} ${go ? tx("yds") : tx("yd")}`;
    h += `<div class="wc-stats">
      <div class="wc-stat"><div class="wc-k">${go ? tx("burnK") : tx("burstK")}</div><div class="v" style="color:${go ? "#ff8a55" : "#5aa2ff"}">${routeDone ? metricV : "…"}</div><div class="s">${tx("target", { v: targetV })}</div></div>
      <div class="wc-stat"><div class="wc-k">${tx("release")}</div><div class="v">${routeDone ? nf(snap.sepRelease) + " " + tx("yd") : "…"}</div><div class="s">${routeDone ? tx("decision") : tx("routeOn")}</div></div></div>`;
    if (phase === "play" || phase === "done") {
      h += `<div class="wc-stats"><div class="wc-stat" style="grid-column:1/-1"><div class="wc-k">${tx("pcmp")}</div><div class="v">${pc(snap.pCmp)}</div><div class="s">${tx("pcmpS")}</div></div></div>`;
      h += `<div class="wc-result ${resultClass()} ${phase === "done" ? "on" : ""}">${resultText()}</div>`;
    }
    h += `<div class="wc-actions">
      ${phase === "pause" ? `<button class="wc-btn primary" type="button" data-wc-full>${tx("fullIn")}<span class="cd"></span></button>` : ""}
      <button class="wc-btn" type="button" data-wc-again ${phase === "route" || phase === "play" ? "disabled" : ""}>${tx("again")}</button>
      <button class="wc-btn" type="button" data-wc-twenty ${phase === "route" || phase === "play" ? "disabled" : ""}>${tx("twenty")}</button></div>
      <p class="wc-legal">${tx("post")}</p>`;
    return h;
  }
  function resultClass() {
    const s = S.snap;
    return s.outcome === "complete" ? (s.success || s.td ? "good" : "mid") : "bad";
  }
  function resultText() {
    const s = S.snap;
    if (s.outcome === "int") return `${tx("int")}<small>${esc(S.c.name)}</small>`;
    if (s.outcome === "incomplete") return `${s.sepCatch < 1.2 ? tx("pbu") : tx("incomplete")}<small>${s.sepCatch < 1.2 ? esc(S.c.name) : "—"}</small>`;
    if (s.td) return `${tx("td")} · ${tx("gain", { n: s.gain })}`;
    const need = needYards();
    return `${tx("complete")} · ${tx("gain", { n: s.gain })}<small>${s.success ? (state.down >= 3 ? tx("first") : tx("success")) : tx("short", { n: need - s.gain })}</small>`;
  }
  function tallyHTML() {
    const T = S.twenty, n = T.length, ev = S.ev;
    const cuts = T.filter(s => s.fam === "cut").length, cmp = T.filter(s => s.outcome === "complete").length, suc = T.filter(s => s.success).length;
    const expCut = n * ev.shareCut, expCmp = n * (ev.shareCut * ev.cut.cmp + (1 - ev.shareCut) * ev.go.cmp);
    const expSuc = n * (ev.shareCut * ev.cut.conv + (1 - ev.shareCut) * ev.go.conv);
    const row = (label, v, e, color) => `<div class="wc-trow"><span>${label}</span><span class="bar"><i style="width:${v / n * 100}%;background:${color}"></i><u style="left:${e / n * 100}%"></u></span>
      <b>${v} <small style="color:#8f9bab;font-family:Inter;font-weight:500">${tx("exp", { v: nf(e) })}</small></b></div>`;
    return `<div class="wc-k">${tx("tally")}</div><div class="wc-tally">
      ${row(tx("calls"), cuts, expCut, "#2a78d6")}${row(tx("cmps"), cmp, expCmp, "#3fd17a")}${row(state.down >= 3 ? tx("first") : tx("succ"), suc, expSuc, "#ffd27a")}</div>
      <div class="wc-actions"><button class="wc-btn primary" type="button" data-wc-again>${tx("again")}</button><button class="wc-btn" type="button" data-wc-twenty>${tx("twenty")}</button></div>
      <p class="wc-legal">${tx("post")}</p>`;
  }

  function layout() {
    const box = S.screen.querySelector(".wc-fieldbox"), svg = box.querySelector("svg");
    // Tailles de mise en page (non affectées par la transformation 3D de l'intro)
    S.box = { w: Math.max(200, box.clientWidth - 28), h: Math.max(200, box.clientHeight - 28) };
    S.svg = svg;
  }
  function renderPanel() { S.screen.querySelector(".wc-panel").innerHTML = panelHTML(); }

  function setupSnap(snap) {
    S.snap = snap;
    layout();
    S.view = viewFor([snap], S.box);
    S.layers = drawField(S.svg, S.view, S.box);
    const L = S.layers, color = snap.fam === "cut" ? "#5aa2ff" : "#ff8a55";
    S.trailW = el("polyline", { fill: "none", stroke: color, "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round", filter: "url(#wcGlow)" }, L.trails);
    S.trailC = el("polyline", { fill: "none", stroke: "#ff5a5f", "stroke-width": 2.5, "stroke-dasharray": "6 6", "stroke-opacity": .85 }, L.trails);
    S.tokQ = token(L.tokens, "qb"); S.tokC = token(L.tokens, "cb", S.c); S.tokW = token(L.tokens, "wr", S.w);
    S.ballG = ballGlyph(L.ball); S.ballG.g.setAttribute("visibility", "hidden");
    S.noted = new Set();
    S.tNow = 0; S.lastBall = null;
    draw(0);
  }

  function place(g, p) { g.setAttribute("transform", `translate(${S.view.X(p[0]).toFixed(1)},${S.view.Y(p[1]).toFixed(1)})`); }
  function trail(line, arr, t) {
    const pts = [];
    for (let i = 0; i <= Math.floor(t); i++) pts.push(arr[i]);
    pts.push(at(arr, t));
    line.setAttribute("points", pts.map(p => `${S.view.X(p[0]).toFixed(1)},${S.view.Y(p[1]).toFixed(1)}`).join(" "));
  }
  function note(key, html) {  // annotation posée une seule fois quand le temps l'atteint
    if (S.noted.has(key)) return;
    S.noted.add(key);
    S.layers.notes.insertAdjacentHTML("beforeend", html);
  }
  function draw(t) {
    const s = S.snap, v = S.view;
    const wp = at(s.wr, t), cp = at(s.cb, t);
    place(S.tokW, wp); place(S.tokC, cp); place(S.tokQ, s.q);
    trail(S.trailW, s.wr, Math.min(t, s.tEnd)); trail(S.trailC, s.cb, Math.min(t, s.tEnd));
    // Cassure : repère au début de la fenêtre, puis mesure de la séparation gagnée en fin de fenêtre
    if (s.fam === "cut" && t >= s.tb) {
      const p = s.wr[s.tb];
      note("brk", `<g transform="translate(${v.X(p[0])},${v.Y(p[1])})"><circle r="9" fill="none" stroke="#fff" stroke-width="2"><animate attributeName="r" from="6" to="22" dur="0.9s" repeatCount="2"/><animate attributeName="opacity" from="1" to="0" dur="0.9s" repeatCount="2"/></circle>
        <text x="14" y="-12" font-size="12" font-weight="700" fill="#fff" font-family="Oswald, sans-serif" letter-spacing="2">${tx("brk")}</text></g>`);
    }
    if (s.fam === "cut" && t >= s.tc + 8) {
      const a = s.wr[s.tc + 8], b = s.cb[s.tc + 8], mx = (v.X(a[0]) + v.X(b[0])) / 2, my = (v.Y(a[1]) + v.Y(b[1])) / 2;
      note("sep", `<line x1="${v.X(a[0])}" y1="${v.Y(a[1])}" x2="${v.X(b[0])}" y2="${v.Y(b[1])}" stroke="#fff" stroke-width="2" stroke-dasharray="3 4"/>
        <g transform="translate(${mx},${my})"><rect x="-34" y="-24" width="68" height="20" rx="10" fill="#0a0f16" stroke="${s.realized >= 0 ? "#3fd17a" : "#ff5a5f"}"/>
        <text y="-9.5" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="Oswald, sans-serif">${sg(s.realized)} ${tx("yd")}</text></g>`);
    }
    if (s.fam === "go" && s.l1 > 0 && t >= s.l1) {
      const p = s.wr[s.l1];
      note("burn", `<g transform="translate(${v.X(p[0]) + 18},${v.Y(p[1])})"><rect x="0" y="-12" width="96" height="22" rx="11" fill="#0a0f16" stroke="${s.realized >= 0 ? "#3fd17a" : "#ff5a5f"}"/>
        <text x="48" y="3.5" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="Oswald, sans-serif">${tx("burnL")} ${sg(s.realized)} ${tx("yds")}</text></g>`);
    }
    // Réception (ou non) : impulsion colorée selon le résultat au point d'arrivée du ballon
    if (t >= s.tCatch && s.tCatch > s.tt) {
      const p = s.outcome === "incomplete" ? s.land : s.catchPt, col = s.outcome === "complete" ? "#3fd17a" : "#ff5a5f";
      note("catch", `<g transform="translate(${v.X(p[0])},${v.Y(p[1])})"><circle r="10" fill="none" stroke="${col}" stroke-width="3">
        <animate attributeName="r" from="8" to="34" dur="0.8s" repeatCount="3"/><animate attributeName="opacity" from="1" to="0" dur="0.8s" repeatCount="3"/></circle>
        <circle r="5" fill="${col}"/></g>`);
    }
    // Ballon : dans les mains du QB, en vol (arc), puis porté ou au sol
    const bg = S.ballG;
    if (t < s.tt) { bg.g.setAttribute("visibility", "hidden"); return; }
    bg.g.setAttribute("visibility", "visible");
    let gp, h = 0;
    if (t <= s.tCatch) {
      const f = (t - s.tt) / (s.tCatch - s.tt), target = s.outcome === "int" ? lerp(s.catchPt, s.cb[s.tCatch], 0.6) : s.catchPt;
      gp = lerp(s.q, target, f); h = 4 * Math.max(1.6, dist(s.q, s.catchPt) * 0.14) * f * (1 - f);
    } else if (s.carrier) gp = at(s[s.carrier], t);
    else { const f = Math.min((t - s.tCatch) / 4, 1); gp = lerp(s.catchPt, s.land, f); h = f < 1 ? Math.abs(Math.sin(f * Math.PI)) * 0.8 : 0; }
    const X = v.X(gp[0]), Y = v.Y(gp[1]), lift = h * v.s * 0.55, sc = 1 + h * 0.06;
    bg.sh.setAttribute("transform", `translate(${X},${Y + 6})`);
    const prev = S.lastBall || [X, Y - lift], ang = Math.atan2(Y - lift - prev[1], X - prev[0]) * 180 / Math.PI;
    bg.b.setAttribute("transform", `translate(${X},${Y - lift}) rotate(${isFinite(ang) ? ang : -90}) scale(${sc})`);
    S.lastBall = [X, Y - lift];
  }

  // ---------------------------------------------------------------- lecture (requestAnimationFrame)
  const FRAME_MS = 115;  // 0,1 s de jeu ≈ 0,115 s à l'écran : légèrement ralenti pour la lecture
  let raf = 0, autoTimer = 0;
  function play(from, to, onEnd) {
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(to, from + (now - t0) / FRAME_MS);
      S.tNow = t; draw(t);
      if (t < to) raf = requestAnimationFrame(step); else onEnd && onEnd();
    };
    raf = requestAnimationFrame(step);
  }
  function startRoute() {
    log("route", S.snap.tt);
    clearTimeout(autoTimer);
    S.phase = "route"; renderPanel();
    play(0, S.snap.tt, () => {
      S.phase = "pause"; renderPanel();
      const cd = S.screen.querySelector(".wc-btn .cd");  // décompte avant l'action complète
      if (cd) cd.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: 3200, fill: "forwards" });
      autoTimer = setTimeout(startPlay, 3200);
    });
  }
  function banner() {  // bandeau de résultat sur le terrain, façon diffusion TV
    const s = S.snap, cls = resultClass(), col = cls === "good" ? "#3fd17a" : cls === "mid" ? "#ffd27a" : "#ff5a5f";
    const tmp = document.createElement("div"); tmp.innerHTML = resultText();
    const main = tmp.childNodes[0].textContent.trim(), sub = tmp.querySelector("small") ? tmp.querySelector("small").textContent.trim() : "";
    // En haut du terrain, sauf si le porteur du ballon y termine : alors en bas
    const end = s.carrier ? s[s.carrier][s.tEnd] : s.catchPt, endY = S.view.Y(end[1]);
    const w = Math.min(S.box.w - 40, 520), x = S.box.w / 2, y = endY < S.box.h * 0.32 ? S.box.h - 58 : 34;
    const g = el("g", { opacity: 0 }, S.layers.notes);
    el("rect", { x: x - w / 2, y: y - 26, width: w, height: sub && sub !== "—" ? 62 : 46, rx: 12, fill: "#05080d", "fill-opacity": .88, stroke: col, "stroke-width": 2 }, g);
    el("text", { x, y: y + 4, "text-anchor": "middle", "font-size": 24, "font-weight": 700, fill: col, "letter-spacing": "3", "font-family": "Oswald, sans-serif" }, g).textContent = main.toUpperCase();
    if (sub && sub !== "—") el("text", { x, y: y + 26, "text-anchor": "middle", "font-size": 13, fill: "#c9d2de", "font-family": "Inter, sans-serif" }, g).textContent = sub;
    g.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 380, fill: "forwards", easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  function startPlay() {
    clearTimeout(autoTimer);
    if (!S || S.phase !== "pause") return;
    S.phase = "play"; renderPanel();
    play(S.snap.tt, S.snap.tEnd, () => { S.phase = "done"; renderPanel(); banner(); });
  }
  function newSnap() {
    clearTimeout(autoTimer); cancelAnimationFrame(raf);
    S.ev = evaluate(S.w, S.c);
    setupSnap(simulate(S.w, S.c, S.ev));
    startRoute();
  }
  function twenty() {
    clearTimeout(autoTimer); cancelAnimationFrame(raf);
    S.ev = evaluate(S.w, S.c);
    const T = Array.from({ length: 20 }, () => simulate(S.w, S.c, S.ev));
    S.twenty = T; S.phase = "twenty"; renderPanel();
    layout();
    S.view = viewFor(T, S.box);
    const L = drawField(S.svg, S.view, S.box);
    T.forEach((s, i) => {  // les 20 tracés apparaissent l'un après l'autre
      const pts = s.wr.slice(0, s.tt + 1).map(p => `${S.view.X(p[0]).toFixed(1)},${S.view.Y(p[1]).toFixed(1)}`).join(" ");
      const end = s.wr[s.tt], col = s.fam === "cut" ? "#5aa2ff" : "#ff8a55", mark = s.outcome === "complete" ? "#3fd17a" : "#ff5a5f";
      const g = el("g", { opacity: 0 }, L.trails);
      el("polyline", { points: pts, fill: "none", stroke: col, "stroke-width": 2.5, "stroke-opacity": .8, "stroke-linecap": "round" }, g);
      el("circle", { cx: S.view.X(end[0]), cy: S.view.Y(end[1]), r: 4.5, fill: mark }, g);
      g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: i * 90, fill: "forwards" });
    });
  }

  // ---------------------------------------------------------------- ouverture / fermeture
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function open(w, c) {
    log("open", !!S, new Error().stack.split("\n").slice(1, 4).join(" | "));
    if (S || !w || !c) return;
    const W = innerWidth, H = innerHeight;
    S = { w, c, W, H, ev: evaluate(w, c), phase: "boot", snap: null };
    const stage = document.createElement("div");
    stage.className = "wc-stage"; stage.setAttribute("role", "dialog"); stage.setAttribute("aria-modal", "true"); stage.setAttribute("aria-label", tx("brand"));
    const ribbon = "NFL PARIS GAME · STADE DE FRANCE · SAINTS ⚜ STEELERS · ".repeat(8);
    const flashes = [[8, 22], [17, 31], [29, 19], [38, 36], [52, 26], [63, 33], [71, 21], [84, 29], [92, 38], [24, 40]]
      .map(([x, y], i) => `<i class="wc-flash" style="left:${x}%;top:${y}%;animation-delay:${(i * 0.83) % 2.6}s"></i>`).join("");
    stage.innerHTML = `<div class="wc-bg"><div class="wc-stands"></div><div class="wc-tiers"></div>${flashes}<div class="wc-board"></div><div class="wc-towers l"></div><div class="wc-towers r"></div>
      <div class="wc-ribbon"><span>${ribbon}</span></div><div class="wc-field"></div><div class="wc-vignette"></div></div>
      <div class="wc-rig" style="width:${W}px;height:${H}px">${armSVG(W, H)}<div class="wc-screen" style="width:${W}px;height:${H}px"></div><div class="wc-glass" style="width:${W}px;height:${H}px"></div></div>`;
    document.body.appendChild(stage);
    document.documentElement.style.overflow = "hidden";
    S.stage = stage; S.rig = stage.querySelector(".wc-rig"); S.screen = stage.querySelector(".wc-screen"); S.bg = stage.querySelector(".wc-bg");
    S.glass = stage.querySelector(".wc-glass");
    S.screen.innerHTML = screenHTML(w, c); renderPanel();
    const ready = loadSim().then(() => { if (!S) return; setupSnap(simulate(S.w, S.c, S.ev)); S.phase = "ready"; renderPanel(); });
    const intro = runIntro();
    Promise.all([intro, ready]).then(() => {
      if (!S) return;
      S.rig.style.transform = "none"; S.rig.style.willChange = "auto";
      S.screen.style.borderRadius = "0";
      setupSnap(S.snap); startRoute();
      stage.querySelector("[data-wc-close]").focus({ preventScroll: true });
    }).catch(() => { if (S) S.screen.querySelector(".wc-panel").innerHTML = `<p class="wc-note">sim.js ✕</p>`; });
  }

  function introKeyframes() {
    const { W, H } = S;
    const rig = [
      { transform: `translate3d(${0.34 * W}px, ${1.0 * H}px, 0) rotateZ(-24deg) rotateX(38deg) rotateY(-8deg) scale(0.24)`, offset: 0, easing: "cubic-bezier(.16,.84,.24,1)" },
      { transform: `translate3d(${0.1 * W}px, ${0.15 * H}px, 0) rotateZ(-10deg) rotateX(24deg) rotateY(-12deg) scale(0.3)`, offset: 0.38, easing: "cubic-bezier(.45,0,.55,1)" },
      { transform: `translate3d(${0.075 * W}px, ${0.11 * H}px, 0) rotateZ(-7.5deg) rotateX(19deg) rotateY(-9deg) scale(0.325)`, offset: 0.52, easing: "cubic-bezier(.72,0,.2,1)" },
      { transform: "translate3d(0px, 0px, 0) rotateZ(0deg) rotateX(0deg) rotateY(0deg) scale(1)", offset: 1 }];
    const r0 = 0.055 * Math.min(W, H);
    const screen = [{ borderRadius: `${r0}px`, filter: "brightness(.55)" }, { borderRadius: `${r0}px`, filter: "brightness(1)", offset: 0.5 },
      { borderRadius: `${r0}px`, offset: 0.88 }, { borderRadius: "0px", filter: "brightness(1)" }];
    const glass = [{ opacity: 1, borderRadius: `${r0}px` }, { opacity: .9, offset: 0.55, borderRadius: `${r0}px` }, { opacity: 0, borderRadius: "0px" }];
    const bg = [{ filter: "blur(0px) brightness(.95)", transform: "scale(1) translate(0,0)" },
      { transform: "scale(1.005) translate(-3px,2px)", offset: 0.16 }, { transform: "scale(1.01) translate(2px,-1px)", offset: 0.3 },
      { filter: "blur(1px) brightness(.9)", transform: "scale(1.012) translate(0,0)", offset: 0.5 },
      { filter: "blur(16px) brightness(.5)", transform: "scale(1.09) translate(0,0)" }];
    const fade = [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1 }];
    return { rig, screen, glass, bg, fade };
  }
  const INTRO_MS = 2350;
  function runIntro() {
    const K = introKeyframes(), opt = { duration: INTRO_MS, fill: "both" };
    S.anims = [S.rig.animate(K.rig, opt), S.screen.animate(K.screen, opt), S.glass.animate(K.glass, opt), S.bg.animate(K.bg, opt), S.stage.animate(K.fade, opt)];
    const dbg = new URLSearchParams(location.search).get("wcT");  // ?wcT=900 : image figée de l'intro (vérification visuelle)
    if (dbg !== null) { S.anims.forEach(a => { a.pause(); a.currentTime = +dbg; }); return new Promise(() => {}); }
    if (reduced()) { S.anims.forEach(a => a.finish()); return Promise.resolve(); }
    return S.anims[0].finished;
  }
  function close() {
    log("close", new Error().stack.split("\n").slice(1, 4).join(" | "));
    if (!S) return;
    clearTimeout(autoTimer); cancelAnimationFrame(raf);
    const s = S, done = () => { s.stage.remove(); document.documentElement.style.overflow = ""; if (S === s) S = null; };
    if (reduced()) return done();
    const K = introKeyframes(), opt = { duration: 950, fill: "both", direction: "reverse", easing: "cubic-bezier(.5,0,.75,0)" };
    s.rig.style.transform = ""; s.closing = true;
    const a = s.rig.animate(K.rig, opt);
    s.screen.animate(K.screen, opt); s.glass.animate(K.glass, opt); s.bg.animate(K.bg, opt); s.stage.animate(K.fade, opt);
    a.finished.then(done);
  }

  // ---------------------------------------------------------------- événements
  document.addEventListener("click", e => {
    if (e.target.closest("[data-wc]")) return open(byId(WR, state.wr), byId(CB, state.cb));
    if (!S) return;
    if (e.target.closest("[data-wc-close]")) return close();
    if (e.target.closest("[data-wc-full]")) return startPlay();
    if (e.target.closest("[data-wc-again]")) return newSnap();
    if (e.target.closest("[data-wc-twenty]")) return twenty();
  });
  document.addEventListener("keydown", e => { if (S && e.key === "Escape") close(); });
  addEventListener("resize", () => {
    if (!S || S.phase === "boot" || S.closing) return;
    S.W = innerWidth; S.H = innerHeight;
    for (const n of [S.rig, S.screen, S.glass]) { n.style.width = S.W + "px"; n.style.height = S.H + "px"; }
    S.screen.querySelector(".wc-ui").classList.toggle("wc-portrait", S.W < S.H);
    if (S.phase === "twenty") return twenty();
    const tNow = S.tNow; setupSnap(S.snap); draw(tNow);
  });
  // Ouverture automatique pour vérification (?wcOpen=1 ou ?wcT=…) ; ?wcTest=N : contrôle de fidélité sur N snaps par duel
  addEventListener("load", () => {
    const q = new URLSearchParams(location.search);
    if (q.has("wcOpen") || q.has("wcT")) setTimeout(() => open(byId(WR, state.wr), byId(CB, state.cb)), 50);
    if (q.has("wcTest")) loadSim().then(() => {
      const N = +q.get("wcTest") || 2000, out = [];
      const pairs = [[state.wr, state.cb], [WR[5].nflId, CB[40].nflId], [WR[60].nflId, CB[10].nflId]];
      for (const [wi, ci] of pairs) {
        const w = byId(WR, wi), c = byId(CB, ci), ev = evaluate(w, c);
        const sims = Array.from({ length: N }, () => simulate(w, c, ev));
        const cut = sims.filter(s => s.fam === "cut"), go = sims.filter(s => s.fam === "go");
        const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
        const sd = a => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)));
        out.push({ duel: w.name + " vs " + c.name, shareCut: [ev.shareCut, cut.length / N],
          burst: [ev.mC, mean(cut.map(s => s.realized)), FIT.burst.route_sd, sd(cut.map(s => s.realized))],
          burn: [ev.mG, mean(go.map(s => s.realized)), FIT.burn.route_sd, sd(go.map(s => s.realized))],
          cmp: [ev.shareCut * ev.cut.cmp + (1 - ev.shareCut) * ev.go.cmp, mean(sims.map(s => +(s.outcome === "complete")))],
          success: [ev.shareCut * ev.cut.conv + (1 - ev.shareCut) * ev.go.conv, mean(sims.map(s => +s.success))],
          int: [ev.shareCut * SIT.cut.int_rate + (1 - ev.shareCut) * SIT.vertical.int_rate, mean(sims.map(s => +(s.outcome === "int")))],
          minSep: Math.min(...sims.map(s => Math.min(...s.wr.slice(0, s.tt + 1).map((p, i) => dist(p, s.cb[i]))))) });
      }
      const pre = document.createElement("pre"); pre.id = "wcTest"; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
    });
  });

  return { open, close, button: () => `<button class="wc-launch" type="button" data-wc>${ICON}${tx("btn")}</button>` };
})();
