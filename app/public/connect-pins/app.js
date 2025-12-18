/* ---------------- Basics ---------------- */
// Feedback issues data. Positions are percentages of the image (0–100).
const ISSUE_TYPES = ['Grammar','Style','Clarity','Consistency','Punctuation','Spelling','Tone','Reference','Layout','Link','Accessibility','Terminology','Formatting','Duplication','Numbering'];
let issues = [];

fetch('issues.json')
  .then(res => res.json())
  .then(data => {
    issues = data;
    window.issues = issues;
    buildCards();
    computeDotsFromAnnotations();
    redraw();
  })
  .catch(err => console.error('Error loading issues:', err));

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const connectorSVG = document.getElementById('connector');
const cardsContainer = document.getElementById('cards');
const app = document.querySelector('.app');
let cards = [];

let DPR = window.devicePixelRatio || 1;
const DOT_SIZE = 30;
const R = DOT_SIZE / 2;
const bgImage = new Image();
bgImage.src = 'screenshot.png';
bgImage.onload = () => console.log('Image loaded:', bgImage.src);
bgImage.onerror = () => console.error('Failed to load image:', bgImage.src);window.bgImage = bgImage;
function fitCanvas(){
  const rect = stage.getBoundingClientRect();
  const appRect = app.getBoundingClientRect();
  // Width matches stage viewport width
  const cssW = rect.width;
  // If the image is loaded, compute scaled height; otherwise fall back to viewport height
  const scale = (bgImage && bgImage.naturalWidth) ? (cssW / bgImage.naturalWidth) : 1;
  const cssH = (bgImage && bgImage.naturalHeight) ? (bgImage.naturalHeight * scale) : rect.height;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.floor(cssW * DPR);
  canvas.height = Math.floor(cssH * DPR);
  // The connector spans the full app size
  connectorSVG.setAttribute('viewBox', `0 0 ${appRect.width} ${appRect.height}`);
  connectorSVG.setAttribute('width', appRect.width);
  connectorSVG.setAttribute('height', appRect.height);
}
fitCanvas();
window.addEventListener('resize', ()=>{
  fitCanvas();
  if (bgImage.complete) { layoutImage(); computeDotsFromAnnotations(); }
  redraw();
  requestAnimationFrame(()=>placeConnector(activeId));
});

// --- Load background image for canvas
// const bgImage = new Image();
// bgImage.src = 'screenshots.png';
let imgDraw = { x: 0, y: 0, w: 0, h: 0 }; // where the image is drawn within the canvas

function layoutImage() {
  const rect = stage.getBoundingClientRect();
  const canvasW = rect.width;
  // scale to 100% width; height will be computed by fitCanvas
  const scale = canvasW / (bgImage.naturalWidth || 1);
  const drawW = canvasW;
  const drawH = (bgImage.naturalHeight || 1) * scale;
  imgDraw = { x: 0, y: 0, w: drawW, h: drawH };
}

bgImage.onload = () => {
  layoutImage();
  fitCanvas();
  if (issues && issues.length) { buildCards(); computeDotsFromAnnotations(); }
  redraw();
};

function scrollDotIntoView(id){
  const d = dots[id];
  if(!d) return;
  const viewTop = stage.scrollTop;
  const viewBottom = viewTop + stage.clientHeight;
  const margin = 48; // keep some breathing room
  const dotTop = d.y - R;
  const dotBottom = d.y + R;

  // If already comfortably visible, do nothing
  if(dotTop >= viewTop + margin && dotBottom <= viewBottom - margin) return;

  const maxScroll = Math.max(0, stage.scrollHeight - stage.clientHeight);
  // Aim to center the dot
  let target = d.y - stage.clientHeight / 2;
  if(target < 0) target = 0;
  if(target > maxScroll) target = maxScroll;

  stage.scrollTo({ top: target, behavior: 'smooth' });
}

function scrollIssueIntoTop(id){
  const panelEl = document.getElementById('panel');
  const cardEl = cards.find(c => c.dataset.id===id);
  if(!cardEl) return;
  const top = cardEl.offsetTop; // offset within the panel scroll container
  panelEl.scrollTo({ top, behavior: 'smooth' });
}

