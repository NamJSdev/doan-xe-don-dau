const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 20000
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==================== SERVER STORAGE & MEMORY QUOTAS ====================
const MAX_ACTIVE_ROOMS = 20;          // Hard cap on concurrent rooms
const MAX_VEHICLES_PER_ROOM = 50;     // Hard cap on vehicles per room
const MAX_WAYPOINTS_PER_ROOM = 20;    // Hard cap on fixed waypoints per room
const MAX_TRAIL_POINTS_CAP = 500;     // Hard cap on compressed trail points per lead vehicle
const MAX_SOLO_CONVOY_TRAIL = 25;     // Max trail points for a non-lead car with no one following it
const OFFLINE_TRAIL_TRIM_MS = 15 * 60 * 1000; // Trim offline car's trail to 1 point after 15 mins
const MAX_OFFLINE_VEHICLE_MS = 2 * 60 * 60 * 1000; // Remove offline car after 2 hours
const MAX_EMPTY_ROOM_MS = 3 * 60 * 60 * 1000;      // Delete empty/inactive room after 3 hours

// Quantize GPS coordinate to 6 decimal places (~11cm precision) to cut RAM & JSON size by ~55%
function roundCoord(val) {
  return Math.round(val * 1e6) / 1e6;
}

function makeTrailPt(lat, lng) {
  return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

// In-memory store for rooms
// Structure: rooms[roomCode] = { vehicles: { [vehicleId]: VehicleObj }, waypoints: [ WaypointObj ], updatedAt: number }
let rooms = {};
let saveTimeoutId = null;

// Load persisted rooms on startup (sanitizing any stale demo data or bloated trails)
function loadPersistedData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        rooms = {};
        for (const roomCode of Object.keys(parsed)) {
          const room = parsed[roomCode];
          if (!room || typeof room !== 'object') continue;

          const cleanVehicles = {};
          if (room.vehicles && typeof room.vehicles === 'object') {
            for (const vId of Object.keys(room.vehicles)) {
              const v = room.vehicles[vId];
              if (!v || v.isDemo) continue; // Never load demo cars from disk
              v.online = false;
              delete v.socketId;
              if (Array.isArray(v.trail)) {
                v.trail = v.trail
                  .slice(-MAX_TRAIL_POINTS_CAP)
                  .filter((p) => p && typeof p.lat === 'number' && typeof p.lng === 'number')
                  .map((p) => makeTrailPt(p.lat, p.lng));
              } else {
                v.trail = [];
              }
              cleanVehicles[vId] = v;
            }
          }

          const cleanWaypoints = Array.isArray(room.waypoints)
            ? room.waypoints.filter((w) => w && !String(w.id).startsWith('wp-demo-')).slice(-MAX_WAYPOINTS_PER_ROOM)
            : [];

          rooms[roomCode] = {
            code: room.code || roomCode,
            hostToken: room.hostToken || null,
            hostVehicleId: room.hostVehicleId || null,
            vehicles: cleanVehicles,
            waypoints: cleanWaypoints,
            createdAt: room.createdAt || Date.now(),
            updatedAt: room.updatedAt || Date.now()
          };
        }
      }
    }
  } catch (err) {
    console.error('Không thể đọc dữ liệu lưu trữ:', err.message);
  }
}

// Build a clean, stripped snapshot of rooms (excluding Demo entities & transient socketIds)
function buildPersistableRoomsSnapshot() {
  const snapshot = {};
  for (const code of Object.keys(rooms)) {
    const r = rooms[code];
    if (!r) continue;

    const cleanVehicles = {};
    for (const vId of Object.keys(r.vehicles || {})) {
      const v = r.vehicles[vId];
      if (!v || v.isDemo) continue;
      cleanVehicles[vId] = {
        id: v.id,
        name: v.name,
        plate: v.plate,
        role: v.role,
        color: v.color,
        lat: typeof v.lat === 'number' ? roundCoord(v.lat) : null,
        lng: typeof v.lng === 'number' ? roundCoord(v.lng) : null,
        heading: v.heading || 0,
        speed: v.speed || 0,
        accuracy: v.accuracy || 10,
        statusMsg: v.statusMsg || '',
        statusTime: v.statusTime || null,
        isHostVehicle: Boolean(v.isHostVehicle),
        online: false,
        lastUpdated: v.lastUpdated || Date.now(),
        trail: Array.isArray(v.trail) ? v.trail.slice(-MAX_TRAIL_POINTS_CAP) : []
      };
    }

    const cleanWaypoints = (r.waypoints || [])
      .filter((w) => w && !String(w.id).startsWith('wp-demo-'))
      .slice(-MAX_WAYPOINTS_PER_ROOM);

    snapshot[code] = {
      code: r.code,
      hostToken: r.hostToken,
      hostVehicleId: r.hostVehicleId,
      vehicles: cleanVehicles,
      waypoints: cleanWaypoints,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    };
  }
  return snapshot;
}

// Debounced, minified, non-blocking disk persistence (shrinks to 2 bytes "{}" when 0 rooms exist)
function savePersistedData(immediate = false) {
  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId);
    saveTimeoutId = null;
  }

  const writeNow = () => {
    try {
      const cleanSnapshot = buildPersistableRoomsSnapshot();
      const rawJson = JSON.stringify(cleanSnapshot); // Minified single-line JSON saves ~45% disk space
      fs.promises.writeFile(DATA_FILE, rawJson, 'utf8').catch(() => {});
    } catch (err) {
      console.error('Không thể ghi dữ liệu lưu trữ:', err.message);
    }
  };

  if (immediate || Object.keys(rooms).length === 0) {
    writeNow();
  } else {
    saveTimeoutId = setTimeout(writeNow, 2500);
  }
}

loadPersistedData();

