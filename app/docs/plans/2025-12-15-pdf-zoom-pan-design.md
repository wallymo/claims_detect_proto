# PDF Viewer Zoom & Pan Design

## Problem

The current PDF viewer zoom controls scale the canvas larger/smaller but don't provide true zoom behavior. When zoomed in, there's no way to navigate around the document.

## Requirements

1. **True zoom** - Zoom into center of current view, not just scale the image
2. **Pan/drag** - When zoomed beyond viewport, click-and-drag to move around
3. **Crisp rendering** - Re-render PDF at zoom level (not CSS scale) for sharp text
4. **Maintain position** - Zooming in/out keeps you focused on the same area

## Design

### State Model

```javascript
const [scale, setScale] = useState(1.0)           // Zoom level (0.5 - 3.0)
const [panX, setPanX] = useState(0)               // Horizontal offset from center
const [panY, setPanY] = useState(0)               // Vertical offset from center
const [isDragging, setIsDragging] = useState(false)
const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
```

### Zoom Behavior

- Zoom range: 0.5x to 3.0x (increased from 2.0x for detail viewing)
- Steps: 0.25 increments
- On zoom change: Proportionally adjust pan position to maintain focus area
- Reset pan to (0, 0) when: new PDF loads, page changes, or canvas fits in container

```javascript
const handleZoomIn = () => {
  const newScale = Math.min(3, scale + 0.25)
  const ratio = newScale / scale
  setPanX(prev => clampPanX(prev * ratio, newScale))
  setPanY(prev => clampPanY(prev * ratio, newScale))
  setScale(newScale)
}
```

### Pan/Drag Interaction

- **Enable condition**: Canvas dimensions exceed container dimensions
- **Interaction**: Click and drag anywhere on the document
- **Bounds**: Clamped so document edge can't move past container edge

```javascript
const handleMouseDown = (e) => {
  if (!canPan) return
  setIsDragging(true)
  setDragStart({ x: e.clientX - panX, y: e.clientY - panY })
}

const handleMouseMove = (e) => {
  if (!isDragging) return
  const newPanX = e.clientX - dragStart.x
  const newPanY = e.clientY - dragStart.y
  setPanX(clamp(newPanX, minPanX, maxPanX))
  setPanY(clamp(newPanY, minPanY, maxPanY))
}

const handleMouseUp = () => setIsDragging(false)
```

### Bounds Calculation

```javascript
// Overflow = how much canvas exceeds container
const overflowX = Math.max(0, canvasWidth - containerWidth)
const overflowY = Math.max(0, canvasHeight - containerHeight)

// Pan limits (centered, so half in each direction)
const maxPanX = overflowX / 2
const minPanX = -overflowX / 2
const canPan = overflowX > 0 || overflowY > 0
```

### CSS Changes

```css
.pdfCanvas {
  transform: translate(var(--pan-x, 0px), var(--pan-y, 0px));
}

.content {
  overflow: hidden;
  cursor: default;
}

.content.canPan {
  cursor: grab;
}

.content.dragging {
  cursor: grabbing;
  user-select: none;
}
```

### Cursor Feedback

| State | Cursor |
|-------|--------|
| Can't pan (fits in view) | `default` |
| Can pan | `grab` |
| Currently dragging | `grabbing` |

### Edge Cases

- New PDF loaded → reset pan to (0, 0)
- Page changed → reset pan to (0, 0)
- Zoom out until fits → reset pan to (0, 0)
- Window resize → recalculate bounds, clamp pan to new limits

## Files Changed

- `src/components/mkg/PDFViewer.jsx` - Add pan state and handlers
- `src/components/mkg/PDFViewer.module.css` - Add cursor and overflow styles
