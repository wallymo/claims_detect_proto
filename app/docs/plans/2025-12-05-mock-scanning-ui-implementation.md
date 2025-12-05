# Mock Scanning UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a mock document scanning experience with animated scanner, AI particles, progress ring, and enhanced claims UI that simulates the full detection flow before API integration.

**Architecture:** Framer Motion handles scan line and particle animations. Mock data intercepts file upload to load sample documents. Claims panel shows Core vs AI-Discovered badges with filtering. Bidirectional highlight sync between document and claims.

**Tech Stack:** React, Framer Motion, CSS Modules, existing component library

**Design Reference:** `docs/plans/2025-12-05-mock-scanning-ui-design.md`

---

## Task 1: Install Framer Motion

**Files:**
- Modify: `package.json`

**Step 1: Install dependency**

Run:
```bash
npm install framer-motion
```

**Step 2: Verify installation**

Run:
```bash
grep "framer-motion" package.json
```
Expected: `"framer-motion": "^11.x.x"`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add framer-motion for animations"
```

---

## Task 2: Create Mock Data - Documents

**Files:**
- Create: `src/mocks/documents.js`

**Step 1: Create mocks directory**

Run:
```bash
mkdir -p src/mocks
```

**Step 2: Create documents.js**

```javascript
export const MOCK_DOCUMENTS = [
  {
    id: 'doc_001',
    title: 'Clinical Trial Summary - CardioMax',
    coreClaims: 12,
    content: `Introduction

This document presents clinical findings for CardioMax, our new pharmaceutical treatment designed to address chronic cardiovascular conditions. The data presented herein represents findings from multiple Phase III clinical trials conducted across 45 research centers.

Clinical Efficacy

Our primary endpoint analysis demonstrates significant therapeutic benefit. Reduces cardiovascular events by 47% in clinical trials conducted over 24 weeks with 2,500 participants. This represents a meaningful improvement over existing standard-of-care treatments.

The treatment has achieved regulatory milestone status. FDA approved for adults 18 and older with established cardiovascular disease. This approval followed an expedited review process based on breakthrough therapy designation.

Dosage and Administration

The recommended dosage is 10mg once daily with food. Clinical studies showed optimal absorption when taken with a meal containing moderate fat content. Patients should take one tablet daily at the same time each day for best results.

Active Ingredients

Each tablet contains 10mg of CardioMax active compound (cardiomaxinil). Inactive ingredients include microcrystalline cellulose, magnesium stearate, and titanium dioxide for coating.

Comparative Analysis

In head-to-head studies against market leaders, the results were compelling. Outperforms Lipitor by 23% in LDL reduction measures. These findings were consistent across all demographic subgroups analyzed.

Patient satisfaction scores also showed marked improvement, with 84% of participants reporting positive outcomes compared to 61% in the control group.

Safety Profile

The treatment demonstrates a favorable safety profile overall. May cause mild side effects in approximately 8% of patients. The most common adverse events were headache (4.1%), muscle pain (2.3%), and digestive discomfort (1.6%), all of which resolved without intervention.

No serious adverse events were attributed to the treatment in any of the clinical trials. Long-term follow-up studies are ongoing to monitor extended safety outcomes.

Patient Testimonials

In our patient feedback program, Dr. Sarah Chen, a leading cardiologist, stated that 9 out of 10 of her patients showed improvement within 8 weeks. This aligns with our clinical observations.

Quality of Life Outcomes

Beyond clinical measures, patient-reported outcomes were encouraging. Clinically proven to improve cardiovascular health scores. The SF-36 health survey showed statistically significant improvements in both physical function and vitality composite scores.

Patients reported improved ability to perform daily activities, better exercise tolerance, and reduced chest discomfort during physical exertion.

Cost and Access

CardioMax is priced competitively at $45 per month, making it the most affordable branded cardiovascular treatment in its class. Patient assistance programs are available for qualifying individuals.

Conclusions

CardioMax represents a significant advancement in the management of cardiovascular conditions, offering both superior efficacy and an excellent safety profile.`
  },
  {
    id: 'doc_002',
    title: 'Marketing Brief - NeuroCalm',
    coreClaims: 10,
    content: `Product Overview

NeuroCalm is our breakthrough treatment for anxiety and stress-related disorders. Developed through 8 years of research, this innovative therapy offers a new approach to mental wellness.

Efficacy Claims

In controlled studies, NeuroCalm reduced anxiety symptoms by 62% compared to placebo. Participants reported significant improvement in sleep quality and daily functioning within just 2 weeks of treatment.

The medication provides 24-hour anxiety relief with once-daily dosing. This sustained release formula maintains consistent blood levels throughout the day.

Regulatory Status

NeuroCalm received FDA approval in March 2024 for generalized anxiety disorder in adults. The approval covers both initial treatment and maintenance therapy for long-term management.

Safety Information

Clinical trials demonstrated a favorable safety profile. Less than 3% of patients experienced drowsiness, and these effects typically resolved within the first week. No significant drug interactions were identified with common medications.

Dosage

Start with 5mg daily for the first week, then increase to 10mg daily. Maximum recommended dose is 20mg per day based on individual response and tolerability.

Ingredients

Active: Neurocalmine HCl 5mg, 10mg, or 20mg tablets. Contains no gluten, lactose, or artificial colors.

Market Comparison

NeuroCalm works faster than leading competitors, with onset of action within 30 minutes. Patient preference studies showed 78% chose NeuroCalm over their previous anxiety medication.

Expert Endorsement

Leading psychiatrists recommend NeuroCalm as a first-line treatment option. Dr. Michael Torres from Johns Hopkins notes it represents a significant advancement in anxiety treatment.

Pricing

Available for $89 per month. With insurance, most patients pay $25 or less. Manufacturer coupons available for uninsured patients.

Summary

NeuroCalm offers rapid, effective, and well-tolerated relief for anxiety sufferers, backed by robust clinical evidence.`
  }
]

