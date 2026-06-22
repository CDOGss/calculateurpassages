// ============================================================================
//  DÉTECTION AUTOMATIQUE DU TERRAIN via OpenStreetMap (API Overpass)
// ============================================================================
//
//  Le GPX ne contient pas le type de sol. On va le chercher dans OSM : chaque
//  chemin porte des tags (highway / surface / sac_scale / trail_visibility).
//  On découpe le parcours en tronçons (2 km par défaut), on interroge Overpass
//  par paquets de tronçons (bbox), on "accroche" (snap) chaque point de trace
//  au chemin OSM le plus proche, puis on retient le type PRÉDOMINANT du tronçon.
//
//  ⚠ Couverture OSM inégale (sac_scale souvent absent en montagne isolée) :
//  les tronçons sans donnée restent "inconnu" et utilisent le terrain global.
// ============================================================================

import { TERRAIN_TYPES } from './pacing.js'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

// highway exploitables pour la course (du plus roulant au sentier)
const HIGHWAY_FILTER =
  'path|track|footway|steps|bridleway|cycleway|pedestrian|service|unclassified|residential|tertiary|secondary|primary|road|living_street'

// Conversion des tags OSM → technicité (0 roulant … 1 alpin).
const SAC = {
  hiking: 0.30, mountain_hiking: 0.50, demanding_mountain_hiking: 0.72,
  alpine_hiking: 0.85, demanding_alpine_hiking: 0.92, difficult_alpine_hiking: 0.97,
}
const SURFACE = {
  asphalt: 0.05, paved: 0.05, concrete: 0.05, paving_stones: 0.10, sett: 0.20,
  cobblestone: 0.30, compacted: 0.15, fine_gravel: 0.15, gravel: 0.25,
  pebblestone: 0.30, ground: 0.32, dirt: 0.32, earth: 0.32, mud: 0.45,
  grass: 0.35, wood: 0.20, sand: 0.50, rock: 0.60, stone: 0.60,
  bare_rock: 0.65, scree: 0.72,
}
const HIGHWAY_BASE = {
  track: 0.20, path: 0.35, footway: 0.12, cycleway: 0.10, pedestrian: 0.10,
  bridleway: 0.30, service: 0.08, unclassified: 0.08, residential: 0.06,
  tertiary: 0.05, secondary: 0.05, primary: 0.05, road: 0.10, living_street: 0.06,
}

/** Technicité d'un chemin OSM d'après ses tags (signal le plus contraignant). */
export function tagsToTechnicity(tags) {
  const signals = []
  if (tags.sac_scale && SAC[tags.sac_scale] != null) signals.push(SAC[tags.sac_scale])
  if (tags.highway === 'steps') signals.push(0.65)
  if (tags.surface && SURFACE[tags.surface] != null) signals.push(SURFACE[tags.surface])
  if (signals.length) return Math.max(...signals)
  return HIGHWAY_BASE[tags.highway] != null ? HIGHWAY_BASE[tags.highway] : 0.30
}

/** Catégorie de terrain (clé de TERRAIN_TYPES) à partir d'une technicité. */
export function technicityToTerrainKey(t) {
  if (t < 0.12) return 'route'
  if (t < 0.28) return 'roulant'
  if (t < 0.52) return 'montagne'
  if (t < 0.75) return 'technique'
  return 'alpin'
}

// --- géométrie : distance d'un point à un segment, en mètres (équirect.) ---
function distPointToSeg(lat, lon, aLat, aLon, bLat, bLon) {
  const R = 6371000
  const latRef = (aLat * Math.PI) / 180
  const cos = Math.cos(latRef)
  const toX = (lo) => (lo * Math.PI) / 180 * R * cos
  const toY = (la) => (la * Math.PI) / 180 * R
  const px = toX(lon), py = toY(lat)
  const ax = toX(aLon), ay = toY(aLat)
  const bx = toX(bLon), by = toY(bLat)
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

async function overpassQuery(bbox, signal) {
  const [s, w, n, e] = bbox
  const q = `[out:json][timeout:60];way["highway"~"${HIGHWAY_FILTER}"](${s},${w},${n},${e});out tags geom;`
  let lastErr
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal,
      })
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue }
      const j = await r.json()
      return j.elements || []
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('Overpass injoignable')
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

/**
 * Détecte le terrain par tronçon.
 *
 * @param {Array} points  points GPX (lat, lon, dist_cumul)
 * @param {Object} opts
 *   - sectionKm   : longueur d'un tronçon (km), défaut 2
 *   - snapMeters  : distance max d'accrochage à un chemin OSM (m), défaut 25
 *   - onProgress  : (done, total) => void
 *   - signal      : AbortSignal pour annuler
 *
 * @returns {{ sections: Array, sectionKm:number }}
 *   chaque section : { index, startKm, endKm, terrainKey|null, technicity|null,
 *                      coverage (0..1), counts:{key:votes} }
 */
