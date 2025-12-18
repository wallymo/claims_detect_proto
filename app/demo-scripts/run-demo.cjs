/**
 * Demo Runner - Executes YAML demo scripts with Playwright and OBS
 * Usage: node demo-scripts/run-demo.js demo-scripts/upload-and-analyze.yaml
 */

const { chromium } = require('playwright');
const OBSWebSocket = require('obs-websocket-js').default;
const yaml = require('yaml');
const fs = require('fs');
const path = require('path');

// Parse timing values like "800ms" or "1.5s" to milliseconds
function parseMs(value) {
  if (!value) return null;
  if (typeof value === 'number') return value;
  const str = String(value);
  const match = str.match(/^([\d.]+)(ms|s)?$/);
  if (!match) return parseInt(str) || null;
  const num = parseFloat(match[1]);
  return match[2] === 's' ? num * 1000 : num;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class DemoRunner {
  constructor() {
    this.obs = new OBSWebSocket();
    this.browser = null;
    this.page = null;
    this.obsConnected = false;
    this.outputDir = path.resolve('./recordings');
  }

  async connectOBS() {
    try {
      await this.obs.connect('ws://localhost:4455');
      this.obsConnected = true;
      console.log('✓ Connected to OBS');
    } catch (err) {
      console.warn('⚠ Could not connect to OBS:', err.message);
      console.warn('  Recording will be skipped. Make sure OBS is running with WebSocket enabled.');
    }
  }

  async startRecording() {
    if (!this.obsConnected) return;
    try {
      await this.obs.call('StartRecord');
      console.log('● Recording started');
    } catch (err) {
      console.warn('Could not start recording:', err.message);
    }
  }

  async stopRecording(scriptName) {
    if (!this.obsConnected) return null;
    try {
      const result = await this.obs.call('StopRecord');
      console.log('■ Recording stopped');

      // Move file to recordings directory with script name
      const obsPath = result.outputPath;
      if (obsPath && fs.existsSync(obsPath)) {
        // Ensure output dir exists
        if (!fs.existsSync(this.outputDir)) {
          fs.mkdirSync(this.outputDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safeName = scriptName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const newPath = path.join(this.outputDir, `${safeName}-${timestamp}.mp4`);

        // Wait a moment for OBS to finish writing
        await sleep(1000);
        fs.copyFileSync(obsPath, newPath);
        fs.unlinkSync(obsPath); // Remove original

        return newPath;
      }
      return obsPath;
    } catch (err) {
      console.warn('Could not stop recording:', err.message);
      return null;
    }
  }

  async zoomTo(x, y, scale, duration = 500) {
    if (!this.obsConnected) return;

    try {
      const { currentProgramSceneName } = await this.obs.call('GetCurrentProgramScene');
      const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneName: currentProgramSceneName });

      // Find browser or window capture source
      const browserSource = sceneItems.find(item =>
        item.sourceName.toLowerCase().includes('browser') ||
        item.sourceName.toLowerCase().includes('window') ||
        item.inputKind?.includes('capture')
      );

      if (!browserSource) {
        console.warn('No browser/window source found in OBS');
        return;
      }

      const steps = 15;
      const stepDuration = duration / steps;

      for (let i = 1; i <= steps; i++) {
        const t = 1 - Math.pow(1 - i / steps, 3); // easeOutCubic
        const currentScale = 1 + (scale - 1) * t;
        const posX = -(x * currentScale - 960);
        const posY = -(y * currentScale - 540);

        await this.obs.call('SetSceneItemTransform', {
          sceneName: currentProgramSceneName,
          sceneItemId: browserSource.sceneItemId,
          sceneItemTransform: {
            positionX: posX,
            positionY: posY,
            scaleX: currentScale,
            scaleY: currentScale
          }
        });
        await sleep(stepDuration);
      }
    } catch (err) {
      // Silently ignore zoom errors
    }
  }

  async resetZoom(duration = 400) {
    if (!this.obsConnected) return;

    try {
      const { currentProgramSceneName } = await this.obs.call('GetCurrentProgramScene');
      const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneName: currentProgramSceneName });

      const browserSource = sceneItems.find(item =>
        item.sourceName.toLowerCase().includes('browser') ||
        item.sourceName.toLowerCase().includes('window') ||
        item.inputKind?.includes('capture')
      );

      if (!browserSource) return;

      await this.obs.call('SetSceneItemTransform', {
        sceneName: currentProgramSceneName,
        sceneItemId: browserSource.sceneItemId,
        sceneItemTransform: {
          positionX: 0,
          positionY: 0,
          scaleX: 1,
          scaleY: 1
        }
      });
    } catch (err) {
      // Silently ignore
    }
  }

  async highlight(selector) {
    try {
      await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          const originalOutline = el.style.outline;
          const originalOffset = el.style.outlineOffset;
          el.style.outline = '3px solid #2196F3';
          el.style.outlineOffset = '3px';
          el.style.transition = 'outline 0.2s ease';
          setTimeout(() => {
            el.style.outline = originalOutline;
            el.style.outlineOffset = originalOffset;
          }, 1500);
        }
      }, selector);
    } catch (err) {
      // Ignore highlight errors
    }
  }

  async resolveTarget(target) {
    if (!target) return null;

    // CSS selectors pass through
    if (target.startsWith('#') || target.startsWith('.') || target.startsWith('[')) {
      return target;
    }

    // Try text-based selectors
    const textSelector = `text="${target}"`;
    const hasText = `button:has-text("${target}"), a:has-text("${target}"), [role="button"]:has-text("${target}")`;

    try {
      const el = await this.page.$(textSelector);
      if (el) return textSelector;
    } catch {}

    try {
      const el = await this.page.$(hasText);
      if (el) return hasText;
    } catch {}

    // Return as-is, let Playwright figure it out
    return `text="${target}"`;
  }

  async executeStep(step, timing) {
    const { action, target } = step;
    const selector = await this.resolveTarget(target);

    switch (action) {
      case 'click':
        if (step.highlight && selector) await this.highlight(selector);
        // Move mouse to element first (makes cursor visible)
        await this.page.hover(selector);
        await sleep(150);
        await this.page.click(selector);
        break;

      case 'type':
        await this.page.fill(selector, '');
        await this.page.type(selector, step.value, { delay: timing.action_time });
        break;

      case 'hover':
        await this.page.hover(selector);
        break;

      case 'scroll':
        if (selector) {
          await this.page.locator(selector).scrollIntoViewIfNeeded();
        }
        break;

      case 'wait':
        if (step.for) {
          await this.page.waitForSelector(step.for, {
            timeout: parseMs(step.timeout) || 5000,
            state: step.gone ? 'hidden' : 'visible'
          });
        }
        break;

      case 'pause':
        await sleep(parseMs(step.duration) || 1000);
        break;

      case 'focus':
        if (selector) {
          const element = await this.page.$(selector);
          if (element) {
            const box = await element.boundingBox();
            if (box) {
              const centerX = box.x + box.width / 2;
              const centerY = box.y + box.height / 2;
              await this.zoomTo(centerX, centerY, step.zoom || 1.5, parseMs(step.transition) || 500);
            }
          }
        }
        break;

      case 'reset':
        await this.resetZoom(parseMs(step.transition) || 400);
        break;

      default:
        console.warn(`Unknown action: ${action}`);
    }
  }

  async run(scriptPath) {
    // Load script
    const content = fs.readFileSync(scriptPath, 'utf8');
    const script = yaml.parse(content);

    console.log(`\n🎬 Starting demo: ${script.name}\n`);

    const timing = {
      think_time: parseMs(script.timing?.think_time) || 1000,
      action_time: parseMs(script.timing?.action_time) || 80,
      pause_after: parseMs(script.timing?.pause_after) || 800
    };

    try {
      // Connect to OBS
      await this.connectOBS();

      // Launch browser in kiosk mode (true fullscreen, no chrome UI)
      console.log('Launching browser in fullscreen...');
      this.browser = await chromium.launch({
        headless: false,
        args: [
          '--kiosk',
          '--disable-infobars',
          '--no-first-run',
          '--disable-translate',
          '--disable-features=TranslateUI'
        ]
      });

      const context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        hasTouch: false
      });
      this.page = await context.newPage();

      // Navigate
      console.log(`Navigating to ${script.url}`);
      await this.page.goto(script.url);
      await this.page.waitForLoadState('networkidle');

      // Wait for page to fully settle
      await sleep(1000);

      // Inject visible cursor overlay
      await this.page.evaluate(() => {
        const cursor = document.createElement('div');
        cursor.id = 'demo-cursor';
        cursor.style.cssText = `
          position: fixed;
          width: 20px;
          height: 20px;
          background: rgba(255, 100, 100, 0.8);
          border: 2px solid white;
          border-radius: 50%;
          pointer-events: none;
          z-index: 999999;
          transform: translate(-50%, -50%);
          transition: transform 0.1s ease, background 0.1s ease;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(cursor);

        // Track mouse movement
        document.addEventListener('mousemove', (e) => {
          cursor.style.left = e.clientX + 'px';
          cursor.style.top = e.clientY + 'px';
        });

        // Click animation
        document.addEventListener('mousedown', () => {
          cursor.style.transform = 'translate(-50%, -50%) scale(0.8)';
          cursor.style.background = 'rgba(255, 50, 50, 0.9)';
        });
        document.addEventListener('mouseup', () => {
          cursor.style.transform = 'translate(-50%, -50%) scale(1)';
          cursor.style.background = 'rgba(255, 100, 100, 0.8)';
        });
      });

      // Brief pause to settle
      await sleep(500);

      // Start recording
      await this.startRecording();
      await sleep(500);

      // Execute steps
      for (let i = 0; i < script.steps.length; i++) {
        const step = script.steps[i];
        const stepTiming = { ...timing };

        if (step.timing) {
          if (step.timing.think_time) stepTiming.think_time = parseMs(step.timing.think_time);
          if (step.timing.action_time) stepTiming.action_time = parseMs(step.timing.action_time);
          if (step.timing.pause_after) stepTiming.pause_after = parseMs(step.timing.pause_after);
        }

        const narration = step.narration ? ` - ${step.narration}` : '';
        console.log(`▶ Step ${i + 1}/${script.steps.length}: ${step.action}${narration}`);

        // Think time
        await sleep(stepTiming.think_time);

        // Execute
        await this.executeStep(step, stepTiming);

        // Pause after
        await sleep(stepTiming.pause_after);
      }

      // Wait 2 seconds after final action before stopping
      console.log('Finishing up...');
      await sleep(2000);

      // Stop recording
      const outputPath = await this.stopRecording(script.name);

      if (outputPath) {
        console.log(`\n✅ Recording saved to: ${outputPath}\n`);
      } else {
        console.log('\n✅ Demo completed\n');
      }

    } catch (err) {
      console.error('Error during demo:', err.message);
      await this.stopRecording(script.name || 'demo');
    } finally {
      if (this.browser) await this.browser.close();
      if (this.obsConnected) await this.obs.disconnect();
    }
  }
}

// Main
const scriptPath = process.argv[2];
if (!scriptPath) {
  console.log('Usage: node demo-scripts/run-demo.js <script.yaml>');
  console.log('Example: node demo-scripts/run-demo.js demo-scripts/upload-and-analyze.yaml');
  process.exit(1);
}

const runner = new DemoRunner();
runner.run(scriptPath);
