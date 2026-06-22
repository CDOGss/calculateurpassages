import React, { useState, useMemo, useCallback, useRef } from 'react'
import {
  Upload, Mountain, Timer, Trash2, Plus, Download, Printer,
  Activity, Gauge, AlertTriangle, Zap, Info,
} from 'lucide-react'
import { parseGpxTrack, alignCheckpoints } from './lib/gpx.js'
import { computePacing, RUNNER_PROFILES, TERRAIN_TYPES } from './lib/pacing.js'
import { detectTerrain } from './lib/terrain.js'
import {
  parseTimeToSec, formatDuration, formatDurationShort, formatPace, formatClock,
} from './lib/format.js'
import ElevationProfile from './components/ElevationProfile.jsx'
import CourseMap from './components/CourseMap.jsx'

let cpId = 1
const nextId = () => String(cpId++)

export default function App() {
  const [rawData, setRawData] = useState(null)
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [parsing, setParsing] = useState(false)

  const [checkpoints, setCheckpoints] = useState([])
  const [targetTime, setTargetTime] = useState('')
  const [startTime, setStartTime] = useState('')
  const [profileKey, setProfileKey] = useState('experimente')
  const [terrainKey, setTerrainKey] = useState('montagne')
  const [technicity, setTechnicity] = useState(TERRAIN_TYPES.montagne.technicity)
  const [segLength, setSegLength] = useState(100)

  // Choisir un terrain ajuste la technicité ; le curseur avancé reste un override.
  const handleTerrain = (key) => {
    setTerrainKey(key)
    if (TERRAIN_TYPES[key]) setTechnicity(TERRAIN_TYPES[key].technicity)
  }
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [hoveredPoint, setHoveredPoint] = useState(null)
  const [newCpName, setNewCpName] = useState('')
  const [newCpKm, setNewCpKm] = useState('')
  const fileInputRef = useRef(null)

  // Détection terrain OSM par section de 2 km
  const SECTION_KM = 2
  const [terrainSections, setTerrainSections] = useState(null)
  const [detecting, setDetecting] = useState(false)
  const [detectProgress, setDetectProgress] = useState({ done: 0, total: 0 })
  const [detectError, setDetectError] = useState('')
  const abortRef = useRef(null)

  const sectionTechnicity = useMemo(
    () => (terrainSections ? terrainSections.map((s) => s.technicity) : null),
    [terrainSections]
  )

  const points = rawData?.points || []
  const metadata = rawData?.metadata || {}
  const targetSec = parseTimeToSec(targetTime)
  const fatiguePerHour = RUNNER_PROFILES[profileKey].fatiguePerHour

  // ---- Calcul : pacing puis alignement des checkpoints (eta_sec dispo) ----
  const { aligned, pacing } = useMemo(() => {
    if (!points.length) return { aligned: [], pacing: null }
    let pacingRes = null
    if (targetSec > 0) {
      pacingRes = computePacing(points, {
        targetTimeSec: targetSec,
        segLength,
        fatiguePerHour,
        technicity,
        sectionTechnicity,
        sectionKm: SECTION_KM,
      })
    } else {
      points.forEach((p) => (p.eta_sec = undefined))
    }
    const al = alignCheckpoints(checkpoints, points)
    return { aligned: al, pacing: pacingRes }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, checkpoints, targetSec, segLength, fatiguePerHour, technicity, sectionTechnicity])

  const hasPacing = !!pacing && targetSec > 0

  // ---------------------------- Upload GPX ----------------------------------
  const handleFile = useCallback((file) => {
    if (!file) return
    setParsing(true)
    setParseError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = parseGpxTrack(e.target.result, { applySmoothing: true })
        if (!data.points.length) throw new Error('Aucun point de trace trouvé dans ce GPX.')
        setRawData(data)
        setFileName(file.name)
        setTerrainSections(null)
        setDetectError('')
        cpId = 1
        setCheckpoints([
          { id: nextId(), name: 'Départ', km_cumul: 0 },
          { id: nextId(), name: 'Arrivée', km_cumul: Number(data.metadata.total_distance_km.toFixed(2)) },
        ])
      } catch (err) {
        setParseError(err.message || 'Fichier GPX illisible.')
        setRawData(null)
      } finally {
        setParsing(false)
      }
    }
    reader.onerror = () => { setParseError('Lecture du fichier impossible.'); setParsing(false) }
    reader.readAsText(file)
  }, [])

  const onDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  // ---------------------- Détection terrain (OSM) ---------------------------
  const handleDetectTerrain = async () => {
    if (!points.length || detecting) return
    setDetecting(true)
    setDetectError('')
    setDetectProgress({ done: 0, total: 0 })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const { sections } = await detectTerrain(points, {
        sectionKm: SECTION_KM,
        signal: controller.signal,
        onProgress: (done, total) => setDetectProgress({ done, total }),
      })
      setTerrainSections(sections)
      const covered = sections.filter((s) => s.terrainKey).length
      if (covered === 0) setDetectError("OpenStreetMap n'a renvoyé aucun type de terrain exploitable sur ce parcours.")
    } catch (err) {
      if (err.name !== 'AbortError') setDetectError('Échec de la détection : ' + (err.message || 'erreur réseau') + '.')
    } finally {
      setDetecting(false)
      abortRef.current = null
    }
  }

  const cancelDetect = () => abortRef.current?.abort()

  // ------------------------- Checkpoints CRUD -------------------------------
  const addCheckpointAtKm = useCallback((km) => {
    setCheckpoints((prev) => {
      const n = prev.filter((c) => c.name.startsWith('Point ')).length
      return [...prev, { id: nextId(), name: `Point ${n + 1}`, km_cumul: km }]
    })
  }, [])

  const handleAddForm = (e) => {
    e.preventDefault()
    const km = parseFloat(newCpKm)
    const max = metadata.total_distance_km || 0
    if (!newCpName || Number.isNaN(km) || km < 0 || km > max + 0.5) return
    setCheckpoints((prev) => [...prev, { id: nextId(), name: newCpName, km_cumul: km }])
    setNewCpName(''); setNewCpKm('')
  }

  const renameCp = (id, name) => setCheckpoints((p) => p.map((c) => (c.id === id ? { ...c, name } : c)))
  const deleteCp = (id) => setCheckpoints((p) => p.filter((c) => c.id !== id))

  // ------------------------------ Exports -----------------------------------
  const exportCsv = () => {
    const header = ['Ordre', 'Nom', 'Km cumulé', 'Km inter', 'Altitude (m)', 'D+ cumulé', 'D- cumulé', 'Temps de passage', 'Temps inter', 'Heure', 'Allure (min/km)']
    const rows = aligned.map((cp) => [
      cp.order + 1, `"${cp.name}"`, cp.km_cumul, cp.dist_inter_km, cp.altitude,
      cp.d_plus_cumul, cp.d_minus_cumul,
      hasPacing ? formatDuration(cp.eta_sec) : '',
      hasPacing ? formatDuration(cp.time_inter_sec) : '',
      hasPacing && startTime ? (formatClock(startTime, cp.eta_sec) || '') : '',
      hasPacing && cp.dist_inter_km > 0 ? formatPace((cp.time_inter_sec / cp.dist_inter_km)) : '',
    ])
    const csv = [header, ...rows].map((r) => r.join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `temps-passage-${(metadata.name || 'parcours').replace(/\s+/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // =================================== UI ===================================
  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-7xl mx-auto px-4 pb-20">
        {!rawData ? (
          <UploadZone
            onPick={() => fileInputRef.current?.click()}
            onDrop={onDrop}
            parsing={parsing}
            error={parseError}
          />
        ) : (
          <div className="space-y-6">
            <StatsHeader metadata={metadata} fileName={fileName} pacing={pacing} hasPacing={hasPacing} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Colonne gauche : réglages + terrain */}
              <div className="space-y-6">
                <RunnerPanel
                  targetTime={targetTime} setTargetTime={setTargetTime}
                  startTime={startTime} setStartTime={setStartTime}
                  profileKey={profileKey} setProfileKey={setProfileKey}
                  terrainKey={terrainKey} handleTerrain={handleTerrain}
                  technicity={technicity} setTechnicity={setTechnicity}
                  segLength={segLength} setSegLength={setSegLength}
                  showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
                  pacing={pacing} hasPacing={hasPacing}
                  detected={!!terrainSections}
                />
                <TerrainPanel
                  hasPoints={points.length > 0}
                  sections={terrainSections}
                  detecting={detecting}
                  progress={detectProgress}
                  error={detectError}
                  sectionKm={SECTION_KM}
                  onDetect={handleDetectTerrain}
                  onCancel={cancelDetect}
                  onClear={() => { setTerrainSections(null); setDetectError('') }}
                />
              </div>

              {/* Profil + carte */}
              <div className="lg:col-span-2 space-y-6">
                <Panel>
                  <PanelTitle
                    icon={<Mountain className="h-5 w-5 text-brand-500" />}
                    title="Profil altimétrique"
                    badge="Cliquez pour ajouter un point"
                  >
                    {hoveredPoint && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs bg-slate-800/80 px-3 py-1.5 rounded-lg">
                        <span><span className="text-slate-400">km</span> <b className="text-white">{hoveredPoint.km}</b></span>
                        <span><span className="text-slate-400">alt</span> <b className="text-white">{hoveredPoint.ele} m</b></span>
                        <span><span className="text-slate-400">pente</span> <b className={hoveredPoint.grad >= 0 ? 'text-brand-400' : 'text-emerald-400'}>{hoveredPoint.grad > 0 ? '+' : ''}{hoveredPoint.grad}%</b></span>
                        {hoveredPoint.eta && <span><span className="text-slate-400">passage</span> <b className="text-brand-400">{hoveredPoint.eta}</b></span>}
                      </div>
                    )}
                  </PanelTitle>
                  <div className="overflow-x-auto">
                    <ElevationProfile
                      points={points}
                      checkpoints={aligned}
                      onAddCheckpoint={addCheckpointAtKm}
                      onHover={setHoveredPoint}
                      hasPacing={hasPacing}
                    />
                  </div>
                  <SlopeLegend />
                </Panel>

                <Panel>
                  <PanelTitle title="Carte du parcours" badge="Cliquez pour ajouter un point" />
                  <CourseMap
                    points={points}
                    checkpoints={aligned}
                    hoveredPoint={hoveredPoint}
                    onAddCheckpoint={addCheckpointAtKm}
                  />
                </Panel>
              </div>
            </div>

            {/* Tableau des temps de passage */}
            <CheckpointTable
              aligned={aligned}
              hasPacing={hasPacing}
              startTime={startTime}
              renameCp={renameCp}
              deleteCp={deleteCp}
              newCpName={newCpName} setNewCpName={setNewCpName}
              newCpKm={newCpKm} setNewCpKm={setNewCpKm}
              onAdd={handleAddForm}
              onExportCsv={exportCsv}
              onPrint={() => window.print()}
            />
          </div>
        )}
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx,.xml"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <Footer />
    </div>
  )
}

/* ----------------------------- Sous-composants ---------------------------- */

function Header() {
  return (
    <header className="border-b border-slate-800/80 bg-slate-950/60 backdrop-blur sticky top-0 z-[500] no-print">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="bg-brand-500/15 border border-brand-500/30 rounded-lg p-1.5">
            <Activity className="h-5 w-5 text-brand-500" />
          </div>
          <div>
            <h1 className="text-white font-extrabold leading-tight">Temps de Passage <span className="text-brand-500">Trail</span></h1>
            <p className="text-[11px] text-slate-500 leading-tight">Pente · D+/D- · technicité · fatigue</p>
          </div>
        </div>
        <span className="text-[11px] text-slate-500 hidden sm:block">100% navigateur · gratuit · vos fichiers ne quittent jamais votre appareil</span>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-600 no-print">
      Calcul local dans votre navigateur · Cartographie © OpenStreetMap · Montée : Minetti et al. (2002) · Descente : modèle terrain selon technicité
    </footer>
  )
}

function UploadZone({ onPick, onDrop, parsing, error }) {
  return (
    <div className="max-w-2xl mx-auto pt-12">
      <div className="text-center mb-8">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Vos temps de passage, au plus juste.</h2>
        <p className="text-slate-400 mt-3">
          Chargez votre trace GPX, entrez votre objectif de temps. On répartit l'effort
          segment par segment (~100 m) selon la pente, le D+/D- <i>et</i> la fatigue qui
          s'accumule au fil des heures.
        </p>
      </div>
      <div
        onClick={onPick}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="cursor-pointer border-2 border-dashed border-slate-700 hover:border-brand-500 hover:bg-brand-500/5 transition-colors rounded-2xl p-12 text-center"
      >
        <Upload className="h-10 w-10 text-brand-500 mx-auto mb-4" />
        <p className="text-white font-semibold">{parsing ? 'Analyse en cours…' : 'Glissez votre fichier GPX ici'}</p>
        <p className="text-slate-500 text-sm mt-1">ou cliquez pour parcourir (.gpx)</p>
      </div>
      {error && (
        <div className="mt-4 flex items-center space-x-2 text-red-400 text-sm bg-red-950/30 border border-red-900/50 rounded-lg px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3 mt-8 text-center">
        {[
          ['Pente réelle', 'Montée ET descente, par tranche de 100 m'],
          ['Fatigue horaire', 'Allure dégradée selon votre profil'],
          ['Checkpoints', 'Cliquez sur le profil ou la carte'],
        ].map(([t, d]) => (
          <div key={t} className="bg-slate-900/50 border border-slate-800 rounded-xl p-3">
            <div className="text-brand-400 text-xs font-bold uppercase tracking-wide">{t}</div>
            <div className="text-slate-400 text-[11px] mt-1">{d}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatsHeader({ metadata, fileName, pacing, hasPacing }) {
  const stat = (label, value, color) => (
    <div>
      <div className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-extrabold mt-0.5 ${color}`}>{value}</div>
    </div>
  )
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
      <div className="min-w-0">
        <div className="text-[11px] text-brand-500 font-semibold uppercase tracking-wider">Parcours</div>
        <h2 className="text-xl font-bold text-white truncate">{metadata.name}</h2>
        <p className="text-xs text-slate-500 truncate">{fileName}</p>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-5 md:gap-8 md:border-l border-slate-800 md:pl-8">
        {stat('Distance', `${metadata.total_distance_km.toFixed(1)} km`, 'text-white')}
        {stat('D+', `+${Math.round(metadata.total_d_plus)} m`, 'text-brand-500')}
        {stat('D-', `-${Math.round(metadata.total_d_minus)} m`, 'text-slate-200')}
        {stat('Effort équiv.', hasPacing ? `${pacing.totalEquivKm.toFixed(1)} km` : '—', 'text-emerald-400')}
        {stat('Allure réf.', hasPacing ? `${formatPace(pacing.flatPaceSecPerKm)}/km` : '—', 'text-white')}
      </div>
    </div>
  )
}

