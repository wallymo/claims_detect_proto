import { useState } from 'react'
import styles from './Tabs.module.css'

export default function Tabs({
  tabs = [
    { label: 'Tab 1', content: 'Content for Tab 1' },
    { label: 'Tab 2', content: 'Content for Tab 2' },
    { label: 'Tab 3', content: 'Content for Tab 3' }
  ],
  variant = 'underlined',
  size = 'medium',
  orientation = 'horizontal',
  defaultActiveIndex = 0,
  onChange,
  className
}) {
  const [activeIndex, setActiveIndex] = useState(defaultActiveIndex)

  const handleTabChange = (index) => {
    setActiveIndex(index)
    onChange?.(index)
  }

  const combinedClassName = [
    styles.tabs,
    styles[variant],
    styles[size],
    styles[orientation],
    className
  ].filter(Boolean).join(' ')

  const handleKeyDown = (event, index) => {
    const lastIndex = tabs.length - 1

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      handleTabChange(index === lastIndex ? 0 : index + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      handleTabChange(index === 0 ? lastIndex : index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      handleTabChange(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      handleTabChange(lastIndex)
    }
  }

  return (
    <div className={combinedClassName}>
      <div className={styles.tabList} role="tablist" aria-orientation={orientation}>
        {tabs.map((tab, index) => (
          <button
            key={index}
            className={`${styles.tab} ${index === activeIndex ? styles.active : ''}`}
            onClick={() => handleTabChange(index)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            role="tab"
            aria-selected={index === activeIndex}
            aria-controls={`panel-${index}`}
            id={`tab-${index}`}
            tabIndex={index === activeIndex ? 0 : -1}
          >
            {tab.icon && <span className={styles.icon}>{tab.icon}</span>}
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.panelContainer}>
        {tabs.map((tab, index) => (
          <div
            key={index}
            className={`${styles.panel} ${index === activeIndex ? styles.activePanel : ''}`}
            role="tabpanel"
            id={`panel-${index}`}
            aria-labelledby={`tab-${index}`}
            hidden={index !== activeIndex}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  )
}
