// ============================================================================
//  MOTEUR D'ALLURE — le cœur du calculateur
// ============================================================================
//
//  Objectif : répartir un temps objectif sur tout le parcours, segment par
//  segment (~100 m), de façon physiologiquement réaliste.
//
//  4 piliers :
//
//  1) MONTÉE — coût énergétique de Minetti et al. (2002), validé en labo.
//     C(i) = 155.4 i^5 − 30.4 i^4 − 43.3 i^3 + 46.3 i^2 + 19.5 i + 3.6  (J/kg/m)
//     En côte on EST limité par l'énergie : Minetti est excellent
//     (+20% ≈ 2,5× le plat, +40% ≈ 4,7× → on marche).
//
//  2) DESCENTE — modèle TERRAIN empirique (≠ Minetti).
//     ⚠ En descente, Minetti (métabolique) sous-estime énormément le temps :
//     une descente raide est "gratuite" en énergie, mais on n'est PAS limité
//     par l'énergie — on est limité par la BIOMÉCANIQUE (freinage excentrique,
//     pose de pied, équilibre, technicité). Une descente technique à −50% peut
//     se parcourir 3 à 5× plus lentement que le plat (≈ marche prudente), ce
//     que Minetti chiffrerait à tort à ~1,1×.
//     On utilise donc un multiplicateur d'allure m(s) (s = raideur de descente) :
//       • optimum (le plus rapide) vers −8/−10% ;
//       • retour au niveau du plat vers −20/−25% ;
//       • puis montée rapide : à −50%, 3 à 5× le plat selon la technicité.
//     La TECHNICITÉ (0 = roulant/route … 1 = pierrier alpin) contrôle la sévérité.
//
//  3) FATIGUE ACCUMULÉE AU FIL DES HEURES — l'allure se dégrade avec le temps
//     passé en course (positive split). multiplicateur = 1 + k · heures.
//     k dépend du profil d'endurance du coureur (réglable).
//
//  4) CALAGE SUR L'OBJECTIF — comme la fatigue dépend du temps écoulé, qui
//     dépend lui-même de l'allure, on résout par itération de point fixe :
//     on ajuste l'allure de base jusqu'à ce que le total = temps objectif.
// ============================================================================

const C_FLAT = 3.6 // coût énergétique sur le plat (J/kg/m)

/** Coût énergétique de Minetti (J/kg/m) en fonction de la pente i (fraction). */
export function minettiCost(i) {
  // Le polynôme n'est validé qu'environ sur [−0.45, +0.45]. Au-delà on borne
  // la pente pour éviter une divergence du polynôme de degré 5.
  const g = Math.max(-0.45, Math.min(0.45, i))
  return (
    155.4 * g ** 5 -
    30.4 * g ** 4 -
    43.3 * g ** 3 +
    46.3 * g ** 2 +
    19.5 * g +
    3.6
  )
}

/**
 * Multiplicateur d'allure d'une pente, relatif au plat (1 = vitesse de plat,
 * 2 = deux fois plus lent...). C'est le "facteur d'équivalence plat".
 *
 * @param {number} i           pente en fraction (dénivelé / distance horiz.)
 * @param {number} technicity  0..1 (0 = roulant/route, 1 = très technique)
 *
 * - Montée (i ≥ 0) : Minetti + légère pénalité de technicité sur le très raide.
 * - Descente (i < 0) : modèle terrain m(s) = 1 − 1.6 s + (6 + 13·τ)·s²
 *   (s = −i borné à 0.7), plancher à 0.7. À −50% : ≈2.7× (roulant léger),
 *   ≈3.7× (technique), correspondant aux temps réels observés en montagne.
 */
export function gradeFactor(i, technicity = 0.3) {
  if (i >= 0) {
    const f = minettiCost(i) / C_FLAT
    const steep = Math.max(0, i - 0.15)
    return f * (1 + 0.6 * technicity * steep)
  }
  const s = Math.min(0.7, -i)
  const m = 1 - 1.6 * s + (6 + 13 * technicity) * s * s
  return Math.max(0.7, m)
}

/**
 * Découpe la trace en segments d'environ `segLength` mètres (défaut 100 m).
 * Chaque segment agrège plusieurs points GPX bruts → pente robuste au bruit.
 */
export function buildSegments(points, segLength = 100) {
  const segs = []
  if (points.length < 2) return segs
  let segStartIdx = 0
  let segDist = 0
  for (let i = 1; i < points.length; i++) {
    segDist += points[i].dist_cumul - points[i - 1].dist_cumul
    const isLast = i === points.length - 1
    if (segDist >= segLength || isLast) {
      const a = points[segStartIdx]
      const b = points[i]
      const dist = b.dist_cumul - a.dist_cumul
      if (dist > 0) {
        const dEle = b.smooth_ele - a.smooth_ele
        segs.push({
          startIdx: segStartIdx,
          endIdx: i,
          startKm: a.dist_cumul / 1000,
          endKm: b.dist_cumul / 1000,
          dist, // mètres
          dEle, // mètres (signé)
          gradient: dEle / dist,
        })
      }
      segStartIdx = i
      segDist = 0
    }
  }
  return segs
}

// Profils de coureur → coefficient de fatigue par heure (dégradation d'allure).
// Valeurs calibrées sur l'observation des positive splits en trail/ultra.
export const RUNNER_PROFILES = {
  elite: { label: 'Élite / très entraîné', fatiguePerHour: 0.018 },
  experimente: { label: 'Expérimenté', fatiguePerHour: 0.032 },
  intermediaire: { label: 'Intermédiaire', fatiguePerHour: 0.048 },
  decouverte: { label: 'Découverte / 1er ultra', fatiguePerHour: 0.065 },
}