// Haversine formula to compute distance in meters between 2 GPS coordinates
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Compute bearing (heading) in degrees from point 1 to point 2
function computeBearing(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function createRoom(roomCode, hostToken, hostVehicleId) {
  const code = (roomCode || 'DAM-CUOI').trim().toUpperCase().slice(0, 24);

  // Enforce MAX_ACTIVE_ROOMS quota: if exceeded, evict the oldest inactive room first
  const existingCodes = Object.keys(rooms);
  if (!rooms[code] && existingCodes.length >= MAX_ACTIVE_ROOMS) {
    let oldestCode = null;
    let oldestScore = Infinity;
    for (const c of existingCodes) {
      const r = rooms[c];
      const onlineCount = Object.values(r.vehicles || {}).filter((v) => v.online && !v.isDemo).length;
      const score = (onlineCount > 0 ? 1e15 : 0) + (r.updatedAt || 0);
      if (score < oldestScore) {
        oldestScore = score;
        oldestCode = c;
      }
    }
    if (oldestCode) {
      stopRoomSimulator(oldestCode);
      delete rooms[oldestCode];
    }
  }

  rooms[code] = {
    code,
    hostToken: hostToken || `host-${Date.now()}`,
    hostVehicleId: hostVehicleId || null,
    vehicles: {},
    waypoints: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  syncBackgroundTimers();
  return rooms[code];
}

function getRoom(roomCode) {
  const code = (roomCode || '').trim().toUpperCase();
  return rooms[code] || null;
}

// Demo simulators per room
const roomSimulators = {};

async function buildDemoRoute(centerLat, centerLng) {
  // Try fetching a realistic road loop around centerLat, centerLng via OSRM public API
  const p1 = { lat: centerLat, lng: centerLng };
  const p2 = { lat: centerLat + 0.0085, lng: centerLng + 0.0065 };
  const p3 = { lat: centerLat + 0.0140, lng: centerLng - 0.0040 };
  const p4 = { lat: centerLat + 0.0045, lng: centerLng - 0.0085 };

  const coordsStr = `${p1.lng},${p1.lat};${p2.lng},${p2.lat};${p3.lng},${p3.lat};${p4.lng},${p4.lat};${p1.lng},${p1.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates) {
        const rawCoords = data.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        // Interpolate dense points (~15m apart) for smooth driving simulation
        const densePoints = [];
        for (let i = 0; i < rawCoords.length - 1; i++) {
          const a = rawCoords[i];
          const b = rawCoords[i + 1];
          const dist = getDistanceMeters(a.lat, a.lng, b.lat, b.lng);
          const steps = Math.max(1, Math.floor(dist / 14));
          for (let s = 0; s < steps; s++) {
            const t = s / steps;
            densePoints.push({
              lat: a.lat + (b.lat - a.lat) * t,
              lng: a.lng + (b.lng - a.lng) * t
            });
          }
        }
        if (densePoints.length > 10) {
          return densePoints;
        }
      }
    }
  } catch (e) {
    // Fallback to smooth generated street-like path if offline
  }

  const fallback = [];
  const totalSteps = 160;
  for (let i = 0; i < totalSteps; i++) {
    const angle = (i / totalSteps) * Math.PI * 2;
    const lat = centerLat + Math.sin(angle) * 0.007 + Math.sin(angle * 2) * 0.002;
    const lng = centerLng + Math.cos(angle) * 0.008 - Math.cos(angle * 3) * 0.0015;
    fallback.push({ lat, lng });
  }
  return fallback;
}

// Trim old trail segments that the LAST car in the convoy has already passed
function trimConvoyTrails(room) {
  if (!room || !room.vehicles) return;
  const isSimulating = Boolean(roomSimulators[room.code]);

  // If simulating, evaluate convoy tail among the moving demo cars (and any real car that is actively moving)
  const allVehicles = Object.values(room.vehicles).filter((c) => {
    if (!c || c.online === false || typeof c.lat !== 'number' || typeof c.lng !== 'number') return false;
    if (isSimulating && !c.isDemo && (!c.speed || c.speed < 3)) return false;
    return true;
  });

  // Case 1: Only 1 active vehicle in the room (nobody behind it yet)
  if (allVehicles.length === 1) {
    const solo = allVehicles[0];
    const maxSolo = solo.role === 'lead' ? 160 : MAX_SOLO_CONVOY_TRAIL;
    if (Array.isArray(solo.trail) && solo.trail.length > maxSolo) {
      const cutCount = solo.trail.length - maxSolo;
      solo.trail.splice(0, cutCount);
      io.to(room.code).emit('vehicle:trail-trimmed', {
        id: solo.id,
        trimCount: cutCount
      });
    }
    return;
  }

  if (allVehicles.length < 2) return;

  for (const v of allVehicles) {
    if (!Array.isArray(v.trail) || v.trail.length < 3) continue;

    const others = allVehicles.filter((o) => o.id !== v.id);
    const trailingIndices = [];

    for (const other of others) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < v.trail.length; i++) {
        const pt = v.trail[i];
        const d = getDistanceMeters(other.lat, other.lng, pt.lat, pt.lng);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      // Consider 'other' as following on v's trail if within 5000m (5km) of the trail and behind v's head
      if (bestIdx >= 0 && bestIdx < v.trail.length - 1 && bestDist <= 5000) {
        trailingIndices.push(bestIdx);
      }
    }

    if (trailingIndices.length > 0) {
      // Find the position of the very LAST car in the convoy along v's trail
      const lastCarIdx = Math.min(...trailingIndices);
      if (lastCarIdx > 0) {
        v.trail.splice(0, lastCarIdx);
        io.to(room.code).emit('vehicle:trail-trimmed', {
          id: v.id,
          trimCount: lastCarIdx
        });
      }
    } else {
      // No car is behind 'v' -> 'v' itself is the last car in the convoy, so erase trail behind it
      if (v.trail.length > 2) {
        const cutCount = v.trail.length - 2;
        v.trail.splice(0, cutCount);
        io.to(room.code).emit('vehicle:trail-trimmed', {
          id: v.id,
          trimCount: cutCount
        });
      }
    }
  }
}

async function startRoomSimulator(roomCode, centerLat = 21.028511, centerLng = 105.804817) {
  stopRoomSimulator(roomCode);
  const room = getRoom(roomCode);
  if (!room) return;
  const routePoints = await buildDemoRoute(centerLat, centerLng);

  const demoLeadId = 'DEMO-XE-HOA';
  const demoMidId = 'DEMO-XE-2';
  const demoTailId = 'DEMO-XE-3';

  // Convoy spacing: Lead car at +16 steps, Middle car at +8 steps, Tail car (Chốt đoàn) at 0
  const midGap = 8;
  const tailGap = 16;
  let stepIdx = tailGap;

  const initialLeadPt = routePoints[stepIdx];
  const nextLeadPt = routePoints[(stepIdx + 1) % routePoints.length] || initialLeadPt;

  // Pre-build initial trail of Xe Hoa from Tail Car (index 0) through Middle Car (index 8) up to Xe Hoa (index 16)
  const initialLeadTrail = [];
  for (let i = 0; i <= stepIdx; i++) {
    initialLeadTrail.push({
      lat: routePoints[i].lat,
      lng: routePoints[i].lng,
      t: Date.now() - (stepIdx - i) * 1200
    });
  }

  // Pre-build initial trail of Middle Car from Tail Car (index 0) up to Middle Car (index 8)
  const midStartIdx = stepIdx - midGap;
  const initialMidTrail = [];
  for (let i = 0; i <= midStartIdx; i++) {
    initialMidTrail.push({
      lat: routePoints[i].lat,
      lng: routePoints[i].lng,
      t: Date.now() - (midStartIdx - i) * 1200
    });
  }

  // 1. Lead Car (Xe Hoa Dẫn Đoàn)
  room.vehicles[demoLeadId] = {
    id: demoLeadId,
    name: 'Xe Hoa Dẫn Đoàn (Mô phỏng)',
    plate: '30K-999.99',
    role: 'lead',
    color: '#e11d48',
    lat: initialLeadPt.lat,
    lng: initialLeadPt.lng,
    heading: computeBearing(initialLeadPt.lat, initialLeadPt.lng, nextLeadPt.lat, nextLeadPt.lng),
    speed: 40,
    accuracy: 4,
    online: true,
    isDemo: true,
    statusMsg: 'Đang dẫn đoàn đón dâu trên lộ trình chính',
    statusTime: Date.now(),
    lastUpdated: Date.now(),
    trail: initialLeadTrail
  };

  // 2. Middle Car (Xe Số 2 - Giữa Đoàn)
  const midPt = routePoints[midStartIdx];
  const midNextPt = routePoints[midStartIdx + 1] || midPt;
  room.vehicles[demoMidId] = {
    id: demoMidId,
    name: 'Xe Số 2 - Đoàn Nhà Trai',
    plate: '30A-686.86',
    role: 'convoy',
    color: '#2563eb',
    lat: midPt.lat,
    lng: midPt.lng,
    heading: computeBearing(midPt.lat, midPt.lng, midNextPt.lat, midNextPt.lng),
    speed: 39,
    accuracy: 5,
    online: true,
    isDemo: true,
    statusMsg: 'Đang bám sát vệt đường Xe Hoa',
    statusTime: Date.now(),
    lastUpdated: Date.now(),
    trail: initialMidTrail
  };

  // 3. Tail Car (Xe Số 3 - Chốt Đoàn Cuối Cùng)
  const tailPt = routePoints[0];
  const tailNextPt = routePoints[1] || tailPt;
  room.vehicles[demoTailId] = {
    id: demoTailId,
    name: 'Xe Số 3 - Chốt Đoàn Cuối',
    plate: '29H-888.68',
    role: 'media',
    color: '#059669',
    lat: tailPt.lat,
    lng: tailPt.lng,
    heading: computeBearing(tailPt.lat, tailPt.lng, tailNextPt.lat, tailNextPt.lng),
    speed: 38,
    accuracy: 5,
    online: true,
    isDemo: true,
    statusMsg: 'Xe khóa đuôi — đi tới đâu xoá vệt đường cũ tới đó',
    statusTime: Date.now(),
    lastUpdated: Date.now(),
    trail: [{ lat: tailPt.lat, lng: tailPt.lng, t: Date.now() }]
  };

  // Add sample waypoints along the route
  room.waypoints = room.waypoints.filter((w) => !w.id.startsWith('wp-demo-'));
  const brideIdx = Math.floor(routePoints.length * 0.38);
  const restIdx = Math.floor(routePoints.length * 0.72);
  const bridePt = routePoints[brideIdx] || { lat: centerLat + 0.008, lng: centerLng + 0.005 };
  const restPt = routePoints[restIdx] || { lat: centerLat + 0.004, lng: centerLng - 0.006 };

  room.waypoints.push(
    {
      id: 'wp-demo-groom',
      title: 'Nhà Trai (Điểm xuất phát)',
      type: 'groom',
      lat: tailPt.lat,
      lng: tailPt.lng,
      note: 'Đoàn xe xuất phát lúc 08:30'
    },
    {
      id: 'wp-demo-bride',
      title: 'Nhà Gái (Điểm đón dâu)',
      type: 'bride',
      lat: bridePt.lat,
      lng: bridePt.lng,
      note: 'Các xe đỗ dọc sảnh chính'
    },
    {
      id: 'wp-demo-restaurant',
      title: 'Trung Tâm Tiệc Cưới Palace',
      type: 'restaurant',
      lat: restPt.lat,
      lng: restPt.lng,
      note: 'Khai tiệc lúc 11:30 trưa'
    }
  );
  io.to(room.code).emit('waypoints:update', room.waypoints);

  io.to(room.code).emit('room:state', {
    code: room.code,
    vehicles: room.vehicles,
    waypoints: room.waypoints,
    simulating: true
  });

  const demoStatusMessages = [
    { id: demoLeadId, msg: 'Chú ý rẽ ở ngã rẽ phía trước nhé!' },
    { id: demoMidId, msg: 'Xe số 2 đang bám sát lộ trình đoàn!' },
    { id: demoTailId, msg: 'Xe chốt đoàn đã qua ngã tư, xoá vệt cũ!' },
    { id: demoLeadId, msg: 'Đoạn này đường thoáng, đoàn giữ đều tốc độ 40km/h' }
  ];
  let pingCounter = 0;

  const timer = setInterval(() => {
    if (!rooms[room.code]) {
      stopRoomSimulator(room.code);
      return;
    }

    stepIdx = (stepIdx + 1) % routePoints.length;
    const now = Date.now();

    // Update 1: Lead Car
    const lead = room.vehicles[demoLeadId];
    if (lead) {
      const pt = routePoints[stepIdx];
      const nextPt = routePoints[(stepIdx + 1) % routePoints.length];
      lead.heading = Math.round(computeBearing(lead.lat, lead.lng, pt.lat, pt.lng) || computeBearing(pt.lat, pt.lng, nextPt.lat, nextPt.lng));
      lead.lat = pt.lat;
      lead.lng = pt.lng;
      lead.speed = Math.round(38 + Math.sin(stepIdx * 0.25) * 6);
      lead.lastUpdated = now;
      const newPt = { lat: pt.lat, lng: pt.lng, t: now };
      lead.trail.push(newPt);

      io.to(room.code).emit('vehicle:location', {
        id: lead.id,
        lat: lead.lat,
        lng: lead.lng,
        heading: lead.heading,
        speed: lead.speed,
        accuracy: lead.accuracy,
        lastUpdated: now,
        newTrailPoint: newPt
      });
    }

    // Update 2: Middle Car (8 steps behind Lead Car)
    const midIdx = (stepIdx - midGap + routePoints.length) % routePoints.length;
    const midCar = room.vehicles[demoMidId];
    if (midCar && routePoints[midIdx]) {
      const pt = routePoints[midIdx];
      midCar.heading = Math.round(computeBearing(midCar.lat, midCar.lng, pt.lat, pt.lng));
      midCar.lat = pt.lat;
      midCar.lng = pt.lng;
      midCar.speed = Math.round(37 + Math.cos(stepIdx * 0.25) * 5);
      midCar.lastUpdated = now;
      const newPt = { lat: pt.lat, lng: pt.lng, t: now };
      midCar.trail.push(newPt);

      io.to(room.code).emit('vehicle:location', {
        id: midCar.id,
        lat: midCar.lat,
        lng: midCar.lng,
        heading: midCar.heading,
        speed: midCar.speed,
        accuracy: midCar.accuracy,
        lastUpdated: now,
        newTrailPoint: newPt
      });
    }

    // Update 3: Tail Car (16 steps behind Lead Car - Last car in convoy!)
    const tailIdx = (stepIdx - tailGap + routePoints.length) % routePoints.length;
    const tailCar = room.vehicles[demoTailId];
    if (tailCar && routePoints[tailIdx]) {
      const pt = routePoints[tailIdx];
      tailCar.heading = Math.round(computeBearing(tailCar.lat, tailCar.lng, pt.lat, pt.lng));
      tailCar.lat = pt.lat;
      tailCar.lng = pt.lng;
      tailCar.speed = Math.round(37 + Math.sin(stepIdx * 0.2) * 5);
      tailCar.lastUpdated = now;
      const newPt = { lat: pt.lat, lng: pt.lng, t: now };
      tailCar.trail.push(newPt);

      io.to(room.code).emit('vehicle:location', {
        id: tailCar.id,
        lat: tailCar.lat,
        lng: tailCar.lng,
        heading: tailCar.heading,
        speed: tailCar.speed,
        accuracy: tailCar.accuracy,
        lastUpdated: now,
        newTrailPoint: newPt
      });
    }

    // Periodically broadcast a live driver status message in demo mode
    if (stepIdx % 12 === 0) {
      const item = demoStatusMessages[pingCounter % demoStatusMessages.length];
      pingCounter++;
      const targetV = room.vehicles[item.id];
      if (targetV) {
        targetV.statusMsg = item.msg;
        targetV.statusTime = now;
        io.to(room.code).emit('vehicle:status-broadcast', {
          id: targetV.id,
          name: targetV.name,
          role: targetV.role,
          statusMsg: item.msg,
          statusTime: now
        });
      }
    }

    // Automatically erase old trail behind the LAST car in the convoy (DEMO-XE-3)
    trimConvoyTrails(room);
  }, 1150);

  roomSimulators[room.code] = timer;
}

function stopRoomSimulator(roomCode) {
  const code = (roomCode || 'DAM-CUOI').trim().toUpperCase();
  if (roomSimulators[code]) {
    clearInterval(roomSimulators[code]);
    delete roomSimulators[code];
  }
  const room = rooms[code];
  if (room) {
    delete room.vehicles['DEMO-XE-HOA'];
    delete room.vehicles['DEMO-XE-2'];
    delete room.vehicles['DEMO-XE-3'];
    room.waypoints = room.waypoints.filter((w) => !w.id.startsWith('wp-demo-'));
    io.to(code).emit('room:state', {
      code: room.code,
      vehicles: room.vehicles,
      waypoints: room.waypoints,
      simulating: false
    });
  }
}

// Healthcheck / Keep-Alive endpoint for multi-hour inter-provincial trips
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Speed-adaptive collinear compression & strict memory cap for 100km - 300km+ routes
function appendAndCompressTrailPoint(trail, rawPt, speedKmh = 30, acc = 12) {
  const pt = makeTrailPt(rawPt.lat, rawPt.lng);
  const minStep = Math.max(7, Math.min(18, acc * 0.5));
  const len = trail.length;
  if (len === 0) {
    trail.push(pt);
    return { added: true, replacedLast: false, point: pt };
  }

  const lastPt = trail[len - 1];
  const distFromLast = getDistanceMeters(lastPt.lat, lastPt.lng, pt.lat, pt.lng);
  if (distFromLast < minStep) {
    return { added: false, replacedLast: false, point: pt };
  }

  // Highway vs Urban adaptive straight-segment merge limit:
  // On highways (>= 55 km/h), straight segments can be merged up to 420m. In urban alleys (< 35 km/h), max 65m.
  const maxStraightMergeMeters = speedKmh >= 55 ? 420 : (speedKmh >= 35 ? 160 : 65);
  const maxAngleTolerance = speedKmh >= 55 ? 2.8 : 3.5;

  let replacedLast = false;
  if (len >= 2) {
    const prevPt = trail[len - 2];
    const b1 = computeBearing(prevPt.lat, prevPt.lng, lastPt.lat, lastPt.lng);
    const b2 = computeBearing(lastPt.lat, lastPt.lng, pt.lat, pt.lng);
    const angleDiff = Math.abs((((b2 - b1) % 360) + 540) % 360 - 180);
    const totalSegDist = getDistanceMeters(prevPt.lat, prevPt.lng, pt.lat, pt.lng);

    if (angleDiff < maxAngleTolerance && totalSegDist < maxStraightMergeMeters) {
      trail[len - 1] = pt;
      replacedLast = true;
    } else {
      trail.push(pt);
    }
  } else {
    trail.push(pt);
  }

  // Hard memory cap: Combined with tail-trimming, active trail between first & last car never needs > 500 points
  if (trail.length > MAX_TRAIL_POINTS_CAP) {
    const cutoff = Math.floor(trail.length * 0.5);
    const compacted = [trail[0]];
    for (let i = 1; i < cutoff - 1; i++) {
      const prev = compacted[compacted.length - 1];
      const curr = trail[i];
      const next = trail[i + 1];
      const b1 = computeBearing(prev.lat, prev.lng, curr.lat, curr.lng);
      const b2 = computeBearing(curr.lat, curr.lng, next.lat, next.lng);
      const turnAngle = Math.abs((((b2 - b1) % 360) + 540) % 360 - 180);
      const dist = getDistanceMeters(prev.lat, prev.lng, curr.lat, curr.lng);
      if (turnAngle >= 7 || dist >= 500) {
        compacted.push(curr);
      }
    }
    const recentHalf = trail.slice(cutoff - 1);
    trail.length = 0;
    trail.push(...compacted, ...recentHalf);
    if (trail.length > MAX_TRAIL_POINTS_CAP) {
      trail.splice(0, trail.length - MAX_TRAIL_POINTS_CAP);
    }
  }

  return { added: true, replacedLast, point: pt };
}

// Lightweight health check endpoint for cloud deployment (Render / Koyeb / UptimeRobot)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    activeRooms: Object.keys(rooms).length,
    uptime: Math.round(process.uptime())
  });
});

// Check if a room exists before joining
app.get('/api/room-check', (req, res) => {
  const code = (req.query.code || '').trim().toUpperCase();
  const room = getRoom(code);
  res.json({
    exists: Boolean(room),
    code,
    vehicleCount: room && room.vehicles ? Object.keys(room.vehicles).length : 0
  });
});

// Extract coordinates & optional place name from any Google Maps URL or raw text
function extractCoordsFromGoogleMapsText(text) {
  if (!text || typeof text !== 'string') return null;
  const decoded = (() => {
    try {
      return decodeURIComponent(text);
    } catch (e) {
      return text;
    }
  })();

  let placeName = '';
  const placeMatch = text.match(/\/maps\/place\/([^/@?&]+)/i);
  if (placeMatch && placeMatch[1]) {
    try {
      const candidate = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
      if (!/^-?\d+\.\d+/.test(candidate)) {
        placeName = candidate;
      }
    } catch (e) {}
  }

  const isValidLatLng = (lat, lng) =>
    !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  // 1. Exact Google Maps Pin (!3d<lat>!4d<lng>) - highest priority over viewport @lat,lng
  const pin3d4d = [...text.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)];
  if (pin3d4d.length > 0) {
    const last = pin3d4d[pin3d4d.length - 1];
    const lat = parseFloat(last[1]);
    const lng = parseFloat(last[2]);
    if (isValidLatLng(lat, lng)) return { lat: roundCoord(lat), lng: roundCoord(lng), placeName };
  }

  // 2. Query parameters (?q=lat,lng | &ll=lat,lng | &destination=lat,lng | &center=lat,lng | &query=lat,lng)
  const queryMatch = decoded.match(/[?&](?:q|query|ll|sll|center|destination|daddr|saddr|viewpoint)=\s*(-?\d+\.\d+)\s*[,\s+]\s*(-?\d+\.\d+)/i);
  if (queryMatch) {
    const lat = parseFloat(queryMatch[1]);
    const lng = parseFloat(queryMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat: roundCoord(lat), lng: roundCoord(lng), placeName };
  }

  // 3. Path /place/lat,lng or /search/lat,lng or /dir/.../lat,lng
  const pathCoordMatch = decoded.match(/\/(?:place|search|dir\/[^/]*)\/\s*(-?\d+\.\d+)\s*[,\s+]\s*(-?\d+\.\d+)/i);
  if (pathCoordMatch) {
    const lat = parseFloat(pathCoordMatch[1]);
    const lng = parseFloat(pathCoordMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat: roundCoord(lat), lng: roundCoord(lng), placeName };
  }

  // 4. Viewport @lat,lng in Google Maps URL
  const atMatch = decoded.match(/@(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat: roundCoord(lat), lng: roundCoord(lng), placeName };
  }

  // 5. Raw coordinates anywhere in text (e.g., "21.028511, 105.804817")
  const rawMatch = decoded.match(/(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{2,3}\.\d{4,})/);
  if (rawMatch) {
    const lat = parseFloat(rawMatch[1]);
    const lng = parseFloat(rawMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat: roundCoord(lat), lng: roundCoord(lng), placeName };
  }

  return null;
}

// Resolve full or shortened Google Maps links (maps.app.goo.gl / goo.gl/maps / google.com/maps)
app.get('/api/resolve-gmaps', async (req, res) => {
  const rawInput = String(req.query.url || '').trim();
  if (!rawInput) {
    return res.status(400).json({ ok: false, message: 'Vui lòng dán đường link Google Maps!' });
  }

  // Fast path: if coordinates are already directly inside the input string/URL
  const direct = extractCoordsFromGoogleMapsText(rawInput);
  if (direct) {
    return res.json({ ok: true, ...direct });
  }

  // Extract http/https URL if user pasted a message containing text + URL from Zalo
  const urlMatch = rawInput.match(/https?:\/\/[^\s"'<>]+/i);
  const targetUrl = urlMatch ? urlMatch[0] : rawInput;

  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({
      ok: false,
      message: 'Link không hợp lệ. Hãy dán link Google Maps (VD: https://maps.app.goo.gl/...)'
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8'
      }
    });
    clearTimeout(timeout);

    const finalUrl = response.url || targetUrl;
    const fromRedirectUrl = extractCoordsFromGoogleMapsText(finalUrl);
    if (fromRedirectUrl) {
      return res.json({ ok: true, ...fromRedirectUrl, resolvedUrl: finalUrl });
    }

    // Also inspect HTML body for embedded staticmap center or APP_INITIALIZATION_STATE coordinates
    const html = (await response.text()).slice(0, 180000);
    const fromHtml = extractCoordsFromGoogleMapsText(html);
    if (fromHtml) {
      return res.json({ ok: true, ...fromHtml, resolvedUrl: finalUrl });
    }

    const initStateMatch = html.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
    if (initStateMatch) {
      const lat = parseFloat(initStateMatch[1]);
      const lng = parseFloat(initStateMatch[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        return res.json({ ok: true, lat: roundCoord(lat), lng: roundCoord(lng), placeName: '' });
      }
    }

    return res.status(422).json({
      ok: false,
      message: 'Không tìm thấy toạ độ trong link này. Bạn hãy mở điểm đó trên Google Maps rồi bấm Chia sẻ -> Sao chép đường liên kết.'
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: 'Không thể giải mã link rút gọn lúc này. Hãy thử lại hoặc bấm "Chấm trên bản đồ".'
    });
  }
});

// REST endpoint to get local network IPs so users can easily scan QR code on same Wi-Fi or internet
app.get('/api/server-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  res.json({
    port: PORT,
    lanIps: ips
  });
});

io.on('connection', (socket) => {
  let currentRoomCode = null;
  let currentVehicleId = null;

  socket.on('room:join', (payload) => {
    const { roomCode, mode = 'join', hostToken, vehicle } = payload || {};
    const code = (roomCode || '').trim().toUpperCase();
    if (!code) {
      socket.emit('room:error', {
        code: 'INVALID_CODE',
        message: 'Vui lòng nhập Mã Phòng hợp lệ!'
      });
      return;
    }

    let room = getRoom(code);

    if (mode === 'create') {
      if (room) {
        // Allow host with matching hostToken (or legacy room without hostToken) to reclaim
        if (room.hostToken && room.hostToken !== hostToken) {
          socket.emit('room:error', {
            code: 'ROOM_EXISTS',
            message: `Phòng "${code}" đã có người mở trước đó! Bạn hãy chuyển sang tab "Nhập Mã Vào Phòng" để tham gia, hoặc đặt một Mã Phòng khác.`
          });
          return;
        }
        if (!room.hostToken && hostToken) {
          room.hostToken = hostToken;
        }
        if (vehicle && vehicle.id && !room.hostVehicleId) {
          room.hostVehicleId = vehicle.id;
        }
      } else {
        room = createRoom(code, hostToken, vehicle ? vehicle.id : null);
      }
    } else {
      // mode === 'join' or 'rejoin': Room MUST already exist!
      if (!room) {
        socket.emit('room:error', {
          code: 'ROOM_NOT_FOUND',
          mode,
          roomCode: code,
          message: `Phòng "${code}" chưa được tạo hoặc đã được Trưởng đoàn đóng lại! Vui lòng kiểm tra lại mã hoặc bấm "Tạo Phòng Mới".`
        });
        return;
      }
      // If creator rejoins on F5 with their hostToken, ensure hostVehicleId stays linked
      if (hostToken && room.hostToken === hostToken && vehicle && vehicle.id) {
        room.hostVehicleId = vehicle.id;
      }
    }

    // Leave previous socket room if switching rooms
    if (currentRoomCode && currentRoomCode !== room.code) {
      socket.leave(currentRoomCode);
    }

    currentRoomCode = room.code;
    socket.join(currentRoomCode);

    const isHost = Boolean(hostToken && room.hostToken === hostToken);

    if (vehicle && vehicle.id) {
      currentVehicleId = String(vehicle.id).slice(0, 40);
      const existing = room.vehicles[currentVehicleId];

      // Enforce MAX_VEHICLES_PER_ROOM quota: if room is full, evict oldest offline non-host vehicle
      const currentVehicleIds = Object.keys(room.vehicles);
      if (!existing && currentVehicleIds.length >= MAX_VEHICLES_PER_ROOM) {
        let evictId = null;
        let oldestTime = Infinity;
        for (const vid of currentVehicleIds) {
          const cand = room.vehicles[vid];
          if (!cand.online && !cand.isHostVehicle && (cand.lastUpdated || 0) < oldestTime) {
            oldestTime = cand.lastUpdated || 0;
            evictId = vid;
          }
        }
        if (evictId) {
          delete room.vehicles[evictId];
          io.to(currentRoomCode).emit('vehicle:removed', { id: evictId });
        }
      }

      const initLat = typeof vehicle.lat === 'number' ? roundCoord(vehicle.lat) : (existing ? existing.lat : null);
      const initLng = typeof vehicle.lng === 'number' ? roundCoord(vehicle.lng) : (existing ? existing.lng : null);

      room.vehicles[currentVehicleId] = {
        id: currentVehicleId,
        name: String(vehicle.name || (existing ? existing.name : 'Xe Thành Viên')).trim().slice(0, 45),
        plate: String(vehicle.plate !== undefined ? vehicle.plate : (existing ? existing.plate : '')).trim().slice(0, 18),
        role: vehicle.role || (existing ? existing.role : 'convoy'),
        color: String(vehicle.color || (existing ? existing.color : '#2563eb')).slice(0, 16),
        lat: initLat,
        lng: initLng,
        heading: typeof vehicle.heading === 'number' ? Math.round(vehicle.heading) : (existing ? existing.heading : 0),
        speed: typeof vehicle.speed === 'number' ? Math.round(vehicle.speed) : (existing ? existing.speed : 0),
        accuracy: typeof vehicle.accuracy === 'number' ? Math.round(vehicle.accuracy) : (existing ? existing.accuracy : 10),
        statusMsg: existing ? existing.statusMsg : '',
        statusTime: existing ? existing.statusTime : null,
        isHostVehicle: isHost || room.hostVehicleId === currentVehicleId,
        online: true,
        socketId: socket.id,
        lastUpdated: Date.now(),
        trail: existing && Array.isArray(existing.trail) ? existing.trail.slice(-MAX_TRAIL_POINTS_CAP) : []
      };

      // Add initial point to trail if valid and trail is empty
      const v = room.vehicles[currentVehicleId];
      if (typeof v.lat === 'number' && typeof v.lng === 'number' && v.trail.length === 0) {
        v.trail.push(makeTrailPt(v.lat, v.lng));
      }

      socket.to(currentRoomCode).emit('vehicle:joined', room.vehicles[currentVehicleId]);
    }

    room.updatedAt = Date.now();
    savePersistedData();
    syncBackgroundTimers();

    socket.emit('room:state', {
      code: room.code,
      isHost,
      hostVehicleId: room.hostVehicleId || null,
      vehicles: room.vehicles,
      waypoints: room.waypoints,
      simulating: Boolean(roomSimulators[room.code])
    });
  });

  // Receive live GPS update from a vehicle (with Kalman-lite Spike Filter & Collinear Trail Compression)
  socket.on('vehicle:update-location', (data) => {
    if (!currentRoomCode || !data || !data.id) return;
    const room = rooms[currentRoomCode];
    if (!room) return;

    const v = room.vehicles[data.id];
    if (!v) return;

    let { lat, lng, heading, speed, accuracy } = data;
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;

    const now = Date.now();
    const acc = typeof accuracy === 'number' && !isNaN(accuracy) ? Math.round(accuracy) : 12;
    const hasPrev = typeof v.lat === 'number' && typeof v.lng === 'number';

    // 1. Accuracy Gate: Reject coarse cell-tower jumps (> 85m accuracy) if we already have a good GPS fix
    if (hasPrev && acc > 85 && (v.accuracy || 15) < 45 && now - (v.lastUpdated || 0) < 30000) {
      v.online = true;
      v.lastUpdated = now;
      return;
    }

    let movedDist = 0;
    if (hasPrev) {
      movedDist = getDistanceMeters(v.lat, v.lng, lat, lng);
      const dtSec = Math.max(0.4, (now - (v.lastUpdated || now)) / 1000);
      const impliedSpeedMs = movedDist / dtSec;

      // 2. Velocity Plausibility Gate: Reject impossible GPS teleportation (> 50 m/s = 180 km/h) over short intervals
      if (impliedSpeedMs > 50 && dtSec < 15) {
        return;
      }

      // 3. Stationary Anti-Drift Lock: When stopped at red lights (< 2.5m jitter and low speed), lock coordinates
      if (movedDist < 2.5 && (!speed || speed < 3)) {
        lat = v.lat;
        lng = v.lng;
        movedDist = 0;
      } else if (acc > 20 && movedDist < 25) {
        // Mild exponential smoothing when GPS accuracy is moderate (20m - 85m)
        const alpha = 0.65;
        lat = v.lat + (lat - v.lat) * alpha;
        lng = v.lng + (lng - v.lng) * alpha;
        movedDist = getDistanceMeters(v.lat, v.lng, lat, lng);
      }
    }

    // 4. Smart Heading Calculation (only rotate car nose when actually moving >= 3.5m)
    let computedHeading = v.heading || 0;
    if (movedDist >= 3.5 && hasPrev) {
      computedHeading = computeBearing(v.lat, v.lng, lat, lng);
    } else if (typeof heading === 'number' && !isNaN(heading) && speed > 5) {
      computedHeading = heading;
    }

    // Derive fallback speed (km/h) from movement if device GPS speed is null/0 while clearly moving
    let computedSpeed = typeof speed === 'number' && !isNaN(speed) ? Math.max(0, Math.round(speed)) : 0;
    if (computedSpeed === 0 && movedDist >= 5 && hasPrev) {
      const dtSec = Math.max(1, (now - (v.lastUpdated || now)) / 1000);
      if (dtSec < 10) {
        computedSpeed = Math.min(120, Math.round((movedDist / dtSec) * 3.6));
      }
    }

    v.lat = roundCoord(lat);
    v.lng = roundCoord(lng);
    v.heading = Math.round(computedHeading);
    v.speed = computedSpeed;
    v.accuracy = acc;
    v.online = true;
    v.socketId = socket.id;
    v.lastUpdated = now;
    room.updatedAt = now;

    // 5. Speed-Adaptive Trail Filter + Collinear Compression (Supports 100km - 300km+ routes)
    let newTrailPoint = null;
    let replaceLastTrail = false;
    const compressRes = appendAndCompressTrailPoint(v.trail, { lat: v.lat, lng: v.lng }, computedSpeed, acc);
    if (compressRes.added) {
      newTrailPoint = compressRes.point;
      replaceLastTrail = compressRes.replacedLast;
    }

    io.to(currentRoomCode).emit('vehicle:location', {
      id: v.id,
      lat: v.lat,
      lng: v.lng,
      heading: v.heading,
      speed: v.speed,
      accuracy: v.accuracy,
      lastUpdated: v.lastUpdated,
      newTrailPoint,
      replaceLastTrail
    });

    // Erase old trail behind the LAST car in the convoy as it advances
    trimConvoyTrails(room);
  });

  // Sync buffered offline GPS points after driving through a 4G dead zone (mountain pass / inter-provincial highway)
  socket.on('vehicle:sync-offline-trail', (data) => {
    if (!currentRoomCode || !data || !data.id || !Array.isArray(data.points) || data.points.length === 0) return;
    const room = rooms[currentRoomCode];
    if (!room || !room.vehicles[data.id]) return;

    const v = room.vehicles[data.id];
    const recentPoints = data.points.slice(-120); // Cap at 120 recent offline points
    let addedCount = 0;
    for (const pt of recentPoints) {
      if (typeof pt.lat === 'number' && typeof pt.lng === 'number') {
        const res = appendAndCompressTrailPoint(
          v.trail,
          { lat: pt.lat, lng: pt.lng },
          pt.speed || 40,
          pt.accuracy || 15
        );
        if (res.added) addedCount++;
      }
    }

    if (addedCount > 0) {
      const last = v.trail[v.trail.length - 1];
      v.lat = last.lat;
      v.lng = last.lng;
      v.lastUpdated = Date.now();
      trimConvoyTrails(room);
      io.to(currentRoomCode).emit('vehicle:updated', v);
      savePersistedData();
    }
  });

  // Update vehicle profile (name, plate, role, color)
  socket.on('vehicle:update-profile', (data) => {
    if (!currentRoomCode || !data || !data.id) return;
    const room = rooms[currentRoomCode];
    if (!room || !room.vehicles[data.id]) return;

    const v = room.vehicles[data.id];
    if (data.name) v.name = String(data.name).trim().slice(0, 45);
    if (data.plate !== undefined) v.plate = String(data.plate).trim().slice(0, 18);
    if (data.role) v.role = data.role;
    if (data.color) v.color = String(data.color).slice(0, 16);
    v.lastUpdated = Date.now();

    io.to(currentRoomCode).emit('vehicle:updated', v);
    savePersistedData();
  });

  // Quick status message / ping (e.g. "Chờ đèn đỏ", "Rẽ phải ngã tư này", "Đợi tôi với!")
  socket.on('vehicle:status', (data) => {
    if (!currentRoomCode || !data || !data.id) return;
    const room = rooms[currentRoomCode];
    if (!room || !room.vehicles[data.id]) return;

    const v = room.vehicles[data.id];
    const now = Date.now();
    v.statusMsg = String(data.statusMsg || '').trim().slice(0, 90);
    v.statusTime = now;

    io.to(currentRoomCode).emit('vehicle:status-broadcast', {
      id: v.id,
      name: v.name,
      role: v.role,
      statusMsg: v.statusMsg,
      statusTime: v.statusTime
    });

    // Automatically clear transient status message after 7 seconds so it never hangs on car head
    setTimeout(() => {
      if (v.statusTime === now) {
        v.statusMsg = '';
        v.statusTime = null;
      }
    }, 7000);
  });

  // Clear breadcrumb trail of a vehicle (useful when starting return trip from Bride's house)
  socket.on('vehicle:clear-trail', (data) => {
    if (!currentRoomCode || !data || !data.id) return;
    const room = rooms[currentRoomCode];
    if (!room || !room.vehicles[data.id]) return;

    const v = room.vehicles[data.id];
    v.trail = typeof v.lat === 'number' ? [makeTrailPt(v.lat, v.lng)] : [];
    io.to(currentRoomCode).emit('vehicle:trail-cleared', {
      id: v.id,
      trail: v.trail
    });
    savePersistedData();
  });

  // Explicitly leave convoy and remove vehicle
  socket.on('vehicle:leave', (data) => {
    if (!currentRoomCode) return;
    const room = rooms[currentRoomCode];
    const targetId = (data && data.id) || currentVehicleId;
    const leavingRoomCode = currentRoomCode;

    if (room && targetId && room.vehicles[targetId]) {
      delete room.vehicles[targetId];
      socket.to(leavingRoomCode).emit('vehicle:removed', { id: targetId });
      savePersistedData();
    }

    socket.leave(leavingRoomCode);
    currentRoomCode = null;
    currentVehicleId = null;
    socket.emit('vehicle:left', { roomCode: leavingRoomCode });
    syncBackgroundTimers();
  });

  // Host kicks a vehicle out of the room
  socket.on('room:kick-vehicle', (data) => {
    if (!currentRoomCode || !data || !data.targetVehicleId) return;
    const room = rooms[currentRoomCode];
    if (!room) return;

    if (!room.hostToken || room.hostToken !== data.hostToken) {
      socket.emit('room:error', {
        code: 'FORBIDDEN',
        message: 'Chỉ Chủ phòng (người mở phòng) mới có quyền xoá xe khỏi phòng!'
      });
      return;
    }

    const targetId = data.targetVehicleId;
    const targetVehicle = room.vehicles[targetId];
    if (!targetVehicle) return;

    const targetName = targetVehicle.name || 'Xe thành viên';
    const targetSocketId = targetVehicle.socketId;

    delete room.vehicles[targetId];

    if (targetSocketId) {
      io.to(targetSocketId).emit('vehicle:kicked', {
        roomCode: currentRoomCode,
        message: `Chủ phòng đã mời xe "${targetName}" rời khỏi phòng ${currentRoomCode}.`
      });
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.leave(currentRoomCode);
      }
    }

    io.to(currentRoomCode).emit('vehicle:removed', {
      id: targetId,
      kickedByHost: true,
      name: targetName
    });
    savePersistedData();
  });

  // Host deletes / closes the entire room
  socket.on('room:delete', (data) => {
    if (!currentRoomCode) return;
    const room = rooms[currentRoomCode];
    if (!room) return;

    if (!room.hostToken || room.hostToken !== (data && data.hostToken)) {
      socket.emit('room:error', {
        code: 'FORBIDDEN',
        message: 'Chỉ Chủ phòng (người mở phòng) mới có quyền xoá và đóng phòng!'
      });
      return;
    }

    const closingCode = currentRoomCode;
    stopRoomSimulator(closingCode);

    io.to(closingCode).emit('room:closed', {
      code: closingCode,
      message: `Chủ phòng đã đóng và xoá phòng đoàn xe "${closingCode}".`
    });

    io.in(closingCode).socketsLeave(closingCode);
    delete rooms[closingCode];
    currentRoomCode = null;
    currentVehicleId = null;

    savePersistedData(true);
    syncBackgroundTimers();
  });

  // Add or update fixed wedding waypoint (Nhà Trai, Nhà Gái, Nhà Hàng...)
  socket.on('waypoint:add', (wp) => {
    if (!currentRoomCode || !wp || typeof wp.lat !== 'number' || typeof wp.lng !== 'number') return;
    const room = rooms[currentRoomCode];
    if (!room) return;

    // Enforce MAX_WAYPOINTS_PER_ROOM quota
    const realWaypoints = room.waypoints.filter((w) => !String(w.id).startsWith('wp-demo-'));
    if (realWaypoints.length >= MAX_WAYPOINTS_PER_ROOM) {
      const oldestRealIdx = room.waypoints.findIndex((w) => !String(w.id).startsWith('wp-demo-'));
      if (oldestRealIdx !== -1) room.waypoints.splice(oldestRealIdx, 1);
    }

    const newWp = {
      id: wp.id || `wp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: String(wp.title || 'Điểm hẹn đoàn xe').trim().slice(0, 60),
      type: wp.type || 'meetup', // 'groom' | 'bride' | 'restaurant' | 'meetup'
      lat: roundCoord(wp.lat),
      lng: roundCoord(wp.lng),
      note: String(wp.note || '').trim().slice(0, 90)
    };

    room.waypoints.push(newWp);
    io.to(currentRoomCode).emit('waypoints:update', room.waypoints);
    savePersistedData();
  });

  socket.on('waypoint:delete', (data) => {
    if (!currentRoomCode || !data || !data.id) return;
    const room = rooms[currentRoomCode];
    if (!room) return;

    room.waypoints = room.waypoints.filter((w) => w.id !== data.id);
    io.to(currentRoomCode).emit('waypoints:update', room.waypoints);
    savePersistedData();
  });

  // Toggle demo simulation
  socket.on('simulator:toggle', (data) => {
    if (!currentRoomCode) return;
    if (roomSimulators[currentRoomCode]) {
      stopRoomSimulator(currentRoomCode);
    } else {
      const lat = data && typeof data.lat === 'number' ? data.lat : 21.028511;
      const lng = data && typeof data.lng === 'number' ? data.lng : 105.804817;
      startRoomSimulator(currentRoomCode, lat, lng);
    }
  });

  socket.on('disconnect', () => {
    if (currentRoomCode && currentVehicleId && rooms[currentRoomCode]) {
      const v = rooms[currentRoomCode].vehicles[currentVehicleId];
      if (v && v.socketId === socket.id) {
        v.online = false;
        v.lastUpdated = Date.now();
        io.to(currentRoomCode).emit('vehicle:offline', {
          id: v.id,
          lastUpdated: v.lastUpdated
        });
      }
    }
  });
});

