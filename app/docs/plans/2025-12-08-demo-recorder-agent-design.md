# Demo Recorder Agent Design

## Overview

An agent that performs automated UI actions based on user stories while recording via OBS Studio, producing professional demo videos for presentations.

## Requirements

| Requirement | Decision |
|-------------|----------|
| Target | Localhost web apps (prototypes) |
| Automation | Playwright (browser control) |
| Recording | OBS Studio via WebSocket API |
| Output | MP4 to `./recordings/` |
| Input | Hybrid (AI interprets user story + manual selector overrides) |
| Camera | Dynamic element focus (no pre-defined scenes) |

## Architecture

### Two-Phase Workflow

**Phase 1 - Script Generation (no recording)**
1. User provides user story (natural language + optional selector hints)
2. Agent launches browser, navigates to localhost URL
3. Agent analyzes page DOM to identify interactive elements
4. Agent generates YAML script with actions, selectors, suggested delays
5. User reviews/edits the script
6. User approves script

**Phase 2 - Recording Execution**
1. Agent starts OBS recording via WebSocket
2. Agent executes approved script step-by-step
3. Actions include configurable delays and camera movements
4. Agent stops OBS recording
5. Video saved to `./recordings/<story-name>-<timestamp>.mp4`

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Demo Recorder Agent                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Phase 1    │───▶│   Phase 2    │───▶│   Output     │      │
│  │   Planning   │    │   Recording  │    │   Manager    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Playwright  │    │  OBS Control │    │  ./recordings│      │
│  │  (DOM scan)  │    │  (WebSocket) │    │  /<name>.mp4 │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                             │                                   │
│                             ▼                                   │
│                      ┌──────────────┐                          │
│                      │ Zoom Engine  │                          │
│                      │ (coordinate  │                          │
│                      │  transform)  │                          │
│                      └──────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Technology | Responsibility |
|-----------|------------|----------------|
| Planning Engine | Claude + Playwright | Parse user story, scan DOM, generate YAML script |
| Script Validator | Node.js | Validate YAML, resolve natural language targets to selectors |
| OBS Controller | obs-websocket-js | Start/stop recording, apply zoom transforms |
| Zoom Engine | Custom JS | Translate element coords to OBS source transforms |
| Execution Engine | Playwright | Execute clicks, typing, waits with timing control |
| Output Manager | Node.js | Save to `./recordings/`, naming convention |

### Dependencies

- `playwright` - Browser automation
- `obs-websocket-js` - OBS WebSocket client
- `yaml` - Script parsing

## Script Format

```yaml
name: "Upload and Analyze Document"
url: "http://localhost:5173"
output: "./recordings/"

timing:
  think_time: 800ms
  action_time: 100ms
  pause_after: 500ms

steps:
  - narration: "User uploads a pharmaceutical document"
    action: click
    target: "[data-testid='upload-button']"

  - action: type
    target: "file input"
    value: "./samples/pharma-doc.pdf"
    timing:
      action_time: 50ms

  - action: wait
    for: "[data-testid='analysis-complete']"
    timeout: 5000ms

  - narration: "Zoom in on the detected claims"
    action: focus
    target: ".claims-panel"
    zoom: 1.5
    transition: "ease-out 600ms"

  - action: click
    target: "first claim card"
    highlight: true
```

## Action Types

### Navigation & Interaction

| Action | Description |
|--------|-------------|
| `click` | Click an element |
| `double_click` | Double-click |
| `right_click` | Context menu |
| `type` | Type text with realistic speed |
| `scroll` | Scroll to element or by amount |
| `hover` | Hover without clicking |
| `drag` | Drag and drop |
| `select` | Dropdown selection |

### Camera & Focus

| Action | Description |
|--------|-------------|
| `focus` | Zoom into element |
| `pan` | Move viewport without zoom |
| `reset` | Return to full page view |
| `follow` | Camera follows cursor |

### Visual Highlights

| Effect | Description |
|--------|-------------|
| `highlight` | Glow/outline element |
| `cursor_emphasis` | Enlarged/styled cursor |
| `annotate` | Temporary label overlay |
| `fade_others` | Dim everything except target |

### Timing & Flow

| Action | Description |
|--------|-------------|
| `pause` | Wait fixed time |
| `wait` | Wait for element/condition |
| `step_marker` | Visual "Step N of M" overlay |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Element not found | Pause, prompt for new selector or skip |
| OBS not running | Detect before Phase 2, prompt user |
| OBS connection lost | Save partial recording, log last step |
| Page load timeout | Retry once, then prompt |
| Unexpected popup | Pause, screenshot, ask user |

Agent saves script state for resume capability on failure.

## Output

- Location: `./recordings/<story-name>-<timestamp>.mp4`
- Format: MP4 (OBS default)
- Naming: Derived from script `name` field + ISO timestamp