// Types de terrain → technicité (sévérité des descentes/pentes fortes).
// En mode objectif (chrono saisi), la technicité redistribue le temps : un
// terrain technique fait perdre davantage en descente raide qu'en faux-plat.
export const TERRAIN_TYPES = {
  route: { label: 'Route / piste roulante', technicity: 0.05 },
  roulant: { label: 'Trail roulant (chemins, forêt)', technicity: 0.2 },
  montagne: { label: 'Trail montagne (type UTMB)', technicity: 0.42 },
  technique: { label: 'Très technique / volcanique (type Diagonale)', technicity: 0.62 },
  alpin: { label: 'Haute montagne / hors-sentier', technicity: 0.82 },
}

/**
 * Calcule les temps de passage.
 *
 * @param {Array} points  points GPX (avec dist_cumul, smooth_ele, gradient)
 * @param {Object} opts
 *   - targetTimeSec : temps objectif total (s)            [requis]
 *   - segLength     : longueur de segment d'analyse (m)   [défaut 100]
 *   - fatiguePerHour: coeff de fatigue / heure            [défaut 0.032]
 *   - technicity    : 0..1, technicité globale (fallback des sections non détectées)
 *   - sectionTechnicity : tableau de technicités par tronçon (ou null/undefined)
 *   - sectionKm     : longueur d'un tronçon de sectionTechnicity (km), défaut 2
 *
 * @returns { points, segments, totalTimeSec, basePaceSec, totalEquivKm,
 *            flatPaceSecPerKm, fatigueAtFinish }
 *   `points` est muté : chaque point reçoit eta_sec (temps de passage cumulé).
 */
export function computePacing(points, {
  targetTimeSec,
  segLength = 100,
  fatiguePerHour = 0.032,
  technicity = 0,
  sectionTechnicity = null,
  sectionKm = 2,
} = {}) {
  const segments = buildSegments(points, segLength)
  if (segments.length === 0 || !targetTimeSec) {
    points.forEach((p) => (p.eta_sec = 0))
    return { points, segments: [], totalTimeSec: 0, basePaceSec: 0, totalEquivKm: 0, flatPaceSecPerKm: 0, fatigueAtFinish: 1 }
  }

  // Technicité applicable à un segment : celle de son tronçon si détectée,
  // sinon la technicité globale.
  const techFor = (s) => {
    if (sectionTechnicity) {
      const midKm = (s.startKm + s.endKm) / 2
      const idx = Math.floor(midKm / sectionKm)
      const t = sectionTechnicity[idx]
      if (t != null) return t
    }
    return technicity
  }

  // Distance plate équivalente de chaque segment : Minetti en montée, modèle
  // terrain en descente (cf. gradeFactor). La technicité (globale ou par section)
  // contrôle la sévérité des descentes raides.
  const effort = segments.map((s) => s.dist * gradeFactor(s.gradient, techFor(s)))
  const totalEquiv = effort.reduce((a, b) => a + b, 0)

  // --- Résolution par point fixe de l'allure de base (s / mètre équivalent) ---
  // time_i = basePace · effort_i · (1 + fatiguePerHour · heures_écoulées_avant_i)
  let basePace = targetTimeSec / totalEquiv // 1re estimation sans fatigue
  for (let iter = 0; iter < 60; iter++) {
    let elapsed = 0
    for (let i = 0; i < segments.length; i++) {
      const fatigue = 1 + fatiguePerHour * (elapsed / 3600)
      elapsed += basePace * effort[i] * fatigue
    }
    const ratio = targetTimeSec / elapsed
    basePace *= ratio
    if (Math.abs(ratio - 1) < 1e-9) break
  }

  // --- Passe finale : temps de chaque segment + fatigue de fin ---
  let elapsed = 0
  let fatigueAtFinish = 1
  for (let i = 0; i < segments.length; i++) {
    const fatigue = 1 + fatiguePerHour * (elapsed / 3600)
    const t = basePace * effort[i] * fatigue
    segments[i].time_sec = t
    segments[i].start_time_sec = elapsed
    segments[i].pace_sec_per_km = (t / segments[i].dist) * 1000
    segments[i].speed_kmh = segments[i].dist / 1000 / (t / 3600)
    elapsed += t
    segments[i].end_time_sec = elapsed
    fatigueAtFinish = fatigue
  }

  // --- Diffusion du temps des segments vers chaque point GPX (eta_sec) ---
  // Pour l'interactivité (survol du profil) et le calage des checkpoints.
  points[0].eta_sec = 0
  for (const seg of segments) {
    const tStart = seg.start_time_sec
    const distSeg = seg.dist
    const base = points[seg.startIdx].dist_cumul
    for (let i = seg.startIdx + 1; i <= seg.endIdx; i++) {
      const frac = distSeg > 0 ? (points[i].dist_cumul - base) / distSeg : 1
      points[i].eta_sec = tStart + frac * seg.time_sec
    }
  }
  // Sécurité : points éventuels après le dernier segment
  for (let i = 1; i < points.length; i++) {
    if (points[i].eta_sec == null) points[i].eta_sec = points[i - 1].eta_sec
  }

  // Allure plate de référence = vitesse sur un segment plat à fatigue nulle
  const flatPaceSecPerKm = basePace * 1000 // car gradeFactor(0)=1

  return {
    points,
    segments,
    totalTimeSec: elapsed,
    basePaceSec: basePace,
    totalEquivKm: totalEquiv / 1000,
    flatPaceSecPerKm,
    fatigueAtFinish,
  }
}