// ==================== ZERO-ROOM IDLE OPTIMIZATION ====================
// Background cleanup and Render Keep-Alive ONLY run when there is at least 1 active room!
let cleanupIntervalId = null;
let renderKeepAliveId = null;

function runPeriodicCleanup() {
  const roomCodes = Object.keys(rooms);
  if (roomCodes.length === 0) {
    syncBackgroundTimers();
    return;
  }

  const now = Date.now();
  let changed = false;

  for (const roomCode of roomCodes) {
    const room = rooms[roomCode];
    if (!room) continue;

    let hasOnlineRealCar = false;
    for (const vId of Object.keys(room.vehicles || {})) {
      const v = room.vehicles[vId];
      if (!v) continue;

      if (v.online && !v.isDemo) {
        hasOnlineRealCar = true;
      } else if (!v.online && !v.isDemo) {
        const offlineDuration = now - (v.lastUpdated || 0);

        // Stage 1 (After 15 mins offline): Compact offline car's trail down to 1 point to free RAM
        if (offlineDuration > OFFLINE_TRAIL_TRIM_MS && Array.isArray(v.trail) && v.trail.length > 1) {
          v.trail = [v.trail[v.trail.length - 1]];
          changed = true;
        }

        // Stage 2 (After 2 hours offline): Remove inactive car completely
        if (offlineDuration > MAX_OFFLINE_VEHICLE_MS) {
          delete room.vehicles[vId];
          io.to(roomCode).emit('vehicle:removed', { id: vId });
          changed = true;
        }
      }
    }

    if (hasOnlineRealCar) {
      room.updatedAt = now;
    } else if (now - (room.updatedAt || room.createdAt || 0) > MAX_EMPTY_ROOM_MS) {
      stopRoomSimulator(roomCode);
      delete rooms[roomCode];
      changed = true;
    }
  }

  if (changed) {
    savePersistedData(Object.keys(rooms).length === 0);
  }
  syncBackgroundTimers();
}