export const getDocumentById = (id) => MOCK_DOCUMENTS.find(doc => doc.id === id)

export const getRandomDocument = () => MOCK_DOCUMENTS[Math.floor(Math.random() * MOCK_DOCUMENTS.length)]
```

**Step 3: Commit**

```bash
git add src/mocks/documents.js
git commit -m "feat: add mock pharma documents for testing"
```

---

## Task 3: Create Mock Data - Claims

**Files:**
- Create: `src/mocks/claims.js`

**Step 1: Create claims.js with all 8 types**

```javascript
export const CLAIM_TYPES = {
  efficacy: { label: 'Efficacy', color: '#2196F3', icon: 'activity' },
  safety: { label: 'Safety', color: '#D32F2F', icon: 'shield' },
  regulatory: { label: 'Regulatory', color: '#F57C00', icon: 'fileCheck' },
  comparative: { label: 'Comparative', color: '#7B1FA2', icon: 'gitCompare' },
  dosage: { label: 'Dosage', color: '#00897B', icon: 'pill' },
  ingredient: { label: 'Ingredient', color: '#388E3C', icon: 'flask' },
  testimonial: { label: 'Testimonial', color: '#C2185B', icon: 'quote' },
  pricing: { label: 'Pricing', color: '#616161', icon: 'dollarSign' }
}

