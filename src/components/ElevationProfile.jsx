import React, { useRef, useEffect } from 'react'
import * as d3 from 'd3'
import { formatDuration } from '../lib/format.js'

// Profil altimétrique interactif (D3).
// Repris et enrichi depuis l'éditeur dev roadbook :
//  - survol → ligne + pastille + remontée de l'info (km / alt / D+ / ETA)
//  - clic → ajoute un point de passage à cette distance
//  - pastilles des checkpoints alignés
// La zone est colorée par tranches de pente (vert descente douce → rouge raide).
export default function ElevationProfile({ points, checkpoints, onAddCheckpoint, onHover, hasPacing }) {
  const svgRef = useRef(null)

  useEffect(() => {
    if (!points || points.length < 2) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = 900
    const height = 260
    const margin = { top: 20, right: 20, bottom: 36, left: 52 }
    const chartWidth = width - margin.left - margin.right
    const chartHeight = height - margin.top - margin.bottom

    const x = d3
      .scaleLinear()
      .domain([0, d3.max(points, (d) => d.dist_cumul) / 1000])
      .range([0, chartWidth])

    const eMin = d3.min(points, (d) => d.smooth_ele)
    const eMax = d3.max(points, (d) => d.smooth_ele)
    const pad = Math.max(10, (eMax - eMin) * 0.1)
    const y = d3
      .scaleLinear()
      .domain([eMin - pad, eMax + pad])
      .range([chartHeight, 0])

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`)

    // Couleur d'une pente (fraction) : descente raide rouge, descente douce
    // verte (terrain le plus rapide), plat gris, montée orange → rouge.
    const slopeColor = (grad) => {
      const p = grad * 100
      if (p <= -25) return '#dc2626'
      if (p <= -12) return '#f59e0b'
      if (p < -3) return '#22c55e'
      if (p <= 3) return '#64748b'
      if (p <= 12) return '#fb923c'
      if (p <= 25) return '#ea580c'
      return '#b91c1c'
    }

    // Aire colorée par segment (tranche entre deux points consécutifs)
    const areaGen = (p0, p1) =>
      `M${x(p0.dist_cumul / 1000)},${chartHeight} ` +
      `L${x(p0.dist_cumul / 1000)},${y(p0.smooth_ele)} ` +
      `L${x(p1.dist_cumul / 1000)},${y(p1.smooth_ele)} ` +
      `L${x(p1.dist_cumul / 1000)},${chartHeight} Z`

    // Pour la perf on ne peint pas un path par point si la trace est énorme :
    // on échantillonne au plus ~1500 tranches.
    const stride = Math.max(1, Math.floor(points.length / 1500))
    for (let i = stride; i < points.length; i += stride) {
      const p0 = points[i - stride]
      const p1 = points[i]
      g.append('path')
        .attr('d', areaGen(p0, p1))
        .attr('fill', slopeColor(p1.gradient || 0))
        .attr('opacity', 0.5)
    }

    // Ligne de crête
    const line = d3
      .line()
      .x((d) => x(d.dist_cumul / 1000))
      .y((d) => y(d.smooth_ele))
    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', '#f8fafc')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.9)
      .attr('d', line)

    // Grilles
    g.append('g')
      .attr('transform', `translate(0, ${chartHeight})`)
      .call(d3.axisBottom(x).ticks(8).tickSize(-chartHeight).tickFormat(''))
      .call((g) => g.selectAll('.tick line').attr('stroke', '#1e293b'))
      .call((g) => g.select('.domain').remove())
    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickSize(-chartWidth).tickFormat(''))
      .call((g) => g.selectAll('.tick line').attr('stroke', '#1e293b'))
      .call((g) => g.select('.domain').remove())

    // Axes
    g.append('g')
      .attr('transform', `translate(0, ${chartHeight})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat((d) => `${d}`))
      .call((g) => g.select('.domain').attr('stroke', '#475569'))
      .call((g) => g.selectAll('.tick text').attr('fill', '#94a3b8').style('font-size', '10px'))
    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .call((g) => g.select('.domain').attr('stroke', '#475569'))
      .call((g) => g.selectAll('.tick text').attr('fill', '#94a3b8').style('font-size', '10px'))

    g.append('text')
      .attr('x', chartWidth)
      .attr('y', chartHeight + 30)
      .attr('text-anchor', 'end')
      .attr('fill', '#64748b')
      .style('font-size', '10px')
      .text('distance (km)')

    // Pastilles checkpoints
    ;(checkpoints || []).forEach((cp) => {
      if (!cp.is_matched) return
      const cx = x(cp.km_cumul)
      const cy = y(cp.altitude)
      g.append('line')
        .attr('x1', cx).attr('x2', cx)
        .attr('y1', cy).attr('y2', chartHeight)
        .attr('stroke', '#f97316').attr('stroke-width', 1).attr('stroke-dasharray', '2,2').attr('opacity', 0.5)
      g.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 5)
        .attr('fill', '#f97316').attr('stroke', '#fff').attr('stroke-width', 1.5)
      g.append('text')
        .attr('x', cx).attr('y', cy - 9)
        .attr('text-anchor', 'middle').attr('fill', '#fdba74')
        .style('font-size', '10px').style('font-weight', '700')
        .text(cp.order + 1)
    })

    // Curseur de survol
    const focus = g.append('g').style('display', 'none')
    focus.append('line')
      .attr('stroke', '#f97316').attr('stroke-width', 1.2).attr('stroke-dasharray', '3,3')
      .attr('y1', 0).attr('y2', chartHeight)
    const dot = focus.append('circle').attr('r', 5).attr('fill', '#f97316').attr('stroke', '#fff').attr('stroke-width', 2)

    const bisect = d3.bisector((d) => d.dist_cumul / 1000).left
    const nearestPoint = (mouseX) => {
      const x0 = x.invert(mouseX)
      const i = bisect(points, x0, 1)
      const d0 = points[i - 1]
      const d1 = points[i]
      if (!d0) return d1
      if (!d1) return d0
      return x0 - d0.dist_cumul / 1000 > d1.dist_cumul / 1000 - x0 ? d1 : d0
    }

    svg.append('rect')
      .attr('transform', `translate(${margin.left}, ${margin.top})`)
      .attr('width', chartWidth)
      .attr('height', chartHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mouseover', () => focus.style('display', null))
      .on('mouseout', () => {
        focus.style('display', 'none')
        onHover && onHover(null)
      })
      .on('mousemove', function (event) {
        const mouseX = d3.pointer(event)[0]
        const d = nearestPoint(mouseX)
        if (!d) return
        focus.attr('transform', `translate(${x(d.dist_cumul / 1000)}, 0)`)
        dot.attr('cy', y(d.smooth_ele))
        onHover && onHover({
          km: (d.dist_cumul / 1000).toFixed(2),
          ele: Math.round(d.smooth_ele),
          d_plus: Math.round(d.d_plus_cumul),
          grad: Math.round((d.gradient || 0) * 100),
          eta: hasPacing ? formatDuration(d.eta_sec) : null,
          lat: d.lat,
          lon: d.lon,
        })
      })
      .on('click', function (event) {
        const mouseX = d3.pointer(event)[0]
        const d = nearestPoint(mouseX)
        if (d && onAddCheckpoint) onAddCheckpoint(Number((d.dist_cumul / 1000).toFixed(2)))
      })
  }, [points, checkpoints, hasPacing, onAddCheckpoint, onHover])

  return (
    <svg ref={svgRef} viewBox="0 0 900 260" className="w-full h-auto min-w-[640px]" />
  )
}
