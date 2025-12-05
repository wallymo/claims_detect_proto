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