export const MOCK_CLAIMS_BY_DOCUMENT = {
  doc_001: [
    {
      id: 'claim_001',
      text: 'Reduces cardiovascular events by 47% in clinical trials conducted over 24 weeks with 2,500 participants',
      confidence: 0.94,
      type: 'efficacy',
      source: 'core',
      status: 'pending',
      location: { paragraph: 3 }
    },
    {
      id: 'claim_002',
      text: 'FDA approved for adults 18 and older with established cardiovascular disease',
      confidence: 0.91,
      type: 'regulatory',
      source: 'core',
      status: 'pending',
      location: { paragraph: 4 }
    },
    {
      id: 'claim_003',
      text: 'The recommended dosage is 10mg once daily with food',
      confidence: 0.88,
      type: 'dosage',
      source: 'core',
      status: 'pending',
      location: { paragraph: 5 }
    },
    {
      id: 'claim_004',
      text: 'Each tablet contains 10mg of CardioMax active compound (cardiomaxinil)',
      confidence: 0.85,
      type: 'ingredient',
      source: 'core',
      status: 'pending',
      location: { paragraph: 6 }
    },
    {
      id: 'claim_005',
      text: 'Outperforms Lipitor by 23% in LDL reduction measures',
      confidence: 0.76,
      type: 'comparative',
      source: 'core',
      status: 'pending',
      location: { paragraph: 7 }
    },
    {
      id: 'claim_006',
      text: 'May cause mild side effects in approximately 8% of patients',
      confidence: 0.82,
      type: 'safety',
      source: 'core',
      status: 'pending',
      location: { paragraph: 9 }
    },
    {
      id: 'claim_007',
      text: '9 out of 10 of her patients showed improvement within 8 weeks',
      confidence: 0.58,
      type: 'testimonial',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 11 }
    },
    {
      id: 'claim_008',
      text: 'Clinically proven to improve cardiovascular health scores',
      confidence: 0.71,
      type: 'efficacy',
      source: 'core',
      status: 'pending',
      location: { paragraph: 12 }
    },
    {
      id: 'claim_009',
      text: 'CardioMax is priced competitively at $45 per month',
      confidence: 0.89,
      type: 'pricing',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 14 }
    },
    {
      id: 'claim_010',
      text: 'the most affordable branded cardiovascular treatment in its class',
      confidence: 0.67,
      type: 'pricing',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 14 }
    },
    {
      id: 'claim_011',
      text: '84% of participants reporting positive outcomes compared to 61% in the control group',
      confidence: 0.79,
      type: 'efficacy',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 8 }
    },
    {
      id: 'claim_012',
      text: 'No serious adverse events were attributed to the treatment',
      confidence: 0.86,
      type: 'safety',
      source: 'core',
      status: 'pending',
      location: { paragraph: 10 }
    }
  ],
  doc_002: [
    {
      id: 'claim_101',
      text: 'reduced anxiety symptoms by 62% compared to placebo',
      confidence: 0.92,
      type: 'efficacy',
      source: 'core',
      status: 'pending',
      location: { paragraph: 3 }
    },
    {
      id: 'claim_102',
      text: 'provides 24-hour anxiety relief with once-daily dosing',
      confidence: 0.87,
      type: 'efficacy',
      source: 'core',
      status: 'pending',
      location: { paragraph: 4 }
    },
    {
      id: 'claim_103',
      text: 'FDA approval in March 2024 for generalized anxiety disorder in adults',
      confidence: 0.95,
      type: 'regulatory',
      source: 'core',
      status: 'pending',
      location: { paragraph: 5 }
    },
    {
      id: 'claim_104',
      text: 'Less than 3% of patients experienced drowsiness',
      confidence: 0.84,
      type: 'safety',
      source: 'core',
      status: 'pending',
      location: { paragraph: 6 }
    },
    {
      id: 'claim_105',
      text: 'Start with 5mg daily for the first week, then increase to 10mg daily',
      confidence: 0.91,
      type: 'dosage',
      source: 'core',
      status: 'pending',
      location: { paragraph: 7 }
    },
    {
      id: 'claim_106',
      text: 'Contains no gluten, lactose, or artificial colors',
      confidence: 0.78,
      type: 'ingredient',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 8 }
    },
    {
      id: 'claim_107',
      text: 'works faster than leading competitors, with onset of action within 30 minutes',
      confidence: 0.73,
      type: 'comparative',
      source: 'core',
      status: 'pending',
      location: { paragraph: 9 }
    },
    {
      id: 'claim_108',
      text: '78% chose NeuroCalm over their previous anxiety medication',
      confidence: 0.69,
      type: 'comparative',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 9 }
    },
    {
      id: 'claim_109',
      text: 'Leading psychiatrists recommend NeuroCalm as a first-line treatment option',
      confidence: 0.55,
      type: 'testimonial',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 10 }
    },
    {
      id: 'claim_110',
      text: 'Available for $89 per month',
      confidence: 0.88,
      type: 'pricing',
      source: 'ai_discovered',
      status: 'pending',
      location: { paragraph: 11 }
    }
  ]
}

export const getClaimsForDocument = (docId) => MOCK_CLAIMS_BY_DOCUMENT[docId] || []

export const getCoreClaimsCount = (docId) => {
  const claims = getClaimsForDocument(docId)
  return claims.filter(c => c.source === 'core').length
}

export const getAIDiscoveredCount = (docId) => {
  const claims = getClaimsForDocument(docId)
  return claims.filter(c => c.source === 'ai_discovered').length
}
```

**Step 2: Commit**

```bash
git add src/mocks/claims.js
git commit -m "feat: add mock claims data with 8 types and source tracking"
```

---

## Task 4: Create ProgressRing Component

**Files:**
- Create: `src/components/claims-detector/ProgressRing.jsx`
- Create: `src/components/claims-detector/ProgressRing.module.css`

**Step 1: Create ProgressRing.jsx**

```jsx
import styles from './ProgressRing.module.css'

