import { useRef, useEffect, useCallback, useState } from 'react'
import styles from './ClaimPinsOverlay.module.css'
import { logger } from '@/utils/logger'

const DOT_RADIUS = 14
const DOT_RADIUS_ACTIVE = 18
const OVERLAP_TOLERANCE = 10
const OVERLAP_SEPARATION = 14
const CONTENT_TYPE_X_PCT = {
  title: 5,
  bullet: 6,
  'sub-bullet': 10,
  footnote: 5,
  chart: 5,
  global: 94
}

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
const labelFromClaim = (claim) => {
  if (claim.globalIndex) return claim.globalIndex
  const digits = claim.id?.match(/\d+/)?.[0]
  return digits ? Number(digits) : claim.id
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

// When Gemini returns only a single (x,y) point, put the pin to the **left** of the text
// so the numeral does not sit on top of the claim copy. If we have a bounding box, we
// place the pin just outside the box on the left side.
const FALLBACK_LATERAL_OFFSET_PCT = 4  // % of page width to shift left when no bbox
const MIN_LATERAL_OFFSET_PX = DOT_RADIUS_ACTIVE + 8

const computeAnchor = (dot, canvasDimensions) => {
  const widthPx = (dot.boxWidthPct || 0) * canvasDimensions.width / 100
  const heightPx = (dot.boxHeightPct || 0) * canvasDimensions.height / 100
  const centerX = (dot.centerXPct / 100) * canvasDimensions.width
  const centerY = (dot.centerYPct / 100) * canvasDimensions.height

  if (dot.contentType === 'global') {
    return {
      x: clamp(centerX, DOT_RADIUS_ACTIVE, canvasDimensions.width - DOT_RADIUS_ACTIVE),
      y: clamp(centerY, DOT_RADIUS_ACTIVE, canvasDimensions.height - DOT_RADIUS_ACTIVE)
    }
  }

  // No bounding box (Gemini simple x/y) – push pin left of the point
  if (!widthPx || !heightPx) {
    const pctOffset = (FALLBACK_LATERAL_OFFSET_PCT / 100) * canvasDimensions.width
    const defaultOffset = Math.max(MIN_LATERAL_OFFSET_PX, pctOffset)
    const x = Math.max(DOT_RADIUS_ACTIVE, centerX - defaultOffset)
    const y = clamp(centerY, DOT_RADIUS_ACTIVE, canvasDimensions.height - DOT_RADIUS_ACTIVE)
    return { x, y }
  }

  // With bounding box – place pin just outside the left edge
  const lateralOffset = Math.min(16, Math.max(10, widthPx * 0.15))
  const leftX = centerX - widthPx / 2 - lateralOffset
  const x = clamp(leftX, DOT_RADIUS_ACTIVE, canvasDimensions.width - DOT_RADIUS_ACTIVE)
  const y = clamp(centerY, DOT_RADIUS_ACTIVE, canvasDimensions.height - DOT_RADIUS_ACTIVE)

  return { x, y }
}

// Spread dots that land on (nearly) identical coords so numbers don't stack
const resolveOverlaps = (dots, canvasDimensions) => {
  const adjusted = []

  for (const dot of dots) {
    let attempt = 0
    let candidate = dot

    // Try alternating small vertical shifts to preserve proximity to text line
    const shifts = [0, 1, -1, 2, -2, 3, -3].map(s => s * OVERLAP_SEPARATION)

    for (const shift of shifts) {
      const shifted = {
        ...dot,
        y: clamp(dot.y + shift, DOT_RADIUS_ACTIVE, canvasDimensions.height - DOT_RADIUS_ACTIVE)
      }
      const overlaps = adjusted.some(d => Math.hypot(d.x - shifted.x, d.y - shifted.y) <= OVERLAP_TOLERANCE)
      if (!overlaps) {
        candidate = shifted
        break
      }
      attempt++
    }

    // Last resort: nudge horizontally a bit
    if (attempt === shifts.length) {
      const bumped = {
        ...candidate,
        x: clamp(candidate.x + OVERLAP_SEPARATION, DOT_RADIUS_ACTIVE, canvasDimensions.width - DOT_RADIUS_ACTIVE)
      }
      candidate = bumped
    }

    adjusted.push(candidate)
  }

  return adjusted
}

const MISSED_CLAIM_COLOR = '#F59E0B'  // Amber for missed claims

export default function ClaimPinsOverlay({
  claims = [],
  missedClaims = [],
  activeClaimId = null,
  currentPage = 1,
  canvasDimensions = { width: 0, height: 0 },
  panOffset = { x: 0, y: 0 },
  scale = 1,
  onClaimSelect,
  onClaimPositionUpdate,
  claimsPanelRef,  // Ref to the claims panel for connector positioning
  showBoxes = false
}) {
  const canvasRef = useRef(null)
  const svgRef = useRef(null)
  const [hoveredDot, setHoveredDot] = useState(null)
  const [dragging, setDragging] = useState(null)
  const dragOffsetRef = useRef(null)

  // Filter claims for current page and compute pixel positions
  const dots = claims
    .filter(claim => Number(claim.page) === currentPage && claim.position)
    .map(claim => {
      // Manual-drag pins bypass all lane/content-type/anchor logic
      if (claim.position?.source === 'manual-drag') {
        const x = clamp((Number(claim.position.x) / 100) * canvasDimensions.width, DOT_RADIUS_ACTIVE, canvasDimensions.width - DOT_RADIUS_ACTIVE)
        const y = clamp((Number(claim.position.y) / 100) * canvasDimensions.height, DOT_RADIUS_ACTIVE, canvasDimensions.height - DOT_RADIUS_ACTIVE)
        return {
          id: claim.id,
          x,
          y,
          contentType: claim.contentType,
          centerXPct: Number(claim.position.x) || 0,
          centerYPct: Number(claim.position.y) || 0,
          boxWidthPct: 0,
          boxHeightPct: 0,
          confidence: claim.confidence,
          text: claim.text,
          label: labelFromClaim(claim),
          positionSource: 'manual-drag'
        }
      }

      const usePositionX = claim.position?.source === 'coarse-slide-anchor' || Boolean(claim.position?.lane)
      const centerXPct = usePositionX
        ? (Number(claim.position?.x) || 0)
        : (
            claim.contentType && CONTENT_TYPE_X_PCT[claim.contentType] != null
              ? CONTENT_TYPE_X_PCT[claim.contentType]
              : (Number(claim.position?.x) || 0)
          )
      const centerYPct = Number(claim.position.y) || 0
      const boxWidthPct = Number(claim.position.width) || 0
      const boxHeightPct = Number(claim.position.height) || 0

      const anchor = computeAnchor(
        { centerXPct, centerYPct, boxWidthPct, boxHeightPct, contentType: claim.contentType },
        canvasDimensions
      )

      return {
        id: claim.id,
        x: anchor.x,
        y: anchor.y,
        contentType: claim.contentType,
        centerXPct,
        centerYPct,
        boxWidthPct,
        boxHeightPct,
        confidence: claim.confidence,
        text: claim.text,
        label: labelFromClaim(claim),
        positionSource: claim.position?.source || 'unknown'
      }
    })

  const displayDots = resolveOverlaps(dots, canvasDimensions)

  // Missed claim pins — simple x/y % placement, amber color
  const missedDots = missedClaims
    .filter(mc => Number(mc.page) === currentPage && mc.position)
    .map((mc, idx) => ({
      id: mc.id,
      x: clamp((mc.position.x / 100) * canvasDimensions.width, DOT_RADIUS_ACTIVE, canvasDimensions.width - DOT_RADIUS_ACTIVE),
      y: clamp((mc.position.y / 100) * canvasDimensions.height, DOT_RADIUS_ACTIVE, canvasDimensions.height - DOT_RADIUS_ACTIVE),
      label: `M${idx + 1}`,
      isMissed: true
    }))

  const activeDot = displayDots.find(d => d.id === activeClaimId)
  const activeBox = activeDot && activeDot.boxWidthPct > 0 && activeDot.boxHeightPct > 0
    ? {
        x: (activeDot.centerXPct / 100) * canvasDimensions.width - (activeDot.boxWidthPct / 100) * canvasDimensions.width / 2,
        y: (activeDot.centerYPct / 100) * canvasDimensions.height - (activeDot.boxHeightPct / 100) * canvasDimensions.height / 2,
        width: (activeDot.boxWidthPct / 100) * canvasDimensions.width,
        height: (activeDot.boxHeightPct / 100) * canvasDimensions.height,
        id: activeDot.id,
        isActive: true
      }
    : null

  const boxList = showBoxes
    ? displayDots
        .filter(d => d.boxWidthPct > 0 && d.boxHeightPct > 0)
        .map(d => ({
          x: (d.centerXPct / 100) * canvasDimensions.width - (d.boxWidthPct / 100) * canvasDimensions.width / 2,
          y: (d.centerYPct / 100) * canvasDimensions.height - (d.boxHeightPct / 100) * canvasDimensions.height / 2,
          width: (d.boxWidthPct / 100) * canvasDimensions.width,
          height: (d.boxHeightPct / 100) * canvasDimensions.height,
          id: d.id,
          isActive: d.id === activeClaimId
        }))
    : activeBox
      ? [activeBox]
      : []

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
    displayDots.forEach((dot, index) => {
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
      ctx.fillText(String(dot.label), dot.x, dot.y)
      ctx.restore()
    })

    // Draw missed claim dots (amber)
    missedDots.forEach((dot) => {
      const isActive = activeClaimId === dot.id
      const radius = isActive ? DOT_RADIUS_ACTIVE : DOT_RADIUS

      ctx.save()

      if (isActive) {
        ctx.shadowColor = 'rgba(245, 158, 11, 0.8)'
        ctx.shadowBlur = 20
      }

      // Draw dashed circle border
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = MISSED_CLAIM_COLOR
      ctx.fill()

      ctx.lineWidth = 2
      ctx.strokeStyle = isActive ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.3)'
      ctx.setLineDash([3, 2])
      ctx.stroke()
      ctx.setLineDash([])

      ctx.restore()

      // Draw label ("M1", "M2", etc.)
      ctx.save()
      ctx.font = `bold ${isActive ? 11 : 9}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'white'
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
      ctx.shadowBlur = 2
      ctx.fillText(dot.label, dot.x, dot.y)
      ctx.restore()
    })
  }, [displayDots, missedDots, activeClaimId, hoveredDot, canvasDimensions, dragging])

  // Draw connector SVG
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !activeClaimId) {
      if (svg) svg.innerHTML = ''
      return
    }

    const activeDot = displayDots.find(d => d.id === activeClaimId)
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
  }, [displayDots, activeClaimId, panOffset, claimsPanelRef])

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

    const allDots = [...displayDots, ...missedDots]
    for (const dot of allDots) {
      const dist = Math.hypot(dot.x - x, dot.y - y)
      if (dist < closestDist) {
        closest = dot
        closestDist = dist
      }
    }

    // Check if within hit radius (dot radius + tolerance)
    return closestDist <= DOT_RADIUS + 8 ? closest : null
  }, [displayDots, missedDots])

  const handleCanvasMouseDown = useCallback((e) => {
    const dot = findDotAt(e.clientX, e.clientY)
    if (!dot) return

    // Stop propagation so PDFViewer's pan handler doesn't fire
    e.stopPropagation()

    if (dot.id === activeClaimId && onClaimPositionUpdate) {
      e.preventDefault()
      const canvas = canvasRef.current
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const claim = claims.find(c => c.id === dot.id)
      dragOffsetRef.current = { dx: mouseX - dot.x, dy: mouseY - dot.y }
      setDragging({
        id: dot.id,
        origXPct: claim?.position?.x ?? (dot.centerXPct || 0),
        origYPct: claim?.position?.y ?? (dot.centerYPct || 0)
      })
    } else {
      onClaimSelect?.(dot.id)
    }
  }, [findDotAt, activeClaimId, onClaimPositionUpdate, onClaimSelect, claims])

  const handleCanvasMouseMove = useCallback((e) => {
    if (dragging) {
      e.stopPropagation()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left - (dragOffsetRef.current?.dx || 0)
      const mouseY = e.clientY - rect.top - (dragOffsetRef.current?.dy || 0)
      const newXPct = clamp((mouseX / canvasDimensions.width) * 100, 1, 99)
      const newYPct = clamp((mouseY / canvasDimensions.height) * 100, 1, 99)
      onClaimPositionUpdate?.(dragging.id, { x: newXPct, y: newYPct }, false)
      return
    }
    const dot = findDotAt(e.clientX, e.clientY)
    setHoveredDot(dot?.id || null)
  }, [dragging, findDotAt, canvasDimensions, onClaimPositionUpdate])

  const handleCanvasMouseUp = useCallback((e) => {
    if (dragging) {
      e.stopPropagation()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left - (dragOffsetRef.current?.dx || 0)
      const mouseY = e.clientY - rect.top - (dragOffsetRef.current?.dy || 0)
      const newXPct = clamp((mouseX / canvasDimensions.width) * 100, 1, 99)
      const newYPct = clamp((mouseY / canvasDimensions.height) * 100, 1, 99)
      onClaimPositionUpdate?.(dragging.id, { x: newXPct, y: newYPct }, true)
      setDragging(null)
      dragOffsetRef.current = null
    }
  }, [dragging, canvasDimensions, onClaimPositionUpdate])

  const handleCanvasMouseLeave = useCallback(() => {
    if (dragging) {
      // Commit at current position rather than reverting — user may have dragged intentionally
      setDragging(null)
      dragOffsetRef.current = null
    }
    setHoveredDot(null)
  }, [dragging])

  if (canvasDimensions.width === 0 || canvasDimensions.height === 0) {
    return null
  }

  return (
    <div className={styles.overlay}>
      {boxList.length > 0 && (
        <svg className={styles.highlight} style={{ width: '100%', height: '100%' }}>
          {boxList.map(box => (
            <rect
              key={box.id}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx="4"
              ry="4"
              className={`${styles.highlightBox} ${box.isActive ? styles.highlightBoxActive : ''}`}
            />
          ))}
        </svg>
      )}
      <canvas
        ref={canvasRef}
        className={`${styles.dotsCanvas} ${hoveredDot ? styles.hasHover : ''} ${dragging ? styles.isDragging : ''} ${hoveredDot === activeClaimId && !dragging ? styles.canGrab : ''}`}
        style={{
          transform: `translate(${panOffset.x}px, ${panOffset.y}px)`
        }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
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