function Panel({ children }) {
  return <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">{children}</div>
}

function PanelTitle({ icon, title, badge, children }) {
  return (
    <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
      <h3 className="font-bold text-white flex items-center space-x-2">
        {icon}<span>{title}</span>
        {badge && <span className="bg-brand-500/15 text-brand-400 text-[10px] uppercase font-bold px-2 py-0.5 rounded">{badge}</span>}
      </h3>
      {children}
    </div>
  )
}

function SlopeLegend() {
  const items = [
    ['#dc2626', 'Descente raide'],
    ['#22c55e', 'Descente douce'],
    ['#64748b', 'Plat'],
    ['#ea580c', 'Montée'],
    ['#b91c1c', 'Montée raide'],
  ]
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-slate-400">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center space-x-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: c }} /> <span>{l}</span>
        </span>
      ))}
    </div>
  )
}

// Couleur + libellé court par type de terrain (clé TERRAIN_TYPES + "unknown")
const TERRAIN_META = {
  route: { color: '#38bdf8', short: 'Route' },
  roulant: { color: '#22c55e', short: 'Roulant' },
  montagne: { color: '#f59e0b', short: 'Montagne' },
  technique: { color: '#ea580c', short: 'Technique' },
  alpin: { color: '#b91c1c', short: 'Alpin' },
  unknown: { color: '#475569', short: 'Inconnu' },
}

