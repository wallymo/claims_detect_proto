(function() {
  let active = false;
  let overlay = null;
  let tooltip = null;

  // Listen for "G" to toggle debug overlay
  window.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'g') {
      if (active) {
        if (overlay) overlay.remove();
        if (tooltip) tooltip.remove();
        active = false;
        return;
      }
      activateDebug();
    }
  });

  function activateDebug() {
    const canvas = document.getElementById('board');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Create red overlay
    overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.top = rect.top + window.scrollY + 'px';
    overlay.style.left = rect.left + window.scrollX + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.background = 'rgba(255,0,0,0.25)';
    overlay.style.cursor = 'crosshair';
    overlay.style.zIndex = 9999;
    overlay.style.border = '1px solid rgba(255,255,255,0.3)';
    document.body.appendChild(overlay);

    // Create tooltip
    tooltip = document.createElement('div');
    Object.assign(tooltip.style, {
      position: 'fixed',
      background: 'rgba(0,0,0,0.8)',
      color: '#fff',
      padding: '4px 8px',
      borderRadius: '6px',
      fontSize: '12px',
      pointerEvents: 'none',
      opacity: 0,
      transition: 'opacity 0.2s ease',
      zIndex: 10000
    });
    document.body.appendChild(tooltip);

    active = true;

    overlay.addEventListener('click', e => {
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const xPct = ((clickX / rect.width) * 100).toFixed(2);
      const yPct = ((clickY / rect.height) * 100).toFixed(2);

      const activeId = window.activeId || (window.selectedCard?.dataset?.id);
      let estimatedX = 'N/A';
      let estimatedY = 'N/A';

      // Attempt to find active issue or pin coordinates
      if (window.dots && window.activeId && window.dots[window.activeId]) {
        estimatedX = ((window.dots[window.activeId].x / rect.width) * 100).toFixed(2);
        estimatedY = ((window.dots[window.activeId].y / rect.height) * 100).toFixed(2);
      } else if (Array.isArray(window.issues)) {
        const activeIssue = window.issues.find(i => i.id === window.activeId);
        if (activeIssue && activeIssue.position) {
          estimatedX = activeIssue.position.x;
          estimatedY = activeIssue.position.y;
        }
      }

      const text = `Estimated coordinates: (${estimatedX}%, ${estimatedY}%)\nPreferred coordinates: (${xPct}%, ${yPct}%)`;
      navigator.clipboard.writeText(text).then(() => {
        showTooltip(e.clientX, e.clientY, 'Coordinates copied');
      });
    });
  }

  function showTooltip(x, y, msg) {
    tooltip.textContent = msg;
    tooltip.style.left = x + 10 + 'px';
    tooltip.style.top = y - 10 + 'px';
    tooltip.style.opacity = 1;
    setTimeout(() => { tooltip.style.opacity = 0; }, 1200);
  }
})();