function buildCards(){
  cardsContainer.innerHTML = '';
  issues.forEach(a => {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = a.id;
    const sevColor = severityColor(a.severity);
    el.innerHTML = `
      <div class="hdr">
        <div class="badge">${a.id}</div>
        <div class="type">${a.type}</div>
        <div class="sev" style="background:${sevColor};">${a.severity}</div>
      </div>
      <div class="body">
        <span class="label">Issue</span>
        <div class="issue-txt">${a.body.issue}</div>
        <div class="extra">
          <span class="label">Reasoning</span>
          <div class="reason-txt">${a.body.reasoning}</div>
          <span class="label">Recommendation</span>
          <div class="rec-txt">${a.body.recommendation}</div>
        </div>
      </div>
      <div class="actions">
        <div class="btn" title="Dismiss">
          <svg class="icon" viewBox="0 0 24 24"><path fill="currentColor" d="M6 6l12 12M18 6L6 18"/></svg>
        </div>
        <div class="btn" title="Approve">
          <svg class="icon" viewBox="0 0 24 24"><path fill="currentColor" d="M20 6l-11 11L4 12"/></svg>
        </div>
        <div class="link more">More</div>
      </div>
    `;
    cardsContainer.appendChild(el);
  });
  cards = [...cardsContainer.querySelectorAll('.card')];
  // attach interactions
  cards.forEach(card=>{
    card.addEventListener('click', ()=>{
      activeId = card.dataset.id;
      window.activeId = activeId;
      scrollDotIntoView(activeId);
      redraw();
      placeConnector(activeId);
    });
    const more = card.querySelector('.more');
    more.addEventListener('click', (e)=>{
      e.stopPropagation();
      card.classList.toggle('expanded');
      cards.forEach(c => c.classList.toggle('selected', c.dataset.id===activeId));
      placeConnector(activeId);
    });
  });
}
function pickDotAt(x, y){
  // x, y are in stage viewport coordinates; convert to canvas content coordinates
  const sRect = stage.getBoundingClientRect();
  const cx = x - sRect.left;
  const cy = (y - sRect.top) + stage.scrollTop;
  let best = null, bestDist = Infinity;
  issues.forEach(a=>{
    const d = dots[a.id]; if(!d) return;
    const dist = Math.hypot(d.x - cx, d.y - cy);
    if(dist < bestDist){ best = a.id; bestDist = dist; }
  });
  // Consider a hit if within the dot radius + 6px tolerance
  return (bestDist <= R + 6) ? best : null;
}

/* ---------------- Dots ---------------- */
let dots = {}; // id -> {x,y,type,severity}

function computeDotsFromAnnotations(){
  dots = {};
  issues.forEach(a=>{
    const x = imgDraw.x + (a.position.x/100) * imgDraw.w;
    const y = imgDraw.y + (a.position.y/100) * imgDraw.h;
    dots[a.id] = { x, y, type: a.type, severity: a.severity };
  });
  window.dots = dots;
}

/* ---------------- Drawing ---------------- */
let activeId = null;

function colorHex(c){
  const s = getComputedStyle(document.documentElement);
  if(c==='red') return s.getPropertyValue('--red').trim();
  if(c==='blue') return s.getPropertyValue('--blue').trim();
  return s.getPropertyValue('--green').trim();
}
function severityColor(sev){
  // 1 = blue, 10 = red
  const hue = 210 - (210 * ((sev-1)/9)); // 210 -> 0
  return `hsl(${Math.max(0,Math.min(210,hue))} 85% 58%)`;
}

function redraw(){
  const W = canvas.width / DPR, H = canvas.height / DPR;

  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,W,H);

  if (bgImage.complete && bgImage.naturalWidth) {
    ctx.drawImage(bgImage, imgDraw.x * DPR, imgDraw.y * DPR, imgDraw.w * DPR, imgDraw.h * DPR);
  }

  issues.forEach(a=>{
    const d = dots[a.id]; if(!d) return;
    const fill = severityColor(a.severity);
    ctx.save();
    if(activeId===a.id){ ctx.shadowColor='rgba(90,170,255,.8)'; ctx.shadowBlur=22; }
    ctx.beginPath(); ctx.arc(d.x, d.y, R, 0, Math.PI*2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.stroke();
    ctx.restore();
  });
}

