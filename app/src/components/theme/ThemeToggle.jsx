import { useTheme } from './ThemeProvider'
import styles from './ThemeToggle.module.css'

/**
 * ThemeToggle - "Within" style toggle from toggles.dev
 * A sun/moon toggle that animates between light and dark modes
 */
export default function ThemeToggle({ className = '' }) {
  const { isDark, toggleTheme } = useTheme()

  return (
    <button
      className={`${styles.toggle} ${isDark ? styles.dark : styles.light} ${className}`}
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className={styles.track}>
        <span className={styles.thumb}>
          {/* Sun rays */}
          <span className={styles.sunRays}>
            <span className={styles.ray}></span>
            <span className={styles.ray}></span>
            <span className={styles.ray}></span>
            <span className={styles.ray}></span>
            <span className={styles.ray}></span>
            <span className={styles.ray}></span>
            <span className={styles.ray}></span>
            <span className={styles.ray}></span>
          </span>
          {/* Sun/moon body */}
          <span className={styles.body}></span>
          {/* Moon crater */}
          <span className={styles.crater}></span>
        </span>
      </span>
    </button>
  )
}
