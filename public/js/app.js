(() => {
  'use strict';

  // ==================== STATE ====================
  const socket = io();
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoomParam = urlParams.get('room');
  const initialRoom = (urlRoomParam || localStorage.getItem('wc_roomCode') || 'DAM-CUOI').toUpperCase();

  let state = {
    roomCode: initialRoom,
    myId: localStorage.getItem('wc_vehicleId') || ('v-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36)),
    hostToken: localStorage.getItem('wc_hostToken') || ('ht-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now().toString(36)),
    myName: localStorage.getItem('wc_vehicleName') || '',
    myPlate: localStorage.getItem('wc_vehiclePlate') || '',
    myRole: localStorage.getItem('wc_vehicleRole') || 'convoy',
    myColor: localStorage.getItem('wc_vehicleColor') || '#e11d48',
    viewOnly: localStorage.getItem('wc_viewOnly') === 'true',
    hasJoined: localStorage.getItem('wc_inRoom') === 'true',
    roomModalMode: urlRoomParam ? 'join' : 'join', // 'join' | 'create' | 'edit'
    pendingJoinMode: 'rejoin', // 'create' | 'join' | 'rejoin'
    isHost: false,
    hostVehicleId: null,

    myLat: null,
    myLng: null,
    myHeading: 0,
    mySpeed: 0,

    vehicles: {},      // { [id]: VehicleObj }
    waypoints: [],     // [ WaypointObj ]
    simulating: false,

    // Follow state
    followTargetId: localStorage.getItem('wc_followTargetId') || null, // vehicleId or 'wp:<waypointId>'
    cameraMode: 'target',     // 'target' | 'both' | 'free'
    showTrail: true,
    showRoute: true,
    showAllTrails: false,

    // Map picking state for adding waypoint
    pickingMapForWaypoint: false,
    pickedWpCoords: null,

    // Satellite & Google Traffic toggles
    isSatellite: false,
    showTraffic: true
  };

  localStorage.setItem('wc_vehicleId', state.myId);
  localStorage.setItem('wc_hostToken', state.hostToken);

  // ==================== DOM ELEMENTS ====================
  const el = {
    topMenuWrap: document.getElementById('topMenuWrap'),
    btnToggleTopMenu: document.getElementById('btnToggleTopMenu'),
    topVerticalMenu: document.getElementById('topVerticalMenu'),
    displayRoomCode: document.getElementById('displayRoomCode'),
    hostCrownBadge: document.getElementById('hostCrownBadge'),
    vehicleCountBadge: document.getElementById('vehicleCountBadge'),
    connectionDot: document.getElementById('connectionDot'),
    btnQuickFollowLead: document.getElementById('btnQuickFollowLead'),
    btnDemoMode: document.getElementById('btnDemoMode'),
    demoBtnLabel: document.getElementById('demoBtnLabel'),
    btnEditProfile: document.getElementById('btnEditProfile'),
    btnOpenShare: document.getElementById('btnOpenShare'),
    btnLeaveRoomMenu: document.getElementById('btnLeaveRoomMenu'),
    btnDeleteRoomMenu: document.getElementById('btnDeleteRoomMenu'),

    followHud: document.getElementById('followHud'),
    hudSpeedBox: document.getElementById('hudSpeedBox'),
    btnToggleHudCollapse: document.getElementById('btnToggleHudCollapse'),
    btnCollapseHudIcon: document.getElementById('btnCollapseHudIcon'),
    followModeTag: document.getElementById('followModeTag'),
    followTargetSpeed: document.getElementById('followTargetSpeed'),
    followTargetName: document.getElementById('followTargetName'),
    followDistanceText: document.getElementById('followDistanceText'),
    followEtaText: document.getElementById('followEtaText'),
    btnOpenFollowGmaps: document.getElementById('btnOpenFollowGmaps'),
    btnStopFollow: document.getElementById('btnStopFollow'),
    camBtnTarget: document.getElementById('camBtnTarget'),
    camBtnBoth: document.getElementById('camBtnBoth'),
    camBtnFree: document.getElementById('camBtnFree'),
    chkShowTrail: document.getElementById('chkShowTrail'),
    chkShowRoute: document.getElementById('chkShowRoute'),

    mapPickBanner: document.getElementById('mapPickBanner'),
    btnCancelPickMap: document.getElementById('btnCancelPickMap'),
    toastContainer: document.getElementById('toastContainer'),

    mapFabPod: document.getElementById('mapFabPod'),
    btnToggleFabPod: document.getElementById('btnToggleFabPod'),
    btnLocateMe: document.getElementById('btnLocateMe'),
    btnFitAll: document.getElementById('btnFitAll'),
    btnToggleTraffic: document.getElementById('btnToggleTraffic'),
    btnToggleMapStyle: document.getElementById('btnToggleMapStyle'),
    btnShowAllTrails: document.getElementById('btnShowAllTrails'),

    btnTogglePingPod: document.getElementById('btnTogglePingPod'),
    quickPingBar: document.getElementById('quickPingBar'),
    bottomSheet: document.getElementById('bottomSheet'),
    sheetToggleHandle: document.getElementById('sheetToggleHandle'),
    btnToggleSheetSize: document.getElementById('btnToggleSheetSize'),
    tabVehicleCount: document.getElementById('tabVehicleCount'),
    tabWaypointCount: document.getElementById('tabWaypointCount'),
    tabContentVehicles: document.getElementById('tabContentVehicles'),
    tabContentWaypoints: document.getElementById('tabContentWaypoints'),
    vehicleListContainer: document.getElementById('vehicleListContainer'),
    waypointListContainer: document.getElementById('waypointListContainer'),
    btnAddWaypointModal: document.getElementById('btnAddWaypointModal'),

    setupModal: document.getElementById('setupModal'),
    setupModalEyebrow: document.getElementById('setupModalEyebrow'),
    setupModalTitle: document.getElementById('setupModalTitle'),
    setupModalSubtitle: document.getElementById('setupModalSubtitle'),
    btnCloseSetupModal: document.getElementById('btnCloseSetupModal'),
    roomModeTabs: document.getElementById('roomModeTabs'),
    tabModeJoin: document.getElementById('tabModeJoin'),
    tabModeCreate: document.getElementById('tabModeCreate'),
    roomModalError: document.getElementById('roomModalError'),
    roomCodeFormGroup: document.getElementById('roomCodeFormGroup'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    btnRandomRoomCode: document.getElementById('btnRandomRoomCode'),
    roomModeHint: document.getElementById('roomModeHint'),
    setupForm: document.getElementById('setupForm'),
    inputRoomCode: document.getElementById('inputRoomCode'),
    inputVehicleName: document.getElementById('inputVehicleName'),
    inputVehiclePlate: document.getElementById('inputVehiclePlate'),
    colorPickerRow: document.getElementById('colorPickerRow'),
    btnSubmitSetupText: document.getElementById('btnSubmitSetupText'),
    btnViewOnlyMode: document.getElementById('btnViewOnlyMode'),
    btnClearMyTrail: document.getElementById('btnClearMyTrail'),
    btnLeaveRoomModal: document.getElementById('btnLeaveRoomModal'),

    waypointModal: document.getElementById('waypointModal'),
    waypointForm: document.getElementById('waypointForm'),
    inputWpTitle: document.getElementById('inputWpTitle'),
    inputWpNote: document.getElementById('inputWpNote'),
    btnWpPickOnMap: document.getElementById('btnWpPickOnMap'),
    btnWpUseMyLoc: document.getElementById('btnWpUseMyLoc'),
    inputWpSearchAddr: document.getElementById('inputWpSearchAddr'),
    btnWpSearchAddr: document.getElementById('inputWpSearchAddrBtn') || document.getElementById('btnWpSearchAddr'),
    wpCoordPreview: document.getElementById('wpCoordPreview'),
    btnCloseWaypointModal: document.getElementById('btnCloseWaypointModal'),

    shareModal: document.getElementById('shareModal'),
    qrImage: document.getElementById('qrImage'),
    shareRoomCodeText: document.getElementById('shareRoomCodeText'),
    shareUrlInput: document.getElementById('shareUrlInput'),
    btnCopyShareUrl: document.getElementById('btnCopyShareUrl'),
    lanIpHint: document.getElementById('lanIpHint'),
    btnCloseShareModal: document.getElementById('btnCloseShareModal')
  };

  // ==================== GOOGLE MAPS TILE LAYERS ====================
  const DEFAULT_LAT = 21.028511;
  const DEFAULT_LNG = 105.804817;

  const googleTrafficLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m,traffic&hl=vi&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 21,
    attribution: '&copy; Google Maps Traffic'
  });

  const googleStreetLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=vi&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 21,
    attribution: '&copy; Google Maps'
  });

  const googleSatelliteLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&hl=vi&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 21,
    attribution: '&copy; Google Maps Satellite'
  });

  const map = L.map('map', {
    center: [DEFAULT_LAT, DEFAULT_LNG],
    zoom: 15,
    zoomControl: false,
    preferCanvas: true,
    layers: [googleTrafficLayer]
  });

  function syncBaseMapLayer() {
    map.removeLayer(googleTrafficLayer);
    map.removeLayer(googleStreetLayer);
    map.removeLayer(googleSatelliteLayer);

    if (state.isSatellite) {
      map.addLayer(googleSatelliteLayer);
    } else if (state.showTraffic) {
      map.addLayer(googleTrafficLayer);
    } else {
      map.addLayer(googleStreetLayer);
    }
  }

  // Layer groups for organized rendering
  const trailsLayerGroup = L.layerGroup().addTo(map);
  const routeLayerGroup = L.layerGroup().addTo(map);
  const waypointsLayerGroup = L.layerGroup().addTo(map);
  const vehiclesLayerGroup = L.layerGroup().addTo(map);

  const vehicleMarkers = {};
  const vehicleTrailLines = {};
  let activeRouteLine = null;
  let activeRouteCasing = null;
  let lastRouteFetchTime = 0;
  let lastRouteKey = '';

  map.on('dragstart', () => {
    if (state.followTargetId && state.cameraMode !== 'free') {
      setCameraMode('free');
    }
  });

  map.on('click', (e) => {
    if (state.pickingMapForWaypoint) {
      state.pickingMapForWaypoint = false;
      state.pickedWpCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
      el.mapPickBanner.classList.add('hidden');
      el.waypointModal.classList.remove('hidden');
      el.wpCoordPreview.textContent = `Đã chọn trên bản đồ: ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    }
  });

  // ==================== BESPOKE SVG ICONS & HELPERS ====================
  function getRoleSvg(role, size = 18) {
    if (role === 'lead') {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>`;
    }
    if (role === 'media') {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>`;
  }

  function getWaypointTypeLabel(type) {
    if (type === 'groom') return 'NHÀ TRAI';
    if (type === 'bride') return 'NHÀ GÁI';
    if (type === 'restaurant') return 'NHÀ HÀNG';
    return 'ĐIỂM HẸN';
  }

  function getDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function computeBearing(lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;
    const dLng = toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function formatDistance(meters) {
    if (meters === null || meters === undefined || isNaN(meters)) return '-- m';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }

  function showToast(message) {
    const item = document.createElement('div');
    item.className = 'toast-item';
    item.textContent = message;
    el.toastContainer.appendChild(item);
    setTimeout(() => {
      item.remove();
    }, 4100);
  }

  function playPingSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } catch (e) {}
  }

  // ==================== WAKE LOCK ====================
  let wakeLockSentinel = null;
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
      } catch (e) {}
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.hasJoined) {
      requestWakeLock();
    }
  });

  // ==================== GPS WATCHER (WITH BATTERY-SAVER THROTTLE & NOISE GATE) ====================
  let watchId = null;
  let lastGpsEmitTime = 0;
  let offlineTrailBuffer = [];

  function startGpsTracking() {
    if (state.viewOnly) return;
    if (!('geolocation' in navigator)) {
      showToast('Trình duyệt không hỗ trợ định vị GPS.');
      return;
    }

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, heading, speed, accuracy } = pos.coords;
        const now = Date.now();
        const isFirstFix = state.myLat === null;

        // Ignore extreme coarse jump (> 100m accuracy) if we already have a recent accurate fix
        if (!isFirstFix && accuracy > 100 && now - lastGpsEmitTime < 20000) {
          return;
        }

        const movedDist = isFirstFix ? 999 : getDistanceMeters(state.myLat, state.myLng, latitude, longitude);

        // Throttle redundant emissions (< 950ms and moved < 3m) to save phone battery & 4G data
        if (!isFirstFix && now - lastGpsEmitTime < 950 && movedDist < 3) {
          return;
        }

        let speedKmh = typeof speed === 'number' && speed > 0 ? Math.round(speed * 3.6) : 0;
        if (speedKmh === 0 && !isFirstFix && movedDist >= 4) {
          const dtSec = Math.max(1, (now - lastGpsEmitTime) / 1000);
          if (dtSec < 10) speedKmh = Math.min(120, Math.round((movedDist / dtSec) * 3.6));
        }

        if (!isFirstFix && movedDist >= 3.5) {
          state.myHeading = Math.round(computeBearing(state.myLat, state.myLng, latitude, longitude));
        } else if (typeof heading === 'number' && !isNaN(heading) && speedKmh > 4) {
          state.myHeading = Math.round(heading);
        }

        state.myLat = latitude;
        state.myLng = longitude;
        state.mySpeed = speedKmh;
        lastGpsEmitTime = now;

        if (isFirstFix && !state.followTargetId) {
          map.setView([latitude, longitude], 16);
        }

        // If offline (4G dead zone on highway/mountain pass), buffer points locally to sync later
        if (!socket.connected) {
          const lastBuf = offlineTrailBuffer.length > 0 ? offlineTrailBuffer[offlineTrailBuffer.length - 1] : null;
          if (!lastBuf || getDistanceMeters(lastBuf.lat, lastBuf.lng, latitude, longitude) >= 12) {
            offlineTrailBuffer.push({
              lat: latitude,
              lng: longitude,
              speed: speedKmh,
              accuracy: accuracy || 12,
              t: now
            });
            if (offlineTrailBuffer.length > 600) offlineTrailBuffer.shift();
          }
          return;
        }

        socket.emit('vehicle:update-location', {
          id: state.myId,
          lat: latitude,
          lng: longitude,
          heading: state.myHeading,
          speed: speedKmh,
          accuracy: accuracy || 10
        });
      },
      (err) => {
        if (err.code === 1) {
          showToast('Vui lòng cấp quyền Vị trí (GPS) cho trình duyệt để phát toạ độ xe!');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000
      }
    );
  }

  function stopGpsTracking() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  // ==================== 60FPS SMOOTH MARKERS & INCREMENTAL TRAILS ====================
  const STATUS_BUBBLE_TTL_MS = 7000; // Auto-hide driver status bubble after 7 seconds
  const markerAnimFrames = {};
  const markerCumulativeRot = {};
  const statusExpireTimers = {};

  function scheduleStatusBubbleExpiry(vehicleId) {
    if (statusExpireTimers[vehicleId]) {
      clearTimeout(statusExpireTimers[vehicleId]);
      delete statusExpireTimers[vehicleId];
    }
    const v = state.vehicles[vehicleId];
    if (!v || !v.statusMsg || !v.statusTime) return;

    const remainingMs = STATUS_BUBBLE_TTL_MS - (Date.now() - v.statusTime);
    if (remainingMs <= 0) {
      v.statusMsg = '';
      v.statusTime = null;
      return;
    }

    statusExpireTimers[vehicleId] = setTimeout(() => {
      delete statusExpireTimers[vehicleId];
      const car = state.vehicles[vehicleId];
      if (!car) return;
      car.statusMsg = '';
      car.statusTime = null;
      const marker = vehicleMarkers[vehicleId];
      if (marker && marker.getElement()) {
        const bubble = marker.getElement().querySelector('.marker-status-bubble');
        if (bubble) bubble.classList.add('hidden');
      }
      renderVehicleCardsList();
    }, remainingMs);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getSmoothRotation(id, targetDeg) {
    const prev = markerCumulativeRot[id] ?? targetDeg;
    const delta = ((((targetDeg - prev) % 360) + 540) % 360) - 180;
    const next = prev + delta;
    markerCumulativeRot[id] = next;
    return next;
  }

  function createVehicleMarkerHtml(v) {
    const isLead = v.role === 'lead';
    const isMe = v.id === state.myId;
    const svgIcon = getRoleSvg(v.role, 18);
    const bgColor = isLead ? '#e11d48' : (v.color || '#2563eb');
    const speedText = v.speed && v.speed > 1 ? `${v.speed}km/h` : '';
    const displayName = isMe ? `${v.name} (Bạn)` : v.name;

    const cleanStatus = v.statusMsg ? v.statusMsg.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/u, '') : '';
    const hasFreshStatus = cleanStatus && v.statusTime && (Date.now() - v.statusTime < STATUS_BUBBLE_TTL_MS);
    if (hasFreshStatus) scheduleStatusBubbleExpiry(v.id);
    const statusBubbleHtml = hasFreshStatus
      ? `<div class="marker-status-bubble">${escapeHtml(cleanStatus)}</div>`
      : `<div class="marker-status-bubble hidden"></div>`;

    const headingDeg = getSmoothRotation(v.id, typeof v.heading === 'number' ? v.heading : 0);

    return `
      <div class="vehicle-marker-wrapper" style="opacity: ${v.online === false ? '0.6' : '1'}">
        ${statusBubbleHtml}
        <div class="marker-name-pill ${isLead ? 'lead-pill' : ''}">
          <span class="marker-title-text">${escapeHtml(displayName)}</span>
          <span class="marker-speed-tag">${speedText}</span>
        </div>
        <div style="position:relative; display:flex; align-items:center; justify-content:center;">
          <svg class="direction-cone" style="transform: rotate(${headingDeg}deg)" viewBox="0 0 54 54">
            <polygon points="27,1 36,15 18,15" fill="${bgColor}" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round" />
          </svg>
          <div class="marker-puck ${isLead ? 'lead-puck' : ''}" style="background:${bgColor}">
            ${svgIcon}
          </div>
        </div>
      </div>
    `;
  }

  // Smoothly interpolate marker lat/lng over ~850ms using requestAnimationFrame
  function animateMarkerPosition(id, marker, targetLat, targetLng) {
    if (markerAnimFrames[id]) {
      cancelAnimationFrame(markerAnimFrames[id]);
    }
    const startLatLng = marker.getLatLng();
    const dist = getDistanceMeters(startLatLng.lat, startLatLng.lng, targetLat, targetLng);

    // If jump is tiny (< 0.8m) or huge (> 400m), set immediately without interpolation
    if (dist < 0.8 || dist > 400) {
      marker.setLatLng([targetLat, targetLng]);
      return;
    }

    const duration = 850;
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const lat = startLatLng.lat + (targetLat - startLatLng.lat) * t;
      const lng = startLatLng.lng + (targetLng - startLatLng.lng) * t;
      marker.setLatLng([lat, lng]);

      if (t < 1) {
        markerAnimFrames[id] = requestAnimationFrame(step);
      } else {
        delete markerAnimFrames[id];
      }
    }

    markerAnimFrames[id] = requestAnimationFrame(step);
  }

  function renderOrUpdateVehicleOnMap(v, options = {}) {
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return;

    const { rebuildIcon = false, incrementalTrail = false, newTrailPoint = null, replaceLastTrail = false } = options;

    if (!vehicleMarkers[v.id]) {
      const icon = L.divIcon({
        className: 'custom-vehicle-div-icon',
        html: createVehicleMarkerHtml(v),
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });
      const marker = L.marker([v.lat, v.lng], {
        icon,
        zIndexOffset: v.role === 'lead' ? 1000 : (v.id === state.myId ? 900 : 500)
      });
      marker.on('click', () => {
        if (v.id !== state.myId) {
          startFollowing(v.id);
        } else {
          showToast('Đây là vị trí xe của bạn');
        }
      });
      marker.addTo(vehiclesLayerGroup);
      vehicleMarkers[v.id] = marker;
      renderVehicleTrail(v);
      return;
    }

    const marker = vehicleMarkers[v.id];
    animateMarkerPosition(v.id, marker, v.lat, v.lng);

    if (rebuildIcon) {
      const icon = L.divIcon({
        className: 'custom-vehicle-div-icon',
        html: createVehicleMarkerHtml(v),
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });
      marker.setIcon(icon);
      marker.setZIndexOffset(v.role === 'lead' ? 1000 : (v.id === state.myId ? 900 : 500));
    } else {
      // Patch DOM in-place for zero layout thrashing and silky CSS rotation
      const domEl = marker.getElement();
      if (domEl) {
        const wrapper = domEl.querySelector('.vehicle-marker-wrapper');
        if (wrapper) wrapper.style.opacity = v.online === false ? '0.6' : '1';

        const cone = domEl.querySelector('.direction-cone');
        if (cone && typeof v.heading === 'number') {
          const smoothDeg = getSmoothRotation(v.id, v.heading);
          cone.style.transform = `rotate(${smoothDeg}deg)`;
        }

        const speedTag = domEl.querySelector('.marker-speed-tag');
        if (speedTag) {
          speedTag.textContent = v.speed && v.speed > 1 ? `${v.speed}km/h` : '';
        }

        const bubble = domEl.querySelector('.marker-status-bubble');
        if (bubble) {
          const cleanStatus =
          v.statusMsg && v.statusTime && Date.now() - v.statusTime < STATUS_BUBBLE_TTL_MS
            ? v.statusMsg.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/u, '')
            : '';
          const hasFreshStatus = cleanStatus && v.statusTime && (Date.now() - v.statusTime < STATUS_BUBBLE_TTL_MS);
          if (hasFreshStatus) {
            bubble.textContent = cleanStatus;
            bubble.classList.remove('hidden');
            scheduleStatusBubbleExpiry(v.id);
          } else {
            bubble.classList.add('hidden');
          }
        }
      }
    }

    if (incrementalTrail && newTrailPoint && vehicleTrailLines[v.id]) {
      appendPointToExistingTrail(v, newTrailPoint, replaceLastTrail);
    } else if (!incrementalTrail || (newTrailPoint && !vehicleTrailLines[v.id])) {
      renderVehicleTrail(v);
    }
  }

  // O(1) incremental trail update instead of rebuilding hundreds of polyline points every second
  function appendPointToExistingTrail(v, pt, replaceLast) {
    const existing = vehicleTrailLines[v.id];
    if (!existing || !existing.casing || !existing.line) {
      renderVehicleTrail(v);
      return;
    }

    const latlngs = existing.line.getLatLngs();
    if (replaceLast && latlngs.length > 0) {
      latlngs[latlngs.length - 1] = L.latLng(pt.lat, pt.lng);
      existing.casing.setLatLngs(latlngs);
      existing.line.setLatLngs(latlngs);
    } else {
      existing.casing.addLatLng([pt.lat, pt.lng]);
      existing.line.addLatLng([pt.lat, pt.lng]);

      // Add a directional arrow every 8 trail points (cap at 22 arrows max for 300km+ performance)
      const totalPts = v.trail ? v.trail.length : latlngs.length;
      if (totalPts >= 3 && totalPts % 8 === 0) {
        const prevPt = v.trail[totalPts - 2];
        const angle = computeBearing(prevPt.lat, prevPt.lng, pt.lat, pt.lng);
        const isFollowed = state.followTargetId === v.id;
        const color = v.role === 'lead' ? '#e11d48' : (v.color || '#2563eb');
        const arrowIcon = L.divIcon({
          className: 'trail-arrow-icon',
          html: `<div style="transform: translate(-50%, -50%) rotate(${angle}deg); color:${color}; font-size:${isFollowed ? 13 : 10}px; font-weight:900; text-shadow: 0 0 3px #fff, 0 0 3px #fff;">▲</div>`,
          iconSize: [0, 0]
        });
        const arrowMarker = L.marker([pt.lat, pt.lng], { icon: arrowIcon, interactive: false }).addTo(trailsLayerGroup);
        existing.arrows.push(arrowMarker);
        if (existing.arrows.length > 22) {
          const oldestArrow = existing.arrows.shift();
          if (oldestArrow) trailsLayerGroup.removeLayer(oldestArrow);
        }
      }
    }
  }

  function renderVehicleTrail(v) {
    if (vehicleTrailLines[v.id]) {
      const old = vehicleTrailLines[v.id];
      if (old.casing) trailsLayerGroup.removeLayer(old.casing);
      if (old.line) trailsLayerGroup.removeLayer(old.line);
      if (old.arrows) old.arrows.forEach((a) => trailsLayerGroup.removeLayer(a));
      delete vehicleTrailLines[v.id];
    }

    const isFollowed = state.followTargetId === v.id;
    const shouldDraw =
      (isFollowed && state.showTrail) ||
      (state.showAllTrails && v.trail && v.trail.length > 1) ||
      (v.role === 'lead' && !state.followTargetId && state.showTrail);

    if (!shouldDraw || !Array.isArray(v.trail) || v.trail.length < 2) {
      return;
    }

    const latlngs = v.trail.map((pt) => [pt.lat, pt.lng]);
    const color = v.role === 'lead' ? '#e11d48' : (v.color || '#2563eb');

    const casing = L.polyline(latlngs, {
      color: '#ffffff',
      weight: isFollowed ? 9.5 : 6.5,
      opacity: isFollowed ? 0.92 : 0.68,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(trailsLayerGroup);

    const line = L.polyline(latlngs, {
      color,
      weight: isFollowed ? 5.5 : 3.5,
      opacity: isFollowed ? 0.96 : 0.78,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(trailsLayerGroup);

    // Prioritize arrows on the most recent 160 points & cap at 22 DOM markers for 100km-300km routes
    const arrows = [];
    const maxArrows = isFollowed ? 20 : 10;
    const startIdx = Math.max(1, latlngs.length - 160);
    const span = latlngs.length - startIdx;
    const step = Math.max(4, Math.ceil(span / maxArrows));
    for (let i = startIdx; i < latlngs.length; i += step) {
      const p1 = v.trail[i - 1];
      const p2 = v.trail[i];
      const angle = computeBearing(p1.lat, p1.lng, p2.lat, p2.lng);
      const arrowIcon = L.divIcon({
        className: 'trail-arrow-icon',
        html: `<div style="transform: translate(-50%, -50%) rotate(${angle}deg); color:${color}; font-size:${isFollowed ? 13 : 10}px; font-weight:900; text-shadow: 0 0 3px #fff, 0 0 3px #fff;">▲</div>`,
        iconSize: [0, 0]
      });
      const arrowMarker = L.marker([p2.lat, p2.lng], { icon: arrowIcon, interactive: false }).addTo(trailsLayerGroup);
      arrows.push(arrowMarker);
    }

    vehicleTrailLines[v.id] = { casing, line, arrows };
  }

  function refreshAllTrails() {
    Object.values(state.vehicles).forEach((v) => renderVehicleTrail(v));
  }

  function removeVehicleFromMap(id) {
    if (vehicleMarkers[id]) {
      vehiclesLayerGroup.removeLayer(vehicleMarkers[id]);
      delete vehicleMarkers[id];
    }
    if (vehicleTrailLines[id]) {
      const old = vehicleTrailLines[id];
      if (old.casing) trailsLayerGroup.removeLayer(old.casing);
      if (old.line) trailsLayerGroup.removeLayer(old.line);
      if (old.arrows) old.arrows.forEach((a) => trailsLayerGroup.removeLayer(a));
      delete vehicleTrailLines[id];
    }
    if (state.followTargetId === id) {
      stopFollowing();
    }
  }

  // ==================== WAYPOINTS RENDERING ====================
  function renderWaypoints() {
    waypointsLayerGroup.clearLayers();
    el.tabWaypointCount.textContent = state.waypoints.length;

    state.waypoints.forEach((wp) => {
      const divIcon = L.divIcon({
        className: 'custom-wp-icon',
        html: `
          <div class="wp-map-marker">
            <div class="wp-map-label">${escapeHtml(wp.title)}</div>
            <svg class="wp-map-pin-svg" width="28" height="28" viewBox="0 0 24 24" fill="#e11d48" stroke="#ffffff" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3" fill="#ffffff"/></svg>
          </div>
        `,
        iconSize: [0, 0]
      });

      const marker = L.marker([wp.lat, wp.lng], { icon: divIcon, zIndexOffset: 700 }).addTo(waypointsLayerGroup);
      marker.on('click', () => {
        startFollowing(`wp:${wp.id}`);
      });
    });

    if (state.waypoints.length === 0) {
      el.waypointListContainer.innerHTML = `
        <div style="text-align:center; padding: 16px; color:#64748b; font-size:13px;">
          Chưa có Điểm Hẹn Cưới cố định nào.<br/>Hãy thêm <strong>Nhà Trai, Nhà Gái, Nhà Hàng</strong> để đồng bộ lên bản đồ của cả đoàn.
        </div>
      `;
      return;
    }

    el.waypointListContainer.innerHTML = state.waypoints
      .map((wp) => {
        const typeBadge = getWaypointTypeLabel(wp.type);
        const isFollowingWp = state.followTargetId === `wp:${wp.id}`;
        const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${wp.lat},${wp.lng}&travelmode=driving`;
        return `
          <div class="wp-card">
            <div class="wp-card-left">
              <div class="wp-badge-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <div class="wp-text">
                <h4>${escapeHtml(wp.title)}</h4>
                <p>${wp.note ? escapeHtml(wp.note) : typeBadge}</p>
              </div>
            </div>
            <div class="wp-card-actions">
              <button type="button" class="btn-wp-action primary" data-action="follow-wp" data-id="${wp.id}">
                ${isFollowingWp ? 'Đang khóa' : 'Chỉ đường'}
              </button>
              <a class="btn-wp-action" href="${gmapsUrl}" target="_blank" rel="noopener" style="text-decoration:none;">
                G.Maps
              </a>
              <button type="button" class="btn-wp-action" data-action="delete-wp" data-id="${wp.id}" title="Xoá điểm hẹn">✕</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // ==================== FOLLOW MODE & LIVE OSRM ROUTING ====================
  function startFollowing(targetId) {
    state.followTargetId = targetId;
    localStorage.setItem('wc_followTargetId', targetId);
    state.cameraMode = 'target';
    updateCameraModeButtons();
    el.followHud.classList.remove('hidden');

    refreshAllTrails();
    updateFollowHudAndCamera(true);
    renderVehicleCardsList();
    renderWaypoints();
  }

  function stopFollowing() {
    state.followTargetId = null;
    localStorage.removeItem('wc_followTargetId');
    el.followHud.classList.add('hidden');
    clearActiveRoute();
    refreshAllTrails();
    renderVehicleCardsList();
    renderWaypoints();
  }

  function setCameraMode(mode) {
    state.cameraMode = mode;
    updateCameraModeButtons();
    updateFollowHudAndCamera(true);
  }

  function updateCameraModeButtons() {
    [el.camBtnTarget, el.camBtnBoth, el.camBtnFree].forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.cam === state.cameraMode);
    });
  }

  function clearActiveRoute() {
    if (activeRouteCasing) {
      routeLayerGroup.removeLayer(activeRouteCasing);
      activeRouteCasing = null;
    }
    if (activeRouteLine) {
      routeLayerGroup.removeLayer(activeRouteLine);
      activeRouteLine = null;
    }
    lastRouteKey = '';
  }

  function formatEtaMinutes(mins) {
    if (mins < 60) return `~${mins} phút`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `~${h} giờ ${m} phút` : `~${h} giờ`;
  }

  async function updateDrivingRoute(fromLat, fromLng, toLat, toLng) {
    if (!state.showRoute) {
      clearActiveRoute();
      return;
    }

    const directMeters = getDistanceMeters(fromLat, fromLng, toLat, toLng);
    if (directMeters < 25) {
      clearActiveRoute();
      el.followDistanceText.textContent = `Cách bạn: ${Math.round(directMeters)} m`;
      el.followEtaText.textContent = 'Đang ở ngay sát nhau';
      return;
    }

    // Distance-adaptive OSRM routing throttle for 100km - 300km+ highway routes
    const minRefreshMs = directMeters > 20000 ? 25000 : (directMeters > 3000 ? 11000 : 4000);
    const now = Date.now();
    const routeKey = `${fromLat.toFixed(4)},${fromLng.toFixed(4)}->${toLat.toFixed(4)},${toLng.toFixed(4)}`;
    if (routeKey === lastRouteKey && now - lastRouteFetchTime < 30000) {
      return;
    }
    if (now - lastRouteFetchTime < minRefreshMs) {
      return;
    }

    lastRouteFetchTime = now;
    lastRouteKey = routeKey;

    try {
      const overviewType = directMeters > 50000 ? 'simplified' : 'full';
      const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=${overviewType}&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('OSRM error');
      const data = await res.json();

      if (!state.followTargetId || !state.showRoute) return;

      if (data.routes && data.routes[0]) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        drawRoutePolyline(coords);

        const distText = formatDistance(route.distance);
        const mins = Math.max(1, Math.round(route.duration / 60));
        el.followDistanceText.textContent = `Cách bạn: ${distText}`;
        el.followEtaText.textContent = `Lộ trình: ${formatEtaMinutes(mins)}`;
        return;
      }
    } catch (e) {
      drawRoutePolyline([[fromLat, fromLng], [toLat, toLng]]);
      el.followDistanceText.textContent = `Khoảng cách: ${formatDistance(directMeters)}`;
      el.followEtaText.textContent = 'Đường thẳng trực tiếp';
    }
  }

  function drawRoutePolyline(latlngs) {
    if (activeRouteCasing) routeLayerGroup.removeLayer(activeRouteCasing);
    if (activeRouteLine) routeLayerGroup.removeLayer(activeRouteLine);

    activeRouteCasing = L.polyline(latlngs, {
      color: '#090d16',
      weight: 8,
      opacity: 0.65,
      lineCap: 'round'
    }).addTo(routeLayerGroup);

    activeRouteLine = L.polyline(latlngs, {
      color: '#22d3ee',
      weight: 5,
      dashArray: '10, 10',
      opacity: 0.96,
      lineCap: 'round'
    }).addTo(routeLayerGroup);
  }

  function updateFollowHudAndCamera(forceCamera = false) {
    if (!state.followTargetId) return;

    let targetLat = null;
    let targetLng = null;
    let targetTitle = '';
    let targetSpeed = 0;
    let targetStatus = '';

    if (state.followTargetId.startsWith('wp:')) {
      const wpId = state.followTargetId.slice(3);
      const wp = state.waypoints.find((w) => w.id === wpId);
      if (!wp) {
        stopFollowing();
        return;
      }
      targetLat = wp.lat;
      targetLng = wp.lng;
      targetTitle = wp.title;
      el.followModeTag.textContent = getWaypointTypeLabel(wp.type);
      if (el.hudSpeedBox) el.hudSpeedBox.classList.add('hidden');
    } else {
      const v = state.vehicles[state.followTargetId];
      if (!v || typeof v.lat !== 'number') {
        return;
      }
      targetLat = v.lat;
      targetLng = v.lng;
      targetTitle = `${v.name}${v.plate ? ` • ${v.plate}` : ''}`;
      targetSpeed = v.speed || 0;
      targetStatus = v.statusMsg ? v.statusMsg.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/u, '') : '';
      el.followModeTag.textContent = v.role === 'lead' ? 'ĐANG BÁM XE HOA' : 'ĐANG KHÓA MỤC TIÊU';
      if (el.hudSpeedBox) el.hudSpeedBox.classList.remove('hidden');
      el.followTargetSpeed.textContent = `${targetSpeed}`;
    }

    el.followTargetName.textContent = targetTitle;
    if (el.btnOpenFollowGmaps && typeof targetLat === 'number' && typeof targetLng === 'number') {
      el.btnOpenFollowGmaps.href = `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`;
    }

    if (typeof state.myLat === 'number' && typeof state.myLng === 'number') {
      const directDist = getDistanceMeters(state.myLat, state.myLng, targetLat, targetLng);
      if (!state.showRoute) {
        el.followDistanceText.textContent = `Cách bạn: ${formatDistance(directDist)}`;
        el.followEtaText.textContent = targetStatus ? `"${targetStatus}"` : 'Đang vẽ vệt lộ trình xe trước';
      } else {
        updateDrivingRoute(state.myLat, state.myLng, targetLat, targetLng);
      }
    } else {
      clearActiveRoute();
      el.followDistanceText.textContent = 'Chế độ quan sát';
      el.followEtaText.textContent = targetStatus ? `"${targetStatus}"` : 'Đang vẽ trực tiếp lộ trình di chuyển';
    }

    if (state.cameraMode === 'target') {
      map.panTo([targetLat, targetLng], { animate: true, duration: 0.6 });
    } else if (state.cameraMode === 'both') {
      if (state.simulating && state.vehicles['DEMO-XE-3'] && state.followTargetId === 'DEMO-XE-HOA') {
        const tailCar = state.vehicles['DEMO-XE-3'];
        const bounds = L.latLngBounds([
          [tailCar.lat, tailCar.lng],
          [targetLat, targetLng]
        ]);
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 17, animate: forceCamera });
      } else if (typeof state.myLat === 'number' && typeof state.myLng === 'number') {
        const bounds = L.latLngBounds([
          [state.myLat, state.myLng],
          [targetLat, targetLng]
        ]);
        map.fitBounds(bounds, { padding: [90, 90], maxZoom: 17, animate: forceCamera });
      } else {
        map.panTo([targetLat, targetLng], { animate: true });
      }
    }
  }

  // ==================== RENDER BOTTOM SHEET VEHICLE CARDS ====================
  function renderVehicleCardsList() {
    const list = Object.values(state.vehicles);

    list.sort((a, b) => {
      if (a.role === 'lead' && b.role !== 'lead') return -1;
      if (b.role === 'lead' && a.role !== 'lead') return 1;
      if (a.id === state.myId) return -1;
      if (b.id === state.myId) return 1;
      return (b.online ? 1 : 0) - (a.online ? 1 : 0);
    });

    const totalCount = list.length;
    el.vehicleCountBadge.textContent = `${totalCount} xe`;
    el.tabVehicleCount.textContent = totalCount;

    if (totalCount === 0) {
      el.vehicleListContainer.innerHTML = `
        <div style="padding:16px; color:#64748b; font-size:13px; line-height:1.5;">
          Chưa có xe nào trong phòng. Hãy bấm nút <strong>"Chạy thử"</strong> ở thanh trên cùng để kích hoạt đoàn xe mô phỏng trên Google Maps!
        </div>
      `;
      return;
    }

    el.vehicleListContainer.innerHTML = list
      .map((v) => {
        const isMe = v.id === state.myId;
        const isFollowing = state.followTargetId === v.id;
        const svgIcon = getRoleSvg(v.role, 20);
        const bgColor = v.role === 'lead' ? '#e11d48' : (v.color || '#2563eb');

        let distStr = 'Đang đồng bộ GPS...';
        if (isMe) {
          distStr = 'Vị trí xe của bạn';
        } else if (typeof state.myLat === 'number' && typeof v.lat === 'number') {
          const d = getDistanceMeters(state.myLat, state.myLng, v.lat, v.lng);
          distStr = `Cách bạn ${formatDistance(d)}`;
        } else if (typeof v.lat === 'number') {
          distStr = `Lộ trình: ${v.trail ? v.trail.length : 1} điểm mốc`;
        }

        const cleanStatus =
          v.statusMsg && v.statusTime && Date.now() - v.statusTime < STATUS_BUBBLE_TTL_MS
            ? v.statusMsg.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/u, '')
            : '';
        const statusHtml = cleanStatus
          ? `<div class="vcard-status-msg">${escapeHtml(cleanStatus)}</div>`
          : '';
        const isCarHost = Boolean(v.isHostVehicle || (state.hostVehicleId && v.id === state.hostVehicleId));

        return `
          <div class="vehicle-card ${isFollowing ? 'is-following' : ''} ${isMe ? 'is-me' : ''}" data-vid="${v.id}">
            <div class="vcard-top">
              <div class="vcard-avatar" style="background:${bgColor}">
                ${svgIcon}
                <span class="vcard-online-dot ${v.online === false ? 'offline' : ''}"></span>
              </div>
              <div class="vcard-info">
                <div class="vcard-title-row">
                  <span class="vcard-name">${escapeHtml(v.name)}${isMe ? ' (Bạn)' : ''}</span>
                  ${isCarHost ? `<span class="host-tag-pill">Chủ phòng</span>` : ''}
                </div>
                <div class="vcard-meta">
                  ${v.plate ? `<span class="plate-badge">${escapeHtml(v.plate)}</span>` : ''}
                  <span class="speed-mono">${v.speed || 0} km/h</span>
                  <span>•</span>
                  <span style="color:${v.online === false ? '#ef4444' : '#10b981'}; font-weight:700;">
                    ${v.online === false ? 'Tạm mất tín hiệu' : 'Trực tiếp'}
                  </span>
                </div>
              </div>
            </div>
            ${statusHtml}
            <div class="vcard-actions">
              <span class="vcard-distance">${distStr}</span>
              <div style="display:flex; align-items:center; gap:5px;">
                ${
                  state.isHost && !isMe && !v.isDemo
                    ? `<button type="button" class="vc-btn kick-btn" data-action="kick-car" data-id="${v.id}" data-name="${escapeHtml(v.name)}" title="Xoá xe này khỏi phòng">Xoá xe</button>`
                    : ''
                }
                ${
                  isMe
                    ? `<button type="button" class="btn-follow-car" data-action="center-me">Định tâm xe tôi</button>`
                    : `<button type="button" class="btn-follow-car ${isFollowing ? 'active' : ''}" data-action="follow-car" data-id="${v.id}">
                        ${isFollowing ? 'Đang khóa mục tiêu' : 'Bám lộ trình'}
                      </button>`
                }
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // Lightweight in-place DOM update for vehicle card telemetry (avoids rebuilding innerHTML on every GPS tick)
  function patchVehicleCardTelemetry(v) {
    const card = el.vehicleListContainer.querySelector(`.vehicle-card[data-vid="${CSS.escape(v.id)}"]`);
    if (!card) {
      renderVehicleCardsList();
      return;
    }

    const speedEl = card.querySelector('.speed-mono');
    if (speedEl) speedEl.textContent = `${v.speed || 0} km/h`;

    const dotEl = card.querySelector('.vcard-online-dot');
    if (dotEl) dotEl.classList.toggle('offline', v.online === false);

    const distEl = card.querySelector('.vcard-distance');
    if (distEl) {
      if (v.id === state.myId) {
        distEl.textContent = 'Vị trí xe của bạn';
      } else if (typeof state.myLat === 'number' && typeof v.lat === 'number') {
        const d = getDistanceMeters(state.myLat, state.myLng, v.lat, v.lng);
        distEl.textContent = `Cách bạn ${formatDistance(d)}`;
      } else if (typeof v.lat === 'number') {
        distEl.textContent = `Lộ trình: ${v.trail ? v.trail.length : 1} điểm mốc`;
      }
    }
  }

  // ==================== SOCKET.IO EVENTS ====================
  socket.on('connect', () => {
    el.connectionDot.classList.remove('offline');
    if (state.hasJoined) {
      emitJoinRoom(state.pendingJoinMode || 'rejoin');
      // Flush buffered GPS trail points recorded while driving through a 4G dead zone
      if (!state.viewOnly && offlineTrailBuffer.length > 0) {
        socket.emit('vehicle:sync-offline-trail', {
          id: state.myId,
          points: offlineTrailBuffer
        });
        offlineTrailBuffer = [];
      }
    }
  });

  // Keep-Alive Heartbeat every 3 minutes ONLY when actively inside a room
  setInterval(() => {
    if (state.hasJoined) {
      fetch('/api/ping').catch(() => {});
    }
  }, 180000);

  socket.on('disconnect', () => {
    el.connectionDot.classList.add('offline');
  });

  socket.on('room:state', (payload) => {
    state.roomCode = payload.code;
    state.isHost = Boolean(payload.isHost);
    state.hostVehicleId = payload.hostVehicleId || null;
    state.vehicles = payload.vehicles || {};
    state.waypoints = payload.waypoints || [];
    state.simulating = Boolean(payload.simulating);
    state.hasJoined = true;
    state.pendingJoinMode = 'rejoin';

    localStorage.setItem('wc_inRoom', 'true');
    localStorage.setItem('wc_roomCode', state.roomCode);

    hideModalError();
    el.setupModal.classList.add('hidden');
    el.displayRoomCode.textContent = state.roomCode;
    if (el.hostCrownBadge) {
      el.hostCrownBadge.classList.toggle('hidden', !state.isHost);
    }
    if (el.btnDeleteRoomMenu) {
      el.btnDeleteRoomMenu.classList.toggle('hidden', !state.isHost);
    }

    el.btnDemoMode.classList.toggle('active', state.simulating);
    el.demoBtnLabel.textContent = state.simulating ? 'Dừng Chạy Thử' : 'Chạy Thử Mô Phỏng';

    Object.keys(vehicleMarkers).forEach((id) => {
      if (!state.vehicles[id]) removeVehicleFromMap(id);
    });
    Object.values(state.vehicles).forEach((v) => {
      renderOrUpdateVehicleOnMap(v, { rebuildIcon: true });
    });

    renderWaypoints();
    renderVehicleCardsList();

    // Restore follow HUD if target still exists in room
    if (state.followTargetId) {
      const isWp = state.followTargetId.startsWith('wp:');
      const exists = isWp
        ? state.waypoints.some((w) => `wp:${w.id}` === state.followTargetId)
        : Boolean(state.vehicles[state.followTargetId]);
      if (exists) {
        el.followHud.classList.remove('hidden');
        updateFollowHudAndCamera(false);
      } else {
        stopFollowing();
      }
    }
  });

  socket.on('room:error', (err) => {
    const code = err && err.code;
    const msg = (err && err.message) || 'Không thể kết nối vào phòng đoàn xe.';

    if (code === 'ROOM_NOT_FOUND' || code === 'ROOM_EXISTS' || code === 'INVALID_CODE') {
      state.hasJoined = false;
      localStorage.setItem('wc_inRoom', 'false');
      stopGpsTracking();
      clearMapRoomEntities();
      openLobbyModal(code === 'ROOM_EXISTS' ? 'join' : 'join', msg);
    } else {
      showToast(msg);
    }
  });

  socket.on('vehicle:kicked', (data) => {
    const msg = (data && data.message) || 'Chủ phòng đã xoá xe của bạn khỏi phòng đoàn xe.';
    resetToLobbyScreen(msg);
  });

  socket.on('room:closed', (data) => {
    const msg = (data && data.message) || 'Phòng đoàn xe đã được Chủ phòng đóng lại.';
    resetToLobbyScreen(msg);
  });

  socket.on('vehicle:left', () => {
    resetToLobbyScreen('Bạn đã thoát khỏi phòng đoàn xe.');
  });

  socket.on('vehicle:joined', (v) => {
    state.vehicles[v.id] = v;
    renderOrUpdateVehicleOnMap(v, { rebuildIcon: true });
    renderVehicleCardsList();
    if (v.id !== state.myId) {
      showToast(`${v.name} vừa kết nối vào đoàn xe`);
    }
  });

  socket.on('vehicle:location', (data) => {
    const v = state.vehicles[data.id];
    if (!v) return;

    v.lat = data.lat;
    v.lng = data.lng;
    v.heading = data.heading;
    v.speed = data.speed;
    v.accuracy = data.accuracy;
    v.online = true;
    v.lastUpdated = data.lastUpdated;

    if (data.newTrailPoint) {
      if (!Array.isArray(v.trail)) v.trail = [];
      if (data.replaceLastTrail && v.trail.length > 0) {
        v.trail[v.trail.length - 1] = data.newTrailPoint;
      } else {
        v.trail.push(data.newTrailPoint);
      }
    }

    renderOrUpdateVehicleOnMap(v, {
      rebuildIcon: false,
      incrementalTrail: true,
      newTrailPoint: data.newTrailPoint,
      replaceLastTrail: Boolean(data.replaceLastTrail)
    });

    patchVehicleCardTelemetry(v);

    // If my own GPS moved, also refresh relative distances on other cards
    if (data.id === state.myId) {
      Object.values(state.vehicles).forEach((other) => {
        if (other.id !== state.myId) patchVehicleCardTelemetry(other);
      });
    }

    if (state.followTargetId === v.id || data.id === state.myId) {
      updateFollowHudAndCamera(false);
    }
  });

  socket.on('vehicle:updated', (v) => {
    state.vehicles[v.id] = v;
    renderOrUpdateVehicleOnMap(v, { rebuildIcon: true });
    renderVehicleCardsList();
    updateFollowHudAndCamera(false);
  });

  socket.on('vehicle:status-broadcast', (data) => {
    const v = state.vehicles[data.id];
    if (v) {
      v.statusMsg = data.statusMsg;
      v.statusTime = data.statusTime;
      renderOrUpdateVehicleOnMap(v, { rebuildIcon: false });
      renderVehicleCardsList();
    }
    showToast(`${data.name}: "${data.statusMsg}"`);
    if (data.id !== state.myId) {
      playPingSound();
    }
  });

  socket.on('vehicle:trail-cleared', (data) => {
    const v = state.vehicles[data.id];
    if (v) {
      v.trail = data.trail || [];
      renderVehicleTrail(v);
    }
  });

  // Erase old trail segments behind the LAST car in the convoy in real time
  socket.on('vehicle:trail-trimmed', (data) => {
    const v = state.vehicles[data.id];
    if (!v || !Array.isArray(v.trail) || !data.trimCount || data.trimCount <= 0) return;

    v.trail.splice(0, data.trimCount);

    const existing = vehicleTrailLines[v.id];
    if (existing && existing.casing && existing.line) {
      if (v.trail.length < 2) {
        renderVehicleTrail(v);
      } else {
        const latlngs = v.trail.map((pt) => [pt.lat, pt.lng]);
        existing.casing.setLatLngs(latlngs);
        existing.line.setLatLngs(latlngs);

        // Remove any directional arrow markers that were behind the new tail point
        if (existing.arrows && existing.arrows.length > 0) {
          const tailPt = v.trail[0];
          while (existing.arrows.length > 0) {
            const firstArrow = existing.arrows[0];
            const arrowPos = firstArrow.getLatLng();
            // Check if this arrow is still on the active trail
            const stillOnTrail = v.trail.some(
              (pt) => getDistanceMeters(arrowPos.lat, arrowPos.lng, pt.lat, pt.lng) < 8
            );
            if (!stillOnTrail) {
              trailsLayerGroup.removeLayer(firstArrow);
              existing.arrows.shift();
            } else {
              break;
            }
          }
        }
      }
    }
  });

  socket.on('vehicle:offline', (data) => {
    const v = state.vehicles[data.id];
    if (v) {
      v.online = false;
      v.lastUpdated = data.lastUpdated;
      renderOrUpdateVehicleOnMap(v);
      renderVehicleCardsList();
    }
  });

  socket.on('vehicle:removed', (data) => {
    delete state.vehicles[data.id];
    removeVehicleFromMap(data.id);
    renderVehicleCardsList();
    if (data && data.kickedByHost && data.name) {
      showToast(`Chủ phòng đã xoá xe "${data.name}" khỏi phòng`);
    }
  });

  socket.on('waypoints:update', (waypoints) => {
    state.waypoints = waypoints || [];
    renderWaypoints();
  });

  // ==================== ROOM LOBBY, CREATE / JOIN & HOST MANAGEMENT ====================
  function clearMapRoomEntities() {
    Object.keys(vehicleMarkers).forEach((id) => removeVehicleFromMap(id));
    state.vehicles = {};
    state.waypoints = [];
    state.simulating = false;
    state.isHost = false;
    state.hostVehicleId = null;
    stopFollowing();
    renderWaypoints();
    renderVehicleCardsList();
    el.displayRoomCode.textContent = 'CHƯA VÀO PHÒNG';
    if (el.hostCrownBadge) el.hostCrownBadge.classList.add('hidden');
    if (el.btnDeleteRoomMenu) el.btnDeleteRoomMenu.classList.add('hidden');
  }

  function showModalError(msg) {
    if (!el.roomModalError) return;
    el.roomModalError.textContent = msg;
    el.roomModalError.classList.remove('hidden');
  }

  function hideModalError() {
    if (!el.roomModalError) return;
    el.roomModalError.textContent = '';
    el.roomModalError.classList.add('hidden');
  }

  function setRoomModalMode(mode) {
    state.roomModalMode = mode; // 'join' | 'create' | 'edit'
    hideModalError();

    if (mode === 'edit') {
      if (el.roomModeTabs) el.roomModeTabs.classList.add('hidden');
      if (el.roomCodeFormGroup) el.roomCodeFormGroup.classList.add('hidden');
      if (el.btnCloseSetupModal) el.btnCloseSetupModal.classList.remove('hidden');
      if (el.setupModalTitle) el.setupModalTitle.textContent = 'Cài Đặt Xe Của Tôi';
      if (el.setupModalSubtitle) el.setupModalSubtitle.textContent = `Đang hoạt động trong phòng ${state.roomCode}`;
      if (el.btnSubmitSetupText) el.btnSubmitSetupText.textContent = 'Lưu Thay Đổi Xe';
      if (el.btnViewOnlyMode) el.btnViewOnlyMode.classList.add('hidden');
      if (el.btnClearMyTrail) el.btnClearMyTrail.classList.remove('hidden');
      if (el.btnLeaveRoomModal) el.btnLeaveRoomModal.classList.remove('hidden');
      return;
    }

    if (el.roomModeTabs) el.roomModeTabs.classList.remove('hidden');
    if (el.roomCodeFormGroup) el.roomCodeFormGroup.classList.remove('hidden');
    if (el.btnCloseSetupModal) el.btnCloseSetupModal.classList.toggle('hidden', !state.hasJoined);
    if (el.btnViewOnlyMode) el.btnViewOnlyMode.classList.toggle('hidden', mode === 'create');
    if (el.btnClearMyTrail) el.btnClearMyTrail.classList.add('hidden');
    if (el.btnLeaveRoomModal) el.btnLeaveRoomModal.classList.add('hidden');

    if (el.tabModeJoin) el.tabModeJoin.classList.toggle('active', mode === 'join');
    if (el.tabModeCreate) el.tabModeCreate.classList.toggle('active', mode === 'create');

    if (mode === 'create') {
      if (el.setupModalTitle) el.setupModalTitle.textContent = 'Mở Phòng Đoàn Xe Mới';
      if (el.setupModalSubtitle) el.setupModalSubtitle.textContent = 'Bạn là Chủ phòng — Tạo mã phòng để các xe khác nhập vào';
      if (el.roomCodeLabel) el.roomCodeLabel.textContent = 'Đặt Mã Phòng Cho Đoàn Cưới Của Bạn';
      if (el.roomModeHint) el.roomModeHint.textContent = 'Bạn sẽ có quyền Chủ phòng (có thể xoá xe lạ hoặc đóng phòng sau đám cưới).';
      if (el.btnRandomRoomCode) el.btnRandomRoomCode.classList.remove('hidden');
      if (el.btnSubmitSetupText) el.btnSubmitSetupText.textContent = 'Mở Phòng Mới & Bật Định Vị';
    } else {
      if (el.setupModalTitle) el.setupModalTitle.textContent = 'Nhập Mã Vào Phòng Đoàn';
      if (el.setupModalSubtitle) el.setupModalSubtitle.textContent = 'Nhập mã phòng do Trưởng đoàn (Chủ phòng) đã mở';
      if (el.roomCodeLabel) el.roomCodeLabel.textContent = 'Mã Phòng Đoàn Xe (Do Chủ phòng cung cấp)';
      if (el.roomModeHint) el.roomModeHint.textContent = 'Lưu ý: Phòng phải được Chủ phòng tạo trước thì các xe mới vào được.';
      if (el.btnRandomRoomCode) el.btnRandomRoomCode.classList.add('hidden');
      if (el.btnSubmitSetupText) el.btnSubmitSetupText.textContent = 'Vào Phòng Đoàn Xe';
    }
  }

  function openLobbyModal(mode = 'join', errorMsg = '') {
    setRoomModalMode(mode);
    if (errorMsg) showModalError(errorMsg);
    el.setupModal.classList.remove('hidden');
  }

  function resetToLobbyScreen(toastMessage) {
    closeTopMenu();
    closePingMenu();
    stopGpsTracking();
    state.hasJoined = false;
    state.viewOnly = false;
    localStorage.setItem('wc_inRoom', 'false');
    localStorage.setItem('wc_viewOnly', 'false');
    clearMapRoomEntities();
    openLobbyModal('join');
    if (toastMessage) showToast(toastMessage);
  }

  function emitJoinRoom(joinMode = 'rejoin') {
    el.displayRoomCode.textContent = state.roomCode;
    const newUrl = `${window.location.pathname}?room=${encodeURIComponent(state.roomCode)}`;
    window.history.replaceState({}, '', newUrl);

    socket.emit('room:join', {
      roomCode: state.roomCode,
      mode: joinMode, // 'create' | 'join' | 'rejoin'
      hostToken: state.hostToken,
      vehicle: state.viewOnly
        ? null
        : {
            id: state.myId,
            name: state.myName,
            plate: state.myPlate,
            role: state.myRole,
            color: state.myColor,
            lat: state.myLat,
            lng: state.myLng,
            heading: state.myHeading,
            speed: state.mySpeed
          }
    });
  }

  el.inputRoomCode.value = state.roomCode;
  el.inputVehicleName.value = state.myName;
  el.inputVehiclePlate.value = state.myPlate;
  const roleRadio = document.querySelector(`input[name="vehicleRole"][value="${state.myRole}"]`);
  if (roleRadio) roleRadio.checked = true;
  document.querySelectorAll('.color-swatch').forEach((s) => {
    s.classList.toggle('selected', s.dataset.color === state.myColor);
  });

  if (el.tabModeJoin) {
    el.tabModeJoin.addEventListener('click', () => setRoomModalMode('join'));
  }
  if (el.tabModeCreate) {
    el.tabModeCreate.addEventListener('click', () => setRoomModalMode('create'));
  }
  if (el.btnCloseSetupModal) {
    el.btnCloseSetupModal.addEventListener('click', () => {
      if (state.hasJoined) el.setupModal.classList.add('hidden');
    });
  }
  if (el.btnRandomRoomCode) {
    el.btnRandomRoomCode.addEventListener('click', () => {
      const rand = Math.floor(100 + Math.random() * 900);
      el.inputRoomCode.value = `DON-DAU-${rand}`;
    });
  }

  el.colorPickerRow.addEventListener('click', (e) => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    document.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
    swatch.classList.add('selected');
    state.myColor = swatch.dataset.color;
  });

  document.querySelectorAll('input[name="vehicleRole"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'lead') {
        state.myColor = '#e11d48';
        document.querySelectorAll('.color-swatch').forEach((s) => {
          s.classList.toggle('selected', s.dataset.color === '#e11d48');
        });
      }
    });
  });

  el.setupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomCode = (el.inputRoomCode.value || 'DAM-CUOI').trim().toUpperCase();
    const name = (el.inputVehicleName.value || 'Xe Đoàn Cưới').trim();
    const plate = (el.inputVehiclePlate.value || '').trim().toUpperCase();
    const selectedRole = document.querySelector('input[name="vehicleRole"]:checked')?.value || 'convoy';

    state.myName = name;
    state.myPlate = plate;
    state.myRole = selectedRole;
    state.viewOnly = false;

    localStorage.setItem('wc_vehicleName', state.myName);
    localStorage.setItem('wc_vehiclePlate', state.myPlate);
    localStorage.setItem('wc_vehicleRole', state.myRole);
    localStorage.setItem('wc_vehicleColor', state.myColor);
    localStorage.setItem('wc_viewOnly', 'false');

    // If user is already inside the room and just editing their vehicle profile
    if (state.roomModalMode === 'edit' && state.hasJoined) {
      socket.emit('vehicle:update-profile', {
        id: state.myId,
        name: state.myName,
        plate: state.myPlate,
        role: state.myRole,
        color: state.myColor
      });
      el.setupModal.classList.add('hidden');
      startGpsTracking();
      showToast('Đã cập nhật thông tin xe của bạn');
      return;
    }

    state.roomCode = roomCode;
    state.hasJoined = true;
    const actionMode = state.roomModalMode === 'create' ? 'create' : 'join';
    state.pendingJoinMode = actionMode;

    localStorage.setItem('wc_roomCode', state.roomCode);
    localStorage.setItem('wc_inRoom', 'true');

    hideModalError();
    emitJoinRoom(actionMode);
    startGpsTracking();
    requestWakeLock();
  });

  el.btnViewOnlyMode.addEventListener('click', () => {
    const roomCode = (el.inputRoomCode.value || 'DAM-CUOI').trim().toUpperCase();
    state.roomCode = roomCode;
    state.viewOnly = true;
    state.hasJoined = true;
    state.pendingJoinMode = 'join';

    localStorage.setItem('wc_roomCode', state.roomCode);
    localStorage.setItem('wc_viewOnly', 'true');
    localStorage.setItem('wc_inRoom', 'true');

    hideModalError();
    emitJoinRoom('join');
    requestWakeLock();
  });

  el.btnClearMyTrail.addEventListener('click', () => {
    socket.emit('vehicle:clear-trail', { id: state.myId });
    el.setupModal.classList.add('hidden');
    showToast('Đã làm mới vệt lộ trình của xe bạn');
  });

  function handleLeaveRoomAction() {
    closeTopMenu();
    socket.emit('vehicle:leave', { id: state.myId });
    resetToLobbyScreen('Đã thoát khỏi phòng đoàn xe');
  }

  if (el.btnLeaveRoomMenu) {
    el.btnLeaveRoomMenu.addEventListener('click', handleLeaveRoomAction);
  }
  if (el.btnLeaveRoomModal) {
    el.btnLeaveRoomModal.addEventListener('click', handleLeaveRoomAction);
  }

  if (el.btnDeleteRoomMenu) {
    el.btnDeleteRoomMenu.addEventListener('click', () => {
      closeTopMenu();
      const confirmed = window.confirm(
        `Bạn là Chủ phòng "${state.roomCode}". Bạn có chắc chắn muốn XOÁ & ĐÓNG toàn bộ phòng này không? Tất cả các xe trong đoàn sẽ được đưa ra ngoài.`
      );
      if (!confirmed) return;
      socket.emit('room:delete', { hostToken: state.hostToken });
    });
  }

  function closeTopMenu() {
    if (el.topVerticalMenu) el.topVerticalMenu.classList.add('hidden');
    if (el.topMenuWrap) el.topMenuWrap.classList.remove('open');
  }

  function closePingMenu() {
    if (el.quickPingBar) el.quickPingBar.classList.add('hidden');
    if (el.btnTogglePingPod) el.btnTogglePingPod.classList.remove('active');
  }

  if (el.btnToggleTopMenu) {
    el.btnToggleTopMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = el.topVerticalMenu.classList.toggle('hidden');
      el.topMenuWrap.classList.toggle('open', !isHidden);
    });
  }

  map.on('click', () => {
    closeTopMenu();
    closePingMenu();
  });

  el.btnEditProfile.addEventListener('click', () => {
    closeTopMenu();
    setRoomModalMode(state.hasJoined ? 'edit' : 'join');
    el.setupModal.classList.remove('hidden');
  });

  el.btnQuickFollowLead.addEventListener('click', () => {
    closeTopMenu();
    const leadCar = Object.values(state.vehicles).find((v) => v.role === 'lead');
    if (leadCar) {
      startFollowing(leadCar.id);
      if (typeof leadCar.lat === 'number') {
        map.setView([leadCar.lat, leadCar.lng], 16, { animate: true });
      }
      showToast(`Đang khóa lộ trình theo ${leadCar.name}`);
    } else {
      showToast('Chưa có Xe Hoa. Bấm vào Mã đoàn góc trái -> Chọn "Chạy Thử Mô Phỏng"!');
    }
  });

  el.btnDemoMode.addEventListener('click', () => {
    closeTopMenu();
    const center = state.myLat
      ? { lat: state.myLat, lng: state.myLng }
      : map.getCenter();
    socket.emit('simulator:toggle', { lat: center.lat, lng: center.lng });

    if (!state.simulating) {
      showToast('Đang khởi chạy đoàn 3 xe mô phỏng (Xe Hoa -> Xe 2 -> Xe 3 xoá vệt đuôi)...');
      setTimeout(() => {
        if (state.vehicles['DEMO-XE-HOA']) {
          startFollowing('DEMO-XE-HOA');
          setCameraMode('both');
        }
      }, 1500);
    } else {
      showToast('Đã dừng chế độ mô phỏng');
    }
  });

  function toggleFollowHudCollapse() {
    el.followHud.classList.toggle('collapsed');
  }

  if (el.btnCollapseHudIcon) {
    el.btnCollapseHudIcon.addEventListener('click', toggleFollowHudCollapse);
  }
  if (el.btnToggleHudCollapse) {
    el.btnToggleHudCollapse.addEventListener('click', toggleFollowHudCollapse);
  }

  el.btnStopFollow.addEventListener('click', stopFollowing);

  [el.camBtnTarget, el.camBtnBoth, el.camBtnFree].forEach((btn) => {
    btn.addEventListener('click', () => {
      setCameraMode(btn.dataset.cam);
    });
  });

  el.chkShowTrail.addEventListener('change', (e) => {
    state.showTrail = e.target.checked;
    refreshAllTrails();
  });

  el.chkShowRoute.addEventListener('change', (e) => {
    state.showRoute = e.target.checked;
    if (!state.showRoute) {
      clearActiveRoute();
    } else {
      lastRouteKey = '';
      updateFollowHudAndCamera(false);
    }
  });

  // Right Vertical Map Control Pod Collapse Toggle
  if (el.btnToggleFabPod && el.mapFabPod) {
    el.btnToggleFabPod.addEventListener('click', () => {
      el.mapFabPod.classList.toggle('collapsed');
    });
  }

  el.btnLocateMe.addEventListener('click', () => {
    if (typeof state.myLat === 'number' && typeof state.myLng === 'number') {
      if (state.followTargetId) setCameraMode('free');
      map.setView([state.myLat, state.myLng], 17, { animate: true });
    } else {
      showToast('Đang định vị toạ độ GPS của bạn...');
      startGpsTracking();
    }
  });

  el.btnFitAll.addEventListener('click', () => {
    const pts = [];
    Object.values(state.vehicles).forEach((v) => {
      if (typeof v.lat === 'number' && typeof v.lng === 'number') {
        pts.push([v.lat, v.lng]);
      }
    });
    state.waypoints.forEach((w) => {
      pts.push([w.lat, w.lng]);
    });

    if (pts.length === 0) {
      showToast('Chưa có xe hoặc địa điểm nào trên bản đồ');
      return;
    }
    if (state.followTargetId) setCameraMode('free');
    const bounds = L.latLngBounds(pts);
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 17, animate: true });
  });

  el.btnToggleTraffic.addEventListener('click', () => {
    state.showTraffic = !state.showTraffic;
    if (state.isSatellite && state.showTraffic) {
      state.isSatellite = false;
      el.btnToggleMapStyle.classList.remove('active');
    }
    el.btnToggleTraffic.classList.toggle('active', state.showTraffic);
    syncBaseMapLayer();
    showToast(
      state.showTraffic
        ? 'Đã bật lớp Giao thông trực tiếp Google Maps'
        : 'Đã tắt lớp Giao thông Google Maps'
    );
  });

  el.btnToggleMapStyle.addEventListener('click', () => {
    state.isSatellite = !state.isSatellite;
    el.btnToggleMapStyle.classList.toggle('active', state.isSatellite);
    syncBaseMapLayer();
    showToast(
      state.isSatellite
        ? 'Đã chuyển sang Google Maps Vệ tinh (Hybrid)'
        : 'Đã chuyển sang Google Maps Đường phố'
    );
  });

  el.btnShowAllTrails.addEventListener('click', () => {
    state.showAllTrails = !state.showAllTrails;
    el.btnShowAllTrails.classList.toggle('active', state.showAllTrails);
    refreshAllTrails();
    showToast(
      state.showAllTrails
        ? 'Đang hiển thị vệt lộ trình của tất cả các xe'
        : 'Chỉ hiển thị vệt lộ trình của Xe Hoa / Xe đang bám'
    );
  });

  // Left Collapsible Quick Driver Signal Pod
  if (el.btnTogglePingPod) {
    el.btnTogglePingPod.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = el.quickPingBar.classList.toggle('hidden');
      el.btnTogglePingPod.classList.toggle('active', !isHidden);
    });
  }

  el.quickPingBar.addEventListener('click', (e) => {
    const chip = e.target.closest('.ping-chip');
    if (!chip) return;
    closePingMenu();
    if (state.viewOnly) {
      showToast('Bạn đang ở chế độ quan sát. Hãy mở Cài đặt để đăng ký tên xe.');
      return;
    }
    const msg = chip.dataset.msg;
    socket.emit('vehicle:status', {
      id: state.myId,
      statusMsg: msg
    });
  });

  document.querySelectorAll('.sheet-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.sheet-tab').forEach((b) => b.classList.remove('active'));
      tabBtn.classList.add('active');
      const targetTab = tabBtn.dataset.tab;
      el.tabContentVehicles.classList.toggle('hidden', targetTab !== 'vehicles');
      el.tabContentWaypoints.classList.toggle('hidden', targetTab !== 'waypoints');
      if (el.bottomSheet.classList.contains('minimized')) {
        setSheetState('normal');
      }
    });
  });

  let sheetState = 'normal';
  function setSheetState(nextState) {
    sheetState = nextState;
    el.bottomSheet.classList.remove('minimized', 'expanded');
    document.body.classList.remove('sheet-minimized', 'sheet-expanded');

    if (sheetState === 'minimized') {
      el.bottomSheet.classList.add('minimized');
      document.body.classList.add('sheet-minimized');
      el.btnToggleSheetSize.textContent = 'Mở rộng';
    } else if (sheetState === 'expanded') {
      el.bottomSheet.classList.add('expanded');
      document.body.classList.add('sheet-expanded');
      el.btnToggleSheetSize.textContent = 'Thu nhỏ';
    } else {
      el.btnToggleSheetSize.textContent = 'Thu gọn';
    }
  }

  el.btnToggleSheetSize.addEventListener('click', () => {
    if (sheetState === 'normal') setSheetState('minimized');
    else if (sheetState === 'minimized') setSheetState('expanded');
    else setSheetState('normal');
  });

  el.sheetToggleHandle.addEventListener('click', () => {
    if (sheetState === 'minimized') setSheetState('normal');
    else if (sheetState === 'normal') setSheetState('expanded');
    else setSheetState('minimized');
  });

  el.vehicleListContainer.addEventListener('click', (e) => {
    const kickBtn = e.target.closest('[data-action="kick-car"]');
    if (kickBtn) {
      e.stopPropagation();
      const targetId = kickBtn.dataset.id;
      const targetName = kickBtn.dataset.name || 'xe này';
      if (window.confirm(`Bạn có muốn xoá xe "${targetName}" ra khỏi phòng đoàn không?`)) {
        socket.emit('room:kick-vehicle', {
          targetVehicleId: targetId,
          hostToken: state.hostToken
        });
      }
      return;
    }

    const followBtn = e.target.closest('[data-action="follow-car"]');
    if (followBtn) {
      e.stopPropagation();
      const targetId = followBtn.dataset.id;
      if (state.followTargetId === targetId) {
        stopFollowing();
      } else {
        startFollowing(targetId);
      }
      return;
    }

    const centerMeBtn = e.target.closest('[data-action="center-me"]');
    if (centerMeBtn) {
      e.stopPropagation();
      el.btnLocateMe.click();
      return;
    }

    const card = e.target.closest('.vehicle-card');
    if (card) {
      const vid = card.dataset.vid;
      const v = state.vehicles[vid];
      if (v && typeof v.lat === 'number') {
        if (vid !== state.myId) {
          startFollowing(vid);
        } else {
          map.setView([v.lat, v.lng], 17, { animate: true });
        }
      }
    }
  });

  el.waypointListContainer.addEventListener('click', (e) => {
    const followWpBtn = e.target.closest('[data-action="follow-wp"]');
    if (followWpBtn) {
      const wpId = followWpBtn.dataset.id;
      const targetKey = `wp:${wpId}`;
      if (state.followTargetId === targetKey) {
        stopFollowing();
      } else {
        startFollowing(targetKey);
      }
      return;
    }

    const delWpBtn = e.target.closest('[data-action="delete-wp"]');
    if (delWpBtn) {
      const wpId = delWpBtn.dataset.id;
      socket.emit('waypoint:delete', { id: wpId });
    }
  });

  el.btnAddWaypointModal.addEventListener('click', () => {
    state.pickedWpCoords = null;
    el.inputWpTitle.value = '';
    el.inputWpNote.value = '';
    el.inputWpSearchAddr.value = '';
    el.wpCoordPreview.textContent = 'Toạ độ: Dán link Google Maps ở trên hoặc chấm trên bản đồ';
    el.wpCoordPreview.style.color = '';
    el.waypointModal.classList.remove('hidden');
  });

  el.btnCloseWaypointModal.addEventListener('click', () => {
    el.waypointModal.classList.add('hidden');
  });

  el.btnWpPickOnMap.addEventListener('click', () => {
    state.pickingMapForWaypoint = true;
    el.waypointModal.classList.add('hidden');
    el.mapPickBanner.classList.remove('hidden');
  });

  el.btnCancelPickMap.addEventListener('click', () => {
    state.pickingMapForWaypoint = false;
    el.mapPickBanner.classList.add('hidden');
  });

  el.btnWpUseMyLoc.addEventListener('click', () => {
    if (typeof state.myLat === 'number' && typeof state.myLng === 'number') {
      state.pickedWpCoords = { lat: state.myLat, lng: state.myLng };
      el.wpCoordPreview.textContent = `✅ Đã lấy vị trí hiện tại: ${state.myLat.toFixed(5)}, ${state.myLng.toFixed(5)}`;
      el.wpCoordPreview.style.color = '#059669';
    } else {
      showToast('Chưa có vị trí GPS của bạn. Hãy dán link Google Maps hoặc chọn "Chấm trên bản đồ".');
    }
  });

  async function resolveGoogleMapsLinkInput(rawLink) {
    const q = (rawLink || el.inputWpSearchAddr.value || '').trim();
    if (!q) return false;
    el.btnWpSearchAddr.textContent = 'Đang lấy...';
    try {
      const res = await fetch(`/api/resolve-gmaps?url=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data && data.ok && typeof data.lat === 'number' && typeof data.lng === 'number') {
        state.pickedWpCoords = { lat: data.lat, lng: data.lng };
        map.setView([data.lat, data.lng], 17);
        const placeLabel = data.placeName ? ` (${data.placeName.slice(0, 42)})` : '';
        el.wpCoordPreview.textContent = `✅ Đã lấy toạ độ từ Google Maps: ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}${placeLabel}`;
        el.wpCoordPreview.style.color = '#059669';

        // Auto-fill title if user hasn't typed one yet and Google Maps link contained place name
        if (!el.inputWpTitle.value.trim() && data.placeName) {
          const wpType = document.querySelector('input[name="wpType"]:checked')?.value || 'groom';
          const prefix = getWaypointTypeLabel(wpType);
          el.inputWpTitle.value = `${prefix} - ${data.placeName.slice(0, 40)}`;
        }
        return true;
      } else {
        el.wpCoordPreview.textContent = `⚠️ ${(data && data.message) || 'Không đọc được toạ độ từ link này.'}`;
        el.wpCoordPreview.style.color = '#dc2626';
        showToast((data && data.message) || 'Không tìm thấy toạ độ trong link Google Maps này.');
        return false;
      }
    } catch (err) {
      showToast('Lỗi khi đọc link Google Maps. Hãy kiểm tra lại đường link.');
      return false;
    } finally {
      el.btnWpSearchAddr.textContent = 'Lấy toạ độ';
    }
  }

  el.btnWpSearchAddr.addEventListener('click', () => {
    resolveGoogleMapsLinkInput();
  });

  // Automatically resolve as soon as user pastes a Google Maps link!
  el.inputWpSearchAddr.addEventListener('paste', () => {
    setTimeout(() => {
      if (el.inputWpSearchAddr.value.trim()) {
        resolveGoogleMapsLinkInput(el.inputWpSearchAddr.value);
      }
    }, 60);
  });

  el.waypointForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.querySelector('input[name="wpType"]:checked')?.value || 'groom';
    const title = el.inputWpTitle.value.trim();
    const note = el.inputWpNote.value.trim();

    // If user pasted a Google Maps link and hit Submit directly without clicking "Lấy toạ độ" first
    if (!state.pickedWpCoords && el.inputWpSearchAddr.value.trim()) {
      const ok = await resolveGoogleMapsLinkInput(el.inputWpSearchAddr.value);
      if (!ok) return;
    }

    const coords = state.pickedWpCoords || map.getCenter();

    socket.emit('waypoint:add', {
      type,
      title,
      note,
      lat: coords.lat,
      lng: coords.lng
    });

    el.waypointModal.classList.add('hidden');
    showToast(`Đã ghim "${title}" lên bản đồ đoàn xe`);
  });

  el.btnOpenShare.addEventListener('click', async () => {
    closeTopMenu();
    let shareOrigin = window.location.origin;
    let lanHintText = '';

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      try {
        const res = await fetch('/api/server-info');
        const info = await res.json();
        if (info.lanIps && info.lanIps.length > 0) {
          shareOrigin = `http://${info.lanIps[0]}:${info.port}`;
          lanHintText = `Mạng nội bộ (Wi-Fi): Các điện thoại cùng Wi-Fi có thể quét mã QR trên để kết nối (${shareOrigin}). Khi di chuyển ngoài đường bằng 4G/5G, hãy deploy lên Render.com hoặc dùng "npx localtunnel --port ${info.port}" để có chứng chỉ HTTPS.`;
        }
      } catch (e) {}
    }

    const shareUrl = `${shareOrigin}/?room=${encodeURIComponent(state.roomCode)}`;
    el.shareRoomCodeText.textContent = `MÃ ĐOÀN: ${state.roomCode}`;
    el.shareUrlInput.value = shareUrl;
    el.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(shareUrl)}`;
    el.lanIpHint.textContent = lanHintText;
    el.shareModal.classList.remove('hidden');
  });

  el.btnCopyShareUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(el.shareUrlInput.value);
    el.btnCopyShareUrl.textContent = 'Đã sao chép';
    setTimeout(() => {
      el.btnCopyShareUrl.textContent = 'Sao chép link';
    }, 2000);
  });

  el.btnCloseShareModal.addEventListener('click', () => {
    el.shareModal.classList.add('hidden');
  });

  // ==================== STARTUP: F5 AUTO-RESTORE OR OPEN LOBBY MODAL ====================
  if (state.hasJoined) {
    // User pressed F5 / Reloaded page while already in a room -> Auto-rejoin seamlessly!
    el.setupModal.classList.add('hidden');
    if (el.btnClearMyTrail) el.btnClearMyTrail.classList.remove('hidden');
    if (!state.viewOnly) {
      startGpsTracking();
    }
    requestWakeLock();
  } else {
    openLobbyModal('join');
  }

  // Cloud Anti-Sleep HTTP Heartbeat (ONLY runs when actively inside a room!)
  setInterval(() => {
    if (state.hasJoined) {
      fetch('/api/health', { cache: 'no-store' }).catch(() => {});
    }
  }, 4 * 60 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