function syncBackgroundTimers() {
  const activeRoomCount = Object.keys(rooms).length;

  if (activeRoomCount > 0) {
    if (!cleanupIntervalId) {
      cleanupIntervalId = setInterval(runPeriodicCleanup, 30000);
    }
    if (process.env.RENDER_EXTERNAL_URL && !renderKeepAliveId) {
      const https = require('https');
      renderKeepAliveId = setInterval(() => {
        if (Object.keys(rooms).length > 0) {
          https.get(`${process.env.RENDER_EXTERNAL_URL}/api/health`, () => {}).on('error', () => {});
        }
      }, 10 * 60 * 1000);
    }
  } else {
    // 0 rooms active -> Stop all timers so server stays 100% idle & consumes zero resources
    if (cleanupIntervalId) {
      clearInterval(cleanupIntervalId);
      cleanupIntervalId = null;
    }
    if (renderKeepAliveId) {
      clearInterval(renderKeepAliveId);
      renderKeepAliveId = null;
    }
  }
}

syncBackgroundTimers();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`💒 Wedding Convoy Live Map Server đang chạy tại:`);
  console.log(`   👉 Local:   http://localhost:${PORT}`);
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`   👉 Mạng LAN: http://${iface.address}:${PORT}`);
      }
    }
  }
  console.log(`====================================================`);
});