function RunnerPanel({
  targetTime, setTargetTime, startTime, setStartTime,
  profileKey, setProfileKey, terrainKey, handleTerrain, technicity, setTechnicity,
  segLength, setSegLength, showAdvanced, setShowAdvanced, pacing, hasPacing, detected,
}) {
  return (
    <Panel>
      <PanelTitle icon={<Timer className="h-5 w-5 text-brand-500" />} title="Votre course" />

      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Objectif de temps</label>
      <input
        type="text"
        placeholder="ex : 24:30 (heures:minutes)"
        value={targetTime}
        onChange={(e) => setTargetTime(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-lg font-bold focus:outline-none focus:border-brand-500"
      />
      <p className="text-[11px] text-slate-500 mt-1">Formats acceptés : <code>24:30</code>, <code>24h30</code>, <code>4:15:00</code>.</p>

      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 mt-4">Heure de départ <span className="text-slate-600 normal-case">(optionnel)</span></label>
      <input
        type="time"
        value={startTime}
        onChange={(e) => setStartTime(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-brand-500"
      />

      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 mt-4">Profil d'endurance</label>
      <select
        value={profileKey}
        onChange={(e) => setProfileKey(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-brand-500"
      >
        {Object.entries(RUNNER_PROFILES).map(([k, v]) => (
          <option key={k} value={k} className="bg-slate-900">{v.label}</option>
        ))}
      </select>
      <p className="text-[11px] text-slate-500 mt-1">Détermine à quelle vitesse l'allure se dégrade au fil des heures.</p>

      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 mt-4">Type de terrain</label>
      <select
        value={terrainKey}
        onChange={(e) => handleTerrain(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-brand-500"
      >
        {Object.entries(TERRAIN_TYPES).map(([k, v]) => (
          <option key={k} value={k} className="bg-slate-900">{v.label}</option>
        ))}
      </select>
      <p className="text-[11px] text-slate-500 mt-1">
        {detected
          ? "Terrain détecté par section (OSM) : cette valeur sert de repli pour les tronçons non couverts."
          : "Règle la technicité du terrain : plus c'est technique, plus le temps part dans les descentes raides (vous y serez plus prudent)."}
      </p>

      <button
        onClick={() => setShowAdvanced((s) => !s)}
        className="text-xs text-brand-400 hover:text-brand-300 mt-4 flex items-center space-x-1"
      >
        <Info className="h-3.5 w-3.5" />
        <span>{showAdvanced ? 'Masquer' : 'Réglages avancés'}</span>
      </button>

      {showAdvanced && (
        <div className="mt-3 space-y-4 pt-3 border-t border-slate-800">
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span className="font-semibold uppercase tracking-wide">Technicité du terrain</span>
              <span className="text-brand-400 font-bold">{Math.round(technicity * 100)}%</span>
            </div>
            <input type="range" min="0" max="1" step="0.05" value={technicity}
              onChange={(e) => setTechnicity(parseFloat(e.target.value))}
              className="w-full accent-brand-500" />
            <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
              <span>roulant / piste</span><span>montagne</span><span>pierrier alpin</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Facteur clé en <b>descente raide</b> : à −50%, ~2,7× le plat à 30%, ~4× à 70% (freinage, pose de pied). Montez-le pour un terrain technique type Roche Écrite / Diagonale.</p>
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span className="font-semibold uppercase tracking-wide">Pas d'analyse</span>
              <span className="text-brand-400 font-bold">{segLength} m</span>
            </div>
            <input type="range" min="50" max="500" step="25" value={segLength}
              onChange={(e) => setSegLength(parseInt(e.target.value, 10))}
              className="w-full accent-brand-500" />
            <p className="text-[11px] text-slate-500">Plus fin = plus précis (et un peu plus lent).</p>
          </div>
        </div>
      )}

      {hasPacing && (
        <div className="mt-5 pt-4 border-t border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400 flex items-center space-x-1.5"><Gauge className="h-4 w-4 text-brand-500" /><span>Temps total</span></span>
            <span className="text-white font-extrabold">{formatDuration(pacing.totalTimeSec)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400 flex items-center space-x-1.5"><Zap className="h-4 w-4 text-brand-500" /><span>Allure de fin vs départ</span></span>
            <span className="text-brand-400 font-bold">+{Math.round((pacing.fatigueAtFinish - 1) * 100)}%</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-snug">
            En fin de course vous courez ~{Math.round((pacing.fatigueAtFinish - 1) * 100)}% moins vite qu'au départ
            (à terrain égal) à cause de la fatigue cumulée.
          </p>
        </div>
      )}
    </Panel>
  )
}

function TerrainPanel({ hasPoints, sections, detecting, progress, error, sectionKm, onDetect, onCancel, onClear }) {
  if (!hasPoints) return null
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const covered = sections ? sections.filter((s) => s.terrainKey).length : 0

  return (
    <Panel>
      <PanelTitle icon={<Mountain className="h-5 w-5 text-brand-500" />} title="Terrain par section" />

      {!sections && !detecting && (
        <>
          <p className="text-[11px] text-slate-500 mb-3">
            Détecte automatiquement le type de sol par tronçon de {sectionKm} km via OpenStreetMap
            (surface, sentier, difficulté pédestre). L'analyse peut prendre quelques minutes.
          </p>
          <button onClick={onDetect} className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg font-semibold text-sm">
            Analyser le terrain (OSM)
          </button>
        </>
      )}

      {detecting && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Analyse OpenStreetMap…</span>
            <span className="font-bold text-brand-400">{progress.done}/{progress.total || '…'}</span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <button onClick={onCancel} className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold text-xs">
            Annuler
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start space-x-2 text-yellow-400 text-[11px] bg-yellow-950/20 border border-yellow-900/40 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {sections && !detecting && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>{covered}/{sections.length} tronçons détectés</span>
            <button onClick={onClear} className="text-slate-500 hover:text-slate-300 underline">Réinitialiser</button>
          </div>

          {/* Bande colorée du parcours */}
          <div className="flex h-3 rounded-full overflow-hidden border border-slate-800">
            {sections.map((s) => {
              const meta = TERRAIN_META[s.terrainKey || 'unknown']
              return <div key={s.index} className="flex-1" style={{ background: meta.color }} title={`${s.startKm}–${s.endKm} km : ${meta.short}${s.coverage ? ` (${Math.round(s.coverage * 100)}%)` : ''}`} />
            })}
          </div>

          {/* Légende */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
            {['route', 'roulant', 'montagne', 'technique', 'alpin', 'unknown'].map((k) => (
              <span key={k} className="flex items-center space-x-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: TERRAIN_META[k].color }} />
                <span>{TERRAIN_META[k].short}</span>
              </span>
            ))}
          </div>

          {/* Liste détaillée */}
          <div className="max-h-52 overflow-y-auto pr-1 space-y-1">
            {sections.map((s) => {
              const meta = TERRAIN_META[s.terrainKey || 'unknown']
              return (
                <div key={s.index} className="flex items-center justify-between text-xs bg-slate-950/40 rounded px-2 py-1.5">
                  <span className="text-slate-400 tabular-nums">{s.startKm}–{s.endKm} km</span>
                  <span className="flex items-center space-x-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: meta.color }} />
                    <span className="text-slate-200 font-medium">{meta.short}</span>
                    {s.terrainKey && <span className="text-slate-600">{Math.round(s.coverage * 100)}%</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Panel>
  )
}

function CheckpointTable({
  aligned, hasPacing, startTime, renameCp, deleteCp,
  newCpName, setNewCpName, newCpKm, setNewCpKm, onAdd, onExportCsv, onPrint,
}) {
  return (
    <Panel>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h3 className="font-bold text-white text-lg">Temps de passage par point</h3>
        <div className="flex gap-2 no-print">
          <button onClick={onExportCsv} className="flex items-center space-x-1.5 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg px-3 py-2 font-semibold">
            <Download className="h-4 w-4" /><span>CSV</span>
          </button>
          <button onClick={onPrint} className="flex items-center space-x-1.5 text-sm bg-brand-600 hover:bg-brand-500 text-white rounded-lg px-3 py-2 font-semibold">
            <Printer className="h-4 w-4" /><span>Imprimer</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm text-slate-300">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
              <th className="py-2.5 px-3 font-semibold">#</th>
              <th className="py-2.5 px-3 font-semibold">Point</th>
              <th className="py-2.5 px-3 font-semibold">Km</th>
              <th className="py-2.5 px-3 font-semibold">Inter</th>
              <th className="py-2.5 px-3 font-semibold">Alt</th>
              <th className="py-2.5 px-3 font-semibold">D+/D-</th>
              {hasPacing && <th className="py-2.5 px-3 font-semibold text-brand-400">Passage</th>}
              {hasPacing && <th className="py-2.5 px-3 font-semibold">Inter</th>}
              {hasPacing && <th className="py-2.5 px-3 font-semibold">Allure</th>}
              {hasPacing && startTime && <th className="py-2.5 px-3 font-semibold">Heure</th>}
              <th className="py-2.5 px-3 font-semibold text-right no-print">Suppr.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {aligned.map((cp) => {
              const interPace = hasPacing && cp.dist_inter_km > 0 ? cp.time_inter_sec / cp.dist_inter_km : null
              return (
                <tr key={cp.id} className="hover:bg-slate-800/20">
                  <td className="py-2.5 px-3 text-slate-500 font-bold">{cp.order + 1}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center space-x-1.5">
                      <input
                        value={cp.name}
                        onChange={(e) => renameCp(cp.id, e.target.value)}
                        className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-brand-500 text-white font-semibold focus:outline-none px-0.5 rounded-sm w-full max-w-[180px]"
                      />
                      {!cp.is_matched && (
                        <span title={`Hors trace (~${cp.offset_distance_m} m)`} className="text-yellow-500 shrink-0"><AlertTriangle className="h-3.5 w-3.5" /></span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{cp.km_cumul} km</td>
                  <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">+{cp.dist_inter_km}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{cp.altitude} m</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="text-brand-500">+{cp.d_plus_inter}</span>
                    <span className="text-slate-600"> / </span>
                    <span className="text-sky-400">-{cp.d_minus_inter}</span>
                  </td>
                  {hasPacing && <td className="py-2.5 px-3 font-extrabold text-brand-400 whitespace-nowrap">{formatDuration(cp.eta_sec)}</td>}
                  {hasPacing && <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">{formatDurationShort(cp.time_inter_sec)}</td>}
                  {hasPacing && <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{formatPace(interPace)}</td>}
                  {hasPacing && startTime && <td className="py-2.5 px-3 text-white font-semibold whitespace-nowrap">{formatClock(startTime, cp.eta_sec)}</td>}
                  <td className="py-2.5 px-3 text-right no-print">
                    <button onClick={() => deleteCp(cp.id)} className="text-slate-500 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-950/20">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <form onSubmit={onAdd} className="flex flex-col sm:flex-row gap-3 mt-5 bg-slate-950/40 p-3 rounded-xl border border-slate-800 no-print">
        <input
          placeholder="Nom du point (ex : Ravito Col)"
          value={newCpName}
          onChange={(e) => setNewCpName(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          required
        />
        <input
          type="number" step="0.1" placeholder="KM"
          value={newCpKm}
          onChange={(e) => setNewCpKm(e.target.value)}
          className="w-full sm:w-28 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          required
        />
        <button type="submit" className="bg-brand-600 hover:bg-brand-500 text-white rounded-lg px-4 py-2 font-semibold text-sm flex items-center justify-center space-x-1.5">
          <Plus className="h-4 w-4" /><span>Ajouter</span>
        </button>
      </form>
    </Panel>
  )
}
