import styles from './StatCard.module.css'
import Icon from '@/components/atoms/Icon/Icon'

export default function StatCard({
  label = 'Total Users',
  value = '12,345',
  trend,
  trendValue,
  layout = 'vertical',
  size = 'medium',
  className
}) {
  const combinedClassName = [
    styles.statCard,
    styles[layout],
    styles[size],
    className
  ].filter(Boolean).join(' ')

  const getTrendIcon = () => {
    if (trend === 'up') return 'arrowUp'
    if (trend === 'down') return 'arrowDown'
    return null
  }

  const getTrendClass = () => {
    if (trend === 'up') return styles.trendUp
    if (trend === 'down') return styles.trendDown
    return styles.trendNeutral
  }

  return (
    <div className={combinedClassName}>
      <div className={styles.label}>{label}</div>
      <div className={styles.valueRow}>
        <div className={styles.value}>{value}</div>
        {trend && trendValue && (
          <div className={`${styles.trend} ${getTrendClass()}`}>
            {getTrendIcon() && (
              <Icon name={getTrendIcon()} size={size === 'small' ? 12 : 14} />
            )}
            <span>{trendValue}</span>
          </div>
        )}
      </div>
    </div>
  )
}