export default function ProgressRing({
  percentage = 0,
  size = 120,
  strokeWidth = 8,
  showComplete = false
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (percentage / 100) * circumference

  return (
    <div className={styles.progressRing} style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        {/* Background circle */}
        <circle
          className={styles.bgCircle}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          className={`${styles.progressCircle} ${showComplete ? styles.complete : ''}`}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className={styles.label}>
        {showComplete ? (
          <span className={styles.checkmark}>✓</span>
        ) : (
          <span className={styles.percentage}>{Math.round(percentage)}%</span>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Create ProgressRing.module.css**

```css
.progressRing {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.progressRing svg {
  transform: rotate(-90deg);
}

.bgCircle {
  fill: none;
  stroke: var(--color-border, #e0e0e0);
}

.progressCircle {
  fill: none;
  stroke: var(--color-primary, #2196F3);
  transition: stroke-dashoffset 0.1s ease-out;
  stroke-linecap: round;
}

.progressCircle.complete {
  stroke: var(--color-success, #4CAF50);
}

.label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.percentage {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--color-text-primary, #1a1a1a);
}

.checkmark {
  font-size: 2rem;
  color: var(--color-success, #4CAF50);
  animation: checkPop 0.3s ease-out;
}

@keyframes checkPop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
```

**Step 3: Commit**

```bash
git add src/components/claims-detector/ProgressRing.jsx src/components/claims-detector/ProgressRing.module.css
git commit -m "feat: add ProgressRing component for scan progress"
```

---

## Task 5: Create AIParticles Component

**Files:**
- Create: `src/components/claims-detector/AIParticles.jsx`
- Create: `src/components/claims-detector/AIParticles.module.css`

**Step 1: Create AIParticles.jsx**

```jsx
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import styles from './AIParticles.module.css'

export default function AIParticles({ scanLineY = 0, isActive = false }) {
  const [particles, setParticles] = useState([])

  useEffect(() => {
    if (!isActive) {
      setParticles([])
      return
    }

    const interval = setInterval(() => {
      const newParticle = {
        id: Date.now() + Math.random(),
        x: Math.random() * 100,
        y: scanLineY,
        size: 3 + Math.random() * 3,
        drift: (Math.random() - 0.5) * 20
      }

      setParticles(prev => [...prev.slice(-11), newParticle])
    }, 80)

    return () => clearInterval(interval)
  }, [isActive, scanLineY])

  return (
    <div className={styles.particleContainer}>
      <AnimatePresence>
        {particles.map(particle => (
          <motion.div
            key={particle.id}
            className={styles.particle}
            initial={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              opacity: 0.8,
              scale: 1
            }}
            animate={{
              top: `${particle.y - 15}%`,
              left: `${particle.x + particle.drift}%`,
              opacity: 0,
              scale: 0.5
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{
              width: particle.size,
              height: particle.size
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}
```

**Step 2: Create AIParticles.module.css**

```css
.particleContainer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.particle {
  position: absolute;
  background: var(--color-primary, #2196F3);
  border-radius: 50%;
  filter: blur(1px);
  box-shadow: 0 0 6px var(--color-primary, #2196F3);
}
```

**Step 3: Commit**

```bash
git add src/components/claims-detector/AIParticles.jsx src/components/claims-detector/AIParticles.module.css
git commit -m "feat: add AIParticles component for scan effect"
```

---

## Task 6: Create ScannerOverlay Component

**Files:**
- Create: `src/components/claims-detector/ScannerOverlay.jsx`
- Create: `src/components/claims-detector/ScannerOverlay.module.css`

**Step 1: Create ScannerOverlay.jsx**

```jsx
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import styles from './ScannerOverlay.module.css'
import ProgressRing from './ProgressRing'
import AIParticles from './AIParticles'

export default function ScannerOverlay({
  isScanning = false,
  onComplete,
  duration = 2500
}) {
  const [progress, setProgress] = useState(0)
  const [scanLineY, setScanLineY] = useState(0)
  const [showComplete, setShowComplete] = useState(false)

  useEffect(() => {
    if (!isScanning) {
      setProgress(0)
      setShowComplete(false)
      return
    }

    const startTime = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const newProgress = Math.min((elapsed / duration) * 100, 100)
      setProgress(newProgress)

      if (newProgress >= 100) {
        clearInterval(interval)
        setShowComplete(true)
        setTimeout(() => {
          onComplete?.()
        }, 600)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [isScanning, duration, onComplete])

  if (!isScanning && !showComplete) return null

  return (
    <div className={styles.overlay}>
      {/* Scan line */}
      {!showComplete && (
        <motion.div
          className={styles.scanLine}
          initial={{ top: '0%' }}
          animate={{ top: '100%' }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            ease: 'linear'
          }}
          onUpdate={(latest) => {
            const topValue = parseFloat(latest.top)
            setScanLineY(topValue)
          }}
        />
      )}

      {/* AI Particles */}
      <AIParticles scanLineY={scanLineY} isActive={isScanning && !showComplete} />

      {/* Progress Ring */}
      <div className={styles.progressContainer}>
        <ProgressRing
          percentage={progress}
          size={140}
          strokeWidth={10}
          showComplete={showComplete}
        />
        {!showComplete && (
          <p className={styles.statusText}>Analyzing document...</p>
        )}
        {showComplete && (
          <p className={styles.statusText}>Analysis complete</p>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Create ScannerOverlay.module.css**

```css
.overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.scanLine {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--color-primary, #2196F3) 20%,
    var(--color-primary, #2196F3) 80%,
    transparent 100%
  );
  box-shadow:
    0 0 10px var(--color-primary, #2196F3),
    0 0 20px var(--color-primary, #2196F3);
}

.progressContainer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md, 16px);
  z-index: 11;
}

.statusText {
  font-size: 0.875rem;
  color: var(--color-text-secondary, #666);
  margin: 0;
}
```

**Step 3: Commit**

```bash
git add src/components/claims-detector/ScannerOverlay.jsx src/components/claims-detector/ScannerOverlay.module.css
git commit -m "feat: add ScannerOverlay with scan line, particles, and progress"
```

---

## Task 7: Update DocumentViewer with Scanner and Enhanced Highlights

**Files:**
- Modify: `src/components/claims-detector/DocumentViewer.jsx`
- Modify: `src/components/claims-detector/DocumentViewer.module.css`

**Step 1: Update DocumentViewer.jsx imports and add scanner**

Replace the entire file:

```jsx
import { useRef, useEffect, useState } from 'react'
import styles from './DocumentViewer.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'
import ScannerOverlay from './ScannerOverlay'
import { CLAIM_TYPES } from '@/mocks/claims'

export default function DocumentViewer({
  document,
  claims = [],
  activeClaim,
  onClaimClick,
  isScanning = false,
  onScanComplete
}) {
  const contentRef = useRef(null)
  const [hoveredClaim, setHoveredClaim] = useState(null)

  useEffect(() => {
    if (activeClaim && contentRef.current) {
      const highlightEl = contentRef.current.querySelector(`[data-claim-id="${activeClaim}"]`)
      if (highlightEl) {
        highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [activeClaim])

  const getConfidenceClass = (confidence) => {
    if (confidence >= 0.8) return styles.confidenceHigh
    if (confidence >= 0.5) return styles.confidenceMedium
    return styles.confidenceLow
  }

  const renderHighlightedText = () => {
    if (!document) return ''
    if (claims.length === 0) return document.content

    let text = document.content
    const sortedClaims = [...claims].sort((a, b) => {
      const aIndex = text.indexOf(a.text)
      const bIndex = text.indexOf(b.text)
      return bIndex - aIndex
    })

    sortedClaims.forEach(claim => {
      const index = text.indexOf(claim.text)
      if (index !== -1) {
        const before = text.substring(0, index)
        const after = text.substring(index + claim.text.length)
        const isActive = activeClaim === claim.id
        const isHovered = hoveredClaim === claim.id
        const typeColor = CLAIM_TYPES[claim.type]?.color || '#666'

        const classes = [
          styles.highlight,
          getConfidenceClass(claim.confidence),
          isActive ? styles.activeHighlight : '',
          isHovered ? styles.hoveredHighlight : ''
        ].filter(Boolean).join(' ')

        text = `${before}<mark class="${classes}" data-claim-id="${claim.id}" data-claim-type="${claim.type}" style="--claim-color: ${typeColor}">${claim.text}</mark>${after}`
      }
    })

    return text
  }

  const handleTextClick = (e) => {
    const claimId = e.target.dataset?.claimId
    if (claimId) {
      onClaimClick?.(claimId)
    }
  }

  const handleTextHover = (e) => {
    const claimId = e.target.dataset?.claimId
    setHoveredClaim(claimId || null)
  }

  if (!document) {
    return (
      <div className={styles.documentViewer}>
        <div className={styles.emptyState}>
          <Icon name="file" size={48} />
          <h3>No Document</h3>
          <p>Upload a document to preview it here</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.documentViewer}>
      <div className={styles.header}>
        <div className={styles.fileInfo}>
          <Icon name="file" size={16} />
          <span className={styles.fileName}>{document.title}</span>
        </div>
        <div className={styles.toolbar}>
          <Button variant="ghost" size="small">
            <Icon name="zoomOut" size={14} />
          </Button>
          <span className={styles.zoom}>100%</span>
          <Button variant="ghost" size="small">
            <Icon name="zoomIn" size={14} />
          </Button>
        </div>
      </div>

      <div className={styles.contentWrapper}>
        <div
          className={styles.content}
          ref={contentRef}
        >
          <div
            className={styles.documentText}
            dangerouslySetInnerHTML={{ __html: renderHighlightedText() }}
            onClick={handleTextClick}
            onMouseOver={handleTextHover}
            onMouseOut={() => setHoveredClaim(null)}
          />
        </div>

        <ScannerOverlay
          isScanning={isScanning}
          onComplete={onScanComplete}
        />
      </div>

      {claims.length > 0 && (
        <div className={styles.footer}>
          <span className={styles.claimCount}>
            {claims.length} claims highlighted
          </span>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendHigh}`}></span>
              High
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendMedium}`}></span>
              Medium
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendLow}`}></span>
              Low
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Update DocumentViewer.module.css - add new highlight styles**

Add these styles to the existing file:

```css
.contentWrapper {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.highlight {
  background-color: color-mix(in srgb, var(--claim-color) 15%, transparent);
  border-left: 2px solid var(--claim-color);
  padding: 2px 4px;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.highlight.confidenceHigh {
  border-left-width: 3px;
}

.highlight.confidenceMedium {
  border-left-width: 2px;
}

.highlight.confidenceLow {
  border-left-width: 1px;
}

.highlight:hover,
.highlight.hoveredHighlight {
  background-color: color-mix(in srgb, var(--claim-color) 25%, transparent);
}

.highlight.activeHighlight {
  background-color: color-mix(in srgb, var(--claim-color) 30%, transparent);
  animation: highlightPulse 0.4s ease-out 0.3s;
}

@keyframes highlightPulse {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.01);
  }
}
```

**Step 3: Commit**

```bash
git add src/components/claims-detector/DocumentViewer.jsx src/components/claims-detector/DocumentViewer.module.css
git commit -m "feat: update DocumentViewer with scanner overlay and enhanced highlights"
```

---

## Task 8: Update ClaimCard with Source Badge

**Files:**
- Modify: `src/components/claims-detector/ClaimCard.jsx`
- Modify: `src/components/claims-detector/ClaimCard.module.css`

**Step 1: Update ClaimCard.jsx - add source badge and type colors**

Update the imports and add CLAIM_TYPES:

```jsx
import { useState } from 'react'
import styles from './ClaimCard.module.css'
import ProgressBar from '@/components/atoms/ProgressBar/ProgressBar'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import Badge from '@/components/atoms/Badge/Badge'
import { CLAIM_TYPES } from '@/mocks/claims'
```

Replace the TYPE_LABELS and TYPE_VARIANTS with dynamic lookup from CLAIM_TYPES:

```jsx
const getTypeConfig = (type) => CLAIM_TYPES[type] || { label: type, color: '#666', icon: 'help' }
```

In the component, update the badges section to include source:

```jsx
<div className={styles.badges}>
  {claim.type && (
    <Badge
      variant="neutral"
      size="small"
      style={{
        backgroundColor: `${getTypeConfig(claim.type).color}20`,
        color: getTypeConfig(claim.type).color,
        borderColor: getTypeConfig(claim.type).color
      }}
    >
      {getTypeConfig(claim.type).label}
    </Badge>
  )}
  <span className={`${styles.sourceBadge} ${claim.source === 'core' ? styles.sourceCore : styles.sourceAI}`}>
    {claim.source === 'core' ? 'Core' : 'AI Found'}
  </span>
  {claim.status !== 'pending' && (
    <Badge variant={claim.status === 'approved' ? 'success' : 'error'} size="small">
      {claim.status}
    </Badge>
  )}
</div>
```

**Step 2: Update ClaimCard.module.css - add source badge styles**

Add:

```css
.sourceBadge {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 4px;
}

.sourceCore {
  background: var(--color-primary, #2196F3);
  color: white;
}

.sourceAI {
  background: transparent;
  color: var(--color-text-secondary, #666);
  border: 1px dashed var(--color-border, #ccc);
}
```

**Step 3: Commit**

```bash
git add src/components/claims-detector/ClaimCard.jsx src/components/claims-detector/ClaimCard.module.css
git commit -m "feat: add source badge and dynamic type colors to ClaimCard"
```

---

## Task 9: Update App.jsx with Mock Data and New Stats

**Files:**
- Modify: `src/App.jsx`

**Step 1: Update imports**

Add at top of file:

```jsx
import { getRandomDocument } from '@/mocks/documents'
import { getClaimsForDocument, getCoreClaimsCount, getAIDiscoveredCount, CLAIM_TYPES } from '@/mocks/claims'
```

**Step 2: Update state and handlers**

Replace the relevant state and functions:

```jsx
// Replace uploadedFile state with document state
const [document, setDocument] = useState(null)

// Add type filter state
const [typeFilters, setTypeFilters] = useState([])
const [sourceFilter, setSourceFilter] = useState('all') // 'all' | 'core' | 'ai_discovered'

// Update handleFileUpload
const handleFileUpload = (file) => {
  const mockDoc = getRandomDocument()
  setDocument(mockDoc)
  setUploadState('complete')
  setAnalysisComplete(false)
  setClaims([])
  setActiveClaim(null)
}

// Update handleAnalyze - remove setTimeout content, scanner handles timing
const handleAnalyze = () => {
  if (!document || !selectedBrand) return
  setIsAnalyzing(true)
  setAnalysisComplete(false)
}

// Add handleScanComplete
const handleScanComplete = () => {
  const mockClaims = getClaimsForDocument(document.id)
  setClaims(mockClaims)
  setProcessingTime(2340)
  setIsAnalyzing(false)
  setAnalysisComplete(true)
}

// Update filteredClaims to include type and source filters
const filteredClaims = claims
  .filter(c => {
    if (claimFilter === 'all') return true
    return c.status === claimFilter
  })
  .filter(c => {
    if (typeFilters.length === 0) return true
    return typeFilters.includes(c.type)
  })
  .filter(c => {
    if (sourceFilter === 'all') return true
    return c.source === sourceFilter
  })
  .filter(c => {
    if (!searchQuery) return true
    return c.text.toLowerCase().includes(searchQuery.toLowerCase())
  })
  .sort((a, b) => b.confidence - a.confidence)

// Calculate stats
const coreClaimsFound = claims.filter(c => c.source === 'core').length
const totalCoreClaims = document?.coreClaims || 0
const aiDiscoveredCount = claims.filter(c => c.source === 'ai_discovered').length
```

**Step 3: Update DocumentViewer props**

```jsx
<DocumentViewer
  document={document}
  claims={claims}
  activeClaim={activeClaim}
  onClaimClick={handleClaimClick}
  isScanning={isAnalyzing}
  onScanComplete={handleScanComplete}
/>
```

**Step 4: Update Results Summary section**

Replace the statsGrid section:

```jsx
{analysisComplete && (
  <AccordionItem
    title="Results Summary"
    defaultOpen={true}
    size="small"
    content={
      <div className="resultsSummary">
        <div className="coreClaimsRow">
          <span className="resultLabel">Core Claims Found</span>
          <div className="resultValue">
            <span className="resultNumber">{coreClaimsFound} of {totalCoreClaims}</span>
            <div className="miniProgress">
              <div
                className="miniProgressBar"
                style={{ width: `${(coreClaimsFound / totalCoreClaims) * 100}%` }}
              />
            </div>
          </div>
        </div>
        <div className="aiDiscoveredRow">
          <span className="resultLabel">AI-Discovered</span>
          <span className="resultValue aiValue">+{aiDiscoveredCount} new</span>
        </div>
        <div className="divider" />
        <div className="statusRow">
          <StatCard label="Approved" value={approvedCount} size="small" trend={approvedCount > 0 ? 'up' : 'neutral'} />
          <StatCard label="Rejected" value={rejectedCount} size="small" trend={rejectedCount > 0 ? 'down' : 'neutral'} />
          <StatCard label="Pending" value={pendingCount} size="small" />
        </div>
        <div className="metaRow">
          <span className="metaItem">
            <Icon name="zap" size={14} />
            {(processingTime / 1000).toFixed(1)}s
          </span>
          <span className="metaDot">•</span>
          <span className="metaItem">{
            selectedModel === 'gemini-3' ? 'Gemini 3' :
            selectedModel === 'claude-opus' ? 'Claude Opus 4.5' : 'GPT-4o'
          }</span>
        </div>
      </div>
    }
  />
)}
```

**Step 5: Add type filter chips after status tabs**

```jsx
{analysisComplete && (
  <div className="typeFilters">
    {Object.entries(CLAIM_TYPES).map(([key, config]) => (
      <button
        key={key}
        className={`typeChip ${typeFilters.includes(key) ? 'active' : ''}`}
        style={{ '--chip-color': config.color }}
        onClick={() => {
          setTypeFilters(prev =>
            prev.includes(key)
              ? prev.filter(t => t !== key)
              : [...prev, key]
          )
        }}
      >
        {config.label}
      </button>
    ))}
    {typeFilters.length > 0 && (
      <button className="clearFilters" onClick={() => setTypeFilters([])}>
        Clear
      </button>
    )}
  </div>
)}
```

**Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat: integrate mock data, scanner, and new results summary"
```

---

## Task 10: Update App.css with New Styles

**Files:**
- Modify: `src/App.css`

**Step 1: Add results summary styles**

```css
.resultsSummary {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.coreClaimsRow,
.aiDiscoveredRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.resultLabel {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.resultValue {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.resultNumber {
  font-weight: 600;
  font-size: 0.875rem;
}

.miniProgress {
  width: 60px;
  height: 6px;
  background: var(--color-border);
  border-radius: 3px;
  overflow: hidden;
}

.miniProgressBar {
  height: 100%;
  background: var(--color-primary);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.aiValue {
  color: var(--color-success);
  font-weight: 600;
}

.divider {
  height: 1px;
  background: var(--color-border);
  margin: var(--spacing-xs) 0;
}

.statusRow {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacing-sm);
}

.metaRow {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-top: var(--spacing-xs);
}

.metaItem {
  display: flex;
  align-items: center;
  gap: 4px;
}

.metaDot {
  opacity: 0.5;
}

.typeFilters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) 0;
}

.typeChip {
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid var(--chip-color);
  background: transparent;
  color: var(--chip-color);
  cursor: pointer;
  transition: all 0.2s ease;
}

.typeChip:hover {
  background: color-mix(in srgb, var(--chip-color) 10%, transparent);
}

.typeChip.active {
  background: var(--chip-color);
  color: white;
}

.clearFilters {
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 12px;
  border: none;
  background: var(--color-border);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.clearFilters:hover {
  background: var(--color-text-secondary);
  color: white;
}
```

**Step 2: Commit**

```bash
git add src/App.css
git commit -m "feat: add styles for results summary and type filters"
```

---

## Task 11: Final Integration Test

**Step 1: Run dev server**

```bash
cd /Users/wallymo/claims_detector/.worktrees/mock-scanning-ui/app
npm run dev
```

**Step 2: Manual verification checklist**

- [ ] Upload any file → mock document loads
- [ ] Select brand → Analyze button enables
- [ ] Click Analyze → scanner animation plays
- [ ] Progress ring fills 0-100%
- [ ] Particles float up from scan line
- [ ] Checkmark appears on complete
- [ ] Claims appear in right panel
- [ ] Claims show Core/AI Found badges
- [ ] Type filter chips work
- [ ] Click claim card → document scrolls to highlight
- [ ] Results summary shows X of Y + model name
- [ ] Thumbs up/down work on pending claims

**Step 3: Build verification**

```bash
npm run build
```
Expected: Build succeeds with no errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete mock scanning UI implementation"
```

---

## Summary

| Task | Description | Estimated Time |
|------|-------------|----------------|
| 1 | Install Framer Motion | 2 min |
| 2 | Create mock documents | 5 min |
| 3 | Create mock claims | 5 min |
| 4 | Create ProgressRing | 5 min |
| 5 | Create AIParticles | 5 min |
| 6 | Create ScannerOverlay | 5 min |
| 7 | Update DocumentViewer | 10 min |
| 8 | Update ClaimCard | 5 min |
| 9 | Update App.jsx | 15 min |
| 10 | Update App.css | 5 min |
| 11 | Integration test | 10 min |

**Total: ~70 min**
