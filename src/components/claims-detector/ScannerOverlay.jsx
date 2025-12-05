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
