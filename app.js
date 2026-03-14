/* ═══════════════════════════════════════════════════════════════════
   SecureStep – Digital Worker Surveillance  |  app.js
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

// ─── Config ─────────────────────────────────────────────────────────────────
const CFG = {
  // Use the WebSocket port directly
  mqttBroker  : 'ws://98.130.28.156:8084',
  mqttUser    : 'moambulance',
  mqttPass    : 'P@$sw0rd2001',
  topic       : 'SECURE_STEP',
  workZoneRadius      : 50,    // metres
  restrictedZoneRadius: 100,   // metres
  defaultLat  : 20.25593,
  defaultLng  : 85.866354,
};

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  lastPayload   : null,
  mqttClient    : null,
  connected     : false,
  alerts        : [],          // { id, time, type, severity, msg, lat, lng }
  alertFilter   : 'all',
  alertCount    : 0,
  sosCount      : 0,
  helmetViolations: 0,

  // Zones (persisted in localStorage)
  workingAreas  : [],          // { id, name, lat, lng }
  restrictedAreas: [],         // { id, name, lat, lng }

  // Productivity
  sessionStart  : Date.now(),
  inZoneStart   : null,        // timestamp when worker entered a work zone
  totalInZone   : 0,           // ms
  inRestrictedMs: 0,
  inRestrictedStart: null,

  // Charts
  speedHistory  : [],          // [{t, v}]
  prodChart     : null,
  speedChart    : null,
};

// ─── Leaflet Map instances ───────────────────────────────────────────────────
let miniMap, mainMap;
let workerMarkerMini, workerMarkerMain;
let miniMapLayers = { working: [], restricted: [] };
let mainMapLayers = { working: [], restricted: [] };
let mapsInitialised = false;

// ═══════════════════════════════════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  loadZones();
  initMaps();
  renderZoneLists();
  renderZoneLayers();
  initCharts();
  startClock();
  connectMQTT();
  startProductivityTimer();
});

// ═══════════════════════════════════════════════════════════════════
//  CLOCK
// ═══════════════════════════════════════════════════════════════════
function startClock() {
  const el = document.getElementById('live-clock');
  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-IN', { hour12: false });
  }
  tick();
  setInterval(tick, 1000);
}

// ═══════════════════════════════════════════════════════════════════
//  SECTION NAVIGATION
// ═══════════════════════════════════════════════════════════════════
const SECTION_META = {
  dashboard : { title: 'Dashboard',     sub: 'Real-time worker surveillance overview' },
  map       : { title: 'Live Map',      sub: 'Real-time GPS position and zone status' },
  alerts    : { title: 'Alerts',        sub: 'Comprehensive alert history log' },
  admin     : { title: 'Zone Admin',    sub: 'Manage working areas and restricted zones' },
  analytics : { title: 'Analytics',     sub: 'Session productivity and telemetry analytics' },
};

function switchSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById(`section-${name}`).classList.add('active');
  document.getElementById(`nav-${name}`).classList.add('active');

  const meta = SECTION_META[name];
  document.getElementById('page-title').textContent    = meta.title;
  document.getElementById('page-subtitle').textContent = meta.sub;

  // Resize maps after they become visible
  if (name === 'map')       { setTimeout(() => mainMap && mainMap.invalidateSize(), 100); }
  if (name === 'dashboard') { setTimeout(() => miniMap && miniMap.invalidateSize(), 100); }
  if (name === 'analytics') { updateCharts(); }
}

// ═══════════════════════════════════════════════════════════════════
//  LEAFLET MAPS
// ═══════════════════════════════════════════════════════════════════
const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_OPTS = { maxZoom: 19 };

function initMaps() {
  const center = [CFG.defaultLat, CFG.defaultLng];

  // Mini map (dashboard)
  miniMap = L.map('mini-map', { zoomControl: false, attributionControl: false }).setView(center, 16);
  L.tileLayer(TILE, TILE_OPTS).addTo(miniMap);

  // Main map
  mainMap = L.map('main-map', { zoomControl: true, attributionControl: false }).setView(center, 16);
  L.tileLayer(TILE, TILE_OPTS).addTo(mainMap);

  // Worker markers
  const pulseIcon = createPulseIcon();
  workerMarkerMini = L.marker(center, { icon: pulseIcon }).addTo(miniMap).bindPopup('SECURE_STEP-001');
  workerMarkerMain = L.marker(center, { icon: pulseIcon }).addTo(mainMap).bindPopup('SECURE_STEP-001');

  mapsInitialised = true;
}

function createPulseIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:18px;height:18px;border-radius:50%;
      background:#00d2ff;border:2.5px solid #fff;
      box-shadow:0 0 0 4px rgba(0,210,255,0.3),0 0 12px rgba(0,210,255,0.5);
      animation:none;
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function updateWorkerMarker(lat, lng) {
  if (!mapsInitialised) return;
  const pos = [lat, lng];
  workerMarkerMini.setLatLng(pos);
  workerMarkerMain.setLatLng(pos);
  miniMap.panTo(pos, { animate: true });
  mainMap.panTo(pos, { animate: true });
}

// ─── Zone Layers ─────────────────────────────────────────────────────────────
function addZoneToMap(zone, type) {
  const isWork  = type === 'working';
  const radius  = isWork ? CFG.workZoneRadius : CFG.restrictedZoneRadius;
  const color   = isWork ? '#00e676' : '#ff3d5a';
  const opts    = { radius, color, fillColor: color, fillOpacity: 0.10, weight: 1.5 };

  const circleMini = L.circle([zone.lat, zone.lng], opts).addTo(miniMap);
  const circleMain = L.circle([zone.lat, zone.lng], opts).addTo(mainMap);
  const labelOpts  = { permanent: true, direction: 'top', className: 'zone-label', offset: [0, -8] };
  const markerOpts = { icon: L.divIcon({ className: '', iconSize: [0,0] }) };
  const mMini = L.marker([zone.lat, zone.lng], markerOpts).addTo(miniMap).bindTooltip(zone.name, labelOpts);
  const mMain = L.marker([zone.lat, zone.lng], markerOpts).addTo(mainMap).bindTooltip(zone.name, labelOpts);

  const layers = isWork ? miniMapLayers.working : miniMapLayers.restricted;
  const mainL  = isWork ? mainMapLayers.working  : mainMapLayers.restricted;

  layers.push({ circle: circleMini, marker: mMini, id: zone.id });
  mainL.push({ circle: circleMain,  marker: mMain, id: zone.id });
}

function removeZoneFromMap(id, type) {
  const mini = type === 'working' ? miniMapLayers.working : miniMapLayers.restricted;
  const main = type === 'working' ? mainMapLayers.working  : mainMapLayers.restricted;

  [mini, main].forEach(arr => {
    const idx = arr.findIndex(l => l.id === id);
    if (idx >= 0) {
      const group = [miniMap, mainMap];
      arr[idx].circle.remove();
      arr[idx].marker.remove();
      arr.splice(idx, 1);
    }
  });
}

function renderZoneLayers() {
  // clear existing
  [...miniMapLayers.working, ...miniMapLayers.restricted,
   ...mainMapLayers.working, ...mainMapLayers.restricted].forEach(l => {
    l.circle.remove(); l.marker.remove();
  });
  miniMapLayers = { working: [], restricted: [] };
  mainMapLayers = { working: [], restricted: [] };

  state.workingAreas.forEach(z  => addZoneToMap(z, 'working'));
  state.restrictedAreas.forEach(z => addZoneToMap(z, 'restricted'));
}

// ═══════════════════════════════════════════════════════════════════
//  HAVERSINE DISTANCE
// ═══════════════════════════════════════════════════════════════════
function haversine(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dO = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(dL/2)**2 +
             Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dO/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ═══════════════════════════════════════════════════════════════════
//  MQTT CLIENT
// ═══════════════════════════════════════════════════════════════════
let _brokerIndex = 0;

function connectMQTT() {
  setConnBadge('connecting');
  _tryConnect();
}

function _tryConnect() {
  const brokerUrl = CFG.mqttBroker;
  console.log(`[MQTT] Connecting to: ${brokerUrl}`);

  if (state.mqttClient) {
    try { state.mqttClient.end(true); } catch(e) {}
    state.mqttClient = null;
  }

  try {
    state.mqttClient = mqtt.connect(brokerUrl, {
      clientId      : 'Web_Visitor_Emp1_' + Math.floor(Math.random() * 1000),
      username      : CFG.mqttUser,
      password      : CFG.mqttPass,
      protocolVersion: 4,
      clean         : true,
      reconnectPeriod: 5000,    // Let MQTT.js handle reconnects now
      connectTimeout : 10000,
      keepalive     : 60,
    });
  } catch (e) {
    console.error('[MQTT] Connection exception:', e);
    setConnBadge('error');
    return;
  }

  state.mqttClient.on('connect', () => {
    console.log('[MQTT] Connected successfully');
    state.connected = true;
    setConnBadge('connected');
    document.getElementById('worker-status-dot').classList.add('online');
    state.mqttClient.subscribe(CFG.topic, { qos: 0 }, err => {
      if (err) console.error('[MQTT] Subscription error:', err);
      else console.log(`[MQTT] Subscribed to: ${CFG.topic}`);
    });
    pushAlert({ type: 'info', severity: 'info', msg: 'Connected to broker', lat: null, lng: null });
  });

  state.mqttClient.on('message', (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      console.log('[MQTT] Payload:', payload);
      processPayload(payload);
    } catch (e) {
      console.warn('[MQTT] Invalid JSON:', e);
    }
  });

  state.mqttClient.on('error', err => {
    console.error('[MQTT] Error:', err.message || err);
    if (err.message && err.message.includes('Not authorized')) {
      console.error('[MQTT] AUTHORIZATION FAILED - Check username/password');
    }
    setConnBadge('error');
  });

  state.mqttClient.on('close', () => {
    if (state.connected) {
      console.warn('[MQTT] Connection lost');
      state.connected = false;
      setConnBadge('error');
      document.getElementById('worker-status-dot').classList.remove('online');
    }
  });

  state.mqttClient.on('offline', () => setConnBadge('error'));
}

  state.mqttClient.on('reconnect', () => setConnBadge('connecting'));
  state.mqttClient.on('offline',   () => {
    console.warn('[MQTT] Client went offline');
    setConnBadge('error');
  });
}

function setConnBadge(status) {
  const badge = document.getElementById('conn-badge');
  const label = document.getElementById('conn-label');
  badge.className = 'conn-badge';
  if (status === 'connected')  { badge.classList.add('connected');  label.textContent = 'Connected'; }
  else if (status === 'error') { badge.classList.add('error');      label.textContent = 'Disconnected'; }
  else                         { label.textContent = 'Connecting…'; }
}

// ═══════════════════════════════════════════════════════════════════
//  PAYLOAD PROCESSING
// ═══════════════════════════════════════════════════════════════════
function processPayload(p) {
  state.lastPayload = p;

  const lat = parseFloat(p.latitude)  || CFG.defaultLat;
  const lng = parseFloat(p.longitude) || CFG.defaultLng;
  const spd = parseFloat(p.speed_kmph) || 0;
  const alt = parseFloat(p.altitude_m) || 0;
  const sos = parseInt(p.sos)          || 0;
  const helmet = (p.helmetWorn === 'Helmet Worn');
  const now   = new Date().toLocaleTimeString('en-IN', { hour12: false });

  // Update map
  updateWorkerMarker(lat, lng);

  // GPS card
  document.getElementById('stat-coords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  document.getElementById('stat-speed').textContent  = `Speed: ${spd.toFixed(1)} km/h`;
  document.getElementById('stat-alt').textContent    = `Alt: ${alt.toFixed(0)} m`;
  document.getElementById('stat-last-seen').textContent = `Last seen: ${now}`;

  // Speed history for chart
  state.speedHistory.push({ t: now, v: spd });
  if (state.speedHistory.length > 20) state.speedHistory.shift();

  // ─── Helmet ────────────────────────────────────────────────────
  const helmetEl   = document.getElementById('stat-helmet');
  const helmetIcon = document.getElementById('helmet-icon');
  const helmetCard = document.getElementById('card-helmet');
  helmetEl.textContent = helmet ? '✔ Helmet Worn' : '✘ Not Worn';
  document.getElementById('stat-helmet-time').textContent = `Last checked: ${now}`;

  if (!helmet) {
    helmetIcon.className = 'stat-icon red';
    helmetCard.classList.add('alert-state', 'helmet-off');
    state.helmetViolations++;
    document.getElementById('sum-helmet').textContent = state.helmetViolations;
    pushAlert({ type: 'helmet', severity: 'warning', msg: 'Worker is NOT wearing helmet!', lat, lng });
  } else {
    helmetIcon.className = 'stat-icon green';
    helmetCard.classList.remove('alert-state', 'helmet-off');
  }

  // ─── SOS ──────────────────────────────────────────────────────
  if (sos === 1) {
    triggerSOS(lat, lng, now);
  } else {
    document.getElementById('stat-sos').textContent = 'Normal';
    document.getElementById('card-sos').classList.remove('alert-state');
  }

  // ─── Zone Engine ───────────────────────────────────────────────
  checkZones(lat, lng, now);
}

// ─── SOS ─────────────────────────────────────────────────────────────────────
const SOS_COOLDOWN_MS = 2 * 60 * 1000;  // 2 minutes
let   lastSosAlertTime = 0;             // epoch ms of last alert/toast

function triggerSOS(lat, lng, now) {
  const currentTime = Date.now();
  const cooldownActive = (currentTime - lastSosAlertTime) < SOS_COOLDOWN_MS;

  // Always update the card UI so the operator sees SOS is still active
  document.getElementById('stat-sos').textContent = '🆘 SOS ACTIVE';
  document.getElementById('stat-sos-time').textContent = `Last triggered: ${now}`;
  document.getElementById('card-sos').classList.add('alert-state');
  document.getElementById('sos-banner').classList.add('visible');

  // Only fire toast + alert log entry if cooldown has passed
  if (cooldownActive) {
    const secsLeft = Math.ceil((SOS_COOLDOWN_MS - (currentTime - lastSosAlertTime)) / 1000);
    console.log(`[SOS] Cooldown active — next alert in ${secsLeft}s`);
    return;
  }

  // New SOS event — reset cooldown timer and fire alerts
  lastSosAlertTime = currentTime;
  state.sosCount++;
  document.getElementById('sum-sos').textContent = state.sosCount;

  showToast({
    type  : 'sos-toast',
    icon  : '🆘',
    title : 'SOS ALERT!',
    msg   : `Worker SECURE_STEP-001 triggered emergency SOS at ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
  });

  pushAlert({ type: 'sos', severity: 'critical', msg: 'SOS Emergency button activated!', lat, lng });
}

function dismissSOS() {
  document.getElementById('sos-banner').classList.remove('visible');
}

// ─── Zone Engine ─────────────────────────────────────────────────────────────
let prevZoneFlags = { inWork: false, inRestricted: false, restrictedName: '' };

function checkZones(lat, lng, now) {
  // Check working areas
  const inWork = state.workingAreas.some(z => haversine(lat, lng, z.lat, z.lng) <= CFG.workZoneRadius);

  // Check restricted areas
  let inRestricted = false;
  let nearestRestrName = '';
  let nearestDist = Infinity;

  for (const z of state.restrictedAreas) {
    const d = haversine(lat, lng, z.lat, z.lng);
    if (d <= CFG.restrictedZoneRadius) {
      inRestricted   = true;
      nearestRestrName = z.name;
    }
    if (d < nearestDist) { nearestDist = d; nearestRestrName = z.name; }
  }

  // Zone card
  const zoneEl   = document.getElementById('stat-zone');
  const zoneIcon = document.getElementById('zone-icon');
  const zoneCard = document.getElementById('card-zone');
  const distEl   = document.getElementById('stat-zone-dist');

  if (state.restrictedAreas.length > 0) {
    distEl.textContent = `Nearest restricted: ${Math.round(nearestDist)} m (${nearestRestrName || '—'})`;
  } else {
    distEl.textContent = 'No restricted areas defined';
  }

  if (inRestricted) {
    zoneEl.textContent  = `⛔ In Restricted Zone`;
    zoneIcon.className  = 'stat-icon red';
    zoneCard.classList.add('alert-state');

    if (!prevZoneFlags.inRestricted) {
      pushAlert({ type: 'restricted', severity: 'critical', msg: `Entered RESTRICTED ZONE: ${nearestRestrName}`, lat, lng });
      showToast({ type: 'restricted-toast', icon: '⛔', title: 'Restricted Zone!', msg: `Worker entered: ${nearestRestrName}` });
    }
  } else if (inWork) {
    zoneEl.textContent = '✔ In Working Area';
    zoneIcon.className = 'stat-icon green';
    zoneCard.classList.remove('alert-state');

    if (!prevZoneFlags.inWork) {
      pushAlert({ type: 'zone', severity: 'info', msg: 'Worker entered a Working Area', lat, lng });
      showToast({ type: 'zone-toast', icon: '🟢', title: 'Entered Work Zone', msg: 'Worker is now in a designated working area.' });
    }
  } else {
    zoneEl.textContent = '○ Outside zones';
    zoneIcon.className = 'stat-icon blue';
    zoneCard.classList.remove('alert-state');

    if (prevZoneFlags.inWork && !inWork) {
      pushAlert({ type: 'zone', severity: 'info', msg: 'Worker left the Working Area', lat, lng });
    }
  }

  // Productivity time tracking
  if (inWork && !inRestricted) {
    if (!state.inZoneStart) state.inZoneStart = Date.now();
  } else {
    if (state.inZoneStart) {
      state.totalInZone += Date.now() - state.inZoneStart;
      state.inZoneStart = null;
    }
  }

  // Restricted time tracking
  if (inRestricted) {
    if (!state.inRestrictedStart) state.inRestrictedStart = Date.now();
  } else {
    if (state.inRestrictedStart) {
      state.inRestrictedMs += Date.now() - state.inRestrictedStart;
      state.inRestrictedStart = null;
    }
  }

  prevZoneFlags = { inWork, inRestricted, restrictedName: nearestRestrName };
}

// ═══════════════════════════════════════════════════════════════════
//  PRODUCTIVITY TIMER
// ═══════════════════════════════════════════════════════════════════
function startProductivityTimer() {
  setInterval(() => {
    const sessionMs = Date.now() - state.sessionStart;
    const inZoneMs  = state.totalInZone + (state.inZoneStart ? Date.now() - state.inZoneStart : 0);
    const pct       = sessionMs > 0 ? Math.round((inZoneMs / sessionMs) * 100) : 0;

    document.getElementById('stat-productivity').textContent = msToHMS(inZoneMs);
    document.getElementById('stat-prod-pct').textContent     = `Session productivity: ${pct}%`;
    document.getElementById('sum-duration').textContent      = msToHMS(sessionMs);
    document.getElementById('sum-inzone').textContent        = msToHMS(inZoneMs);
    document.getElementById('sum-pct').textContent           = `${pct}%`;
  }, 1000);
}

function msToHMS(ms) {
  const s  = Math.floor(ms / 1000);
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════════════
//  ALERTS
// ═══════════════════════════════════════════════════════════════════
const TYPE_META = {
  sos        : { label: 'SOS',       icon: '🆘', sev: 'critical' },
  helmet     : { label: 'Helmet',    icon: '⛑️',  sev: 'warning'  },
  restricted : { label: 'Restricted',icon: '⛔', sev: 'critical' },
  zone       : { label: 'Zone',      icon: '📍', sev: 'info'     },
  info       : { label: 'Info',      icon: 'ℹ️',  sev: 'safe'     },
};

function pushAlert({ type, severity, msg, lat, lng }) {
  const id   = Date.now() + Math.random();
  const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
  const item = { id, time, type, severity, msg, lat, lng };
  state.alerts.unshift(item);
  state.alertCount++;

  // Update badge
  const badge = document.getElementById('alert-badge');
  badge.textContent = state.alertCount;
  badge.classList.add('visible');
  document.getElementById('sum-alerts').textContent = state.alertCount;
  document.getElementById('recent-alert-count').textContent = Math.min(state.alertCount, 99);

  renderRecentAlerts();
  renderAlertTable();
}

function renderRecentAlerts() {
  const container = document.getElementById('recent-alerts');
  const recent    = state.alerts.slice(0, 8);

  if (recent.length === 0) {
    container.innerHTML = '<div class="alert-empty">No alerts yet. All systems nominal.</div>';
    return;
  }

  container.innerHTML = recent.map(a => {
    const meta = TYPE_META[a.type] || TYPE_META.info;
    return `<div class="alert-item ${a.type}">
      <span class="alert-item-icon">${meta.icon}</span>
      <div class="alert-item-body">
        <div class="alert-item-msg">${a.msg}</div>
        <div class="alert-item-time">${a.time}</div>
      </div>
    </div>`;
  }).join('');
}

function renderAlertTable() {
  const tbody     = document.getElementById('alert-tbody');
  const filtered  = state.alertFilter === 'all'
    ? state.alerts
    : state.alerts.filter(a => a.type === state.alertFilter);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr class="alert-empty-row"><td colspan="5">No alerts recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(a => {
    const meta  = TYPE_META[a.type] || TYPE_META.info;
    const coord = (a.lat && a.lng) ? `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}` : '—';
    return `<tr>
      <td class="mono" style="font-size:11px;color:var(--text-secondary)">${a.time}</td>
      <td><span class="type-pill type-${a.type}">${meta.icon} ${meta.label}</span></td>
      <td><span class="severity-pill sev-${a.severity}">${a.severity}</span></td>
      <td style="max-width:280px">${a.msg}</td>
      <td class="mono" style="font-size:11px;color:var(--text-muted)">${coord}</td>
    </tr>`;
  }).join('');
}

function filterAlerts(type, btn) {
  state.alertFilter = type;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAlertTable();
}

function clearAlerts() {
  state.alerts      = [];
  state.alertCount  = 0;
  document.getElementById('alert-badge').classList.remove('visible');
  document.getElementById('sum-alerts').textContent = '0';
  document.getElementById('recent-alert-count').textContent = '0';
  renderRecentAlerts();
  renderAlertTable();
}

// ═══════════════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════════════
function showToast({ type = 'zone-toast', icon = 'ℹ️', title, msg }) {
  const container = document.getElementById('toast-container');
  const id = 'toast-' + Date.now();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.id = id;
  el.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${msg}</div>
    </div>
    <button class="toast-close" onclick="removeToast('${id}')">✕</button>
  `;
  container.appendChild(el);
  setTimeout(() => removeToast(id), 7000);
}

function removeToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('removing');
  setTimeout(() => el.remove(), 320);
}

// ═══════════════════════════════════════════════════════════════════
//  ADMIN – ZONE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════
function loadZones() {
  try {
    state.workingAreas   = JSON.parse(localStorage.getItem('ss_working')   || '[]');
    state.restrictedAreas= JSON.parse(localStorage.getItem('ss_restricted')|| '[]');
  } catch(e) { state.workingAreas = []; state.restrictedAreas = []; }
}

function saveZones() {
  localStorage.setItem('ss_working',    JSON.stringify(state.workingAreas));
  localStorage.setItem('ss_restricted', JSON.stringify(state.restrictedAreas));
}

function addWorkingArea(e) {
  e.preventDefault();
  const name = document.getElementById('wa-name').value.trim();
  const lat  = parseFloat(document.getElementById('wa-lat').value);
  const lng  = parseFloat(document.getElementById('wa-lng').value);
  if (!name || isNaN(lat) || isNaN(lng)) return;

  const zone = { id: Date.now().toString(), name, lat, lng };
  state.workingAreas.push(zone);
  saveZones();
  addZoneToMap(zone, 'working');
  renderZoneLists();
  e.target.reset();
  showToast({ type: 'safe-toast', icon: '🟢', title: 'Working Area Added', msg: `"${name}" added at ${lat.toFixed(5)}, ${lng.toFixed(5)}` });
}

function addRestrictedArea(e) {
  e.preventDefault();
  const name = document.getElementById('ra-name').value.trim();
  const lat  = parseFloat(document.getElementById('ra-lat').value);
  const lng  = parseFloat(document.getElementById('ra-lng').value);
  if (!name || isNaN(lat) || isNaN(lng)) return;

  const zone = { id: Date.now().toString(), name, lat, lng };
  state.restrictedAreas.push(zone);
  saveZones();
  addZoneToMap(zone, 'restricted');
  renderZoneLists();
  e.target.reset();
  showToast({ type: 'restricted-toast', icon: '⛔', title: 'Restricted Area Added', msg: `"${name}" added at ${lat.toFixed(5)}, ${lng.toFixed(5)}` });
}

function removeWorkingArea(id) {
  state.workingAreas = state.workingAreas.filter(z => z.id !== id);
  saveZones();
  removeZoneFromMap(id, 'working');
  renderZoneLists();
}

function removeRestrictedArea(id) {
  state.restrictedAreas = state.restrictedAreas.filter(z => z.id !== id);
  saveZones();
  removeZoneFromMap(id, 'restricted');
  renderZoneLists();
}

function renderZoneLists() {
  // Working Areas
  const waEl    = document.getElementById('wa-list');
  const waCount = document.getElementById('wa-count');
  waCount.textContent = state.workingAreas.length;

  if (state.workingAreas.length === 0) {
    waEl.innerHTML = '<div class="zone-empty">No working areas added yet.</div>';
  } else {
    waEl.innerHTML = state.workingAreas.map(z => `
      <div class="zone-item">
        <span class="zone-item-icon">🟢</span>
        <div class="zone-item-body">
          <div class="zone-item-name">${z.name}</div>
          <div class="zone-item-coords">${z.lat.toFixed(5)}, ${z.lng.toFixed(5)} · r=50m</div>
        </div>
        <button class="zone-item-del" onclick="removeWorkingArea('${z.id}')">Remove</button>
      </div>
    `).join('');
  }

  // Restricted Areas
  const raEl    = document.getElementById('ra-list');
  const raCount = document.getElementById('ra-count');
  raCount.textContent = state.restrictedAreas.length;

  if (state.restrictedAreas.length === 0) {
    raEl.innerHTML = '<div class="zone-empty">No restricted areas added yet.</div>';
  } else {
    raEl.innerHTML = state.restrictedAreas.map(z => `
      <div class="zone-item">
        <span class="zone-item-icon">🔴</span>
        <div class="zone-item-body">
          <div class="zone-item-name">${z.name}</div>
          <div class="zone-item-coords">${z.lat.toFixed(5)}, ${z.lng.toFixed(5)} · r=100m</div>
        </div>
        <button class="zone-item-del" onclick="removeRestrictedArea('${z.id}')">Remove</button>
      </div>
    `).join('');
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CHARTS
// ═══════════════════════════════════════════════════════════════════
const CHART_DEFAULTS = {
  plugins: { legend: { display: false } },
  scales : { x: { display: false }, y: { display: false } },
};

function initCharts() {
  // Productivity donut
  const ctxP = document.getElementById('chart-productivity').getContext('2d');
  state.prodChart = new Chart(ctxP, {
    type: 'doughnut',
    data: {
      labels  : ['In Work Zone', 'Outside Zone', 'Restricted Zone'],
      datasets: [{ data: [0, 100, 0], backgroundColor: ['#00e676','#1c3550','#ff3d5a'], borderWidth: 0 }],
    },
    options: {
      cutout: '70%',
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      animation: { animateRotate: true },
    },
  });

  // Speed line chart
  const ctxS = document.getElementById('chart-speed').getContext('2d');
  state.speedChart = new Chart(ctxS, {
    type: 'line',
    data: {
      labels  : [],
      datasets: [{
        label: 'Speed km/h',
        data : [],
        borderColor : '#00d2ff',
        backgroundColor: 'rgba(0,210,255,0.06)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#00d2ff',
        fill: true,
        tension: 0.4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#3d6080', maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#3d6080' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true },
      },
    },
  });
}

function updateCharts() {
  if (!state.prodChart || !state.speedChart) return;

  const sessionMs   = Date.now() - state.sessionStart;
  const inZoneMs    = state.totalInZone + (state.inZoneStart ? Date.now() - state.inZoneStart : 0);
  const restrictMs  = state.inRestrictedMs + (state.inRestrictedStart ? Date.now() - state.inRestrictedStart : 0);
  const outsideMs   = Math.max(0, sessionMs - inZoneMs - restrictMs);

  state.prodChart.data.datasets[0].data = [inZoneMs, outsideMs, restrictMs];
  state.prodChart.update();

  state.speedChart.data.labels   = state.speedHistory.map(s => s.t);
  state.speedChart.data.datasets[0].data = state.speedHistory.map(s => s.v);
  state.speedChart.update();
}

// ═══════════════════════════════════════════════════════════════════
//  SIMULATION HELPER (for testing without hardware)
// ═══════════════════════════════════════════════════════════════════
window.simulatePayload = function(overrides = {}) {
  const base = {
    "V-Id"       : "SECURE_STEP-001",
    "date_ist"   : "12-03-2026",
    "time_ist"   : new Date().toLocaleTimeString('en-IN', { hour12: false }),
    "latitude"   : CFG.defaultLat,
    "longitude"  : CFG.defaultLng,
    "speed_kmph" : 2.5,
    "altitude_m" : 36,
    "sos"        : 0,
    "helmetWorn" : "Helmet Worn",
    "zoneStatus" : "Safe Zone",
  };
  processPayload({ ...base, ...overrides });
  console.log('[SIM] Payload sent:', { ...base, ...overrides });
};

// Quick sim helpers in console:
// simulatePayload()                          → normal reading
// simulatePayload({ sos: 1 })               → SOS alert
// simulatePayload({ helmetWorn: "Helmet Not Worn" }) → helmet alert
// simulatePayload({ latitude: 20.253580, longitude: 85.842148 }) → move to boiler area
