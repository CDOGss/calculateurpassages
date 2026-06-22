// Helpers de formatage (durées, allures, horloge).

/** "HH:MM:SS" → secondes. Accepte aussi "HH:MM", "12h30", "9.5" (heures). */
export function parseTimeToSec(str) {
  if (str == null) return 0
  const s = String(str).trim().toLowerCase().replace('h', ':')
  if (s === '') return 0
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => parseFloat(p) || 0)
    const [h = 0, m = 0, sec = 0] = parts
    return Math.round(h * 3600 + m * 60 + sec)
  }
  // nombre seul = heures décimales
  return Math.round((parseFloat(s) || 0) * 3600)
}

/** Secondes → "HH:MM:SS" (ou "H:MM:SS"). */
export function formatDuration(totalSec) {
  if (totalSec == null || Number.isNaN(totalSec)) return '—'
  const sec = Math.max(0, Math.round(totalSec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n) => String(n).padStart(2, '0')
  return `${h}:${pad(m)}:${pad(s)}`
}

/** Secondes → "Hh MM" compact pour l'affichage léger. */
export function formatDurationShort(totalSec) {
  if (totalSec == null || Number.isNaN(totalSec)) return '—'
  const sec = Math.max(0, Math.round(totalSec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h === 0) return `${m} min`
  return `${h}h${String(m).padStart(2, '0')}`
}

/** Allure (s/km) → "M:SS /km". */
export function formatPace(secPerKm) {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return '—'
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  if (s === 60) return `${m + 1}:00`
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Heure d'horloge de passage : heure de départ ("08:30") + offset (s).
 * Renvoie "HH:MM" et marque "+Nj" si on franchit minuit.
 */
export function formatClock(startTimeStr, offsetSec) {
  if (!startTimeStr || offsetSec == null) return null
  const [h, m] = startTimeStr.split(':').map((x) => parseInt(x, 10))
  if (Number.isNaN(h)) return null
  const startSec = h * 3600 + (m || 0) * 60
  const total = startSec + offsetSec
  const dayOffset = Math.floor(total / 86400)
  const inDay = ((total % 86400) + 86400) % 86400
  const hh = Math.floor(inDay / 3600)
  const mm = Math.floor((inDay % 3600) / 60)
  const base = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  return dayOffset > 0 ? `${base} (+${dayOffset}j)` : base
}
