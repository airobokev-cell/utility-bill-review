/**
 * Interactive Roof Panel Designer
 * Uses Konva.js to overlay draggable solar panels on a satellite roof image.
 */
(function () {
  'use strict';

  // ── Panel dimensions ──────────────────────────────────────────────
  // Standard residential panel: ~1.7m x 1.0m
  // At Google Maps zoom 20, ~0.15m/px → panel ≈ 11x7px (too small)
  // We use zoom 20 with scaled panels for usability
  const PANEL_W = 22;  // px width (long edge)
  const PANEL_H = 13;  // px height (short edge)
  const PANEL_GAP = 3; // px gap between panels
  const PANEL_COLOR = 'rgba(59, 130, 246, 0.55)';
  const PANEL_STROKE = 'rgba(59, 130, 246, 0.9)';
  const PANEL_SELECTED_COLOR = 'rgba(251, 191, 36, 0.6)';
  const PANEL_SELECTED_STROKE = 'rgba(245, 158, 11, 1)';
  const PANEL_WATTAGE = 0.4; // kW per panel

  let stage, bgLayer, panelLayer;
  let selectedPanel = null;
  let initialPanelPositions = [];
  let config = {};
  let stageWidth = 640;
  let stageHeight = 640;

  // ── Public entry point ────────────────────────────────────────────
  window.initPanelDesigner = function (container, opts) {
    config = opts;
    const productionPerKw = config.annualProductionKwh / config.systemSizeKw;

    // Build the DOM structure
    container.innerHTML = `
      <div class="designer-header">
        <h2>Your Roof Panel Layout</h2>
        <p class="designer-subtitle">Drag panels to adjust placement. Add or remove panels to see how it affects your system.</p>
        <div class="designer-metrics">
          <div class="metric-card">
            <div class="metric-label">Panels</div>
            <div class="metric-value" id="dm-panels">${config.panelCount}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">System Size</div>
            <div class="metric-value" id="dm-size">${config.systemSizeKw.toFixed(1)} <span class="metric-unit">kW</span></div>
          </div>
          <div class="metric-card highlight">
            <div class="metric-label">Est. Annual Production</div>
            <div class="metric-value" id="dm-production">${formatNum(config.annualProductionKwh)} <span class="metric-unit">kWh</span></div>
          </div>
        </div>
      </div>
      <div class="designer-toolbar">
        <button id="pd-add" type="button" class="primary">+ Add Panel</button>
        <button id="pd-remove" type="button" class="danger" disabled>- Remove Selected</button>
        <button id="pd-reset" type="button">Reset Layout</button>
        <span class="panel-selected-info" id="pd-sel-info">Panel selected — drag to move</span>
        <span class="spacer"></span>
        <button id="pd-save" type="button" class="success">Save Design</button>
      </div>
      <div class="designer-canvas-container" id="pd-canvas-wrap">
        <div class="loading-overlay" id="pd-loading">
          <div class="spinner-sm"></div>
          Loading satellite image...
        </div>
        <div id="pd-canvas"></div>
      </div>
      <div class="designer-footer">
        <span class="tip-icon">&#128161;</span>
        <div>
          <p>Click a panel to select it, then drag to reposition. Use the buttons above to add or remove panels.</p>
          <p class="disclaimer">Approximate layout for visualization. Final design requires a site survey.</p>
        </div>
      </div>
    `;

    // Responsive width
    stageWidth = Math.min(640, container.clientWidth);
    stageHeight = stageWidth; // square

    // Init Konva
    stage = new Konva.Stage({
      container: 'pd-canvas',
      width: stageWidth,
      height: stageHeight,
    });

    bgLayer = new Konva.Layer();
    panelLayer = new Konva.Layer();
    stage.add(bgLayer);
    stage.add(panelLayer);

    // Click on empty space to deselect
    stage.on('click tap', function (e) {
      if (e.target === stage || e.target.getLayer() === bgLayer) {
        deselectAll();
      }
    });

    // Load satellite image
    loadSatelliteImage().then(() => {
      document.getElementById('pd-loading').style.display = 'none';
      placeSuggestedPanels();
      saveInitialPositions();
      updateMetrics();
    }).catch((err) => {
      console.error('Failed to load satellite image:', err);
      // Draw a grid placeholder background
      drawPlaceholderBg();
      document.getElementById('pd-loading').innerHTML =
        '<div style="text-align:center;line-height:1.6;">' +
        '<div style="font-size:16px;margin-bottom:4px;">Satellite image unavailable</div>' +
        '<div style="font-size:12px;opacity:0.7;">Enable Maps Static API in Google Cloud Console for roof imagery.<br>Panels are placed on a grid for now.</div>' +
        '</div>';
      placeSuggestedPanels();
      saveInitialPositions();
      updateMetrics();
      setTimeout(() => { document.getElementById('pd-loading').style.display = 'none'; }, 3500);
    });

    // Wire up buttons
    document.getElementById('pd-add').addEventListener('click', addPanel);
    document.getElementById('pd-remove').addEventListener('click', removeSelectedPanel);
    document.getElementById('pd-reset').addEventListener('click', resetLayout);
    document.getElementById('pd-save').addEventListener('click', saveDesign);
  };

  // ── Satellite image ───────────────────────────────────────────────
  function loadSatelliteImage() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        const konvaImg = new Konva.Image({
          x: 0,
          y: 0,
          image: img,
          width: stageWidth,
          height: stageHeight,
        });
        bgLayer.add(konvaImg);
        bgLayer.draw();
        resolve();
      };
      img.onerror = reject;
      img.src = `/api/satellite-image?lat=${config.lat}&lon=${config.lon}&zoom=20&size=${stageWidth}x${stageHeight}`;
    });
  }

  // ── Panel placement ───────────────────────────────────────────────
  function placeSuggestedPanels() {
    panelLayer.destroyChildren();
    selectedPanel = null;

    const count = config.panelCount || 20;
    const roofSegments = config.roofSegments || [];

    // Calculate grid placement centered on the image
    // Use roof segment data if available to orient panels
    const primaryAzimuth = getBestAzimuth(roofSegments);
    const rotation = azimuthToCanvasRotation(primaryAzimuth);

    // Calculate how many columns fit
    const effectiveW = PANEL_W + PANEL_GAP;
    const effectiveH = PANEL_H + PANEL_GAP;
    const cols = Math.floor((stageWidth * 0.5) / effectiveW);
    const rows = Math.ceil(count / cols);

    // Center the grid
    const gridW = cols * effectiveW - PANEL_GAP;
    const gridH = rows * effectiveH - PANEL_GAP;
    const startX = (stageWidth - gridW) / 2;
    const startY = (stageHeight - gridH) / 2;

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * effectiveW;
      const y = startY + row * effectiveH;
      createPanel(x, y, rotation);
    }

    panelLayer.draw();
  }

  function createPanel(x, y, rotation) {
    const panel = new Konva.Rect({
      x: x,
      y: y,
      width: PANEL_W,
      height: PANEL_H,
      fill: PANEL_COLOR,
      stroke: PANEL_STROKE,
      strokeWidth: 1,
      cornerRadius: 1,
      rotation: rotation || 0,
      draggable: true,
      name: 'panel',
    });

    // Selection
    panel.on('click tap', function (e) {
      e.cancelBubble = true;
      selectPanel(panel);
    });

    // Drag visual feedback
    panel.on('dragstart', function () {
      panel.moveToTop();
      panel.opacity(0.7);
    });

    panel.on('dragend', function () {
      panel.opacity(1);
      updateMetrics();
    });

    // Hover cursor
    panel.on('mouseenter', function () {
      stage.container().style.cursor = 'grab';
    });

    panel.on('mouseleave', function () {
      stage.container().style.cursor = 'crosshair';
    });

    panelLayer.add(panel);
    return panel;
  }

  // ── Selection ─────────────────────────────────────────────────────
  function selectPanel(panel) {
    deselectAll();
    selectedPanel = panel;
    panel.fill(PANEL_SELECTED_COLOR);
    panel.stroke(PANEL_SELECTED_STROKE);
    panel.strokeWidth(2);
    panelLayer.draw();

    document.getElementById('pd-remove').disabled = false;
    document.getElementById('pd-sel-info').classList.add('visible');
  }

  function deselectAll() {
    if (selectedPanel) {
      selectedPanel.fill(PANEL_COLOR);
      selectedPanel.stroke(PANEL_STROKE);
      selectedPanel.strokeWidth(1);
      selectedPanel = null;
      panelLayer.draw();
    }
    document.getElementById('pd-remove').disabled = true;
    document.getElementById('pd-sel-info').classList.remove('visible');
  }

  // ── Actions ───────────────────────────────────────────────────────
  function addPanel() {
    // Place in center with slight random offset so they don't stack perfectly
    const x = stageWidth / 2 - PANEL_W / 2 + (Math.random() - 0.5) * 60;
    const y = stageHeight / 2 - PANEL_H / 2 + (Math.random() - 0.5) * 60;
    const roofSegments = config.roofSegments || [];
    const rotation = azimuthToCanvasRotation(getBestAzimuth(roofSegments));
    const panel = createPanel(x, y, rotation);
    selectPanel(panel);
    panelLayer.draw();
    updateMetrics();
  }

  function removeSelectedPanel() {
    if (!selectedPanel) return;
    selectedPanel.destroy();
    selectedPanel = null;
    panelLayer.draw();
    document.getElementById('pd-remove').disabled = true;
    document.getElementById('pd-sel-info').classList.remove('visible');
    updateMetrics();
  }

  function resetLayout() {
    deselectAll();
    placeSuggestedPanels();
    updateMetrics();
  }

  function saveDesign() {
    const btn = document.getElementById('pd-save');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    const panels = getPanelPositions();
    const panelCount = panels.length;
    const systemSizeKw = panelCount * PANEL_WATTAGE;

    fetch('/api/save-panel-design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: window._capturedEmail || null,
        panels,
        panelCount,
        systemSizeKw,
      }),
    })
      .then(() => {
        btn.textContent = 'Saved!';
        setTimeout(() => { btn.textContent = 'Save Design'; btn.disabled = false; }, 2000);
      })
      .catch(() => {
        btn.textContent = 'Save failed';
        setTimeout(() => { btn.textContent = 'Save Design'; btn.disabled = false; }, 2000);
      });
  }

  // ── Metrics ───────────────────────────────────────────────────────
  function updateMetrics() {
    const panels = panelLayer.find('.panel');
    const count = panels.length;
    const sizeKw = count * PANEL_WATTAGE;
    const productionPerKw = config.annualProductionKwh / config.systemSizeKw;
    const production = sizeKw * productionPerKw;

    document.getElementById('dm-panels').textContent = count;
    document.getElementById('dm-size').innerHTML = `${sizeKw.toFixed(1)} <span class="metric-unit">kW</span>`;
    document.getElementById('dm-production').innerHTML = `${formatNum(Math.round(production))} <span class="metric-unit">kWh</span>`;
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function getPanelPositions() {
    return panelLayer.find('.panel').map((p) => ({
      x: Math.round(p.x()),
      y: Math.round(p.y()),
      rotation: Math.round(p.rotation()),
    }));
  }

  function saveInitialPositions() {
    initialPanelPositions = getPanelPositions();
  }

  function getBestAzimuth(segments) {
    if (!segments || segments.length === 0) return 180; // default south
    // Pick the segment with the most panels (best solar exposure)
    const sorted = [...segments].sort((a, b) => (b.panelsCount || 0) - (a.panelsCount || 0));
    return sorted[0].azimuthDegrees || 180;
  }

  function azimuthToCanvasRotation(azimuth) {
    // Azimuth: 0=North, 90=East, 180=South, 270=West
    // For panels, south-facing (180) = 0° rotation on canvas
    // We only rotate slightly — full rotation makes dragging weird
    // Just align the grid to the dominant roof face direction
    const offset = ((azimuth - 180 + 360) % 360);
    if (offset > 180) return -(360 - offset);
    // Only apply subtle rotation (±15° max) for usability
    return Math.max(-15, Math.min(15, offset > 90 ? offset - 180 : offset));
  }

  function drawPlaceholderBg() {
    // Dark background with subtle grid to give spatial reference
    const bg = new Konva.Rect({
      x: 0, y: 0, width: stageWidth, height: stageHeight,
      fill: '#1e293b',
    });
    bgLayer.add(bg);

    // Grid lines
    const gridSize = 40;
    for (let x = 0; x <= stageWidth; x += gridSize) {
      bgLayer.add(new Konva.Line({
        points: [x, 0, x, stageHeight],
        stroke: 'rgba(255,255,255,0.06)',
        strokeWidth: 1,
      }));
    }
    for (let y = 0; y <= stageHeight; y += gridSize) {
      bgLayer.add(new Konva.Line({
        points: [0, y, stageWidth, y],
        stroke: 'rgba(255,255,255,0.06)',
        strokeWidth: 1,
      }));
    }

    // Roof outline hint (centered rectangle)
    bgLayer.add(new Konva.Rect({
      x: stageWidth * 0.2,
      y: stageHeight * 0.2,
      width: stageWidth * 0.6,
      height: stageHeight * 0.6,
      stroke: 'rgba(255,255,255,0.15)',
      strokeWidth: 2,
      dash: [8, 4],
      cornerRadius: 4,
    }));

    bgLayer.add(new Konva.Text({
      x: 0, y: stageHeight * 0.14,
      width: stageWidth,
      text: 'Roof Area (approximate)',
      fontSize: 13,
      fill: 'rgba(255,255,255,0.2)',
      align: 'center',
    }));

    bgLayer.draw();
  }

  function formatNum(n) {
    return n.toLocaleString('en-US');
  }
})();
