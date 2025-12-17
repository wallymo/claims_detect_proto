import { useRef, useEffect, useCallback, useState } from 'react'
import styles from './ClaimPinsOverlay.module.css'

const DOT_RADIUS = 14
const DOT_RADIUS_ACTIVE = 18

/**
 * Get color based on confidence score
 * Matches the confidence tiers in master prompt
 */
function confidenceColor(confidence) {
  if (confidence >= 0.9) return '#388E3C'  // Green - Definite claim (90-100%)
  if (confidence >= 0.7) return '#F57C00'  // Amber - Strong implication (70-89%)
  if (confidence >= 0.5) return '#E64A19'  // Orange - Borderline (50-69%)
  return '#757575'                          // Gray - Weak signal (30-49%)
}

/**
 * ClaimPinsOverlay - Renders dots on PDF and connectors to claim cards
 *
 * Adapted from connect-pins standalone app
 */
export default function ClaimPinsOverlay({
  claims = [],
  activeClaimId = null,
  currentPage = 1,
  canvasDimensions = { width: 0, height: 0 },
  panOffset = { x: 0, y: 0 },
  scale = 1,
  onClaimSelect,
  claimsPanelRef  // Ref to the claims panel for connector positioning
}) {
  const canvasRef = useRef(null)
  const svgRef = useRef(null)
  const [hoveredDot, setHoveredDot] = useState(null)

  // Filter claims for current page and compute pixel positions
  const dots = claims
    .filter(claim => claim.page === currentPage && claim.position)
    .map(claim => ({
      id: claim.id,
      x: (claim.position.x / 100) * canvasDimensions.width,
      y: (claim.position.y / 100) * canvasDimensions.height,
      confidence: claim.confidence,
      text: claim.text
    }))

  // Draw dots on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasDimensions.width === 0) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    // Set canvas size accounting for device pixel ratio
    canvas.width = canvasDimensions.width * dpr
    canvas.height = canvasDimensions.height * dpr
    canvas.style.width = `${canvasDimensions.width}px`
    canvas.style.height = `${canvasDimensions.height}px`
    ctx.scale(dpr, dpr)

    // Clear canvas
    ctx.clearRect(0, 0, canvasDimensions.width, canvasDimensions.height)

    // Draw each dot
    dots.forEach((dot, index) => {
      const isActive = activeClaimId === dot.id
      const isHovered = hoveredDot === dot.id
      const radius = isActive || isHovered ? DOT_RADIUS_ACTIVE : DOT_RADIUS

      ctx.save()

      // Glow effect for active dot
      if (isActive) {
        ctx.shadowColor = 'rgba(90, 170, 255, 0.8)'
        ctx.shadowBlur = 20
      } else if (isHovered) {
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)'
        ctx.shadowBlur = 12
      }

      // Draw circle
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = confidenceColor(dot.confidence)
      ctx.fill()

      // Border
      ctx.lineWidth = 2
      ctx.strokeStyle = isActive ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.3)'
      ctx.stroke()

      ctx.restore()

      // Draw claim number in center
      ctx.save()
      ctx.font = `bold ${isActive ? 12 : 10}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'white'
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
      ctx.shadowBlur = 2
      ctx.fillText(String(index + 1), dot.x, dot.y)
      ctx.restore()
    })
  }, [dots, activeClaimId, hoveredDot, canvasDimensions])

  // Draw connector SVG
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !activeClaimId) {
      if (svg) svg.innerHTML = ''
      return
    }

    const activeDot = dots.find(d => d.id === activeClaimId)
    if (!activeDot) {
      svg.innerHTML = ''
      return
    }

    // Find the active claim card in the panel
    const cardEl = document.querySelector(`[data-claim-id="${activeClaimId}"]`)
    if (!cardEl || !claimsPanelRef?.current) {
      svg.innerHTML = ''
      return
    }

    const svgRect = svg.getBoundingClientRect()
    const cardRect = cardEl.getBoundingClientRect()

    // Card position relative to SVG
    const cardLeft = cardRect.left - svgRect.left
    const cardTop = cardRect.top - svgRect.top
    const cardBottom = cardRect.bottom - svgRect.top

    // Dot position (already in canvas coordinates, adjust for pan)
    const dotX = activeDot.x + panOffset.x
    const dotY = activeDot.y + panOffset.y

    // Build gradient
    const gradientId = 'connectorGradient'
    const cardMidY = (cardTop + cardBottom) / 2

    svg.innerHTML = `
      <defs>
        <linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse"
          x1="${cardLeft}" y1="${cardMidY}" x2="${dotX}" y2="${dotY}">
          <stop offset="0%" stop-color="white" stop-opacity="0.85"/>
          <stop offset="100%" stop-color="white" stop-opacity="0.15"/>
        </linearGradient>
        <filter id="connectorShadow">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="black" flood-opacity="0.3"/>
        </filter>
      </defs>
      <path
        d="M ${cardLeft},${cardTop}
           L ${cardLeft},${cardBottom}
           L ${dotX},${dotY + DOT_RADIUS}
           L ${dotX},${dotY - DOT_RADIUS}
           Z"
        fill="url(#${gradientId})"
        stroke="rgba(255,255,255,0.2)"
        stroke-width="1"
        stroke-linejoin="round"
        filter="url(#connectorShadow)"
      />
    `
  }, [dots, activeClaimId, panOffset, claimsPanelRef])

  // Hit detection for dot clicks
  const findDotAt = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    // Find closest dot within click radius
    let closest = null
    let closestDist = Infinity

    for (const dot of dots) {
      const dist = Math.hypot(dot.x - x, dot.y - y)
      if (dist < closestDist) {
        closest = dot
        closestDist = dist
      }
    }

    // Check if within hit radius (dot radius + tolerance)
    return closestDist <= DOT_RADIUS + 8 ? closest : null
  }, [dots])

  const handleCanvasClick = useCallback((e) => {
    const dot = findDotAt(e.clientX, e.clientY)
    if (dot) {
      onClaimSelect?.(dot.id)
    }
  }, [findDotAt, onClaimSelect])

  const handleCanvasMouseMove = useCallback((e) => {
    const dot = findDotAt(e.clientX, e.clientY)
    setHoveredDot(dot?.id || null)
  }, [findDotAt])

  const handleCanvasMouseLeave = useCallback(() => {
    setHoveredDot(null)
  }, [])

  if (canvasDimensions.width === 0 || canvasDimensions.height === 0) {
    return null
  }

  return (
    <div className={styles.overlay}>
      <canvas
        ref={canvasRef}
        className={`${styles.dotsCanvas} ${hoveredDot ? styles.hasHover : ''}`}
        style={{
          transform: `translate(${panOffset.x}px, ${panOffset.y}px)`
        }}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
      />
      <svg
        ref={svgRef}
        className={styles.connector}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