export async function detectTerrain(points, {
  sectionKm = 2, snapMeters = 25, onProgress, signal,
} = {}) {
  if (!points || points.length < 2) return { sections: [], sectionKm }

  const totalKm = points[points.length - 1].dist_cumul / 1000
  const nSections = Math.max(1, Math.ceil(totalKm / sectionKm))

  // Sous-échantillonnage pour le snapping : 1 point tous les ~50 m (bornage coût)
  const sampleBySection = Array.from({ length: nSections }, () => [])
  let lastSampledDist = -Infinity
  for (const pt of points) {
    if (pt.dist_cumul - lastSampledDist < 50) continue
    lastSampledDist = pt.dist_cumul
    const idx = Math.min(nSections - 1, Math.floor(pt.dist_cumul / 1000 / sectionKm))
    sampleBySection[idx].push(pt)
  }

  const sections = Array.from({ length: nSections }, (_, i) => ({
    index: i,
    startKm: Number((i * sectionKm).toFixed(2)),
    endKm: Number(Math.min(totalKm, (i + 1) * sectionKm).toFixed(2)),
    terrainKey: null,
    technicity: null,
    coverage: 0,
    counts: {},
  }))

  // Regroupe les tronçons en chunks dont la bbox reste raisonnable (≤ ~0.06°
  // ou 6 tronçons) → bien moins de requêtes Overpass.
  const chunks = []
  let cur = []
  let cb = null // [s,w,n,e]
  const span = (b) => Math.max(b[2] - b[0], b[3] - b[1])
  for (let i = 0; i < nSections; i++) {
    const pts = sampleBySection[i]
    if (!pts.length) { // tronçon sans point échantillonné : on le rattache quand même
      if (cur.length) cur.push(i)
      else chunks.push([i])
      continue
    }
    let b = [Infinity, Infinity, -Infinity, -Infinity]
    for (const p of pts) {
      b[0] = Math.min(b[0], p.lat); b[1] = Math.min(b[1], p.lon)
      b[2] = Math.max(b[2], p.lat); b[3] = Math.max(b[3], p.lon)
    }
    if (!cur.length) { cur = [i]; cb = b; continue }
    const merged = [Math.min(cb[0], b[0]), Math.min(cb[1], b[1]), Math.max(cb[2], b[2]), Math.max(cb[3], b[3])]
    if (cur.length >= 6 || span(merged) > 0.06) {
      chunks.push(cur); cur = [i]; cb = b
    } else {
      cur.push(i); cb = merged
    }
  }
  if (cur.length) chunks.push(cur)

  let done = 0
  for (const chunk of chunks) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

    // bbox du chunk (padding ~55 m)
    let b = [Infinity, Infinity, -Infinity, -Infinity]
    for (const i of chunk) for (const p of sampleBySection[i]) {
      b[0] = Math.min(b[0], p.lat); b[1] = Math.min(b[1], p.lon)
      b[2] = Math.max(b[2], p.lat); b[3] = Math.max(b[3], p.lon)
    }
    if (!Number.isFinite(b[0])) { done += chunk.length; onProgress?.(done, nSections); continue }
    const pad = 0.0006
    const bbox = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]

    let ways = []
    try {
      ways = await overpassQuery(bbox, signal)
    } catch (err) {
      if (err.name === 'AbortError') throw err
      // chunk en échec → tronçons "inconnu", on continue
      done += chunk.length; onProgress?.(done, nSections); continue
    }

    // Pré-calcul des segments + technicité de chaque way
    const segs = []
    for (const wy of ways) {
      const g = wy.geometry
      if (!g || g.length < 2) continue
      const tech = tagsToTechnicity(wy.tags || {})
      for (let k = 1; k < g.length; k++) {
        segs.push([g[k - 1].lat, g[k - 1].lon, g[k].lat, g[k].lon, tech])
      }
    }

    for (const i of chunk) {
      const pts = sampleBySection[i]
      const counts = {}
      let matched = 0
      for (const p of pts) {
        let best = Infinity, bestTech = null
        for (const sg of segs) {
          const d = distPointToSeg(p.lat, p.lon, sg[0], sg[1], sg[2], sg[3])
          if (d < best) { best = d; bestTech = sg[4] }
        }
        if (best <= snapMeters && bestTech != null) {
          matched++
          const key = technicityToTerrainKey(bestTech)
          counts[key] = (counts[key] || 0) + 1
        }
      }
      const sec = sections[i]
      sec.counts = counts
      sec.coverage = pts.length ? matched / pts.length : 0
      // type prédominant (au moins 20% des points accrochés)
      if (matched > 0 && sec.coverage >= 0.2) {
        const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
        sec.terrainKey = best[0]
        sec.technicity = TERRAIN_TYPES[best[0]].technicity
      }
      done++
      onProgress?.(done, nSections)
    }

    await sleep(400) // politesse envers Overpass
  }

  return { sections, sectionKm }
}