/* ---------------- Four-corner connector ---------------- */
/*
  Geometry
  - Wide end attaches to the selected card’s left edge, spanning almost the card height.
  - Narrow end sits tangent to the circle and uses the line to the card as axis.
  - Points order: cardTop -> cardBottom -> tipLower -> tipUpper
*/
function placeConnector(id){
  connectorSVG.innerHTML = '';
  cards.forEach(c => c.classList.toggle('selected', c.dataset.id===id));
  if(!id) return;

  const dot = dots[id];
  if(!dot) return;

  const cardEl = cards.find(c => c.dataset.id===id);
  const sRect = stage.getBoundingClientRect();
  const cRect = cardEl.getBoundingClientRect();
  const aRect = app.getBoundingClientRect();

  // Compute card coordinates relative to app
  const cardLeftX = cRect.left - aRect.left;
  const cardTopLeft    = { x: cardLeftX, y: cRect.top    - aRect.top };
  const cardBottomLeft = { x: cardLeftX, y: cRect.bottom - aRect.top };

  // Compute dot anchor points relative to app, account for stage scroll
  const dotScreenX = (sRect.left - aRect.left) + dot.x;
  const dotScreenY = (sRect.top  - aRect.top)  + (dot.y - stage.scrollTop);
  const dotTopMid    = { x: dotScreenX, y: dotScreenY - R };
  const dotBottomMid = { x: dotScreenX, y: dotScreenY + R };

  // Build polygon in clockwise order: top-left -> bottom-left -> bottom-mid -> top-mid
  const path = `M ${cardTopLeft.x},${cardTopLeft.y}
                L ${cardBottomLeft.x},${cardBottomLeft.y}
                L ${dotBottomMid.x},${dotBottomMid.y}
                L ${dotTopMid.x},${dotTopMid.y}
                Z`;

  // Gradient that fades toward the dot
  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  const grad = document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
  grad.setAttribute('id','fade');
  grad.setAttribute('gradientUnits','userSpaceOnUse');
  // From card edge mid to dot center
  const cardMidY = (cardTopLeft.y + cardBottomLeft.y) / 2;
  grad.setAttribute('x1', cardTopLeft.x); grad.setAttribute('y1', cardMidY);
  grad.setAttribute('x2', dotScreenX);    grad.setAttribute('y2', dotScreenY);
  const s1 = document.createElementNS('http://www.w3.org/2000/svg','stop');
  s1.setAttribute('offset','0%');  s1.setAttribute('stop-color','#ffffff'); s1.setAttribute('stop-opacity','0.9');
  const s2 = document.createElementNS('http://www.w3.org/2000/svg','stop');
  s2.setAttribute('offset','100%'); s2.setAttribute('stop-color','#ffffff'); s2.setAttribute('stop-opacity','0.28');
  grad.appendChild(s1); grad.appendChild(s2);
  defs.appendChild(grad);

  const poly = document.createElementNS('http://www.w3.org/2000/svg','path');
  poly.setAttribute('d', path);
  poly.setAttribute('fill','url(#fade)');
  poly.setAttribute('stroke','rgba(255,255,255,0.18)');
  poly.setAttribute('stroke-width','1.5');
  poly.setAttribute('stroke-linejoin','round');
  poly.setAttribute('stroke-linecap','round');

  // Soft shadow for realism
  const flt = document.createElementNS('http://www.w3.org/2000/svg','filter');
  flt.setAttribute('id','shadow');
  flt.innerHTML = `
    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="black" flood-opacity="0.35"/>
  `;
  defs.appendChild(flt);
  poly.setAttribute('filter','url(#shadow)');

  connectorSVG.appendChild(defs);
  connectorSVG.appendChild(poly);
}

/* ---------------- Interactions ---------------- */
// Cards interactions handled in buildCards()

window.addEventListener('keydown', e=>{
  if(e.key.toLowerCase()==='r'){
    activeId = null;
    cards.forEach(c=>c.classList.remove('selected'));
    connectorSVG.innerHTML='';
    redraw();
  }
});

window.addEventListener('load', ()=>{
  fitCanvas();
  if (bgImage.complete) { layoutImage(); computeDotsFromAnnotations(); buildCards(); }
  redraw();
});

let rafConn = null;
stage.addEventListener('scroll', ()=>{
  if (rafConn) return;
  rafConn = requestAnimationFrame(()=>{
    rafConn = null;
    placeConnector(activeId);
  });
}, { passive: true });
window.addEventListener('scroll', ()=>{ placeConnector(activeId); }, { passive: true });

const panelEl = document.getElementById('panel');
panelEl.addEventListener('scroll', ()=>{ placeConnector(activeId); }, { passive: true });

canvas.addEventListener('click', (e)=>{
  const id = pickDotAt(e.clientX, e.clientY);
  if(!id) return;
  activeId = id;
  window.activeId = activeId;

  // Make sure the dot is visible on the left
  scrollDotIntoView(activeId);

  // Select the corresponding card on the right
  cards.forEach(c => c.classList.toggle('selected', c.dataset.id===id));

  // Scroll the issue list so the selected issue lands at the top
  scrollIssueIntoTop(id);

  // Draw/update the connector
  placeConnector(activeId);
});

// Change cursor to pointer when hovering a clickable dot
canvas.addEventListener('mousemove', (e)=>{
  const id = pickDotAt(e.clientX, e.clientY);
  canvas.style.cursor = id ? 'pointer' : 'default';
});
// Reset on leave
canvas.addEventListener('mouseleave', ()=>{
  canvas.style.cursor = 'default';
});

// Expose for debug/tools
window.computeDotsFromAnnotations = computeDotsFromAnnotations;
window.redraw = redraw;
window.placeConnector = placeConnector;
window.scrollDotIntoView = scrollDotIntoView;
window.scrollIssueIntoTop = scrollIssueIntoTop;
window.getImgDraw = () => ({...imgDraw});
window.getStageRect = () => stage.getBoundingClientRect();
window.getAppRect = () => app.getBoundingClientRect();
window.getActiveId = () => activeId;