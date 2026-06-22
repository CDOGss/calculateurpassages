import React, { useRef, useEffect } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Carte Leaflet (OpenStreetMap, gratuit). Reprise de l'éditeur dev roadbook :
//  - tracé GPX
//  - clic sur la carte → ajoute un point de passage au point de trace le plus proche
//  - pastille de survol synchronisée avec le profil altimétrique
//  - marqueurs numérotés des checkpoints
// On n'utilise que circleMarker / divIcon → aucune image à charger (évite le
// bug classique des icônes Leaflet cassées avec Vite).
export default function CourseMap({ points, checkpoints, hoveredPoint, onAddCheckpoint }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const hoverRef = useRef(null)
  const cpMarkersRef = useRef([])

  // Init carte + tracé
  useEffect(() => {
    if (!points || points.length < 2 || !containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current).setView([points[0].lat, points[0].lon], 13)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)

    const latlngs = points.map((p) => [p.lat, p.lon])
    const pathLine = L.polyline(latlngs, { color: '#f97316', weight: 4, opacity: 0.85 }).addTo(map)
    map.fitBounds(pathLine.getBounds(), { padding: [20, 20] })

    // Départ / arrivée
    L.circleMarker([points[0].lat, points[0].lon], { radius: 6, fillColor: '#22c55e', color: '#fff', weight: 2, fillOpacity: 1 })
      .addTo(map).bindPopup('Départ')
    const last = points[points.length - 1]
    L.circleMarker([last.lat, last.lon], { radius: 6, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 1 })
      .addTo(map).bindPopup('Arrivée')

    hoverRef.current = L.circleMarker([points[0].lat, points[0].lon], {
      radius: 6, fillColor: '#f97316', color: '#fff', weight: 2, fillOpacity: 1,
    }).addTo(map)
    hoverRef.current.setStyle({ opacity: 0, fillOpacity: 0 })

    map.on('click', (e) => {
      const { lat, lng } = e.latlng
      let nearest = null
      let minDist = Infinity
      for (const pt of points) {
        const dLat = pt.lat - lat
        const dLon = (pt.lon - lng) * Math.cos((lat * Math.PI) / 180)
        const d = dLat * dLat + dLon * dLon
        if (d < minDist) { minDist = d; nearest = pt }
      }
      if (nearest && onAddCheckpoint) {
        onAddCheckpoint(Number((nearest.dist_cumul / 1000).toFixed(2)))
      }
    })

    mapRef.current = map
    // Recalage de la taille (le conteneur peut être monté avant son layout final)
    setTimeout(() => map.invalidateSize(), 200)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [points, onAddCheckpoint])

  // Pastille de survol synchronisée avec le profil
  useEffect(() => {
    if (!hoverRef.current) return
    if (hoveredPoint && hoveredPoint.lat) {
      hoverRef.current.setLatLng([hoveredPoint.lat, hoveredPoint.lon])
      hoverRef.current.setStyle({ opacity: 1, fillOpacity: 1 })
    } else {
      hoverRef.current.setStyle({ opacity: 0, fillOpacity: 0 })
    }
  }, [hoveredPoint])

  // Marqueurs des checkpoints
  useEffect(() => {
    if (!mapRef.current) return
    cpMarkersRef.current.forEach((m) => m.remove())
    cpMarkersRef.current = []
    ;(checkpoints || []).forEach((cp) => {
      if (!cp.is_matched || !cp.lat) return
      const icon = L.divIcon({
        html: `<div style="background:#0f172a;border:2px solid #f97316;color:#fb923c;font-weight:800;font-size:11px;border-radius:9999px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.5)">${cp.order + 1}</div>`,
        className: 'cp-map-marker',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })
      const m = L.marker([cp.lat, cp.lon], { icon })
        .addTo(mapRef.current)
        .bindPopup(`<b>${cp.name}</b><br/>${cp.km_cumul} km · ${cp.altitude} m<br/>D+ ${cp.d_plus_cumul} m`)
      cpMarkersRef.current.push(m)
    })
  }, [checkpoints])

  return <div ref={containerRef} className="rounded-xl overflow-hidden border border-slate-800" style={{ height: 420 }} />
}
