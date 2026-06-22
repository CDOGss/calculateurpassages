// Moteur GPX — 100% navigateur.
// Porté depuis le backend Python (dev roadbook / gpx_utils.py) :
//  - distance haversine
//  - lissage médian de l'altitude (anti-bruit altimétrique)
//  - cumul D+/D- avec hystérésis (dead-band) façon Garmin/Strava
// Le parsing utilise DOMParser (natif), donc aucune dépendance ni serveur.

const EARTH_RADIUS_M = 6371000.0

/** Distance grand-cercle entre deux points (mètres). */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dPhi = toRad(lat2 - lat1)
  const dLambda = toRad(lon2 - lon1)
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}

/**
 * Lissage médian de l'altitude : fenêtre glissante w=12, seuil 3 m.
 * Si |brut - médiane| < seuil on garde la médiane, sinon le point brut.
 */
export function medianSmoothing(elevations, w = 12, threshold = 3.0) {
  const n = elevations.length
  if (n === 0) return []
  const halfW = Math.floor(w / 2)
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - halfW)
    const end = Math.min(n, i + halfW)
    const window = elevations.slice(start, end).sort((a, b) => a - b)
    const mid = Math.floor(window.length / 2)
    const med =
      window.length % 2 === 0
        ? (window[mid - 1] + window[mid]) / 2
        : window[mid]
    out[i] = Math.abs(elevations[i] - med) < threshold ? med : elevations[i]
  }
  return out
}

/**
 * Parse une chaîne GPX et renvoie { points, metadata }.
 * Chaque point porte : lat, lon, ele, dist_cumul (m), smooth_ele,
 * d_plus_cumul, d_minus_cumul, gradient (pente locale en fraction).
 *
 * D+/D- accumulés avec une bande morte de `elevationThreshold` mètres :
 * une montée/descente n'est comptée qu'au-delà du seuil depuis le dernier
 * point d'ancrage (standard anti-bruit GPS).
 */
export function parseGpxTrack(gpxContent, {
  applySmoothing = true,
  elevationThreshold = 8.0,
} = {}) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(gpxContent, 'application/xml')

  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('Fichier GPX invalide ou illisible.')
  }

  // On accepte <trkpt> (tracks) et, à défaut, <rtept> (routes).
  let nodes = Array.from(doc.getElementsByTagName('trkpt'))
  if (nodes.length === 0) nodes = Array.from(doc.getElementsByTagName('rtept'))

  const points = []
  for (const node of nodes) {
    const lat = parseFloat(node.getAttribute('lat'))
    const lon = parseFloat(node.getAttribute('lon'))
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue
    const eleNode = node.getElementsByTagName('ele')[0]
    const ele = eleNode ? parseFloat(eleNode.textContent) : 0.0
    points.push({ lat, lon, ele: Number.isNaN(ele) ? 0.0 : ele })
  }

  if (points.length < 2) {
    return { points: [], metadata: { name: 'GPX vide ou invalide' } }
  }

  // Nom de la trace
  let name = 'Parcours'
  const nameNode = doc.querySelector('trk > name') || doc.querySelector('metadata > name')
  if (nameNode && nameNode.textContent.trim()) name = nameNode.textContent.trim()

  const rawEle = points.map((p) => p.ele)
  const smoothEle = applySmoothing ? medianSmoothing(rawEle, 12, 3.0) : rawEle

  let distCumul = 0
  let dPlus = 0
  let dMinus = 0
  let refEle = smoothEle[0]

  points[0].dist_cumul = 0
  points[0].smooth_ele = smoothEle[0]
  points[0].d_plus_cumul = 0
  points[0].d_minus_cumul = 0
  points[0].gradient = 0

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]

    const stepDist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon)
    distCumul += stepDist

    const currEle = smoothEle[i]
    const delta = currEle - refEle
    if (delta > elevationThreshold) {
      dPlus += delta
      refEle = currEle
    } else if (delta < -elevationThreshold) {
      dMinus += -delta
      refEle = currEle
    }

    const stepEle = currEle - prev.smooth_ele
    curr.dist_cumul = distCumul
    curr.smooth_ele = currEle
    curr.d_plus_cumul = dPlus
    curr.d_minus_cumul = dMinus
    curr.gradient = stepDist > 0.5 ? stepEle / stepDist : 0
  }

  return {
    points,
    metadata: {
      name,
      total_distance_m: distCumul,
      total_distance_km: distCumul / 1000,
      total_d_plus: dPlus,
      total_d_minus: dMinus,
      n_points: points.length,
    },
  }
}

/**
 * Aligne une liste de checkpoints (définis par km_cumul) sur le point de
 * trace le plus proche, et calcule les métriques inter-checkpoints.
 * Repris de la logique getAlignedCheckpoints de l'éditeur dev roadbook.
 */
export function alignCheckpoints(checkpoints, points) {
  const sorted = [...checkpoints].sort((a, b) => a.km_cumul - b.km_cumul)
  const aligned = sorted.map((cp, index) => {
    let nearest = null
    let minDiff = Infinity
    const targetDist = cp.km_cumul * 1000
    for (const pt of points) {
      const diff = Math.abs(pt.dist_cumul - targetDist)
      if (diff < minDiff) {
        minDiff = diff
        nearest = pt
      }
    }
    if (!nearest) {
      return { ...cp, lat: 0, lon: 0, altitude: 0, d_plus_cumul: 0, d_minus_cumul: 0, is_matched: false, order: index }
    }
    return {
      ...cp,
      lat: nearest.lat,
      lon: nearest.lon,
      km_cumul: Number((nearest.dist_cumul / 1000).toFixed(3)),
      altitude: Math.round(nearest.smooth_ele),
      d_plus_cumul: Math.round(nearest.d_plus_cumul),
      d_minus_cumul: Math.round(nearest.d_minus_cumul),
      eta_sec: nearest.eta_sec,
      is_matched: minDiff <= 250,
      offset_distance_m: Math.round(minDiff),
      _pointIdx: points.indexOf(nearest),
      order: index,
    }
  })

  return aligned.map((cp, idx) => {
    if (idx === 0) {
      return {
        ...cp,
        dist_inter_km: cp.km_cumul,
        d_plus_inter: cp.d_plus_cumul,
        d_minus_inter: cp.d_minus_cumul,
        time_inter_sec: cp.eta_sec,
      }
    }
    const prev = aligned[idx - 1]
    return {
      ...cp,
      dist_inter_km: Number((cp.km_cumul - prev.km_cumul).toFixed(3)),
      d_plus_inter: Math.max(0, cp.d_plus_cumul - prev.d_plus_cumul),
      d_minus_inter: Math.max(0, cp.d_minus_cumul - prev.d_minus_cumul),
      time_inter_sec:
        cp.eta_sec != null && prev.eta_sec != null ? cp.eta_sec - prev.eta_sec : null,
    }
  })
}
