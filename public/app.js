/* DiagAuto Pro 4.3.0 — frontend tout-en-un corrigé */

const APP_VERSION = '4.3.0';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const enc = new TextEncoder();
const dec = new TextDecoder();
const now = () => Date.now();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(msg, type = 'info') {
  const host = $('#toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function normalizeText(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function bufToB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToAscii(hex) {
  const clean = String(hex || '').replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i += 2) {
    const code = parseInt(clean.substr(i, 2), 16);
    if (code >= 32 && code <= 126) out += String.fromCharCode(code);
  }
  return out;
}

function parseHexPairs(hex) {
  const clean = String(hex || '').replace(/[^0-9A-Fa-f]/g, '');
  const out = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.substr(i, 2), 16));
  return out;
}

/* ---------- Config / API ---------- */
const API_BASE_KEY = 'diagauto-api-base';

function isNative() {
  return window.Capacitor?.isNativePlatform?.() === true;
}

function getApiBase() {
  return (localStorage.getItem(API_BASE_KEY) || '').replace(/\/+$/, '');
}

function setApiBase(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (clean) localStorage.setItem(API_BASE_KEY, clean);
  else localStorage.removeItem(API_BASE_KEY);
}

function apiUrl(p) {
  if (/^https?:\/\//i.test(p)) return p;
  return `${getApiBase()}${p}`;
}

function wsUrl(p) {
  const base = getApiBase();
  if (base) {
    const u = new URL(base);
    return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}${p}`;
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${p}`;
}

/* ---------- IndexedDB ---------- */
const DB_NAME = 'diagauto-idb-v4-3';
let idbPromise = null;

function openIdb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('secure')) db.createObjectStore('secure');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbPromise;
}

async function idbGet(store, key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(store, key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const r = tx.objectStore(store).put(value, key);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}

async function idbDelete(store, key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const r = tx.objectStore(store).delete(key);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}

/* ---------- Crypto ---------- */
async function deriveKey(password, saltB64, iterations = 150000) {
  const salt = b64ToBuf(saltB64);
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function encryptWithKey(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv_b64: bufToB64(iv), cipher_b64: bufToB64(cipher) };
}

async function decryptWithKey(key, ivB64, cipherB64) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(ivB64) }, key, b64ToBuf(cipherB64));
}

async function importAesKey(rawB64) {
  return crypto.subtle.importKey('raw', b64ToBuf(rawB64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function encryptWithPassword(password, data) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, bufToB64(salt));
  const pkg = await encryptWithKey(key, data);
  return {
    v: 1,
    app: 'diagauto-pro',
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 150000,
    salt_b64: bufToB64(salt),
    ...pkg,
    created_at: now()
  };
}

async function decryptWithPassword(pkg, password) {
  if (!pkg || pkg.v !== 1 || pkg.alg !== 'AES-GCM') throw new Error('Format invalide');
  const key = await deriveKey(password, pkg.salt_b64, pkg.iterations || 150000);
  return decryptWithKey(key, pkg.iv_b64, pkg.cipher_b64);
}

async function importRsaPublicKey(spkiB64) {
  return crypto.subtle.importKey('spki', b64ToBuf(spkiB64), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

async function verifyRsa(publicKey, jsonString, signatureB64) {
  return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, publicKey, b64ToBuf(signatureB64), enc.encode(jsonString));
}

/* ---------- State ---------- */
const S = {
  local: null,
  aesKey: null,
  encConfig: null,
  role: 'none',
  token: null,
  unlocked: false,
  lastResults: [],
  lastAnalysis: null,
  aiSession: null,
  workshopProfile: null,
  selectedBackupFile: null,
  wallpaper: null,
  elm: null,
  elmProfiles: null,
  liveTimer: null
};

const PIN_VERIFIER = 'diagauto-pin-ok-v4-3';
const SESSION_KEY = 'diagauto-aes-key-raw';
let saveTimer = null;
let pinResolver = null;
let eventsBound = false;

function defaultLocal() {
  return {
    version: 0,
    reference: { brands: [], models: [], engines: [], faults: [] },
    workshop: { profile: null, vehicles: {}, interventions: {} },
    elm_logs: [],
    audit: [],
    elm_profiles: null,
    settings: {}
  };
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistLocal, 500);
}

async function persistLocal() {
  if (!S.local) return;
  const json = JSON.stringify(S.local);

  if (S.encConfig?.enabled && S.aesKey) {
    const pkg = await encryptWithKey(S.aesKey, enc.encode(json));
    await idbSet('secure', 'local', pkg);
    await idbDelete('kv', 'local_plain');
  } else {
    await idbSet('kv', 'local_plain', json);
    await idbDelete('secure', 'local');
  }
}

async function loadLocalData() {
  const cfg = await idbGet('kv', 'encryption');
  S.encConfig = cfg;

  if (cfg?.enabled) {
    if (!S.aesKey) {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) S.aesKey = await importAesKey(raw);
      else throw Object.assign(new Error('PIN requis'), { code: 'PIN_REQUIRED' });
    }

    const pkg = await idbGet('secure', 'local');
    if (!pkg) throw new Error('Base chiffrée absente');

    const plain = await decryptWithKey(S.aesKey, pkg.iv_b64, pkg.cipher_b64);
    S.local = JSON.parse(dec.decode(plain));
  } else {
    const plain = await idbGet('kv', 'local_plain');
    S.local = plain ? JSON.parse(plain) : null;
  }

  if (!S.local) S.local = defaultLocal();
  if (!S.local.workshop) S.local.workshop = { profile: null, vehicles: {}, interventions: {} };
  if (!S.local.audit) S.local.audit = [];
  if (!S.local.elm_logs) S.local.elm_logs = [];
}

async function ensureLocalOrBootstrap() {
  if (!S.local) S.local = defaultLocal();
  if (!S.local.reference?.brands?.length) {
    const data = await api('/api/bootstrap');
    S.local.version = data.version;
    S.local.reference = {
      brands: data.brands,
      models: data.models,
      engines: data.engines,
      faults: data.faults
    };
    S.local.elm_profiles = data.elm_profiles;
    S.elmProfiles = data.elm_profiles;
    await persistLocal();
  }
}

async function ensureLocalData() {
  await loadLocalData();
  if (!S.local.reference?.brands?.length) {
    try {
      await ensureLocalOrBootstrap();
    } catch (err) {
      console.warn('Bootstrap impossible:', err);
      if (!S.local) S.local = defaultLocal();
    }
  }
}

/* ---------- API ---------- */
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (S.token) headers.Authorization = `Bearer ${S.token}`;

  const res = await fetch(apiUrl(path), { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/* ---------- Network ---------- */
const network = {
  state: { online: navigator.onLine, type: 'inconnu' },
  listeners: new Set(),
  detect() {
    const c = navigator.connection;
    let type = 'inconnu';
    if (c) {
      if (c.type === 'wifi') type = 'Wi-Fi';
      else if (c.effectiveType === '4g') type = c.downlink > 50 ? '5G/4G+' : '4G';
      else if (c.effectiveType) type = c.effectiveType.toUpperCase();
    }
    return { online: navigator.onLine, type };
  },
  update() {
    this.state = this.detect();
    this.listeners.forEach(fn => fn(this.state));
  },
  onChange(fn) {
    this.listeners.add(fn);
    fn(this.state);
  },
  isOnline() {
    return this.state.online;
  }
};

window.addEventListener('online', () => network.update());
window.addEventListener('offline', () => network.update());
if (navigator.connection) navigator.connection.addEventListener('change', () => network.update());

/* ---------- Access ---------- */
async function getDeviceId() {
  let id = await idbGet('kv', 'device_id');
  if (!id) {
    id = uid();
    await idbSet('kv', 'device_id', id);
  }
  return id;
}

async function getToken() {
  return idbGet('kv', 'auth_token');
}

async function getRole() {
  return idbGet('kv', 'auth_role');
}

async function setSession(token, role) {
  await idbSet('kv', 'auth_token', token);
  await idbSet('kv', 'auth_role', role);
}

async function clearSession() {
  await idbDelete('kv', 'auth_token');
  await idbSet('kv', 'auth_role', 'none');
}

async function loginOwner(code) {
  const d = await api('/api/auth/owner', { method: 'POST', body: JSON.stringify({ code }) });
  await setSession(d.token, 'owner');
  return d;
}

async function requestAccess(name) {
  const deviceId = await getDeviceId();
  try {
    return await api('/api/access/request', {
      method: 'POST',
      body: JSON.stringify({ deviceId, requesterName: name.trim(), role: 'guest' })
    });
  } catch (err) {
    const q = (await idbGet('queue', 'items')) || [];
    q.push({ type: 'access/request', payload: { deviceId, requesterName: name.trim(), role: 'guest' }, at: now() });
    await idbSet('queue', 'items', q);
    throw err;
  }
}

async function flushQueue() {
  const q = (await idbGet('queue', 'items')) || [];
  if (!q.length) return;

  const rem = [];
  for (const item of q) {
    try {
      if (item.type === 'access/request') {
        await api('/api/access/request', { method: 'POST', body: JSON.stringify(item.payload) });
      }
    } catch {
      rem.push(item);
    }
  }

  await idbSet('queue', 'items', rem);
}

async function refreshAccessStatus() {
  const deviceId = await getDeviceId();
  const st = await api(`/api/access/status?deviceId=${encodeURIComponent(deviceId)}`);

  if (st.status === 'granted' && st.token) await setSession(st.token, st.role || 'guest');
  if (st.status === 'revoked' || st.status === 'denied') {
    await clearSession();
    await idbSet('kv', 'auth_role', st.status);
  }

  return st;
}

async function listRequests() {
  const rows = await api('/api/access/list');
  await idbSet('kv', 'owner_requests_cache', rows);
  return rows;
}

async function getCachedRequests() {
  return (await idbGet('kv', 'owner_requests_cache')) || [];
}

async function updateAccess(requestId, status) {
  return api('/api/access/update', { method: 'POST', body: JSON.stringify({ requestId, status }) });
}

let ws = null;
let wsTimer = null;
const wsListeners = new Set();

function onAccessEvent(fn) {
  wsListeners.add(fn);
  return () => wsListeners.delete(fn);
}

function emitAccess(e) {
  wsListeners.forEach(fn => fn(e));
}

function connectRealtime() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  getDeviceId().then(deviceId => {
    ws = new WebSocket(wsUrl(`/ws?deviceId=${encodeURIComponent(deviceId)}`));

    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        handleWs(m, deviceId);
      } catch {}
    };

    ws.onclose = () => {
      ws = null;
      clearTimeout(wsTimer);
      wsTimer = setTimeout(connectRealtime, 4000);
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  });
}

function handleWs(m, deviceId) {
  if (m.type === 'ACCESS_GRANTED' && m.deviceId === deviceId && m.token) {
    setSession(m.token, 'guest').then(() => emitAccess({ type: 'GRANTED' }));
  }

  if (m.type === 'ACCESS_REVOKED' && m.deviceId === deviceId) {
    clearSession().then(() => idbSet('kv', 'auth_role', 'revoked')).then(() => emitAccess({ type: 'REVOKED' }));
  }

  if (m.type === 'ACCESS_DENIED' && m.deviceId === deviceId) {
    clearSession().then(() => idbSet('kv', 'auth_role', 'denied')).then(() => emitAccess({ type: 'DENIED' }));
  }

  if (m.type === 'ACCESS_REQUEST' || m.type === 'ACCESS_UPDATED') {
    emitAccess({ type: 'OWNER_REFRESH', payload: m.payload });
  }
}

/* ---------- Sync données ---------- */
async function syncData(force = false) {
  if (!navigator.onLine) {
    if (force) throw new Error('Hors ligne');
    return { offline: true };
  }

  const data = await api('/api/bootstrap');
  S.local.version = data.version;
  S.local.reference = {
    brands: data.brands,
    models: data.models,
    engines: data.engines,
    faults: data.faults
  };
  S.local.elm_profiles = data.elm_profiles;
  S.elmProfiles = data.elm_profiles;

  await idbSet('kv', 'last_sync', now());
  await persistLocal();

  return { updated: true, version: data.version };
}

/* ---------- Atelier ---------- */
function workshopId(prefix) {
  return `${prefix}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getProfile() {
  return S.local.workshop.profile;
}

async function saveProfile(p) {
  S.local.workshop.profile = {
    type: 'profile',
    id: 'current',
    name: p.name || 'Atelier',
    role: p.role || 'technicien',
    updated_at: now()
  };
  schedulePersist();
  return S.local.workshop.profile;
}

async function saveVehicle(v) {
  const id = v.id || workshopId('VEH');
  const old = S.local.workshop.vehicles[id] || {};

  const rec = {
    type: 'vehicle',
    id,
    plate: v.plate || old.plate || '',
    vin: v.vin || old.vin || '',
    brand_id: v.brand_id || old.brand_id || '',
    brand_name: v.brand_name || old.brand_name || '',
    model_id: v.model_id || old.model_id || '',
    model_name: v.model_name || old.model_name || '',
    year: v.year || old.year || '',
    odometer: Number(v.odometer ?? old.odometer ?? 0),
    customer: v.customer || old.customer || '',
    phone: v.phone || old.phone || '',
    notes: v.notes ?? old.notes ?? '',
    deleted: false,
    device_id: await getDeviceId(),
    author: v.author || old.author || '',
    created_at: old.created_at || now(),
    updated_at: now()
  };

  S.local.workshop.vehicles[id] = rec;
  schedulePersist();
  return rec;
}

async function listVehicles() {
  return Object.values(S.local.workshop.vehicles)
    .filter(v => !v.deleted)
    .sort((a, b) => b.updated_at - a.updated_at);
}

async function deleteVehicle(id) {
  const v = S.local.workshop.vehicles[id];
  if (v) {
    v.deleted = true;
    v.updated_at = now();
    schedulePersist();
  }
}

async function saveIntervention(i) {
  const id = i.id || workshopId('INT');
  const old = S.local.workshop.interventions[id] || {};

  const rec = {
    type: 'intervention',
    id,
    vehicle_id: i.vehicle_id || old.vehicle_id || '',
    title: i.title || old.title || 'Intervention',
    diagnosis: i.diagnosis ?? old.diagnosis ?? '',
    parts: i.parts ?? old.parts ?? '',
    labor: i.labor ?? old.labor ?? '',
    cost: Number(i.cost ?? old.cost ?? 0),
    technician: i.technician || old.technician || '',
    deleted: false,
    device_id: await getDeviceId(),
    author: i.author || old.author || '',
    created_at: old.created_at || now(),
    updated_at: now()
  };

  S.local.workshop.interventions[id] = rec;
  schedulePersist();
  return rec;
}

async function listInterventions(vehicleId = null) {
  let rows = Object.values(S.local.workshop.interventions).filter(i => !i.deleted);
  if (vehicleId) rows = rows.filter(i => i.vehicle_id === vehicleId);
  return rows.sort((a, b) => b.created_at - a.created_at);
}

async function syncWorkshop() {
  if (!S.token) return { skipped: 'no-token' };

  const records = [
    ...Object.values(S.local.workshop.vehicles),
    ...Object.values(S.local.workshop.interventions)
  ].map(r => ({
    id: r.id,
    type: r.type,
    payload: r,
    updated_at: r.updated_at || now(),
    deleted: !!r.deleted,
    device_id: r.device_id,
    author: r.author || ''
  }));

  let pushed = 0;

  if (records.length) {
    const res = await api('/api/workshop/push', {
      method: 'POST',
      body: JSON.stringify({ records })
    });
    pushed = res.applied || 0;
  }

  const since = Number(await idbGet('kv', 'workshop_last_sync') || 0);
  const delta = await api(`/api/workshop/delta?since=${since}`);

  let applied = 0;
  for (const rec of delta.records || []) {
    const bucket = rec.type === 'vehicle' ? S.local.workshop.vehicles : S.local.workshop.interventions;
    const local = bucket[rec.id];

    if (!local || (rec.payload.updated_at || 0) > (local.updated_at || 0)) {
      bucket[rec.id] = rec.payload;
      applied++;
    }
  }

  await idbSet('kv', 'workshop_last_sync', delta.server_time || now());
  schedulePersist();

  return { pushed, applied, server_time: delta.server_time || now() };
}

function buildReportHtml({ vehicle, interventions, diagnostic, profile }) {
  const date = new Date().toLocaleString('fr-FR');

  const intRows = (interventions || []).map(i => `
    <tr>
      <td>${new Date(i.created_at).toLocaleDateString('fr-FR')}</td>
      <td>${esc(i.title)}</td>
      <td>${esc(i.diagnosis)}</td>
      <td>${esc(i.parts)}</td>
      <td>${esc(i.labor)}</td>
      <td>${Number(i.cost || 0).toFixed(2)} €</td>
      <td>${esc(i.technician)}</td>
    </tr>
  `).join('');

  const diagRows = (diagnostic || []).slice(0, 30).map(f => `
    <tr>
      <td>${esc(f.dtc_code || f.code)}</td>
      <td>${esc(f.description)}</td>
      <td>${esc(f.causes)}</td>
      <td>${esc(f.solutions)}</td>
      <td>${esc(f.severity)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Rapport DiagAuto Pro</title>
<style>
body{font-family:Arial,sans-serif;color:#111;margin:24px}
h1{font-size:24px}
h2{font-size:18px;margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:6px}
.meta{color:#555;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
th,td{border:1px solid #ccc;padding:8px;vertical-align:top;text-align:left}
th{background:#f3f4f6}
.kv{display:grid;grid-template-columns:180px 1fr;gap:6px 12px;margin-top:10px}
.kv div:nth-child(odd){color:#555}
@media print{body{margin:10mm}}
</style>
</head>
<body>
<h1>Rapport technique DiagAuto Pro</h1>
<div class="meta">Généré le ${esc(date)} — Atelier : ${esc(profile?.name || 'Non défini')}</div>

<h2>Véhicule</h2>
<div class="kv">
  <div>Immatriculation</div><div>${esc(vehicle?.plate || '-')}</div>
  <div>VIN</div><div>${esc(vehicle?.vin || '-')}</div>
  <div>Marque</div><div>${esc(vehicle?.brand_name || '-')}</div>
  <div>Modèle</div><div>${esc(vehicle?.model_name || '-')}</div>
  <div>Année</div><div>${esc(vehicle?.year || '-')}</div>
  <div>Kilométrage</div><div>${esc(vehicle?.odometer || '-')}</div>
  <div>Client</div><div>${esc(vehicle?.customer || '-')}</div>
  <div>Téléphone</div><div>${esc(vehicle?.phone || '-')}</div>
  <div>Notes</div><div>${esc(vehicle?.notes || '-')}</div>
</div>

<h2>Historique des interventions</h2>
<table>
<thead><tr><th>Date</th><th>Intitulé</th><th>Diagnostic</th><th>Pièces</th><th>Main d’œuvre</th><th>Coût</th><th>Tech.</th></tr></thead>
<tbody>${intRows || '<tr><td colspan="7">Aucune intervention.</td></tr>'}</tbody>
</table>

<h2>Diagnostic associé</h2>
<table>
<thead><tr><th>Code</th><th>Description</th><th>Causes</th><th>Solutions</th><th>Gravité</th></tr></thead>
<tbody>${diagRows || '<tr><td colspan="5">Aucun diagnostic joint.</td></tr>'}</tbody>
</table>
</body>
</html>`;
}

function openPrintReport(html) {
  const w = window.open('', '_blank', 'width=1024,height=768');
  if (!w) {
    alert('Autorisez les pop-up pour imprimer.');
    return;
  }

  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try { w.print(); } catch {}
  }, 350);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function saveBlob(blob, filename) {
  if (window.Capacitor?.Plugins?.Filesystem) {
    try {
      const Fs = window.Capacitor.Plugins.Filesystem;
      const base64 = bufToB64(new Uint8Array(await blob.arrayBuffer()));
      await Fs.writeFile({
        path: filename,
        data: base64,
        directory: Fs.Directory?.Documents ?? 6,
        recursive: true
      });
      return { native: true, filename };
    } catch {}
  }

  downloadBlob(blob, filename);
  return { native: false, filename };
}

async function createZip(files) {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const chunks = [];
  const entries = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = enc.encode(file.name);
    const dataBuf = file.data instanceof Uint8Array ? file.data : enc.encode(String(file.data));
    const crc = crc32(dataBuf);

    const local = new Uint8Array(30 + nameBuf.length);
    const lv = new DataView(local.buffer);

    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBuf.length, true);
    lv.setUint32(22, dataBuf.length, true);
    lv.setUint16(26, nameBuf.length, true);

    local.set(nameBuf, 30);

    chunks.push(local, dataBuf);
    entries.push({ nameBuf, crc, size: dataBuf.length, offset });
    offset += local.length + dataBuf.length;
  }

  const centralSize = entries.reduce((s, e) => s + 46 + e.nameBuf.length, 0);
  const central = new Uint8Array(centralSize);
  const cv = new DataView(central.buffer);
  let pos = 0;

  for (const e of entries) {
    cv.setUint32(pos, 0x02014b50, true); pos += 4;
    cv.setUint16(pos, 20, true); pos += 2;
    cv.setUint16(pos, 20, true); pos += 2;
    cv.setUint16(pos, 0x0800, true); pos += 2;
    cv.setUint32(pos, e.crc, true); pos += 4;
    cv.setUint32(pos, e.size, true); pos += 4;
    cv.setUint32(pos, e.size, true); pos += 4;
    cv.setUint16(pos, e.nameBuf.length, true); pos += 2;
    cv.setUint32(pos, e.offset, true); pos += 18;
    central.set(e.nameBuf, pos);
    pos += e.nameBuf.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, central, eocd], { type: 'application/zip' });
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

async function exportWorkspaceZip({ vehicles, interventions, diagnostic, profile }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const interventionCsv = [
    ['id', 'vehicle_id', 'date', 'title', 'diagnosis', 'parts', 'labor', 'cost', 'technician'],
    ...(interventions || []).map(i => [
      i.id,
      i.vehicle_id,
      new Date(i.created_at).toISOString(),
      i.title,
      i.diagnosis,
      i.parts,
      i.labor,
      i.cost,
      i.technician
    ])
  ].map(r => r.map(csvEscape).join(',')).join('\n');

  const manifest = {
    app: 'DiagAuto Pro',
    version: APP_VERSION,
    exported_at: new Date().toISOString(),
    profile: profile || null,
    counts: {
      vehicles: (vehicles || []).length,
      interventions: (interventions || []).length,
      diagnostic_rows: (diagnostic || []).length
    }
  };

  const zip = await createZip([
    { name: 'diagauto-atelier/manifest.json', data: JSON.stringify(manifest, null, 2) },
    { name: 'diagauto-atelier/vehicles.json', data: JSON.stringify(vehicles || [], null, 2) },
    { name: 'diagauto-atelier/interventions.json', data: JSON.stringify(interventions || [], null, 2) },
    { name: 'diagauto-atelier/interventions.csv', data: interventionCsv },
    { name: 'diagauto-atelier/diagnostic.json', data: JSON.stringify(diagnostic || [], null, 2) },
    { name: 'diagauto-atelier/lisez-moi.txt', data: 'Export atelier DiagAuto Pro.' }
  ]);

  const filename = `diagauto-atelier-${stamp}.zip`;
  await saveBlob(zip, filename);

  return { filename, size: zip.size };
}

async function shareSummary({ vehicle, interventions, diagnostic }) {
  const last = interventions?.[0];
  const top = diagnostic?.[0];

  const text = [
    'DiagAuto Pro — Synthèse atelier',
    `Véhicule : ${vehicle?.brand_name || ''} ${vehicle?.model_name || ''} ${vehicle?.plate || ''}`.trim(),
    `VIN : ${vehicle?.vin || '-'}`,
    `Km : ${vehicle?.odometer || '-'}`,
    last ? `Dernière intervention : ${last.title} (${new Date(last.created_at).toLocaleDateString('fr-FR')})` : '',
    top ? `Panne probable : ${top.dtc_code || top.code} — ${top.description}` : '',
    '',
    'Généré par DiagAuto Pro'
  ].filter(Boolean).join('\n');

  if (navigator.share) {
    try {
      await navigator.share({ title: 'DiagAuto Pro', text });
      return { shared: true };
    } catch {}
  }

  await navigator.clipboard.writeText(text);
  return { shared: false, copied: true, text };
}

/* ---------- Sécurité locale / PIN ---------- */
async function getEncryptionStatus() {
  const cfg = await idbGet('kv', 'encryption');
  return {
    configured: !!cfg?.enabled,
    unlocked: !!S.aesKey,
    created_at: cfg?.created_at || null
  };
}

async function unlockWithPin(pin) {
  const cfg = await idbGet('kv', 'encryption');
  if (!cfg?.enabled) throw new Error('PIN non configuré');

  const key = await deriveKey(pin, cfg.salt_b64, cfg.iterations || 150000);
  const plain = await decryptWithKey(key, cfg.verifier.iv_b64, cfg.verifier.cipher_b64);

  if (dec.decode(plain) !== PIN_VERIFIER) throw new Error('PIN incorrect');

  S.aesKey = key;
  S.encConfig = cfg;

  try {
    sessionStorage.setItem(SESSION_KEY, bufToB64(await crypto.subtle.exportKey('raw', key)));
  } catch {}

  return true;
}

async function setPin(pin) {
  if (!S.local) throw new Error('DB non initialisée');
  if (!pin || String(pin).length < 4) throw new Error('PIN trop court');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = bufToB64(salt);
  const key = await deriveKey(pin, saltB64);
  const verifier = await encryptWithKey(key, enc.encode(PIN_VERIFIER));

  await idbSet('kv', 'encryption', {
    enabled: true,
    salt_b64: saltB64,
    iterations: 150000,
    verifier,
    created_at: now()
  });

  S.aesKey = key;
  S.encConfig = await idbGet('kv', 'encryption');

  try {
    sessionStorage.setItem(SESSION_KEY, bufToB64(await crypto.subtle.exportKey('raw', key)));
  } catch {}

  await persistLocal();
  return true;
}

async function changePin(oldPin, newPin) {
  await unlockWithPin(oldPin);
  await setPin(newPin);
}

async function disablePin(pin) {
  await unlockWithPin(pin);
  await idbDelete('kv', 'encryption');
  await idbDelete('secure', 'local');

  S.aesKey = null;
  S.encConfig = null;

  try { sessionStorage.removeItem(SESSION_KEY); } catch {}

  await persistLocal();
}

function lockEncryption() {
  S.aesKey = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

async function exportEncryptedBackup(password) {
  if (!password || password.length < 6) throw new Error('Mot de passe trop court');
  if (!S.local) throw new Error('Base locale absente');

  const data = enc.encode(JSON.stringify(S.local));
  const pkg = await encryptWithPassword(password, data);
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `diagauto-backup-${stamp}.diagauto`;

  await saveBlob(blob, filename);
  await localAudit('encrypted_backup_export', { filename, size: blob.size });

  return { filename, size: blob.size };
}

async function importEncryptedBackup(file, password) {
  if (!file) throw new Error('Fichier requis');
  if (!password) throw new Error('Mot de passe requis');

  const pkg = JSON.parse(await file.text());
  const plain = await decryptWithPassword(pkg, password);

  S.local = JSON.parse(dec.decode(plain));
  await persistLocal();
  await localAudit('encrypted_backup_import', { filename: file.name });

  return true;
}

async function localAudit(action, details = null) {
  const rec = { id: uid(), ts: now(), action, details };
  S.local.audit.unshift(rec);
  S.local.audit = S.local.audit.slice(0, 500);
  schedulePersist();
  return rec;
}

async function listLocalAudit(limit = 100) {
  return (S.local.audit || []).slice(0, limit);
}

async function fetchServerAudit(limit = 100) {
  return api(`/api/security/audit?limit=${limit}`);
}

async function ensurePublicKey() {
  let pk = await idbGet('kv', 'public_key');
  if (pk) return pk;

  pk = await api('/api/security/public-key');
  await idbSet('kv', 'public_key', pk);
  return pk;
}

async function refreshRevocations() {
  const pk = await ensurePublicKey();
  const bundle = await api('/api/security/revocations');
  const key = await importRsaPublicKey(pk.spki_b64);
  const valid = await verifyRsa(key, JSON.stringify(bundle.payload), bundle.signature_b64);

  if (!valid) throw new Error('Signature de révocation invalide');

  await idbSet('kv', 'revocation_bundle', bundle);
  await localAudit('revocation_refresh', { payload: bundle.payload });

  return bundle;
}

async function checkRevocation() {
  const deviceId = await getDeviceId();
  let bundle = await idbGet('kv', 'revocation_bundle');

  if (!bundle) {
    try { bundle = await refreshRevocations(); } catch { return false; }
  }

  if (bundle.payload.expires_at < now() && navigator.onLine) {
    try { bundle = await refreshRevocations(); } catch {}
  }

  const revoked = bundle.payload.revoked_device_ids || [];
  const denied = bundle.payload.denied_device_ids || [];

  if (revoked.includes(deviceId) || denied.includes(deviceId)) {
    await clearSession();
    await idbSet('kv', 'auth_role', revoked.includes(deviceId) ? 'revoked' : 'denied');
    await localAudit('revocation_applied', { deviceId });
    return true;
  }

  return false;
}

/* ---------- Symptômes ---------- */
const SYMPTOM_RULES = [
  { id: 'hard_start', label: 'Démarrage difficile', keywords: ['demarrage', 'démarrage', 'ne demarre', 'ne démarre', 'pas de demarrage', 'pas de démarrage'], systems: ['DEMARRAGE', 'BATTERIE', 'ALTERNATEUR', 'ALLUMAGE'], dtcHints: ['P0562', 'P0563', 'P0335', 'P0340'], checks: ['Tension batterie', 'Chute au démarrage', 'Capteur vilebrequin'], weight: 12 },
  { id: 'rough_idle', label: 'Ralenti instable', keywords: ['ralenti', 'instable', 'broute', 'calage', 'tressaute'], systems: ['ADMISSION', 'INJECTION', 'ALLUMAGE', 'EGR'], dtcHints: ['P0300', 'P0505', 'P2187'], checks: ['Bougies/bobines', 'Fuite admission', 'EGR/papillon'], weight: 10 },
  { id: 'power_loss', label: 'Perte de puissance', keywords: ['perte de puissance', 'moins de puissance', 'mode degrade', 'mode dégradé'], systems: ['TURBO', 'INJECTION', 'ADMISSION', 'ECHAPPEMENT'], dtcHints: ['P0299', 'P0171', 'P0420'], checks: ['Pression suralimentation', 'Filtre/admission', 'Injecteurs'], weight: 10 },
  { id: 'misfire', label: 'Ratés d’allumage', keywords: ['rate', 'ratés', 'broutement', 'a-coups', 'à-coups'], systems: ['ALLUMAGE', 'INJECTION', 'COMPRESSION'], dtcHints: ['P0300', 'P0350', 'P0200'], checks: ['Bougies', 'Bobines', 'Injecteurs', 'Compression'], weight: 12 },
  { id: 'overheating', label: 'Surchauffe', keywords: ['surchauffe', 'chauffe', 'temperature', 'température'], systems: ['REFROIDISSEMENT', 'THERMOSTAT', 'POMPE A EAU', 'VENTILATEUR'], dtcHints: ['P0115', 'P0125', 'P2600'], checks: ['Niveau liquide', 'Thermostat', 'Pompe à eau', 'Ventilateur'], weight: 12 },
  { id: 'smoke_white', label: 'Fumée blanche', keywords: ['fumee blanche', 'fumée blanche', 'vapeur blanche'], systems: ['REFROIDISSEMENT', 'CULASSE'], dtcHints: ['P0115', 'P0300'], checks: ['Joint de culasse', 'Injecteurs diesel'], weight: 9 },
  { id: 'smoke_black', label: 'Fumée noire', keywords: ['fumee noire', 'fumée noire'], systems: ['INJECTION', 'ADMISSION', 'TURBO'], dtcHints: ['P0172', 'P0401'], checks: ['Filtre à air', 'Injecteurs', 'EGR/turbo'], weight: 9 },
  { id: 'smoke_blue', label: 'Fumée bleue', keywords: ['fumee bleue', 'fumée bleue', 'consomme huile', 'brule huile', 'brûle huile'], systems: ['SEGMENTS', 'SOUPAPES', 'TURBO'], dtcHints: [], checks: ['Consommation huile', 'Segments/joints soupapes', 'Turbo'], weight: 9 },
  { id: 'transmission_shock', label: 'À-coups boîte', keywords: ['boite', 'boîte', 'a-coups', 'à-coups', 'passage de rapport'], systems: ['TRANSMISSION', 'SOLENOIDES'], dtcHints: ['P0700', 'P0750'], checks: ['Huile boîte', 'Solénoïdes', 'Adaptations'], weight: 10 },
  { id: 'electrical_fault', label: 'Problème électrique', keywords: ['electricite', 'électricité', 'fusible', 'relais', 'cable', 'câble'], systems: ['ELECTRICITE', 'MASSE'], dtcHints: ['U0100', 'U0121', 'P0562'], checks: ['Fusibles/relais', 'Masses', 'Connecteurs'], weight: 9 },
  { id: 'hybrid_battery', label: 'Anomalie hybride/HT', keywords: ['hybride', 'batterie', 'haute tension', 'ht', 'recharge'], systems: ['BATTERIE HT', 'BMS', 'ONDULEUR', 'ISOLEMENT'], dtcHints: ['P0A00', 'P0A14', 'P0AA6', 'P0C0A'], checks: ['Isolement HT', 'Températures batterie', 'DC/DC'], weight: 12 },
  { id: 'egr_dp', label: 'EGR/FAP/AdBlue', keywords: ['egr', 'fap', 'dpf', 'adblue', 'uree', 'urée', 'regeneration', 'régénération'], systems: ['DEPOLLUTION', 'EGR', 'FAP/DPF', 'SCR'], dtcHints: ['P0400', 'P2002', 'P20EE'], checks: ['Colmatage FAP', 'Vanne EGR', 'AdBlue/SCR'], weight: 10 }
];

function analyzeSymptom(text) {
  const norm = normalizeText(text);
  if (!norm) return null;

  const matches = [];

  for (const rule of SYMPTOM_RULES) {
    let score = 0;
    const matched = [];

    for (const kw of rule.keywords) {
      const nk = normalizeText(kw);
      if (nk && norm.includes(nk)) {
        score += nk.split(' ').length > 1 ? 10 : (nk.length > 5 ? 5 : 3);
        matched.push(kw);
      }
    }

    if (score > 0) {
      matches.push({
        id: rule.id,
        label: rule.label,
        score: score + (rule.weight || 0),
        matchedKeywords: unique(matched),
        systems: rule.systems,
        dtcHints: rule.dtcHints,
        checks: rule.checks
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  return {
    raw: text,
    normalized: norm,
    matches: matches.slice(0, 8),
    systems: unique(matches.flatMap(m => m.systems)),
    dtcHints: unique(matches.flatMap(m => m.dtcHints)),
    checks: unique(matches.flatMap(m => m.checks))
  };
}

function buildSymptomTerms(analysis) {
  if (!analysis) return [];

  const terms = [];
  for (const m of analysis.matches || []) {
    terms.push(...m.matchedKeywords);
    terms.push(...normalizeText(m.label).split(' '));
  }

  return unique(terms.map(normalizeText).flatMap(t => t.split(' ')).filter(t => t.length > 2)).slice(0, 12);
}

function scoreFaultRow(row, analysis) {
  if (!analysis) return 0;

  const hay = normalizeText([row.dtc_code, row.description, row.causes, row.solutions].join(' '));
  let score = 0;

  for (const t of buildSymptomTerms(analysis)) {
    if (hay.includes(t)) score += 4;
  }

  for (const hint of analysis.dtcHints || []) {
    if (String(row.dtc_code || '').toUpperCase().startsWith(String(hint).toUpperCase())) score += 30;
  }

  const sev = String(row.severity || 'medium').toLowerCase();
  score += sev === 'critical' ? 16 : sev === 'high' ? 10 : sev === 'medium' ? 5 : 2;

  return score;
}

/* ---------- IA locale ---------- */
const AI_CAUSES = [
  { id: 'battery_weak', label: 'Batterie 12V faible', system: 'Démarrage/Charge', base: 18, fuels: [], dtc: ['P0562', 'P0563'], keywords: ['batterie', 'demarrage', 'démarrage', 'lent', 'cliquetis'], tests: ['Tension repos', 'Chute sous démarrage', 'Test capacité'], fixes: ['Recharger/remplacer batterie', 'Nettoyer bornes'], parts: ['Batterie 12V'], labor_h: 0.3, severity: 'high' },
  { id: 'starter_solenoid', label: 'Solénoïde de démarreur', system: 'Démarrage', base: 11, fuels: [], dtc: [], keywords: ['clic', 'cliquetis', 'solenoide', 'solénoïde'], tests: ['Écouter clic', 'Commande 12V solénoïde'], fixes: ['Remplacer solénoïde/démarreur'], parts: ['Démarreur'], labor_h: 1, severity: 'high' },
  { id: 'alternator_fault', label: 'Alternateur défaillant', system: 'Charge', base: 14, fuels: [], dtc: ['P0562', 'P0563'], keywords: ['alternateur', 'charge', 'voyant batterie'], tests: ['Tension moteur tournant', 'Courroie'], fixes: ['Remplacer alternateur/régulateur'], parts: ['Alternateur'], labor_h: 1.5, severity: 'high' },
  { id: 'poor_ground', label: 'Masse défaillante', system: 'Électricité', base: 12, fuels: [], dtc: ['U0100', 'U0121'], keywords: ['masse', 'ground', 'incoherent', 'incohérent'], tests: ['Chute de tension masse', 'Tresses de masse'], fixes: ['Nettoyer/resserrer masses'], parts: ['Tresse de masse'], labor_h: 0.8, severity: 'high' },
  { id: 'immobilizer_fault', label: 'Antidémarrage actif', system: 'Sécurité/Démarrage', base: 10, fuels: [], dtc: ['U0100'], keywords: ['antidemarrage', 'antidémarrage', 'cle', 'clé', 'voyant cle'], tests: ['Voyant immobilizer', '2e clé', 'DTC antidémarrage'], fixes: ['Réapprentissage clé/bague'], parts: ['Clé, bague antenne'], labor_h: 1, severity: 'high' },
  { id: 'spark_plugs_worn', label: 'Bougies usées', system: 'Allumage', base: 16, fuels: ['ESSENCE', 'GPL', 'HYBRID', 'PHEV', 'MILD-HYBRID'], dtc: ['P0300', 'P0301'], keywords: ['broute', 'ratés', 'a-coups'], tests: ['Inspection bougies', 'Écartement'], fixes: ['Remplacer bougies'], parts: ['Bougies'], labor_h: 0.6, severity: 'medium' },
  { id: 'ignition_coil_fault', label: 'Bobine défaillante', system: 'Allumage', base: 15, fuels: ['ESSENCE', 'GPL', 'HYBRID', 'PHEV', 'MILD-HYBRID'], dtc: ['P0300', 'P0350'], keywords: ['rate', 'ratés', 'voyant clignote'], tests: ['Permutation bobine', 'Oscillo'], fixes: ['Remplacer bobine'], parts: ['Bobine'], labor_h: 0.7, severity: 'critical' },
  { id: 'injector_clogged', label: 'Injecteur bouché', system: 'Injection', base: 13, fuels: ['ESSENCE', 'DIESEL', 'GPL', 'HYBRID', 'PHEV'], dtc: ['P0200', 'P0171'], keywords: ['broute', 'perte de puissance', 'ralenti instable'], tests: ['Équilibre injection', 'Débit'], fixes: ['Nettoyage/remplacement'], parts: ['Injecteur'], labor_h: 1.5, severity: 'high' },
  { id: 'fuel_pump_weak', label: 'Pompe carburant faible', system: 'Alimentation', base: 14, fuels: ['ESSENCE', 'DIESEL', 'GPL', 'HYBRID', 'PHEV'], dtc: ['P0087', 'P0088'], keywords: ['ne demarre pas', 'perte de puissance', 'cale'], tests: ['Pression carburant', 'Bruit pompe'], fixes: ['Remplacer pompe/filtre'], parts: ['Pompe, filtre'], labor_h: 2, severity: 'critical' },
  { id: 'maf_dirty', label: 'MAF encrassé', system: 'Admission', base: 12, fuels: ['ESSENCE', 'DIESEL', 'HYBRID', 'PHEV'], dtc: ['P0100', 'P0171'], keywords: ['maf', 'debitmetre', 'débitmètre', 'ralenti'], tests: ['Valeur MAF', 'Nettoyage test'], fixes: ['Nettoyer/remplacer MAF'], parts: ['MAF'], labor_h: 0.5, severity: 'medium' },
  { id: 'vacuum_leak', label: 'Fuite admission', system: 'Admission', base: 13, fuels: ['ESSENCE', 'DIESEL', 'HYBRID', 'PHEV'], dtc: ['P0171', 'P2187'], keywords: ['trop pauvre', 'ralenti eleve', 'sifflement'], tests: ['Test fumigène', 'Durites/joints'], fixes: ['Remplacer durite/joint'], parts: ['Durite, joint'], labor_h: 1, severity: 'high' },
  { id: 'egr_stuck_open', label: 'EGR bloquée ouverte', system: 'Dépollution', base: 10, fuels: ['DIESEL', 'ESSENCE', 'HYBRID', 'PHEV'], dtc: ['P0400', 'P0401'], keywords: ['egr', 'ratés', 'fumee noire'], tests: ['Commande EGR', 'Encrassement'], fixes: ['Nettoyer/remplacer EGR'], parts: ['Vanne EGR'], labor_h: 1.5, severity: 'high' },
  { id: 'catalytic_converter_failed', label: 'Catalyseur HS', system: 'Échappement', base: 9, fuels: ['ESSENCE', 'HYBRID', 'PHEV'], dtc: ['P0420'], keywords: ['catalyseur', 'controle technique', 'perte de puissance'], tests: ['Sondes amont/aval', 'Contre-pression'], fixes: ['Remplacer catalyseur'], parts: ['Catalyseur'], labor_h: 2.5, severity: 'high' },
  { id: 'dpf_clogged', label: 'FAP/DPF colmaté', system: 'Dépollution diesel', base: 13, fuels: ['DIESEL'], dtc: ['P2002'], keywords: ['fap', 'dpf', 'regeneration', 'régénération', 'mode degrade'], tests: ['Masse suie', 'Différentiel pression'], fixes: ['Régénération/nettoyage/remplacement'], parts: ['FAP, capteur'], labor_h: 2, severity: 'high' },
  { id: 'turbo_boost_leak', label: 'Fuite turbo/suralimentation', system: 'Suralimentation', base: 12, fuels: ['ESSENCE', 'DIESEL'], dtc: ['P0299'], keywords: ['perte de puissance', 'sifflement', 'turbo'], tests: ['Étanchéité admission', 'Pression réelle vs consigne'], fixes: ['Remplacer durite/intercooler/turbo'], parts: ['Durite, turbo'], labor_h: 1.8, severity: 'high' },
  { id: 'glow_plugs_fault', label: 'Bougies préchauffage diesel', system: 'Préchauffage', base: 12, fuels: ['DIESEL'], dtc: ['P0380'], keywords: ['diesel froid', 'demarrage a froid', 'préchauffage'], tests: ['Résistance bougies', 'Relais préchauffage'], fixes: ['Remplacer bougies/relais'], parts: ['Bougies préchauffage'], labor_h: 1, severity: 'medium' },
  { id: 'thermostat_stuck_closed', label: 'Thermostat bloqué fermé', system: 'Refroidissement', base: 12, fuels: [], dtc: ['P0125', 'P0217'], keywords: ['surchauffe', 'chauffe', 'aiguille rouge'], tests: ['Circulation liquide', 'Test thermostat'], fixes: ['Remplacer thermostat'], parts: ['Thermostat, liquide'], labor_h: 1, severity: 'critical' },
  { id: 'radiator_fan_fault', label: 'Ventilateur défaillant', system: 'Refroidissement', base: 11, fuels: [], dtc: ['P0480'], keywords: ['surchauffe ville', 'ventilateur', 'fan'], tests: ['Commande ventilo', 'Relais/moteur'], fixes: ['Remplacer ventilateur/relais'], parts: ['Ventilateur, relais'], labor_h: 1.5, severity: 'high' },
  { id: 'head_gasket_leak', label: 'Joint de culasse', system: 'Mécanique moteur', base: 10, fuels: [], dtc: ['P0300', 'P0125'], keywords: ['fumee blanche', 'mayonnaise', 'bulles vase', 'surchauffe'], tests: ['Test CO2 liquide', 'Compression/étanchéité'], fixes: ['Remplacer joint de culasse'], parts: ['Joint de culasse'], labor_h: 6, severity: 'critical' },
  { id: 'hv_battery_degradation', label: 'Vieillissement batterie HT', system: 'Batterie HT', base: 11, fuels: ['HYBRID', 'PHEV', 'ELECTRIC'], dtc: ['P0A16', 'P0C0A'], keywords: ['autonomie', 'batterie fatigue', 'soh'], tests: ['SOH', 'Historique charges'], fixes: ['Remplacer/reconditionner batterie'], parts: ['Batterie HT'], labor_h: 5, severity: 'critical' },
  { id: 'isolation_fault', label: 'Défaut isolement HT', system: 'Batterie HT/Sécurité', base: 12, fuels: ['HYBRID', 'PHEV', 'ELECTRIC'], dtc: ['P0A14', 'P0AA6'], keywords: ['isolement', 'fuite ht', 'humidite', 'humidité'], tests: ['Test isolement', 'Connecteurs orange'], fixes: ['Sécher/remplacer câble/connecteur'], parts: ['Connecteur HT'], labor_h: 2, severity: 'critical' },
  { id: 'dc_dc_converter_fault', label: 'DC/DC défaillant', system: 'Charge HT/12V', base: 10, fuels: ['HYBRID', 'PHEV', 'ELECTRIC'], dtc: ['P0A00'], keywords: ['dc dc', 'batterie 12v', 'convertisseur'], tests: ['Tension 12V', 'Température DC/DC'], fixes: ['Remplacer DC/DC'], parts: ['Convertisseur DC/DC'], labor_h: 2.5, severity: 'critical' },
  { id: 'tcm_fault', label: 'TCM boîte défaillant', system: 'Transmission', base: 9, fuels: [], dtc: ['P0700', 'U0101'], keywords: ['boite', 'boîte', 'tcm', 'mode degrade'], tests: ['DTC TCM', 'CAN boîte'], fixes: ['Reprogrammer/remplacer TCM'], parts: ['TCM'], labor_h: 2, severity: 'critical' },
  { id: 'transmission_solenoid', label: 'Solénoïde boîte', system: 'Transmission', base: 10, fuels: [], dtc: ['P0750', 'P2700'], keywords: ['a-coups', 'à-coups', 'passage de rapport', 'solenoide'], tests: ['Test solénoïde', 'Huile boîte'], fixes: ['Remplacer solénoïde/vidange'], parts: ['Solénoïde, huile'], labor_h: 1.8, severity: 'high' },
  { id: 'abs_sensor_fault', label: 'Capteur ABS', system: 'Freinage/Sécurité', base: 9, fuels: [], dtc: ['C0035', 'U0121'], keywords: ['voyant abs', 'abs', 'esp', 'capteur roue'], tests: ['Comparer signaux roues', 'Entrefer'], fixes: ['Remplacer capteur ABS'], parts: ['Capteur ABS'], labor_h: 0.8, severity: 'high' },
  { id: 'brake_pads_worn', label: 'Plaquettes usées', system: 'Freinage', base: 10, fuels: [], dtc: [], keywords: ['frein', 'grincement', 'sifflement frein', 'plaquette'], tests: ['Épaisseur plaquettes'], fixes: ['Remplacer plaquettes'], parts: ['Plaquettes'], labor_h: 0.8, severity: 'high' },
  { id: 'wheel_bearing_noise', label: 'Roulement de roue', system: 'Train roulant', base: 8, fuels: [], dtc: [], keywords: ['roulement', 'bruit roue', 'grondement'], tests: ['Roue levée, jeu/bruit'], fixes: ['Remplacer roulement/moyeu'], parts: ['Roulement, moyeu'], labor_h: 1.5, severity: 'medium' },
  { id: 'ac_refrigerant_low', label: 'Manque frigorigène clim', system: 'Climatisation', base: 9, fuels: [], dtc: [], keywords: ['clim', 'ne froidit plus', 'air chaud'], tests: ['Pressions HP/BP', 'Étanchéité'], fixes: ['Recharge/réparation fuite'], parts: ['Frigorigène'], labor_h: 1, severity: 'medium' }
];

const AI_QUESTIONS = [
  { id: 'q_cranking', text: 'Que se passe-t-il au démarrage ?', options: [['slow', 'Démarreur lent'], ['normal', 'Démarreur normal'], ['click', 'Clics sans entraînement'], ['silent', 'Aucun bruit'], ['crank_no_start', 'Tourne mais ne démarre pas']], effects: { slow: { battery_weak: 10, poor_ground: 6, starter_solenoid: 4 }, normal: { battery_weak: -6, fuel_pump_weak: 6, ignition_coil_fault: 4 }, click: { starter_solenoid: 10, battery_weak: 7, poor_ground: 6 }, silent: { battery_weak: 10, poor_ground: 7, immobilizer_fault: 5 }, crank_no_start: { fuel_pump_weak: 10, ignition_coil_fault: 6, injector_clogged: 5 } } },
  { id: 'q_voltage_rest', text: 'Tension batterie moteur arrêté ?', options: [['under12', '< 12.0 V'], ['12_124', '12.0–12.4 V'], ['124_127', '12.4–12.7 V'], ['above127', '> 12.7 V']], effects: { under12: { battery_weak: 12 }, '12_124': { battery_weak: 6 }, '124_127': { battery_weak: -3 }, above127: { battery_weak: -5 } } },
  { id: 'q_alt_voltage', text: 'Tension batterie moteur tournant ?', options: [['below132', '< 13.2 V'], ['normal', '13.2–14.8 V'], ['above15', '> 15.0 V']], effects: { below132: { alternator_fault: 12 }, normal: { alternator_fault: -6 }, above15: { alternator_fault: 6 } } },
  { id: 'q_misfeel', text: 'Ratés ressentis ?', options: [['idle', 'Continu au ralenti'], ['load', 'En charge/accélération'], ['cold', 'À froid'], ['random', 'Aléatoire']], effects: { idle: { spark_plugs_worn: 6, ignition_coil_fault: 6, vacuum_leak: 4 }, load: { ignition_coil_fault: 7, turbo_boost_leak: 5, fuel_pump_weak: 5 }, cold: { glow_plugs_fault: 8, injector_clogged: 5 }, random: { ignition_coil_fault: 5, spark_plugs_worn: 5, vacuum_leak: 5 } } },
  { id: 'q_mil', text: 'Voyant moteur ?', options: [['flashing', 'Clignote'], ['steady', 'Fixe'], ['off', 'Éteint']], effects: { flashing: { ignition_coil_fault: 10, spark_plugs_worn: 7 }, steady: { maf_dirty: 4, catalytic_converter_failed: 3, dpf_clogged: 3 }, off: { ignition_coil_fault: -2 } } },
  { id: 'q_smoke', text: 'Fumée à l’échappement ?', options: [['white', 'Blanche'], ['black', 'Noire'], ['blue', 'Bleue'], ['none', 'Aucune']], effects: { white: { head_gasket_leak: 10, glow_plugs_fault: 4 }, black: { injector_clogged: 6, turbo_boost_leak: 5, egr_stuck_open: 4 }, blue: { head_gasket_leak: 4, turbo_boost_leak: 5 }, none: { head_gasket_leak: -4 } } },
  { id: 'q_overheat', text: 'Moteur surchauffe ?', options: [['yes', 'Oui'], ['sometimes', 'Parfois'], ['no', 'Non']], effects: { yes: { thermostat_stuck_closed: 10, radiator_fan_fault: 7, head_gasket_leak: 4 }, sometimes: { thermostat_stuck_closed: 6, radiator_fan_fault: 5 }, no: { thermostat_stuck_closed: -5 } } },
  { id: 'q_trans', text: 'À-coups boîte de vitesses ?', options: [['cold', 'À froid'], ['hot', 'À chaud'], ['always', 'Tout le temps'], ['no', 'Non']], effects: { cold: { transmission_solenoid: 5, tcm_fault: 3 }, hot: { transmission_solenoid: 7, tcm_fault: 4 }, always: { transmission_solenoid: 8, tcm_fault: 5 }, no: { transmission_solenoid: -4 } } },
  { id: 'q_ev', text: 'Véhicule hybride/électrique avec anomalie batterie/recharge ?', options: [['yes', 'Oui'], ['no', 'Non'], ['unknown', 'Inconnu']], effects: { yes: { hv_battery_degradation: 10, isolation_fault: 7, dc_dc_converter_fault: 5 }, no: { hv_battery_degradation: -5 } } },
  { id: 'q_dpf', text: 'Problème FAP/régénération/AdBlue ?', options: [['yes', 'Oui'], ['no', 'Non'], ['unknown', 'Inconnu']], effects: { yes: { dpf_clogged: 12, egr_stuck_open: 5 }, no: { dpf_clogged: -5 } } }
];

function aiCreateSession(input) {
  return { input: input || {}, answers: {}, result: null };
}

function aiEvaluate(session) {
  const input = session.input || {};
  const ctx = input.context || {};
  const fuel = ctx.fuel ? String(ctx.fuel).toUpperCase() : null;
  const map = new Map();

  const ensure = (c) => {
    if (!map.has(c.id)) map.set(c.id, { ...c, score: c.base || 0, reasons: [] });
    return map.get(c.id);
  };

  for (const c of AI_CAUSES) {
    if (c.fuels?.length && fuel && !c.fuels.includes(fuel)) continue;
    if ((c.base || 0) >= 12) ensure(c).reasons.push('Cause statistiquement fréquente');
  }

  const sym = String(input.symptom || '').trim();
  if (sym) {
    const norm = normalizeText(sym);
    const analysis = analyzeSymptom(sym);

    for (const c of AI_CAUSES) {
      const matched = (c.keywords || []).filter(k => norm.includes(normalizeText(k)));
      if (matched.length) {
        const e = ensure(c);
        e.score += Math.min(30, matched.length * 10);
        e.reasons.push(`Symptôme: ${matched.slice(0, 3).join(', ')}`);
      }
    }

    if (analysis) {
      for (const m of analysis.matches) {
        for (const hint of m.dtcHints || []) {
          for (const c of AI_CAUSES) {
            if ((c.dtc || []).includes(hint)) {
              const e = ensure(c);
              e.score += Math.round(m.score / 4);
              e.reasons.push(`Analyse: ${m.label}`);
            }
          }
        }
      }
    }
  }

  const dtc = String(input.dtc || '').toUpperCase();
  if (dtc) {
    for (const c of AI_CAUSES) {
      for (const code of c.dtc || []) {
        let boost = 0;
        let reason = '';

        if (dtc === code) {
          boost = 35;
          reason = `DTC exact ${code}`;
        } else if (code.startsWith(dtc) || dtc.startsWith(code)) {
          boost = 15;
          reason = `Famille DTC ${code}`;
        }

        if (boost) {
          const e = ensure(c);
          e.score += boost;
          e.reasons.push(reason);
        }
      }
    }
  }

  if (fuel === 'DIESEL') {
    for (const id of ['glow_plugs_fault', 'dpf_clogged']) {
      const c = AI_CAUSES.find(x => x.id === id);
      if (c) {
        const e = ensure(c);
        e.score += 6;
        e.reasons.push('Contexte diesel');
      }
    }
  }

  if (['ELECTRIC', 'HYBRID', 'PHEV'].includes(fuel)) {
    for (const id of ['hv_battery_degradation', 'isolation_fault', 'dc_dc_converter_fault']) {
      const c = AI_CAUSES.find(x => x.id === id);
      if (c) {
        const e = ensure(c);
        e.score += 7;
        e.reasons.push('Contexte électrifié/HT');
      }
    }
  }

  for (const [qid, val] of Object.entries(session.answers || {})) {
    const q = AI_QUESTIONS.find(x => x.id === qid);
    if (!q) continue;

    const eff = q.effects?.[val];
    if (!eff) continue;

    const opt = q.options.find(o => o[0] === val);
    const label = opt ? opt[1] : val;

    for (const [cid, delta] of Object.entries(eff)) {
      const c = AI_CAUSES.find(x => x.id === cid);
      if (!c) continue;

      const e = ensure(c);
      e.score += delta;
      e.reasons.push(`Réponse « ${label} » : ${delta > 0 ? '+' : ''}${delta}`);
    }
  }

  const list = Array.from(map.values())
    .filter(x => x.score >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  const max = list[0]?.score || 1;
  const weights = list.map(x => Math.exp((x.score - max) / 6.5));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const reliability = clamp(max / 65, 0.25, 1);

  const hypotheses = list.map((item, i) => ({
    ...item,
    rank: i + 1,
    score: Math.round(item.score),
    confidence: Math.round(clamp((weights[i] / sum) * 100 * reliability, 1, 95)),
    reasons: unique(item.reasons).slice(0, 8)
  }));

  const topIds = new Set(hypotheses.slice(0, 10).map(h => h.id));
  let nextQuestion = null;
  let best = 0;

  for (const q of AI_QUESTIONS) {
    if (session.answers[q.id]) continue;

    let score = 0;
    for (const eff of Object.values(q.effects || {})) {
      for (const cid of Object.keys(eff)) {
        if (topIds.has(cid)) score += 5;
      }
    }

    if (score > best) {
      best = score;
      nextQuestion = q;
    }
  }

  const checklist = [];
  const seen = new Set();

  for (const h of hypotheses.slice(0, 3)) {
    for (const t of h.tests || []) {
      if (!seen.has(t)) {
        seen.add(t);
        checklist.push({ text: t, type: 'test', cause: h.label });
      }
    }
  }

  for (const h of hypotheses.slice(0, 2)) {
    for (const f of h.fixes || []) {
      if (!seen.has(f)) {
        seen.add(f);
        checklist.push({ text: f, type: 'repair', cause: h.label });
      }
    }
  }

  const warnings = [];
  const systems = new Set(hypotheses.map(h => h.system));

  if ([...systems].some(s => /HT|Batterie|Charge HT|Transmission électrique|Recharge/.test(s)) || /^P0[ABC]/.test(dtc)) {
    warnings.push('Risque haute tension : intervention réservée à un technicien habilité EV/HV.');
  }

  if ([...systems].some(s => /Refroidissement|Mécanique moteur/.test(s))) {
    warnings.push('Ne jamais ouvrir le circuit de refroidissement chaud.');
  }

  if ([...systems].some(s => /Freinage/.test(s))) {
    warnings.push('Ne pas rouler si pédale molle, course basse ou voyant ABS/ESP.');
  }

  if (dtc.startsWith('P03') || session.answers.q_mil === 'flashing') {
    warnings.push('Voyant moteur clignotant : risque catalyseur, limiter la charge.');
  }

  session.result = {
    hypotheses,
    nextQuestion,
    checklist: checklist.slice(0, 20),
    warnings: unique(warnings).slice(0, 6),
    summary: hypotheses.length
      ? `Piste principale : ${hypotheses[0].label} (${hypotheses[0].confidence}%)`
      : 'Données insuffisantes.'
  };

  return session.result;
}

function aiAnswer(session, qid, value) {
  session.answers[qid] = value;
  return aiEvaluate(session);
}

function aiReset(session) {
  session.answers = {};
  return aiEvaluate(session);
}

/* ---------- Diagnostic DB ---------- */
function getBrands() {
  return (S.local.reference.brands || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
}

function getModels(brandId) {
  const models = S.local.reference.models || [];
  const brands = new Map((S.local.reference.brands || []).map(b => [b.id, b.name]));
  const rows = brandId ? models.filter(m => m.brand_id === brandId) : models;

  return rows.slice(0, 800).map(m => ({ ...m, brand_name: brands.get(m.brand_id) || '' }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
}

function getEngines(modelId) {
  if (!modelId) return [];
  return (S.local.reference.engines || [])
    .filter(e => e.model_id === modelId)
    .sort((a, b) => String(a.fuel).localeCompare(String(b.fuel)) || Number(b.power_hp || 0) - Number(a.power_hp || 0));
}

function getEngineContext(engineId, modelId, brandId) {
  const engines = S.local.reference.engines || [];
  const models = new Map((S.local.reference.models || []).map(m => [m.id, m]));
  const brands = new Map((S.local.reference.brands || []).map(b => [b.id, b]));

  let e = null;

  if (engineId) e = engines.find(x => x.id === engineId);
  else if (modelId) e = engines.filter(x => x.model_id === modelId).sort((a, b) => Number(b.power_hp || 0) - Number(a.power_hp || 0))[0];
  else if (brandId) {
    const modelIds = new Set((S.local.reference.models || []).filter(m => m.brand_id === brandId).map(m => m.id));
    e = engines.filter(x => modelIds.has(x.model_id)).sort((a, b) => Number(b.power_hp || 0) - Number(a.power_hp || 0))[0];
  }

  if (!e) return {};

  const m = models.get(e.model_id) || {};
  const b = brands.get(m.brand_id) || {};

  return {
    id: e.id,
    type: e.type,
    power_hp: e.power_hp,
    fuel: e.fuel,
    displacement_cc: e.displacement_cc,
    model_id: m.id,
    model_name: m.name,
    brand_id: b.id,
    brand_name: b.name
  };
}

function sanitizeLike(t) {
  return String(t || '').replace(/[%_]/g, '').trim();
}

function searchFaults(filters = {}) {
  const faults = S.local.reference.faults || [];
  const brands = new Map((S.local.reference.brands || []).map(b => [b.id, b.name]));
  const models = new Map((S.local.reference.models || []).map(m => [m.id, m.name]));
  const engines = new Map((S.local.reference.engines || []).map(e => [e.id, e]));

  let rows = faults.filter(f => {
    if (f.applicability !== 'ALL') {
      if (filters.brandId && f.brand_id !== filters.brandId) return false;
      if (filters.modelId && f.model_id !== filters.modelId) return false;
      if (filters.engineId && f.engine_id !== filters.engineId) return false;
    }

    if (filters.dtc) {
      const q = String(filters.dtc).toUpperCase();
      if (!(f.dtc_code || '').toUpperCase().includes(q) && !normalizeText(f.description).includes(normalizeText(q))) return false;
    }

    if (filters.symptomTerms?.length) {
      const hay = normalizeText([f.dtc_code, f.description, f.causes, f.solutions].join(' '));
      if (!filters.symptomTerms.some(t => hay.includes(sanitizeLike(t)))) return false;
    } else if (filters.symptom) {
      const q = normalizeText(filters.symptom);
      const hay = normalizeText([f.description, f.causes, f.solutions].join(' '));
      if (!hay.includes(q)) return false;
    }

    return true;
  });

  if (filters.powerMin || filters.powerMax) {
    const min = Number(filters.powerMin || 0);
    const max = Number(filters.powerMax || 10000);

    rows = rows.filter(f => {
      if (f.applicability === 'ALL') return true;
      const e = engines.get(f.engine_id);
      return !e || (Number(e.power_hp || 0) >= min && Number(e.power_hp || 0) <= max);
    });
  }

  return rows.map(f => {
    const e = f.engine_id ? engines.get(f.engine_id) : null;
    const m = f.model_id ? models.get(f.model_id) : null;
    const b = f.brand_id ? brands.get(f.brand_id) : null;

    return {
      ...f,
      brand_name: b || '',
      model_name: m || '',
      engine_type: e?.type || '',
      power_hp: e?.power_hp || null,
      fuel: e?.fuel || '',
      displacement_cc: e?.displacement_cc || null
    };
  }).sort((a, b) => {
    const sev = { critical: 1, high: 2, medium: 3, low: 4 };
    return (sev[a.severity] || 5) - (sev[b.severity] || 5) || String(a.dtc_code).localeCompare(String(b.dtc_code));
  }).slice(0, 500);
}

function runDiagnostic(filters = {}) {
  const analysis = filters.symptom ? analyzeSymptom(filters.symptom) : null;
  const symptomTerms = analysis ? buildSymptomTerms(analysis) : [];

  let rows = searchFaults({ ...filters, symptomTerms });

  if (analysis) {
    rows = rows
      .map(r => ({ ...r, __score: scoreFaultRow(r, analysis) }))
      .sort((a, b) => b.__score - a.__score)
      .slice(0, 300);
  }

  const context = getEngineContext(filters.engineId, filters.modelId, filters.brandId);
  const session = aiCreateSession({ dtc: filters.dtc || '', symptom: filters.symptom || '', context });
  const ai = aiEvaluate(session);

  return { rows, analysis, ai, aiSession: session };
}

function groupFaults(rows) {
  const map = new Map();

  for (const r of rows) {
    const key = r.dtc_code;
    if (!map.has(key)) {
      map.set(key, {
        code: r.dtc_code,
        description: r.description,
        causes: r.causes,
        solutions: r.solutions,
        severity: r.severity,
        applicability: r.applicability,
        score: r.__score || 0,
        vehicles: []
      });
    }

    const item = map.get(key);
    const vehicle = [r.brand_name, r.model_name, r.engine_type, r.power_hp ? `${r.power_hp} ch` : null, r.fuel].filter(Boolean).join(' • ');

    if (vehicle && !item.vehicles.includes(vehicle)) item.vehicles.push(vehicle);
  }

  return Array.from(map.values());
}

/* ---------- ELM / UDS ---------- */
function normalizeHex(input) {
  return String(input || '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

function hexToBytes(hex) {
  const clean = normalizeHex(hex);
  if (!clean) return new Uint8Array(0);
  if (clean.length % 2 !== 0) throw new Error('Hex invalide : longueur impaire');

  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes, spaced = true) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0').toUpperCase());
  return spaced ? hex.join(' ') : hex.join('');
}

function parseElmHex(text) {
  const upper = String(text || '').toUpperCase();

  const cleaned = upper
    .replace(/ELM327[^\r\n]*/g, ' ')
    .replace(/BUS INIT[^\r\n]*/g, ' ')
    .replace(/SEARCHING[^\r\n]*/g, ' ')
    .replace(/DATA[^\r\n]*/g, ' ')
    .replace(/MESSAGE[^\r\n]*/g, ' ')
    .replace(/TIMEOUT[^\r\n]*/g, ' ')
    .replace(/NO RESPONSE[^\r\n]*/g, ' ')
    .replace(/\?/g, ' ');

  const contiguous = cleaned.match(/[0-9A-F]{2,}/g) || [];
  let hex = contiguous.filter(s => s.length % 2 === 0).join('');

  if (!hex) {
    const tokens = upper.match(/\b[0-9A-F]{2}\b/g) || [];
    hex = tokens.join('');
  }

  return hex;
}

const NRC_DESCRIPTIONS = {
  0x10: 'General reject',
  0x11: 'Service not supported',
  0x12: 'Sub-function not supported',
  0x13: 'Incorrect message length or invalid format',
  0x22: 'Conditions not correct',
  0x24: 'Request sequence error',
  0x25: 'No key from output',
  0x26: 'Invalid key',
  0x27: 'Exceed number of attempts',
  0x28: 'Required time delay not expired',
  0x31: 'Request out of range',
  0x33: 'Security access denied',
  0x35: 'Invalid key',
  0x36: 'Exceed number of attempts',
  0x37: 'Required time delay not expired',
  0x70: 'Upload/download not accepted',
  0x71: 'Transfer data suspended',
  0x73: 'General programming failure',
  0x78: 'Request correctly received - response pending'
};

function describeNrc(nrc) {
  const value = typeof nrc === 'number' ? nrc : parseInt(String(nrc), 16);
  return NRC_DESCRIPTIONS[value] || `NRC inconnu 0x${(value || 0).toString(16).toUpperCase().padStart(2, '0')}`;
}

class ElmUdsChannel {
  constructor({ sendAt, timeout = 5000 } = {}) {
    if (typeof sendAt !== 'function') throw new Error('ElmUdsChannel nécessite sendAt()');
    this.sendAt = sendAt;
    this.timeout = timeout;
    this.lastTx = null;
    this.lastConfig = null;
  }

  async configure(txId, opts = {}) {
    const config = {
      protocol: opts.protocol ?? 6,
      padding: opts.padding || 'CC',
      blockSize: opts.blockSize ?? 0,
      stMin: opts.stMin ?? 0
    };

    const signature = `${txId}|${config.protocol}|${config.padding}|${config.blockSize}|${config.stMin}`;
    if (this.lastTx === txId && this.lastConfig === signature) return;

    await this.sendAt(`ATSP ${config.protocol}`);
    await this.sendAt(`ATSH ${txId}`);
    await this.sendAt(`ATFC SD ${config.blockSize} ${config.stMin}`);
    await this.sendAt('ATCAF 0');
    await this.sendAt(`ATCP ${config.padding}`);

    this.lastTx = txId;
    this.lastConfig = signature;
  }

  async request(txId, payloadHex, opts = {}) {
    await this.configure(txId, opts);

    const payload = normalizeHex(payloadHex);
    if (!payload) throw new Error('Payload UDS vide');

    const spaced = payload.match(/.{2}/g).join(' ');
    const raw = await this.sendAt(spaced);
    const hex = parseElmHex(raw);

    if (!hex) throw new Error(`Réponse ELM vide ou non hex : ${String(raw).slice(0, 160)}`);

    const bytes = hexToBytes(hex);

    if (bytes[0] === 0x7F) {
      const rejectedService = bytes[1];
      const nrc = bytes[2];
      const message = `NRC 0x${(nrc || 0).toString(16).toUpperCase().padStart(2, '0')} sur service 0x${(rejectedService || 0).toString(16).toUpperCase().padStart(2, '0')} : ${describeNrc(nrc)}`;
      throw new Error(message);
    }

    return bytes;
  }
}

class ElmManager {
  constructor() {
    this.transport = 'demo';
    this.connected = false;
    this.buffer = '';
    this.listeners = new Set();
    this.device = null;
    this.txChar = null;
    this.rxChar = null;
    this.serialPort = null;
    this.capDevice = null;
    this.capSubscription = null;
    this.pendingResolve = null;
    this.pendingTimer = null;

    this.onBleValue = (event) => {
      const val = event.target.value;
      const text = dec.decode(new Uint8Array(val));
      this.buffer += text;

      if (this.pendingResolve && (this.buffer.includes('>') || this.buffer.includes('\r\r'))) {
        const out = this.buffer;
        this.buffer = '';
        clearTimeout(this.pendingTimer);
        const r = this.pendingResolve;
        this.pendingResolve = null;
        r(out);
      }
    };
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e) {
    this.listeners.forEach(fn => fn(e));
  }

  log(msg) {
    this.emit({ type: 'log', msg });
  }

  async connect(transport, opts = {}) {
    this.transport = transport;
    this.disconnectCleanup();

    if (transport === 'demo') {
      this.connected = true;
      this.log('Transport démo connecté.');
      return true;
    }

    if (transport === 'ble') return this.connectBle();
    if (transport === 'capbt') return this.connectCapBt(opts);
    if (transport === 'serial') return this.connectSerial(opts);
    if (transport === 'manual') {
      this.connected = true;
      this.log('Mode manuel : les réponses seront saisies via prompt.');
      return true;
    }

    throw new Error('Transport inconnu');
  }

  disconnectCleanup() {
    this.connected = false;
    this.buffer = '';

    try { this.rxChar?.removeEventListener?.('characteristicvaluechanged', this.onBleValue); } catch {}
    try { this.device?.gatt?.disconnect?.(); } catch {}
    try { this.serialPort?.close?.(); } catch {}
    try { this.capSubscription?.remove?.(); } catch {}

    clearTimeout(this.pendingTimer);
    this.pendingResolve = null;
  }

  async disconnect() {
    this.disconnectCleanup();
    this.log('Déconnecté.');
  }

  async send(command) {
    const cmd = String(command || '').trim();
    if (!cmd) return '';
    if (!this.connected) throw new Error('ELM non connecté');

    this.log(`> ${cmd}`);

    let response = '';

    if (this.transport === 'demo') {
      const hex = normalizeHex(cmd);
      response = hex.length > 4 ? this.demoUds(hex) : this.demoObd(cmd);
    } else if (this.transport === 'ble') {
      response = await this.sendBle(cmd);
    } else if (this.transport === 'capbt') {
      response = await this.sendCapBt(cmd);
    } else if (this.transport === 'serial') {
      response = await this.sendSerial(cmd);
    } else {
      response = await this.sendManual(cmd);
    }

    this.log(response);
    return response;
  }

  demoObd(cmd) {
    const c = cmd.toUpperCase();

    if (c === 'ATZ') return 'ELM327 v2.2';
    if (c.startsWith('AT')) return 'OK';
    if (c.startsWith('0100')) return '4100 BE 3F A8 10';
    if (c.startsWith('010C')) return '410C 1A F8';
    if (c.startsWith('010D')) return '410D 3E';
    if (c.startsWith('0105')) return '4105 7D';
    if (c.startsWith('0111')) return '4111 1F';
    if (c.startsWith('0142')) return '4142 45 9E';
    if (c.startsWith('0104')) return '4104 2D';
    if (c.startsWith('0106')) return '4106 8F';
    if (c.startsWith('0107')) return '4107 94';
    if (c.startsWith('011C')) return '411C 01 02';
    if (c.startsWith('03')) return '43 03 P0171 P0300';
    if (c.startsWith('04')) return '44';
    if (c.startsWith('07')) return '47 21 00 00 00 00';
    if (c.startsWith('0902')) return '4902015756304C4A433145313531323334353637';

    return '?';
  }

  demoUds(hex) {
    const h = normalizeHex(hex);

    if (h.startsWith('10')) return `50 ${h.slice(2, 4)}`;
    if (h.startsWith('3E')) return '7E 00';
    if (h.startsWith('14')) return '54';
    if (h.startsWith('85')) return `C5 ${h.slice(2, 4)}`;

    if (h.startsWith('22F190')) {
      const vin = 'VF1ZZZZZZZZZZZZZZ';
      const vinHex = Array.from(enc.encode(vin)).map(b => b.toString(16).padStart(2, '0')).join('');
      return `6A F1 90 ${vinHex.match(/.{2}/g).join(' ')}`;
    }

    if (h.startsWith('22F194')) return '6A F1 94 31 2E 30 2E 30';
    if (h.startsWith('22F195')) return '6A F1 95 48 57 31 32 33 34 35 36';

    if (h.startsWith('22')) {
      const did = h.slice(2, 6);
      return `6A ${did.match(/.{2}/g).join(' ')} 00 01 02 03`;
    }

    if (h.startsWith('2E')) {
      const did = h.slice(2, 6);
      return `6E ${did.match(/.{2}/g).join(' ')}`;
    }

    if (h.startsWith('27')) {
      const level = h.slice(2, 4);
      const isSeed = parseInt(level, 16) % 2 === 1;
      return isSeed ? `67 ${level} 11 22 33 44` : `67 ${level}`;
    }

    if (h.startsWith('31')) {
      const sub = h.slice(2, 4);
      const rid = h.slice(4, 10) || '000000';
      return `71 ${sub} ${rid.match(/.{2}/g).join(' ')} 00`;
    }

    if (h.startsWith('19')) return '59 02 FF 00 94 01 00';

    return `7F ${h.slice(0, 2)} 31`;
  }

  async connectBle() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth non supporté');

    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb', '0000ae30-0000-1000-8000-00805f9b34fb']
    });

    const server = await this.device.gatt.connect();

    let tx = null;
    let rx = null;

    for (const svc of await server.getPrimaryServices()) {
      for (const ch of await svc.getCharacteristics()) {
        if (!tx && (ch.properties.write || ch.properties.writeWithoutResponse)) tx = ch;
        if (!rx && (ch.properties.notify || ch.properties.indicate)) rx = ch;
      }
    }

    if (!tx || !rx) throw new Error('Caractéristiques ELM introuvables');

    this.txChar = tx;
    this.rxChar = rx;

    await rx.startNotifications();
    rx.addEventListener('characteristicvaluechanged', this.onBleValue);

    this.connected = true;
    this.log(`BLE connecté : ${this.device.name || this.device.id}`);
  }

  async sendBle(cmd) {
    return new Promise((resolve, reject) => {
      this.buffer = '';
      this.pendingResolve = resolve;

      this.pendingTimer = setTimeout(() => {
        const out = this.buffer;
        this.buffer = '';
        this.pendingResolve = null;
        out ? resolve(out) : reject(new Error('Timeout BLE'));
      }, 5000);

      const value = enc.encode(cmd + '\r');

      this.txChar.writeValue(value).catch(() => {
        this.txChar.writeValueWithoutResponse(value).catch(reject);
      });
    });
  }

  async connectCapBt(opts = {}) {
    const BS = window.Capacitor?.Plugins?.BluetoothSerial;
    if (!BS) throw new Error('Plugin BluetoothSerial absent dans l’APK');

    await BS.requestPermissions?.();

    if (!opts.address) throw new Error('Adresse MAC requise pour Bluetooth natif');

    await BS.connect({ address: opts.address });

    const onData = (name, value) => {
      const text = typeof value === 'string' ? value : dec.decode(new Uint8Array(value));
      this.buffer += text;

      if (this.pendingResolve && (this.buffer.includes('>') || this.buffer.includes('\r\r'))) {
        const out = this.buffer;
        this.buffer = '';
        clearTimeout(this.pendingTimer);
        const r = this.pendingResolve;
        this.pendingResolve = null;
        r(out);
      }
    };

    if (BS.subscribeData) this.capSubscription = BS.subscribeData(onData);
    else if (BS.subscribe) this.capSubscription = await BS.subscribe({ data: onData });

    this.connected = true;
    this.log('Bluetooth natif connecté.');
  }

  async sendCapBt(cmd) {
    return new Promise((resolve, reject) => {
      const BS = window.Capacitor?.Plugins?.BluetoothSerial;
      if (!BS) return reject(new Error('Plugin absent'));

      this.buffer = '';
      this.pendingResolve = resolve;

      this.pendingTimer = setTimeout(() => {
        const out = this.buffer;
        this.buffer = '';
        this.pendingResolve = null;
        out ? resolve(out) : reject(new Error('Timeout BT natif'));
      }, 6000);

      const bytes = Array.from(enc.encode(cmd + '\r'));

      if (BS.writeData) BS.writeData({ data: bytes }).catch(reject);
      else if (BS.write) BS.write({ value: bytes }).catch(reject);
      else reject(new Error('Méthode write indisponible'));
    });
  }

  async connectSerial(opts = {}) {
    if (!navigator.serial) throw new Error('Web Serial non supporté');

    this.serialPort = await navigator.serial.requestPort();
    await this.serialPort.open({ baudRate: Number(opts.baudRate || 38400) });

    this.connected = true;
    this.log('Série USB connectée.');
  }

  async sendSerial(cmd) {
    if (!this.serialPort?.writable) throw new Error('Port série non ouvert');

    const writer = this.serialPort.writable.getWriter();
    await writer.write(enc.encode(cmd + '\r'));
    writer.releaseLock();

    const reader = this.serialPort.readable.getReader();
    let out = '';
    const start = now();

    try {
      while (now() - start < 6000) {
        const { value, done } = await reader.read();
        if (done) break;

        out += dec.decode(value);
        if (out.includes('>') || out.includes('\r\r')) break;
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }

    return out || '?';
  }

  async sendManual(cmd) {
    const answer = prompt(`Réponse ELM pour :\n${cmd}`);
    return answer || '';
  }
}

const EA = {
  profiles: null,
  channel: null,
  liveTimer: null,
  liveRunning: false,
  logs: []
};

const CLIENT_ELM_FALLBACK = {
  version: 'fallback',
  transport_defaults: { tx_id: '7E0', rx_id: '7E8', padding: 'CC', protocol: 6, block_size: 0, st_min: 0, timeout_ms: 5000 },
  brands: { GENERIC: { name: 'Générique', tx_id: '7E0', rx_id: '7E8' } },
  ecu_groups: [
    {
      id: 'ENGINE_GENERIC',
      name: 'Moteur générique',
      tx_id: '7E0',
      rx_id: '7E8',
      variables: [
        { name: 'Régime moteur', source: 'pid', pid: '010C', unit: 'tr/min' },
        { name: 'Vitesse véhicule', source: 'pid', pid: '010D', unit: 'km/h' }
      ],
      routines: []
    }
  ]
};

function injectElmAdvanced() {
  const host = $('#elmAdvancedHost') || $('#panel-elm');
  if (!host || $('#elmAdvancedCard')) return;

  const card = document.createElement('section');
  card.id = 'elmAdvancedCard';
  card.className = 'card ea-card';
  card.innerHTML = `
    <div class="ea-title">
      <h2>🧬 Console ELM avancée UDS / ISO-TP</h2>
      <span id="eaRoleBadge" class="ea-badge">Chargement…</span>
    </div>

    <div class="ea-small">
      Lecture DTC, VIN, DID, variables live, routines, security access, écritures UDS.
      Les écritures sensibles sont réservées au mode propriétaire et nécessitent confirmation.
    </div>

    <div class="ea-section">
      <h3>⚙️ Configuration canal</h3>
      <div class="ea-grid">
        <div class="field"><label for="eaBrandSelect">Marque / profil</label><select id="eaBrandSelect"><option value="">Charger profils…</option></select></div>
        <div class="field"><label for="eaEcuSelect">Calculateur / groupe ECU</label><select id="eaEcuSelect"><option value="">Aucun</option></select></div>
        <div class="field"><label for="eaTxId">Tx ID hex</label><input id="eaTxId" placeholder="7E0" /></div>
        <div class="field"><label for="eaRxId">Rx ID hex</label><input id="eaRxId" placeholder="7E8" /></div>
        <div class="field"><label for="eaPadding">Padding hex</label><input id="eaPadding" placeholder="CC" /></div>
        <div class="field"><label for="eaTimeout">Timeout ms</label><input id="eaTimeout" type="number" min="500" step="100" value="5000" /></div>
      </div>

      <div class="ea-row">
        <button id="eaLoadProfilesBtn" class="btn btn-primary">Charger profils serveur</button>
        <button id="eaRefreshBtn" class="btn btn-outline">Actualiser interface</button>
        <button id="eaTesterPresentBtn" class="btn btn-outline">Tester présent 3E 00</button>
        <button id="eaScanEcusBtn" class="btn btn-primary">Scanner ECUs</button>
      </div>

      <div id="eaConfigStatus" class="ea-small" style="margin-top:10px;">Profils non chargés.</div>
    </div>

    <div class="ea-section">
      <h3>🚗 Identification / DTC</h3>
      <div class="ea-row">
        <button id="eaReadVinBtn" class="btn btn-primary">Lire VIN UDS F190</button>
        <button id="eaReadDtcBtn" class="btn btn-outline">Lire DTC</button>
        <button id="eaClearDtcBtn" class="btn btn-danger">Effacer DTC</button>
        <button id="eaReadinessBtn" class="btn btn-outline">Readiness 07</button>
      </div>
      <div id="eaVehicleInfo" class="ea-grid" style="margin-top:12px;"></div>
      <div id="eaDtcResults" style="margin-top:12px;"></div>
    </div>

    <div class="ea-section">
      <h3>📈 Variables live</h3>
      <div class="ea-row">
        <button id="eaLiveStartBtn" class="btn btn-primary">Démarrer live</button>
        <button id="eaLiveStopBtn" class="btn btn-danger">Arrêter live</button>
        <div class="field" style="min-width:160px;">
          <label for="eaLiveInterval">Intervalle ms</label>
          <input id="eaLiveInterval" type="number" min="500" step="100" value="2000" />
        </div>
      </div>
      <table class="ea-table">
        <thead><tr><th>Variable</th><th>Source</th><th>Valeur</th><th>Unité</th></tr></thead>
        <tbody id="eaVariablesBody"><tr><td colspan="4">Aucune variable.</td></tr></tbody>
      </table>
    </div>

    <div class="ea-section">
      <h3>🧪 DID lecture / écriture</h3>
      <div class="ea-grid">
        <div class="field"><label for="eaDidInput">DID hex</label><input id="eaDidInput" placeholder="F190" /></div>
        <div class="field"><label for="eaDidDataInput">Données hex écriture</label><input id="eaDidDataInput" placeholder="Ex : 00 01 02" /></div>
      </div>
      <div class="ea-row">
        <button id="eaReadDidBtn" class="btn btn-primary">Lire DID 22</button>
        <button id="eaWriteDidBtn" class="btn btn-danger ea-danger">Écrire DID 2E</button>
      </div>
      <div id="eaDidResult" class="ea-small" style="margin-top:10px;"></div>
    </div>

    <div class="ea-section">
      <h3>🔐 Security access UDS</h3>
      <div class="ea-small">Demande de seed et envoi de clé. Aucun calcul de clé OEM propriétaire n’est fourni.</div>
      <div class="ea-grid" style="margin-top:10px;">
        <div class="field"><label for="eaSecurityLevel">Niveau impair hex</label><input id="eaSecurityLevel" placeholder="01" value="01" /></div>
        <div class="field"><label for="eaSecurityKey">Clé hex</label><input id="eaSecurityKey" placeholder="Clé légitime fournie" /></div>
      </div>
      <div class="ea-row">
        <button id="eaRequestSeedBtn" class="btn btn-primary">Demander seed 27 01</button>
        <button id="eaSendKeyBtn" class="btn btn-danger ea-danger">Envoyer clé 27 02</button>
      </div>
      <div id="eaSecurityResult" class="ea-small" style="margin-top:10px;"></div>
    </div>

    <div class="ea-section">
      <h3>🧰 Routines / calibrage / apprentissages</h3>
      <div class="ea-grid">
        <div class="field"><label for="eaRoutineSelect">Routine</label><select id="eaRoutineSelect"><option value="">Aucune</option></select></div>
        <div class="field"><label for="eaRoutineOption">Option record hex</label><input id="eaRoutineOption" placeholder="Optionnel" /></div>
      </div>
      <div class="ea-row">
        <button id="eaRoutineStartBtn" class="btn btn-danger ea-danger">Démarrer 31 01</button>
        <button id="eaRoutineStopBtn" class="btn btn-outline">Arrêter 31 02</button>
        <button id="eaRoutineResultsBtn" class="btn btn-outline">Résultats 31 03</button>
      </div>
      <div id="eaRoutineResult" class="ea-small" style="margin-top:10px;"></div>
    </div>

    <div class="ea-section">
      <h3>🧾 UDS brut</h3>
      <div class="field"><label for="eaRawPayload">Payload hex UDS</label><input id="eaRawPayload" placeholder="Ex : 22 F1 90 ou 31 01 00 00 00" /></div>
      <div class="ea-row">
        <button id="eaRawSendBtn" class="btn btn-primary">Envoyer requête brute</button>
        <button id="eaControlDtcOffBtn" class="btn btn-danger ea-danger">DTC off 85 01</button>
        <button id="eaControlDtcOnBtn" class="btn btn-outline">DTC on 85 02</button>
      </div>
      <pre id="eaConsole" class="ea-console"></pre>
    </div>

    <div class="ea-section">
      <h3>📜 Journal ELM avancé</h3>
      <div class="ea-row">
        <button id="eaLoadLogsBtn" class="btn btn-outline">Charger journal serveur</button>
        <button id="eaClearLocalLogsBtn" class="btn btn-outline">Vider journal local</button>
      </div>
      <div id="eaLogs" style="margin-top:10px;"></div>
    </div>
  `;

  host.appendChild(card);
  bindElmAdvanced();
  renderElmRoleBadge();
  renderElmLogs();
}

function $adv(sel) {
  return document.querySelector(sel);
}

function isOwner() {
  return (S.role || '') === 'owner';
}

function requireOwner(actionLabel = 'Cette opération') {
  if (!isOwner()) {
    toast(`${actionLabel} réservé au mode propriétaire/admin.`, 'error');
    return false;
  }
  return true;
}

function renderElmRoleBadge() {
  const badge = $adv('#eaRoleBadge');
  if (!badge) return;

  const role = S.role || 'none';
  badge.textContent = role === 'owner' ? '👑 Propriétaire / écritures autorisées' :
    role === 'guest' ? '🟢 Invité / lecture seule' :
    '⚪ Non connecté';

  badge.className = `ea-badge ${role === 'owner' ? 'ok' : role === 'guest' ? '' : 'warn'}`;
}

function ensureElmConnected() {
  if (!S.elm?.connected) {
    toast('Connectez d’abord l’adaptateur ELM dans la carte Connexion ELM.', 'error');
    return false;
  }
  return true;
}

function getElmChannel() {
  if (!EA.channel) {
    EA.channel = new ElmUdsChannel({
      sendAt: (cmd) => S.elm.send(cmd),
      timeout: 5000
    });
  }
  return EA.channel;
}

function appendElmConsole(text) {
  const el = $adv('#eaConsole');
  if (!el) return;
  el.textContent += (el.textContent ? '\n' : '') + text;
  el.scrollTop = el.scrollHeight;
}

async function elmAddLog(action, command, response, ok = true, meta = null) {
  const rec = {
    id: uid(),
    ts: now(),
    action,
    command: String(command || '').slice(0, 1000),
    response: String(response || '').slice(0, 4000),
    ok: !!ok,
    meta
  };

  EA.logs.unshift(rec);
  EA.logs = EA.logs.slice(0, 300);

  S.local.elm_logs.unshift(rec);
  S.local.elm_logs = S.local.elm_logs.slice(0, 500);
  schedulePersist();

  renderElmLogs();

  try {
    if (S.token) {
      await api('/api/elm/log', {
        method: 'POST',
        body: JSON.stringify({ action, command: rec.command, response: rec.response, ok: rec.ok, meta })
      });
    }
  } catch {}
}

function renderElmLogs() {
  const host = $adv('#eaLogs');
  if (!host) return;

  if (!EA.logs.length) {
    host.innerHTML = '<div class="ea-small">Aucun journal local.</div>';
    return;
  }

  host.innerHTML = EA.logs.slice(0, 80).map(log => `
    <div class="audit-item">
      <strong>${esc(log.action)}</strong>
      <span class="ea-badge ${log.ok ? 'ok' : 'ko'}" style="margin-left:8px;">${log.ok ? 'OK' : 'KO'}</span>
      <div class="muted small">${new Date(log.ts).toLocaleString()}</div>
      <div class="small small-break">${esc(log.command)}</div>
      ${log.response ? `<div class="muted small small-break">→ ${esc(log.response)}</div>` : ''}
    </div>
  `).join('');
}

function getSelectedBrandId() {
  return $adv('#eaBrandSelect')?.value || '';
}

function getSelectedEcuGroup() {
  const id = $adv('#eaEcuSelect')?.value;
  if (!EA.profiles || !id) return null;
  return (EA.profiles.ecu_groups || []).find(g => g.id === id) || null;
}

function getCurrentEcuConfig() {
  const profiles = EA.profiles;
  if (!profiles) return null;

  const brandId = getSelectedBrandId();
  const brand = profiles.brands?.[brandId] || {};
  const group = getSelectedEcuGroup() || {};
  const defaults = profiles.transport_defaults || {};

  return {
    brandId,
    brandName: brand.name || brandId || 'Générique',
    groupId: group.id || '',
    groupName: group.name || 'Aucun',
    tx_id: ($adv('#eaTxId')?.value || group.tx_id || brand.tx_id || defaults.tx_id || '7E0').toUpperCase().replace(/[^0-9A-F]/g, ''),
    rx_id: ($adv('#eaRxId')?.value || group.rx_id || brand.rx_id || defaults.rx_id || '7E8').toUpperCase().replace(/[^0-9A-F]/g, ''),
    padding: ($adv('#eaPadding')?.value || defaults.padding || 'CC').toUpperCase().replace(/[^0-9A-F]/g, '') || 'CC',
    protocol: defaults.protocol || 6,
    block_size: defaults.block_size || 0,
    st_min: defaults.st_min || 0,
    timeout_ms: Number($adv('#eaTimeout')?.value || defaults.timeout_ms || 5000),
    variables: group.variables || [],
    routines: group.routines || [],
    dids: group.dids || []
  };
}

function renderElmProfiles() {
  const brandSelect = $adv('#eaBrandSelect');
  const ecuSelect = $adv('#eaEcuSelect');
  const status = $adv('#eaConfigStatus');
  const ecuProfileSelect = $('#elmEcuProfileSelect');
  const calibProfileSelect = $('#elmCalibProfileSelect');

  if (!EA.profiles) {
    if (brandSelect) brandSelect.innerHTML = '<option value="">Profils non chargés</option>';
    if (ecuSelect) ecuSelect.innerHTML = '<option value="">Aucun</option>';
    if (status) status.textContent = 'Profils non chargés.';
    return;
  }

  const brands = Object.entries(EA.profiles.brands || {});
  const groups = EA.profiles.ecu_groups || [];

  const brandOptions = '<option value="">Marque générique</option>' +
    brands.map(([id, b]) => `<option value="${esc(id)}">${esc(b.name || id)}</option>`).join('');

  const groupOptions = groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');

  if (brandSelect) brandSelect.innerHTML = brandOptions;
  if (ecuSelect) ecuSelect.innerHTML = groupOptions;
  if (ecuProfileSelect) ecuProfileSelect.innerHTML = groupOptions;
  if (calibProfileSelect) calibProfileSelect.innerHTML = groupOptions;

  const firstGroup = groups[0];
  if (firstGroup) {
    if ($adv('#eaTxId')) $adv('#eaTxId').value = firstGroup.tx_id || EA.profiles.transport_defaults?.tx_id || '7E0';
    if ($adv('#eaRxId')) $adv('#eaRxId').value = firstGroup.rx_id || EA.profiles.transport_defaults?.rx_id || '7E8';
    if ($adv('#eaPadding')) $adv('#eaPadding').value = EA.profiles.transport_defaults?.padding || 'CC';
    if ($adv('#eaTimeout')) $adv('#eaTimeout').value = EA.profiles.transport_defaults?.timeout_ms || 5000;
  }

  renderElmEcuDetails();

  if (status) {
    status.textContent = `Profils chargés : version ${EA.profiles.version}, ${groups.length} groupes ECU, ${brands.length} marques.`;
  }
}

function renderElmEcuDetails() {
  const ecu = getCurrentEcuConfig();
  const variablesBody = $adv('#eaVariablesBody');
  const routineSelect = $adv('#eaRoutineSelect');

  if (!ecu) {
    if (variablesBody) variablesBody.innerHTML = '<tr><td colspan="4">Aucun groupe ECU sélectionné.</td></tr>';
    if (routineSelect) routineSelect.innerHTML = '<option value="">Aucune</option>';
    return;
  }

  if (variablesBody) {
    variablesBody.innerHTML = ecu.variables.length
      ? ecu.variables.map((v, index) => `
        <tr data-ea-variable-index="${index}">
          <td>${esc(v.name)}</td>
          <td>${esc(v.source === 'pid' ? `PID ${v.pid}` : `DID ${v.did}`)}</td>
          <td data-ea-variable-value>—</td>
          <td>${esc(v.unit || '')}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="4">Aucune variable définie pour ce groupe.</td></tr>';
  }

  if (routineSelect) {
    routineSelect.innerHTML = ecu.routines.length
      ? ecu.routines.map(r => `<option value="${esc(r.id)}">${esc(r.name)} ${r.danger ? '⚠️' : ''}</option>`).join('')
      : '<option value="">Aucune routine définie</option>';
  }
}

async function loadElmProfiles() {
  try {
    EA.profiles = await api('/api/elm/profiles');
  } catch {
    EA.profiles = CLIENT_ELM_FALLBACK;
  }

  S.elmProfiles = EA.profiles;
  S.local.elm_profiles = EA.profiles;
  schedulePersist();

  renderElmProfiles();
  renderElmRoleBadge();
  toast('Profils ELM/UDS chargés.', 'success');
  await elmAddLog('profiles_loaded', 'GET /api/elm/profiles', `${EA.profiles?.ecu_groups?.length || 0} groupes`, true);
}

async function loadElmServerLogs() {
  if (!requireOwner('Journal serveur')) return;

  try {
    const rows = await api('/api/elm/logs?limit=120');
    EA.logs = rows.map(r => ({
      id: r.id,
      ts: r.ts,
      action: r.action,
      command: r.command,
      response: r.response,
      ok: r.ok
    }));
    renderElmLogs();
    toast('Journal serveur chargé.', 'success');
  } catch (err) {
    toast('Journal serveur : ' + err.message, 'error');
  }
}

async function udsRequest(payloadHex, ecuOverride = null) {
  if (!ensureElmConnected()) throw new Error('ELM non connecté');

  const ecu = ecuOverride || getCurrentEcuConfig();
  if (!ecu?.tx_id) throw new Error('Tx ID non défini');

  const channel = getElmChannel();
  const bytes = await channel.request(ecu.tx_id, payloadHex, {
    protocol: ecu.protocol,
    padding: ecu.padding,
    blockSize: ecu.block_size,
    stMin: ecu.st_min,
    timeout: ecu.timeout_ms
  });

  await elmAddLog('uds_request', `${ecu.tx_id} -> ${normalizeHex(payloadHex)}`, bytesToHex(bytes), true);
  return bytes;
}

function parseDidPositive(bytes, didHex) {
  const did = normalizeHex(didHex);
  if (bytes.length < 3) throw new Error('Réponse DID trop courte');
  if (bytes[0] !== 0x6A) throw new Error('Réponse DID inattendue : ' + bytesToHex(bytes));

  const responseDid = bytes[1].toString(16).padStart(2, '0') + bytes[2].toString(16).padStart(2, '0');
  if (responseDid.toUpperCase() !== did.toUpperCase()) {
    throw new Error(`DID répondu ${responseDid} attendu ${did}`);
  }

  return bytes.slice(3);
}

function bytesToUnsignedInteger(bytes) {
  let value = 0;
  for (const b of bytes) value = value * 256 + b;
  return value;
}

function bytesToSignedInteger(bytes) {
  const unsigned = bytesToUnsignedInteger(bytes);
  const bits = bytes.length * 8;
  const max = 2 ** bits;
  return unsigned >= max / 2 ? unsigned - max : unsigned;
}

function decodePid(pid, bytes) {
  const p = normalizeHex(pid).slice(-2);
  const a = bytes[2] ?? 0;
  const b = bytes[3] ?? 0;

  switch (p) {
    case '0C': return Math.round((a * 256 + b) / 4);
    case '0D': return a;
    case '05': return a - 40;
    case '0B': return a;
    case '11': return Math.round(a * 100 / 255);
    case '0F': return a - 40;
    case '42': return Number(((a * 256 + b) / 1000).toFixed(2));
    case '04': return Math.round(a * 100 / 255);
    case '06':
    case '07':
      return Number((((a - 128) * 100) / 128).toFixed(1));
    case '1C':
      return { mil: a & 127, dtcCount: b };
    default:
      return bytesToHex(bytes.slice(2));
  }
}

function formatVariableValue(variable, rawBytes) {
  if (variable.enum) {
    const key = String(bytesToUnsignedInteger(rawBytes));
    return variable.enum[key] || key;
  }

  const signed = !!variable.signed;
  const raw = signed ? bytesToSignedInteger(rawBytes) : bytesToUnsignedInteger(rawBytes);
  const scale = Number(variable.scale ?? 1);
  const offset = Number(variable.offset ?? 0);
  const value = raw * scale + offset;

  if (Number.isInteger(value)) return String(value);
  return value.toFixed(scale < 1 ? 2 : 1);
}

async function readElmVariable(variable, ecu) {
  if (variable.source === 'pid') {
    const resp = await S.elm.send(variable.pid);
    const hex = parseElmHex(resp);
    if (!hex) throw new Error('PID sans réponse');

    const bytes = hexToBytes(hex);
    const value = decodePid(variable.pid, bytes);
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  if (variable.source === 'did') {
    const bytes = await udsRequest(`22 ${variable.did}`, ecu);
    const data = parseDidPositive(bytes, variable.did);
    const offset = Number(variable.byte_offset || 0);
    const length = Number(variable.length || data.length);
    const slice = data.slice(offset, offset + length);

    if (!slice.length) throw new Error('Données DID vides');
    return formatVariableValue(variable, slice);
  }

  throw new Error('Source variable inconnue');
}

async function scanElmEcus() {
  if (!EA.profiles) {
    toast('Chargez d’abord les profils.', 'error');
    return;
  }

  if (!ensureElmConnected()) return;

  const results = [];
  const groups = EA.profiles.ecu_groups || [];

  for (const group of groups) {
    const ecu = {
      ...getCurrentEcuConfig(),
      tx_id: group.tx_id || '7E0',
      rx_id: group.rx_id || '7E8',
      groupId: group.id,
      groupName: group.name
    };

    try {
      const bytes = await udsRequest('22 F190', ecu);
      const data = parseDidPositive(bytes, 'F190');
      const vin = dec.decode(data).replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17);
      results.push({ group, ok: true, vin: vin || bytesToHex(data) });
    } catch (err) {
      results.push({ group, ok: false, error: err.message });
    }
  }

  const host = $adv('#eaVehicleInfo');
  if (host) {
    host.innerHTML = results.map(r => `
      <div class="card" style="margin:0;padding:12px;">
        <strong>${esc(r.group.name)}</strong>
        <div class="ea-badge ${r.ok ? 'ok' : 'ko'}" style="margin-top:6px;">${r.ok ? 'Répond' : 'Silencieux / NRC'}</div>
        <div class="muted small">${esc(r.group.tx_id)} → ${esc(r.group.rx_id)}</div>
        <div class="small">${esc(r.ok ? `VIN/ID : ${r.vin}` : r.error)}</div>
      </div>
    `).join('');
  }

  toast(`Scan terminé : ${results.filter(r => r.ok).length}/${results.length} ECUs actifs.`, 'success');
  await elmAddLog('scan_ecus', '22 F190 sur groupes', JSON.stringify(results.map(r => ({ id: r.group.id, ok: r.ok }))), true);
}

function parseVinFromElm(resp) {
  const hex = parseElmHex(resp);
  const ascii = hexToAscii(hex);
  const m = ascii.match(/[A-HJ-NPR-Z0-9]{17}/i);
  if (m) return m[0].toUpperCase();

  const hexClean = hex.replace(/[^0-9A-F]/g, '');
  const idx = hexClean.indexOf('4902');
  const segment = idx >= 0 ? hexClean.slice(idx + 6) : hexClean;

  return hexToAscii(segment).replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17).toUpperCase();
}

async function eaReadVin() {
  try {
    const ecu = getCurrentEcuConfig();
    const bytes = await udsRequest('22 F190', ecu);
    const data = parseDidPositive(bytes, 'F190');
    const vin = dec.decode(data).replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17);

    const host = $adv('#eaVehicleInfo');
    if (host) {
      host.innerHTML = `
        <div class="card" style="margin:0;padding:12px;">
          <strong>VIN</strong>
          <div style="font-size:1.2rem;font-weight:900;color:#06b6d4;">${esc(vin || bytesToHex(data))}</div>
        </div>
      `;
    }

    toast('VIN lu.', 'success');
  } catch (err) {
    try {
      const resp = await S.elm.send('0902');
      const vin = parseVinFromElm(resp);
      const host = $adv('#eaVehicleInfo');
      if (host) host.innerHTML = `<div class="card" style="margin:0;padding:12px;"><strong>VIN</strong><div>${esc(vin || 'non lu')}</div></div>`;
      toast(vin ? 'VIN lu via OBD.' : 'VIN non lu.', vin ? 'success' : 'error');
    } catch (err2) {
      toast('VIN : ' + err.message, 'error');
    }
  }
}

function parseDtcText(text) {
  const upper = String(text || '').toUpperCase();
  const tokens = upper.match(/[PUBCR][0-9A-F]{4}/g) || [];
  if (tokens.length) return Array.from(new Set(tokens));

  const hex = parseElmHex(upper);
  if (!hex) return [];

  const bytes = hexToBytes(hex);
  const out = [];

  for (let i = 2; i < bytes.length - 1; i += 2) {
    const high = bytes[i];
    const low = bytes[i + 1];
    const type = ['P', 'C', 'B', 'U'][(high >> 6) & 3] || 'P';
    const digit2 = (high >> 4) & 3;
    const num = ((high & 15) << 8) | low;
    out.push(`${type}${digit2}${String(num).padStart(3, '0')}`);
  }

  return Array.from(new Set(out));
}

async function eaReadDtc() {
  try {
    const resp = await S.elm.send('03');
    const dtcs = parseDtcText(resp);

    const host = $adv('#eaDtcResults');
    if (host) {
      host.innerHTML = dtcs.length
        ? dtcs.map(d => `<div class="fault medium"><div class="code">${esc(d)}</div></div>`).join('')
        : '<div class="ea-small">Aucun DTC.</div>';
    }

    toast(`${dtcs.length} DTC.`, 'success');
    await elmAddLog('read_dtc', '03', resp, true);
  } catch (err) {
    toast('DTC : ' + err.message, 'error');
  }
}

async function eaClearDtc() {
  if (!requireOwner('Effacement DTC')) return;
  if (!confirm('Effacer les DTC ? Cela peut masquer un défaut sans réparer la cause.')) return;

  try {
    const resp = await S.elm.send('04');
    const host = $adv('#eaDtcResults');
    if (host) host.innerHTML = '<div class="ea-small">DTC effacés si supportés.</div>';

    toast('DTC effacés.', 'success');
    await elmAddLog('clear_dtc', '04', resp, true);
  } catch (err) {
    toast('Effacement DTC : ' + err.message, 'error');
  }
}

async function eaReadiness() {
  try {
    const resp = await S.elm.send('07');
    appendElmConsole('Readiness : ' + resp);
    toast('Readiness lu.', 'success');
    await elmAddLog('readiness', '07', resp, true);
  } catch (err) {
    toast('Readiness : ' + err.message, 'error');
  }
}

async function eaTesterPresent() {
  try {
    const bytes = await udsRequest('3E 00');
    appendElmConsole('Tester present : ' + bytesToHex(bytes));
    toast('Tester présent OK.', 'success');
  } catch (err) {
    toast('Tester présent : ' + err.message, 'error');
  }
}

function stopElmLive() {
  if (EA.liveTimer) clearInterval(EA.liveTimer);
  EA.liveTimer = null;
  EA.liveRunning = false;
}

async function startElmLive() {
  stopElmLive();

  const ecu = getCurrentEcuConfig();
  if (!ecu?.variables?.length) {
    toast('Aucune variable pour ce groupe ECU.', 'error');
    return;
  }

  if (!ensureElmConnected()) return;

  const interval = Math.max(500, Number($adv('#eaLiveInterval')?.value || 2000));

  EA.liveTimer = setInterval(async () => {
    if (EA.liveRunning) return;
    EA.liveRunning = true;

    try {
      for (const variable of ecu.variables) {
        const index = ecu.variables.indexOf(variable);
        const row = document.querySelector(`[data-ea-variable-index="${index}"] [data-ea-variable-value]`);
        if (!row) continue;

        try {
          const value = await readElmVariable(variable, ecu);
          row.textContent = `${value} ${variable.unit || ''}`;
        } catch (err) {
          row.textContent = 'Erreur';
          row.title = err.message;
        }

        await sleep(80);
      }
    } finally {
      EA.liveRunning = false;
    }
  }, interval);

  toast('Live variables démarrées.', 'success');
}

async function eaReadDid() {
  try {
    const did = normalizeHex($adv('#eaDidInput')?.value);
    if (!did) throw new Error('DID requis');

    const bytes = await udsRequest(`22 ${did}`);
    const data = parseDidPositive(bytes, did);

    const result = $adv('#eaDidResult');
    if (result) {
      result.textContent = `DID ${did} : ${bytesToHex(data)} | ASCII : ${dec.decode(data).replace(/[^\x20-\x7E]/g, '.')}`;
    }

    toast('DID lu.', 'success');
  } catch (err) {
    const result = $adv('#eaDidResult');
    if (result) result.textContent = 'Erreur : ' + err.message;
    toast('DID : ' + err.message, 'error');
  }
}

async function eaWriteDid() {
  if (!requireOwner('Écriture DID')) return;

  const did = normalizeHex($adv('#eaDidInput')?.value);
  const data = normalizeHex($adv('#eaDidDataInput')?.value);

  if (!did) return toast('DID requis.', 'error');
  if (!data) return toast('Données hex requises.', 'error');

  if (!confirm(`Écrire DID ${did} avec données ${data} ?\n\nCette opération peut modifier un calculateur.`)) return;

  try {
    const bytes = await udsRequest(`2E ${did} ${data}`);
    const result = $adv('#eaDidResult');
    if (result) result.textContent = `Écriture DID ${did} : ${bytesToHex(bytes)}`;

    toast('DID écrit (si accepté).', 'success');
    await elmAddLog('write_did', `2E ${did} ${data}`, bytesToHex(bytes), true);
  } catch (err) {
    const result = $adv('#eaDidResult');
    if (result) result.textContent = 'Erreur écriture : ' + err.message;
    toast('Écriture DID : ' + err.message, 'error');
  }
}

async function eaRequestSeed() {
  if (!requireOwner('Security access')) return;

  const level = normalizeHex($adv('#eaSecurityLevel')?.value) || '01';

  try {
    const bytes = await udsRequest(`27 ${level}`);
    if (bytes[0] !== 0x67) throw new Error('Réponse seed inattendue : ' + bytesToHex(bytes));

    const seed = bytesToHex(bytes.slice(2));
    const result = $adv('#eaSecurityResult');
    if (result) result.textContent = `Seed : ${seed}`;

    toast('Seed reçu. Saisissez la clé légitime.', 'success');
    await elmAddLog('security_seed', `27 ${level}`, seed, true);
  } catch (err) {
    const result = $adv('#eaSecurityResult');
    if (result) result.textContent = 'Erreur seed : ' + err.message;
    toast('Seed : ' + err.message, 'error');
  }
}

async function eaSendKey() {
  if (!requireOwner('Security access')) return;

  const level = normalizeHex($adv('#eaSecurityLevel')?.value) || '01';
  const key = normalizeHex($adv('#eaSecurityKey')?.value);

  if (!key) return toast('Clé hex requise.', 'error');

  const evenLevel = (parseInt(level, 16) + 1).toString(16).padStart(2, '0').toUpperCase();

  if (!confirm(`Envoyer clé de sécurité ${key} au niveau ${evenLevel} ?`)) return;

  try {
    const bytes = await udsRequest(`27 ${evenLevel} ${key}`);
    const result = $adv('#eaSecurityResult');
    if (result) result.textContent = `Réponse security access : ${bytesToHex(bytes)}`;

    toast('Clé envoyée.', 'success');
    await elmAddLog('security_key', `27 ${evenLevel} ${key}`, bytesToHex(bytes), true);
  } catch (err) {
    const result = $adv('#eaSecurityResult');
    if (result) result.textContent = 'Erreur clé : ' + err.message;
    toast('Clé : ' + err.message, 'error');
  }
}

function getSelectedRoutine() {
  const ecu = getCurrentEcuConfig();
  const id = $adv('#eaRoutineSelect')?.value;
  return ecu?.routines?.find(r => r.id === id) || null;
}

async function runElmRoutine(action) {
  const routine = getSelectedRoutine();
  if (!routine) return toast('Sélectionnez une routine.', 'error');

  const labels = { start: 'Démarrer', stop: 'Arrêter', results: 'Résultats' };
  const sub = { start: '01', stop: '02', results: '03' }[action];

  if (routine.requires_owner && !requireOwner(`Routine ${routine.name}`)) return;

  if (routine.danger && action === 'start') {
    if (!confirm(`⚠️ ROUTINE SENSIBLE : ${routine.name}\n\n${routine.warning || ''}\n\nContinuer uniquement si vous êtes habilité.`)) return;
  }

  const option = normalizeHex($adv('#eaRoutineOption')?.value);
  const rid = normalizeHex(routine.routine_id || '000000');
  const payload = `31 ${sub} ${rid}${option ? ' ' + option : ''}`;

  try {
    const bytes = await udsRequest(payload);
    const result = $adv('#eaRoutineResult');
    if (result) result.textContent = `${labels[action]} ${routine.name} : ${bytesToHex(bytes)}`;

    toast(`Routine ${labels[action].toLowerCase()} envoyée.`, 'success');
    await elmAddLog(`routine_${action}`, payload, bytesToHex(bytes), true, { routine: routine.id });
  } catch (err) {
    const result = $adv('#eaRoutineResult');
    if (result) result.textContent = `Erreur routine ${routine.name} : ${err.message}`;
    toast(`Routine : ${err.message}`, 'error');
  }
}

function isWriteService(payloadHex) {
  const service = parseInt(normalizeHex(payloadHex).slice(0, 2), 16);
  return [0x11, 0x14, 0x27, 0x28, 0x2E, 0x31, 0x85].includes(service);
}

async function sendRawElmUds() {
  const payload = normalizeHex($adv('#eaRawPayload')?.value);
  if (!payload) return toast('Payload hex requis.', 'error');

  if (isWriteService(payload) && !requireOwner('Requête UDS écriture')) return;

  if (isWriteService(payload) && !confirm(`Envoyer requête brute d'écriture ?\n\n${payload}`)) return;

  try {
    const bytes = await udsRequest(payload);
    appendElmConsole(`> ${payload}\n< ${bytesToHex(bytes)}`);
    toast('Requête UDS envoyée.', 'success');
  } catch (err) {
    appendElmConsole(`> ${payload}\nERREUR : ${err.message}`);
    toast('UDS brut : ' + err.message, 'error');
  }
}

async function controlElmDtc(enabled) {
  if (!requireOwner('Control DTC')) return;

  const payload = enabled ? '85 02' : '85 01';
  if (!confirm(`Contrôle enregistrement DTC : ${enabled ? 'ACTIVER' : 'DÉSACTIVER'} ?`)) return;

  try {
    const bytes = await udsRequest(payload);
    appendElmConsole(`${payload} -> ${bytesToHex(bytes)}`);
    toast('Control DTC envoyé.', 'success');
    await elmAddLog('control_dtc', payload, bytesToHex(bytes), true);
  } catch (err) {
    toast('Control DTC : ' + err.message, 'error');
  }
}

function bindElmAdvanced() {
  const bind = (sel, fn) => {
    const el = $adv(sel);
    if (el) el.onclick = fn;
  };

  bind('#eaLoadProfilesBtn', loadElmProfiles);
  bind('#eaRefreshBtn', () => {
    renderElmProfiles();
    renderElmRoleBadge();
    toast('Interface actualisée.', 'success');
  });

  const brandSelect = $adv('#eaBrandSelect');
  if (brandSelect) brandSelect.onchange = renderElmEcuDetails;

  const ecuSelect = $adv('#eaEcuSelect');
  if (ecuSelect) {
    ecuSelect.onchange = () => {
      const ecu = getCurrentEcuConfig();
      if (ecu) {
        if ($adv('#eaTxId')) $adv('#eaTxId').value = ecu.tx_id;
        if ($adv('#eaRxId')) $adv('#eaRxId').value = ecu.rx_id;
      }
      renderElmEcuDetails();
    };
  }

  bind('#eaScanEcusBtn', scanElmEcus);
  bind('#eaTesterPresentBtn', eaTesterPresent);
  bind('#eaReadVinBtn', eaReadVin);
  bind('#eaReadDtcBtn', eaReadDtc);
  bind('#eaClearDtcBtn', eaClearDtc);
  bind('#eaReadinessBtn', eaReadiness);

  bind('#eaLiveStartBtn', startElmLive);
  bind('#eaLiveStopBtn', () => {
    stopElmLive();
    toast('Live arrêté.', 'info');
  });

  bind('#eaReadDidBtn', eaReadDid);
  bind('#eaWriteDidBtn', eaWriteDid);

  bind('#eaRequestSeedBtn', eaRequestSeed);
  bind('#eaSendKeyBtn', eaSendKey);

  bind('#eaRoutineStartBtn', () => runElmRoutine('start'));
  bind('#eaRoutineStopBtn', () => runElmRoutine('stop'));
  bind('#eaRoutineResultsBtn', () => runElmRoutine('results'));

  bind('#eaRawSendBtn', sendRawElmUds);
  bind('#eaControlDtcOffBtn', () => controlElmDtc(false));
  bind('#eaControlDtcOnBtn', () => controlElmDtc(true));

  bind('#eaLoadLogsBtn', loadElmServerLogs);
  bind('#eaClearLocalLogsBtn', () => {
    EA.logs = [];
    renderElmLogs();
    toast('Journal local vidé.', 'success');
  });
}

async function elmConnect() {
  const transport = $('#elmTransportSelect')?.value || 'demo';

  try {
    S.elm = S.elm || new ElmManager();
    EA.channel = null;

    await S.elm.connect(transport, {
      address: $('#elmMacInput')?.value.trim(),
      baudRate: $('#elmBaudInput')?.value
    });

    $('#elmStatus').textContent = 'Connecté.';
    toast('ELM connecté.', 'success');
  } catch (err) {
    $('#elmStatus').textContent = 'Échec : ' + err.message;
    toast(err.message, 'error');
  }
}

async function elmDisconnect() {
  stopElmLive();
  if (S.elm) await S.elm.disconnect();
  $('#elmStatus').textContent = 'Déconnecté.';
}

async function elmScanDevices() {
  const transport = $('#elmTransportSelect')?.value;
  const list = $('#elmDeviceList');

  if (!list) return;
  list.innerHTML = '<div class="muted">Scan en cours...</div>';

  try {
    if (transport === 'capbt') {
      const BS = window.Capacitor?.Plugins?.BluetoothSerial;
      if (!BS) throw new Error('Plugin absent');

      await BS.requestPermissions?.();
      const devices = await BS.getPairedDevices?.() || [];

      list.innerHTML = devices.length
        ? devices.map(d => `
          <div class="list-item">
            <div>
              <strong>${esc(d.name || d.address)}</strong>
              <div class="muted small">${esc(d.address)}</div>
            </div>
            <button class="btn btn-primary btn-sm" data-connect-mac="${esc(d.address)}">Connecter</button>
          </div>
        `).join('')
        : '<div class="muted">Aucun appareil appairé. Saisissez l’MAC manuellement.</div>';

      list.querySelectorAll('[data-connect-mac]').forEach(btn => {
        btn.onclick = async () => {
          $('#elmMacInput').value = btn.dataset.connectMac;
          await elmConnect();
        };
      });
    } else if (transport === 'ble') {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth non supporté');

      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb']
      });

      list.innerHTML = `
        <div class="list-item">
          <div>
            <strong>${esc(device.name || 'BLE device')}</strong>
            <div class="muted small">${esc(device.id)}</div>
          </div>
          <button class="btn btn-primary btn-sm" id="bleConnectSelected">Connecter</button>
        </div>
      `;

      $('#bleConnectSelected').onclick = async () => {
        await elmConnect();
      };
    } else {
      list.innerHTML = '<div class="muted">Scan non disponible pour ce transport.</div>';
    }
  } catch (err) {
    list.innerHTML = `<div class="muted">Scan impossible : ${esc(err.message)}</div>`;
  }
}

async function elmRawSend() {
  const cmd = $('#elmRawCmd')?.value.trim();
  if (!cmd) return;

  try {
    const r = await S.elm.send(cmd);
    appendElmConsole(r);
  } catch (err) {
    appendElmConsole('Erreur : ' + err.message);
  }
}

function elmPopulateProfiles() {
  const profiles = S.elmProfiles || EA.profiles || CLIENT_ELM_FALLBACK;
  const options = (profiles.ecu_groups || []).map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');

  if ($('#elmEcuProfileSelect')) $('#elmEcuProfileSelect').innerHTML = options;
  if ($('#elmCalibProfileSelect')) $('#elmCalibProfileSelect').innerHTML = options;

  const first = (profiles.ecu_groups || [])[0];
  if (first?.tx_id && $('#elmCalibAddress')) $('#elmCalibAddress').value = first.tx_id;
}

/* ---------- UI helpers ---------- */
function switchTab(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.panel').forEach(p => p.classList.add('hidden'));
  $(`#panel-${tab}`)?.classList.remove('hidden');
}

function updateNetworkUi(s) {
  const badge = $('#netStatus');
  if (badge) {
    badge.className = `badge ${s.online ? 'online' : 'offline'}`;
    badge.textContent = s.online ? `🟢 ${s.type}` : '🔴 Hors ligne';
  }

  const detail = $('#networkDetail');
  if (detail) detail.textContent = `${s.online ? 'En ligne' : 'Hors ligne'} • ${s.type}`;
}

function populateBrandSelect(select, includeAll = true) {
  if (!select) return;

  const brands = getBrands();
  select.innerHTML = (includeAll ? '<option value="">Toutes marques</option>' : '<option value="">Choisir</option>') +
    brands.map(b => `<option value="${b.id}" data-name="${esc(b.name)}">${esc(b.name)} ${b.country ? `(${b.country})` : ''}</option>`).join('');
}

function populateModelSelect(modelSelect, brandId) {
  if (!modelSelect) return;

  const models = getModels(brandId);
  modelSelect.innerHTML = '<option value="">Tous modèles</option>' +
    models.map(m => `<option value="${m.id}" data-name="${esc(m.name)}">${esc(m.brand_name)} — ${esc(m.name)}</option>`).join('');

  const engineId = modelSelect.id.replace('ModelSelect', 'EngineSelect');
  const engineSelect = document.getElementById(engineId);
  if (engineSelect) engineSelect.innerHTML = '<option value="">Toutes motorisations</option>';
}

function populateEngineSelect(engineSelect, modelId) {
  if (!engineSelect) return;

  const engines = getEngines(modelId);
  engineSelect.innerHTML = '<option value="">Toutes motorisations</option>' +
    engines.map(e => `<option value="${e.id}" data-name="${esc(e.type)}">${esc(e.type)} • ${e.power_hp || '?'} ch • ${esc(e.fuel || '')}</option>`).join('');
}

function renderSymptomAnalysis(analysis) {
  const container = $('#symptomAnalysis');
  if (!container) return;

  if (!analysis || !analysis.matches.length) {
    container.innerHTML = '<span class="muted">Aucune correspondance symptôme détectée.</span>';
    return;
  }

  const maxScore = Math.max(...analysis.matches.map(m => m.score), 1);

  container.innerHTML = `
    <div class="analysis-grid">
      ${analysis.matches.map(m => `
        <div class="analysis-item">
          <div class="analysis-top">
            <strong>${esc(m.label)}</strong>
            <span class="pill">${m.score}</span>
          </div>
          <div class="progress"><div class="progress-bar" style="width:${Math.round((m.score / maxScore) * 100)}%"></div></div>
          <div class="muted small">Mots-clés : ${m.matchedKeywords.map(esc).join(', ')}</div>
          <div class="small"><strong>Systèmes :</strong> ${m.systems.map(esc).join(', ')}</div>
          ${m.dtcHints.length ? `<div class="small"><strong>DTC probables :</strong> ${m.dtcHints.map(c => `<span class="chip">${esc(c)}</span>`).join(' ')}</div>` : ''}
          <ul class="checklist">${m.checks.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
        </div>
      `).join('')}
    </div>
  `;
}

function renderResults(rows) {
  const container = $('#results');
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = '<div class="muted">Aucune panne trouvée pour ces critères.</div>';
    return;
  }

  const groups = groupFaults(rows);

  container.innerHTML = groups.map(g => `
    <article class="fault ${esc(g.severity)}">
      <div class="fault-top">
        <div class="code">${esc(g.code)}</div>
        <div class="row">
          ${g.score ? `<span class="pill">score ${Math.round(g.score)}</span>` : ''}
          <span class="pill">${esc(g.severity.toUpperCase())}</span>
        </div>
      </div>
      <div><strong>Description :</strong> ${esc(g.description || '')}</div>
      <div><strong>Causes :</strong> ${esc(g.causes || '')}</div>
      <div><strong>Solutions :</strong> ${esc(g.solutions || '')}</div>
      <div class="muted small" style="margin-top:8px;">
        Portée : ${g.applicability === 'ALL' ? 'Universel OBD-II' : 'Spécifique'}
        ${g.vehicles.length ? '<br>' + g.vehicles.slice(0, 8).map(esc).join('<br>') : ''}
      </div>
    </article>
  `).join('');
}

function renderAi(result) {
  const panel = $('#aiPanel');
  if (!panel) return;

  if (!result) {
    panel.innerHTML = '';
    return;
  }

  const q = result.nextQuestion;

  panel.innerHTML = `
    <div class="card ai-card">
      <h2>🧠 Assistant IA locale</h2>
      <div class="muted small">${esc(result.summary)}</div>

      <div class="row" style="margin-top:12px;">
        <button class="btn btn-outline" data-ai-action="reset">Réinitialiser réponses</button>
        <button class="btn btn-outline" data-ai-action="clear">Effacer session</button>
      </div>

      ${result.warnings.length ? `
        <div class="ai-warnings">
          <strong>⚠️ Sécurité</strong>
          <ul>${result.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
        </div>
      ` : ''}

      <div class="ai-section">
        <h3>Interview dynamique</h3>
        ${q ? `
          <div class="ai-question">
            <div class="ai-question-title">❓ ${esc(q.text)}</div>
            <div class="ai-options">
              ${q.options.map(o => `
                <button class="btn btn-outline" data-qid="${esc(q.id)}" data-value="${esc(o[0])}">${esc(o[1])}</button>
              `).join('')}
            </div>
          </div>
        ` : '<div class="ai-empty">Interview terminée ou non discriminante.</div>'}
      </div>

      <div class="ai-section">
        <h3>Hypothèses classées</h3>
        <div class="ai-hypotheses">
          ${result.hypotheses.slice(0, 8).map(h => `
            <article class="ai-hypothesis ${esc(h.severity)}">
              <div class="ai-hyp-top">
                <div><span class="ai-rank">#${h.rank}</span><strong>${esc(h.label)}</strong></div>
                <span class="pill">${esc(h.system)}</span>
              </div>

              <div class="ai-confidence"><div class="ai-confidence-bar" style="width:${Math.max(3, h.confidence)}%"></div></div>

              <div class="muted small">Confiance : ${h.confidence}% • Score : ${h.score} • Gravité : ${esc(h.severity)}</div>

              ${h.reasons?.length ? `
                <details>
                  <summary>Pourquoi cette piste ?</summary>
                  <ul class="ai-reasons">${h.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
                </details>
              ` : ''}

              ${h.tests?.length ? `
                <div class="ai-block">
                  <strong>Contrôles suggérés</strong>
                  <ul>${h.tests.slice(0, 4).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
                </div>
              ` : ''}

              ${h.fixes?.length ? `
                <div class="ai-block">
                  <strong>Actions probables</strong>
                  <ul>${h.fixes.slice(0, 3).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
                </div>
              ` : ''}
            </article>
          `).join('') || '<div class="ai-empty">Aucune hypothèse exploitable.</div>'}
        </div>
      </div>

      <div class="ai-section">
        <h3>Checklist intelligente</h3>
        ${result.checklist.length ? `
          <ol class="ai-checklist">
            ${result.checklist.map(i => `
              <li>
                <label>
                  <input type="checkbox" />
                  <span>
                    <strong>${esc(i.text)}</strong>
                    ${i.cause ? `<div class="muted small">Lié à : ${esc(i.cause)}</div>` : ''}
                  </span>
                </label>
              </li>
            `).join('')}
          </ol>
        ` : '<div class="ai-empty">Checklist indisponible.</div>'}
      </div>
    </div>
  `;
}

function bindAiDelegation() {
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('#aiPanel button');
    if (!btn || !S.aiSession) return;

    const action = btn.dataset.aiAction;
    const qid = btn.dataset.qid;
    const value = btn.dataset.value;

    if (action === 'reset') {
      aiReset(S.aiSession);
      renderAi(S.aiSession.result);
      return;
    }

    if (action === 'clear') {
      S.aiSession = null;
      const panel = $('#aiPanel');
      if (panel) panel.innerHTML = '';
      return;
    }

    if (qid && value) {
      aiAnswer(S.aiSession, qid, value);
      renderAi(S.aiSession.result);
    }
  });
}

async function runSearch() {
  if (!S.unlocked) {
    toast('Accès requis.', 'error');
    return;
  }

  const filters = {
    brandId: $('#brandSelect')?.value || null,
    modelId: $('#modelSelect')?.value || null,
    engineId: $('#engineSelect')?.value || null,
    powerMin: $('#powerMin')?.value || null,
    powerMax: $('#powerMax')?.value || null,
    dtc: $('#dtcInput')?.value.trim() || null,
    symptom: $('#symptomInput')?.value.trim() || null
  };

  if (!filters.dtc && !filters.symptom && !filters.brandId && !filters.modelId && !filters.engineId) {
    toast('Entrez un DTC/symptôme ou sélectionnez un véhicule.', 'info');
    return;
  }

  const { rows, analysis, ai, aiSession } = runDiagnostic(filters);

  S.lastResults = rows;
  S.lastAnalysis = analysis;
  S.aiSession = aiSession;

  renderSymptomAnalysis(analysis);
  renderResults(rows);
  renderAi(ai);

  toast(`${rows.length} résultat(s).`, 'success');
}

async function updateAccessUi() {
  S.token = await getToken();
  S.role = await getRole() || 'none';
  S.unlocked = !!S.token && ['owner', 'guest'].includes(S.role);

  $('#lockOverlay')?.classList.toggle('hidden', S.unlocked);
  $('#guestArea')?.classList.toggle('hidden', S.unlocked || S.role === 'pending');
  $('#pendingArea')?.classList.toggle('hidden', S.role !== 'pending');
  $('#ownerArea')?.classList.toggle('hidden', S.role !== 'owner');
  $('#ownerImportBtn')?.classList.toggle('hidden', S.role !== 'owner');
  $('#elmCalibCard')?.classList.toggle('hidden', S.role !== 'owner');

  const status = $('#accessStatus');
  if (status) {
    status.textContent =
      S.role === 'owner' ? '👑 Mode propriétaire actif.' :
      S.role === 'guest' ? '🟢 Accès tiers accordé.' :
      S.role === 'pending' ? '🟡 Demande en attente.' :
      S.role === 'denied' ? '🔴 Demande refusée.' :
      S.role === 'revoked' ? '🔴 Accès révoqué.' :
      '⚪ Aucun accès actif.';
  }

  renderElmRoleBadge();

  if (S.role === 'owner') refreshRequests();
}

async function refreshRequests() {
  const list = $('#requestsList');
  if (!list) return;

  let rows = [];
  try {
    rows = await listRequests();
  } catch {
    rows = await getCachedRequests();
  }

  if (!rows.length) {
    list.innerHTML = '<div class="muted">Aucune demande.</div>';
    return;
  }

  list.innerHTML = rows.map(r => `
    <div class="request">
      <div>
        <strong>${esc(r.requester_name)}</strong>
        <div class="muted small">${new Date(r.created_at).toLocaleString()}</div>
        <div class="pill" style="margin-top:6px;">${esc(r.status)}</div>
      </div>
      <div class="row">
        ${r.status === 'pending' ? `
          <button class="btn btn-success" data-action="granted" data-id="${r.id}">✅</button>
          <button class="btn btn-danger" data-action="denied" data-id="${r.id}">❌</button>
        ` : ''}
        ${r.status === 'granted' ? `
          <button class="btn btn-warning" data-action="revoked" data-id="${r.id}">🚫 Révoquer</button>
        ` : ''}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('button[data-action]').forEach(btn => {
    btn.onclick = async () => {
      try {
        await updateAccess(btn.dataset.id, btn.dataset.action);
        toast('Statut mis à jour.', 'success');
        refreshRequests();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}

async function updateVersionsUi() {
  if ($('#appVersion')) $('#appVersion').textContent = APP_VERSION;

  try {
    const v = await api('/api/version');
    if ($('#dataVersion')) $('#dataVersion').textContent = v.data_version || '—';
  } catch {
    const local = S.local?.version || 0;
    if ($('#dataVersion')) $('#dataVersion').textContent = local ? `${local} (local)` : '—';
  }

  const last = Number(await idbGet('kv', 'last_sync') || 0);
  if ($('#lastSync')) $('#lastSync').textContent = last ? new Date(last).toLocaleString() : 'Jamais';
}

function applyWallpaper(cfg) {
  const layer = $('#wallpaper');
  const img = $('#wallpaperImg');
  const vid = $('#wallpaperVideo');
  const ov = $('#wallpaperOverlay');

  if (!layer || !img || !vid || !ov) return;

  if (!cfg || !cfg.enabled || !cfg.url) {
    layer.style.display = 'none';
    img.style.display = 'none';
    vid.style.display = 'none';
    return;
  }

  layer.style.display = 'block';

  const opacity = Number(cfg.opacity ?? 0.22);
  const blur = Number(cfg.blur ?? 0);
  const overlay = Number(cfg.overlay ?? 0.45);
  const fit = cfg.fit || 'cover';
  const url = cfg.url.startsWith('http') ? cfg.url : apiUrl(cfg.url);

  ov.style.opacity = overlay;

  if (cfg.type === 'video') {
    img.style.display = 'none';
    vid.style.display = 'block';
    vid.style.objectFit = fit;
    vid.style.opacity = opacity;
    vid.style.filter = `blur(${blur}px)`;

    if (vid.src !== url) {
      vid.src = url;
      vid.load();
    }

    vid.play?.().catch(() => {});
  } else {
    vid.style.display = 'none';
    img.style.display = 'block';
    img.style.objectFit = fit;
    img.style.opacity = opacity;
    img.style.filter = `blur(${blur}px)`;
    img.src = url;
  }
}

async function loadWallpaper() {
  try {
    if (S.role === 'owner') {
      const d = await api('/api/settings/background');
      S.wallpaper = d.background;
    } else {
      const d = await api('/api/settings/public');
      S.wallpaper = d.background;
    }

    applyWallpaper(S.wallpaper);
  } catch {
    applyWallpaper(null);
  }
}

async function refreshSecurityUi() {
  const encStatus = await getEncryptionStatus();

  if ($('#encStatus')) {
    $('#encStatus').textContent = encStatus.configured
      ? (encStatus.unlocked ? '🟢 Activé et déverrouillé' : '🔒 Activé, verrouillé')
      : '⚪ Non activé';
  }

  $('#pinSetupArea')?.classList.toggle('hidden', encStatus.configured);
  $('#pinManagedArea')?.classList.toggle('hidden', !encStatus.configured);

  if ($('#apiBaseInput')) $('#apiBaseInput').value = getApiBase();

  const bundle = await idbGet('kv', 'revocation_bundle');
  if (bundle) {
    const p = bundle.payload;
    if ($('#revocationStatus')) $('#revocationStatus').textContent = `🟢 Valide jusqu’au ${new Date(p.expires_at).toLocaleString()}`;
    if ($('#revocationDetails')) {
      $('#revocationDetails').textContent =
        `Révoqués : ${(p.revoked_device_ids || []).length} • Refusés : ${(p.denied_device_ids || []).length} • Data v${p.data_version}`;
    }
  } else {
    if ($('#revocationStatus')) $('#revocationStatus').textContent = '⚪ Aucune liste signée locale';
    if ($('#revocationDetails')) $('#revocationDetails').textContent = 'Connectez-vous au serveur pour récupérer la liste.';
  }
}

async function loadWorkshopProfile() {
  S.workshopProfile = await getProfile();
  if (S.workshopProfile?.name && $('#workshopProfileName')) {
    $('#workshopProfileName').value = S.workshopProfile.name;
  }
}

async function renderVehicles() {
  const vehicles = await listVehicles();
  const list = $('#vehicleList');
  const options = vehicles.map(v => {
    const label = `${v.plate || 'Sans plaque'} — ${v.brand_name || ''} ${v.model_name || ''}`.trim();
    return `<option value="${v.id}">${esc(label)}</option>`;
  }).join('');

  if ($('#interventionVehicleSelect')) $('#interventionVehicleSelect').innerHTML = '<option value="">Choisir un véhicule</option>' + options;
  if ($('#reportVehicleSelect')) $('#reportVehicleSelect').innerHTML = '<option value="">Choisir un véhicule</option>' + options;

  if (!list) return;

  if (!vehicles.length) {
    list.innerHTML = '<div class="muted">Aucun véhicule enregistré.</div>';
    return;
  }

  list.innerHTML = vehicles.map(v => `
    <div class="list-item">
      <div>
        <strong>${esc(v.plate || 'Sans plaque')}</strong>
        <div class="muted small">${esc(v.brand_name)} ${esc(v.model_name)} • ${esc(v.year || '')} • ${esc(v.odometer || 0)} km</div>
        <div class="muted small">Client : ${esc(v.customer || '-')} • VIN : ${esc(v.vin || '-')}</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-outline btn-sm" data-delete-vehicle="${v.id}">🗑️</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-delete-vehicle]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Supprimer ce véhicule (suppression logique) ?')) return;
      await deleteVehicle(btn.dataset.deleteVehicle);
      await renderVehicles();
      await renderInterventions();
      toast('Véhicule supprimé localement. Synchronisez pour propager.', 'success');
    };
  });
}

async function renderInterventions(vehicleId = null) {
  const rows = await listInterventions(vehicleId);
  const list = $('#interventionList');
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = '<div class="muted">Aucune intervention.</div>';
    return;
  }

  const vehicles = await listVehicles();
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

  list.innerHTML = rows.map(i => {
    const v = vehicleMap.get(i.vehicle_id);
    const vehicleLabel = v ? `${v.plate || ''} ${v.brand_name || ''} ${v.model_name || ''}`.trim() : 'Véhicule inconnu';

    return `
      <div class="list-item">
        <div>
          <strong>${esc(i.title)}</strong>
          <div class="muted small">${new Date(i.created_at).toLocaleString()} — ${esc(vehicleLabel)}</div>
          <div class="small">${esc(i.diagnosis || '')}</div>
          <div class="muted small">Pièces : ${esc(i.parts || '-')} • MO : ${esc(i.labor || '-')} • ${Number(i.cost || 0).toFixed(2)} €</div>
        </div>
      </div>
    `;
  }).join('');
}

async function saveWorkshopVehicle() {
  const brandSelect = $('#workshopBrandSelect');
  const modelSelect = $('#workshopModelSelect');

  const brandOption = brandSelect?.selectedOptions[0];
  const modelOption = modelSelect?.selectedOptions[0];

  const vehicle = {
    plate: $('#vehiclePlate')?.value.trim() || '',
    vin: $('#vehicleVin')?.value.trim() || '',
    brand_id: brandSelect?.value || '',
    brand_name: brandOption?.dataset?.name || brandOption?.text || '',
    model_id: modelSelect?.value || '',
    model_name: modelOption?.dataset?.name || modelOption?.text || '',
    year: $('#vehicleYear')?.value.trim() || '',
    odometer: $('#vehicleOdometer')?.value || 0,
    customer: $('#vehicleCustomer')?.value.trim() || '',
    phone: $('#vehiclePhone')?.value.trim() || '',
    notes: $('#vehicleNotes')?.value.trim() || ''
  };

  if (!vehicle.plate && !vehicle.vin) {
    toast('Renseignez plaque ou VIN.', 'error');
    return;
  }

  await saveVehicle(vehicle);
  await renderVehicles();
  toast('Véhicule enregistré.', 'success');
}

async function saveWorkshopIntervention() {
  const vehicleId = $('#interventionVehicleSelect')?.value;
  if (!vehicleId) {
    toast('Choisissez un véhicule.', 'error');
    return;
  }

  await saveIntervention({
    vehicle_id: vehicleId,
    title: $('#interventionTitle')?.value.trim() || 'Intervention',
    diagnosis: $('#interventionDiagnosis')?.value.trim() || '',
    parts: $('#interventionParts')?.value.trim() || '',
    labor: $('#interventionLabor')?.value.trim() || '',
    cost: $('#interventionCost')?.value || 0,
    technician: $('#interventionTechnician')?.value.trim() || S.workshopProfile?.name || ''
  });

  await renderInterventions();
  toast('Intervention enregistrée.', 'success');
}

async function safeWorkshopSync(manual = false) {
  if (!S.unlocked) return;

  try {
    const res = await syncWorkshop();

    if (res.skipped) {
      if (manual && $('#workshopSyncStatus')) $('#workshopSyncStatus').textContent = 'Synchronisation ignorée : accès requis.';
      return;
    }

    if ($('#workshopSyncStatus')) {
      $('#workshopSyncStatus').textContent =
        `Synchronisé : ${res.pushed} envoi(s), ${res.applied} mise(s) à jour, serveur ${new Date(res.server_time).toLocaleString()}.`;
    }

    await renderVehicles();
    await renderInterventions();

    if (manual) toast('Atelier synchronisé.', 'success');
  } catch (err) {
    if ($('#workshopSyncStatus')) $('#workshopSyncStatus').textContent = 'Erreur sync atelier : ' + err.message;
    if (manual) toast(err.message, 'error');
  }
}

async function generateReport() {
  const vid = $('#reportVehicleSelect')?.value;
  if (!vid) {
    toast('Choisissez un véhicule.', 'error');
    return;
  }

  const vehicles = await listVehicles();
  const vehicle = vehicles.find(v => v.id === vid);
  const interventions = await listInterventions(vid);

  openPrintReport(buildReportHtml({
    vehicle,
    interventions,
    diagnostic: S.lastResults,
    profile: S.workshopProfile
  }));

  if ($('#workshopStatus')) $('#workshopStatus').textContent = 'Rapport ouvert. Utilisez Enregistrer au format PDF.';
}

async function exportZip() {
  const vehicles = await listVehicles();
  const interventions = await listInterventions();

  const res = await exportWorkspaceZip({
    vehicles,
    interventions,
    diagnostic: S.lastResults,
    profile: S.workshopProfile
  });

  if ($('#workshopStatus')) $('#workshopStatus').textContent = `Export ZIP : ${res.filename} (${res.size} octets).`;
  toast('Export ZIP terminé.', 'success');
}

async function shareWorkshopSummary() {
  const vid = $('#reportVehicleSelect')?.value || $('#interventionVehicleSelect')?.value;
  const vehicles = await listVehicles();
  const vehicle = vehicles.find(v => v.id === vid) || vehicles[0];
  const interventions = vehicle ? await listInterventions(vehicle.id) : [];

  const res = await shareSummary({
    vehicle,
    interventions,
    diagnostic: S.lastResults
  });

  toast(res.shared ? 'Synthèse partagée.' : 'Synthèse copiée.', 'success');
}

async function renderLocalAudit() {
  const rows = await listLocalAudit(80);
  const list = $('#localAuditList');
  if (!list) return;

  list.innerHTML = rows.length
    ? rows.map(r => `
      <div class="audit-item">
        <strong>${esc(r.action)}</strong>
        <div class="muted small">${new Date(r.ts).toLocaleString()}</div>
        <div class="small small-break">${esc(JSON.stringify(r.details || {}))}</div>
      </div>
    `).join('')
    : '<div class="muted">Aucun audit local.</div>';
}

async function renderServerAudit() {
  const list = $('#serverAuditList');
  if (!list) return;

  try {
    const rows = await fetchServerAudit(80);

    list.innerHTML = rows.length
      ? rows.map(r => `
        <div class="audit-item">
          <strong>${esc(r.action)}</strong>
          <div class="muted small">${new Date(r.ts).toLocaleString()} — ${esc(r.actor || '')}</div>
          <div class="small small-break">${esc(JSON.stringify(r.details || {}))}</div>
        </div>
      `).join('')
      : '<div class="muted">Aucun audit serveur.</div>';
  } catch (err) {
    list.innerHTML = `<div class="muted">Audit serveur indisponible : ${esc(err.message)}</div>`;
  }
}

function showPinOverlay() {
  $('#pinOverlay')?.classList.remove('hidden');
  setTimeout(() => $('#pinInput')?.focus(), 100);
}

function hidePinOverlay() {
  $('#pinOverlay')?.classList.add('hidden');
  if ($('#pinInput')) $('#pinInput').value = '';
  if ($('#pinStatus')) $('#pinStatus').textContent = '';
}

function waitForPin() {
  return new Promise((resolve) => {
    pinResolver = resolve;
    showPinOverlay();
  });
}

/* ---------- Service Worker / Push / Update ---------- */
let swRegistration = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function registerServiceWorker() {
  if (isNative() || !('serviceWorker' in navigator)) return null;

  swRegistration = await navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none'
  });

  swRegistration.addEventListener('updatefound', () => {
    const installing = swRegistration.installing;
    if (!installing) return;

    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        window.dispatchEvent(new CustomEvent('diagauto:update-available'));
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.dispatchEvent(new CustomEvent('diagauto:controller-changed'));
  });

  navigator.serviceWorker.addEventListener('message', (e) => {
    window.dispatchEvent(new CustomEvent('diagauto:sw-message', { detail: e.data || {} }));
  });

  await navigator.serviceWorker.ready;
  return swRegistration;
}

async function checkAppUpdate() {
  if (isNative()) throw new Error('En APK natif, mettre à jour via rebuild/store.');
  if (!swRegistration) await registerServiceWorker();
  if (!swRegistration) throw new Error('Service Worker non supporté');

  await swRegistration.update();

  if (swRegistration.waiting) {
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return { updated: true };
  }

  return { updated: false };
}

async function subscribePush() {
  if (isNative() || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const reg = await navigator.serviceWorker.ready;
  const deviceId = await getDeviceId();
  const role = await getRole();
  const { publicKey } = await api('/api/push/public-key');

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: sub.toJSON(), deviceId, role: role || 'guest' })
  });

  return true;
}

/* ---------- Bind events ---------- */
function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  $$('.tab').forEach(tab => {
    tab.onclick = () => switchTab(tab.dataset.tab);
  });

  if ($('#brandSelect')) $('#brandSelect').onchange = (e) => populateModelSelect($('#modelSelect'), e.target.value);
  if ($('#modelSelect')) $('#modelSelect').onchange = (e) => populateEngineSelect($('#engineSelect'), e.target.value);
  if ($('#workshopBrandSelect')) $('#workshopBrandSelect').onchange = (e) => populateModelSelect($('#workshopModelSelect'), e.target.value);

  if ($('#searchBtn')) $('#searchBtn').onclick = runSearch;

  if ($('#resetBtn')) {
    $('#resetBtn').onclick = () => {
      if ($('#dtcInput')) $('#dtcInput').value = '';
      if ($('#symptomInput')) $('#symptomInput').value = '';
      if ($('#powerMin')) $('#powerMin').value = '';
      if ($('#powerMax')) $('#powerMax').value = '';
      if ($('#brandSelect')) $('#brandSelect').value = '';
      populateModelSelect($('#modelSelect'), '');
      if ($('#results')) $('#results').innerHTML = '<div class="muted">Aucune recherche lancée.</div>';
      if ($('#symptomAnalysis')) $('#symptomAnalysis').innerHTML = '<span class="muted">Aucune analyse.</span>';
      if ($('#aiPanel')) $('#aiPanel').innerHTML = '';
      S.lastResults = [];
      S.lastAnalysis = null;
      S.aiSession = null;
    };
  }

  if ($('#goAccessBtn')) $('#goAccessBtn').onclick = () => switchTab('access');
  if ($('#goOwnerBtn')) $('#goOwnerBtn').onclick = () => switchTab('access');

  if ($('#ownerLoginBtn')) {
    $('#ownerLoginBtn').onclick = async () => {
      const code = $('#ownerCode')?.value.trim();
      if (!code) return toast('Entrez le code.', 'error');

      try {
        await loginOwner(code);
        toast('Mode propriétaire activé.', 'success');
        if ($('#ownerCode')) $('#ownerCode').value = '';
        await updateAccessUi();
        await loadWallpaper();
        switchTab('access');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#logoutBtn')) {
    $('#logoutBtn').onclick = async () => {
      await clearSession();
      await updateAccessUi();
      toast('Mode propriétaire désactivé.', 'info');
    };
  }

  if ($('#requestAccessBtn')) {
    $('#requestAccessBtn').onclick = async () => {
      const name = $('#requesterName')?.value.trim();
      if (!name) return toast('Entrez votre prénom.', 'error');

      try {
        await requestAccess(name);
        await idbSet('kv', 'auth_role', 'pending');
        toast('Demande envoyée.', 'success');
      } catch {
        await idbSet('kv', 'auth_role', 'pending');
        toast('Hors ligne : demande en file.', 'info');
      }

      await updateAccessUi();
    };
  }

  if ($('#refreshAccessBtn')) {
    $('#refreshAccessBtn').onclick = async () => {
      try {
        await refreshAccessStatus();
        await updateAccessUi();
        toast('Statut actualisé.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#refreshRequestsBtn')) $('#refreshRequestsBtn').onclick = () => refreshRequests();

  if ($('#checkAppUpdateBtn')) {
    $('#checkAppUpdateBtn').onclick = async () => {
      try {
        const res = await checkAppUpdate();
        toast(res.updated ? 'Mise à jour déclenchée.' : 'Application à jour.', 'success');
        if (res.updated) setTimeout(() => location.reload(), 1200);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#checkDataUpdateBtn')) {
    $('#checkDataUpdateBtn').onclick = async () => {
      try {
        await syncData(false);
        toast('Données vérifiées/mises à jour.', 'success');
        populateBrandSelect($('#brandSelect'), true);
        populateBrandSelect($('#workshopBrandSelect'), false);
        await updateVersionsUi();
        await safeWorkshopSync(false);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#forceFullUpdateBtn')) {
    $('#forceFullUpdateBtn').onclick = async () => {
      try {
        await syncData(true);
        toast('Mise à jour complète appliquée.', 'success');
        populateBrandSelect($('#brandSelect'), true);
        populateBrandSelect($('#workshopBrandSelect'), false);
        await updateVersionsUi();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#ownerImportBtn')) {
    $('#ownerImportBtn').onclick = async () => {
      try {
        await api('/api/import/trigger', { method: 'POST' });
        toast('Import serveur relancé.', 'success');
        await syncData(true);
        populateBrandSelect($('#brandSelect'), true);
        populateBrandSelect($('#workshopBrandSelect'), false);
        await updateVersionsUi();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#saveProfileBtn')) {
    $('#saveProfileBtn').onclick = async () => {
      const name = $('#workshopProfileName')?.value.trim();
      if (!name) return toast('Entrez un nom.', 'error');

      S.workshopProfile = await saveProfile({ name, role: S.role || 'technicien' });
      toast('Profil enregistré.', 'success');
    };
  }

  if ($('#saveVehicleBtn')) $('#saveVehicleBtn').onclick = saveWorkshopVehicle;
  if ($('#saveInterventionBtn')) $('#saveInterventionBtn').onclick = saveWorkshopIntervention;
  if ($('#syncWorkshopBtn')) $('#syncWorkshopBtn').onclick = () => safeWorkshopSync(true);
  if ($('#generateReportBtn')) $('#generateReportBtn').onclick = generateReport;
  if ($('#exportZipBtn')) $('#exportZipBtn').onclick = exportZip;
  if ($('#shareSummaryBtn')) $('#shareSummaryBtn').onclick = shareWorkshopSummary;

  if ($('#interventionVehicleSelect')) {
    $('#interventionVehicleSelect').onchange = async (e) => {
      await renderInterventions(e.target.value || null);
    };
  }

  if ($('#pinUnlockBtn')) {
    $('#pinUnlockBtn').onclick = async () => {
      try {
        if ($('#pinStatus')) $('#pinStatus').textContent = 'Vérification...';
        await unlockWithPin($('#pinInput')?.value || '');
        hidePinOverlay();

        if (pinResolver) {
          const r = pinResolver;
          pinResolver = null;
          r();
        }

        await refreshSecurityUi();
        toast('Base déverrouillée.', 'success');
      } catch (err) {
        if ($('#pinStatus')) $('#pinStatus').textContent = err.message;
      }
    };
  }

  if ($('#pinInput')) {
    $('#pinInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#pinUnlockBtn')?.click();
    });
  }

  if ($('#setPinBtn')) {
    $('#setPinBtn').onclick = async () => {
      const p1 = $('#pinSet1')?.value;
      const p2 = $('#pinSet2')?.value;
      if (p1 !== p2) return toast('PIN différents.', 'error');

      try {
        await setPin(p1);
        await localAudit('pin_enabled');
        if ($('#pinSet1')) $('#pinSet1').value = '';
        if ($('#pinSet2')) $('#pinSet2').value = '';
        await refreshSecurityUi();
        toast('PIN activé.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#changePinBtn')) {
    $('#changePinBtn').onclick = async () => {
      try {
        await changePin($('#changePinOld')?.value, $('#changePinNew')?.value);
        await localAudit('pin_changed');
        if ($('#changePinOld')) $('#changePinOld').value = '';
        if ($('#changePinNew')) $('#changePinNew').value = '';
        await refreshSecurityUi();
        toast('PIN modifié.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#disablePinBtn')) {
    $('#disablePinBtn').onclick = async () => {
      try {
        await disablePin($('#disablePinCurrent')?.value);
        await localAudit('pin_disabled');
        if ($('#disablePinCurrent')) $('#disablePinCurrent').value = '';
        await refreshSecurityUi();
        toast('PIN désactivé.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#lockAppBtn')) {
    $('#lockAppBtn').onclick = async () => {
      await localAudit('manual_lock');
      lockEncryption();
      location.reload();
    };
  }

  if ($('#exportBackupBtn')) {
    $('#exportBackupBtn').onclick = async () => {
      try {
        const res = await exportEncryptedBackup($('#exportBackupPassword')?.value);
        if ($('#backupStatus')) $('#backupStatus').textContent = `Export : ${res.filename} (${res.size} octets).`;
        toast('Sauvegarde exportée.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#importBackupFile')) {
    $('#importBackupFile').onchange = (e) => {
      S.selectedBackupFile = e.target.files?.[0] || null;
    };
  }

  if ($('#importBackupBtn')) {
    $('#importBackupBtn').onclick = async () => {
      try {
        await importEncryptedBackup(S.selectedBackupFile, $('#importBackupPassword')?.value);
        populateBrandSelect($('#brandSelect'), true);
        populateBrandSelect($('#workshopBrandSelect'), false);
        await refreshSecurityUi();
        if ($('#backupStatus')) $('#backupStatus').textContent = 'Sauvegarde importée.';
        toast('Base restaurée.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#refreshRevocationsBtn')) {
    $('#refreshRevocationsBtn').onclick = async () => {
      try {
        await refreshRevocations();
        const revoked = await checkRevocation();
        await refreshSecurityUi();

        if (revoked) {
          await updateAccessUi();
          toast('Accès révoqué par liste signée.', 'error');
        } else {
          toast('Liste actualisée.', 'success');
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#loadLocalAuditBtn')) $('#loadLocalAuditBtn').onclick = async () => {
    await renderLocalAudit();
    toast('Audit local chargé.', 'success');
  };

  if ($('#loadServerAuditBtn')) $('#loadServerAuditBtn').onclick = renderServerAudit;

  if ($('#saveApiBaseBtn')) {
    $('#saveApiBaseBtn').onclick = async () => {
      setApiBase($('#apiBaseInput')?.value);
      await localAudit('api_base_changed', { url: getApiBase() });
      toast('URL backend enregistrée. Rechargement...', 'success');
      setTimeout(() => location.reload(), 800);
    };
  }

  if ($('#saveWallpaperBtn')) {
    $('#saveWallpaperBtn').onclick = async () => {
      try {
        const file = $('#wallpaperFile')?.files?.[0];
        let dataUrl = null;

        if (file) {
          if (file.size > 100 * 1024 * 1024) throw new Error('Fichier trop lourd (max 100 Mo)');

          dataUrl = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(file);
          });
        }

        const payload = {
          enabled: $('#wallpaperEnabled')?.value === 'true',
          type: $('#wallpaperType')?.value || 'image',
          fit: $('#wallpaperFit')?.value || 'cover',
          opacity: Number($('#wallpaperOpacity')?.value || 0.22),
          blur: Number($('#wallpaperBlur')?.value || 0),
          overlay: Number($('#wallpaperOverlay')?.value || 0.45),
          applyToGuests: $('#wallpaperApplyGuests')?.value === 'true',
          url: $('#wallpaperUrlInput')?.value.trim() || undefined,
          dataUrl: dataUrl || undefined
        };

        const res = await api('/api/settings/background', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        S.wallpaper = res.background;
        applyWallpaper(S.wallpaper);

        if ($('#wallpaperPreview')) {
          $('#wallpaperPreview').textContent =
            `Fond enregistré : ${S.wallpaper.url || 'aucun'} • opacité ${S.wallpaper.opacity} • tiers ${S.wallpaper.applyToGuests ? 'oui' : 'non'}.`;
        }

        toast('Fond d’écran enregistré.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if ($('#elmConnectBtn')) $('#elmConnectBtn').onclick = elmConnect;
  if ($('#elmDisconnectBtn')) $('#elmDisconnectBtn').onclick = elmDisconnect;
  if ($('#elmScanBtn')) $('#elmScanBtn').onclick = elmScanDevices;
  if ($('#elmReadVinBtn')) $('#elmReadVinBtn').onclick = eaReadVin;
  if ($('#elmReadMileageBtn')) $('#elmReadMileageBtn').onclick = eaReadVin;
  if ($('#elmReadDtcBtn')) $('#elmReadDtcBtn').onclick = eaReadDtc;
  if ($('#elmClearDtcBtn')) $('#elmClearDtcBtn').onclick = eaClearDtc;
  if ($('#elmReadinessBtn')) $('#elmReadinessBtn').onclick = eaReadiness;
  if ($('#elmLiveStartBtn')) $('#elmLiveStartBtn').onclick = startElmLive;
  if ($('#elmLiveStopBtn')) $('#elmLiveStopBtn').onclick = () => {
    stopElmLive();
    toast('Live arrêté.', 'info');
  };
  if ($('#elmIdentifyBtn')) $('#elmIdentifyBtn').onclick = scanElmEcus;
  if ($('#elmRunCalibBtn')) $('#elmRunCalibBtn').onclick = () => runElmRoutine('start');
  if ($('#elmRawSendBtn')) $('#elmRawSendBtn').onclick = elmRawSend;

  if (!S.elm) {
    S.elm = new ElmManager();
  }

  S.elm.on((e) => {
    if (e.type === 'log') appendElmConsole(e.msg);
  });
}

/* ---------- Boot ---------- */
async function initSecurityBoot() {
  await localAudit('app_boot', { native: isNative() });

  if (navigator.onLine) {
    try {
      await refreshRevocations();
    } catch (err) {
      console.warn('Revocation refresh failed:', err);
    }
  }

  await checkRevocation();
}

async function boot() {
  await getDeviceId();

  try {
    await ensureLocalData();
  } catch (err) {
    if (err.code === 'PIN_REQUIRED') {
      await waitForPin();
      await ensureLocalData();
    } else {
      throw err;
    }
  }

  network.onChange(updateNetworkUi);
  updateNetworkUi(network.state);

  await registerServiceWorker();
  await updateAccessUi();

  try {
    await flushQueue();
    await refreshAccessStatus();
  } catch {}

  await updateAccessUi();
  await initSecurityBoot();

  connectRealtime();

  onAccessEvent(async (event) => {
    if (event.type === 'GRANTED') {
      toast('Accès accordé.', 'success');
      await updateAccessUi();
      populateBrandSelect($('#brandSelect'), true);
      populateBrandSelect($('#workshopBrandSelect'), false);
      await safeWorkshopSync(false);
      await loadWallpaper();
    }

    if (event.type === 'REVOKED' || event.type === 'DENIED') {
      toast('Accès refusé/révoqué.', 'error');
      await updateAccessUi();
    }

    if (event.type === 'OWNER_REFRESH' && S.role === 'owner') {
      refreshRequests();
    }
  });

  window.addEventListener('diagauto:update-available', () => {
    toast('Nouvelle version disponible. Onglet MAJ.', 'info');
  });

  let reloaded = false;
  window.addEventListener('diagauto:controller-changed', () => {
    if (!reloaded) {
      reloaded = true;
      location.reload();
    }
  });

  populateBrandSelect($('#brandSelect'), true);
  populateBrandSelect($('#workshopBrandSelect'), false);
  populateModelSelect($('#modelSelect'), '');
  populateModelSelect($('#workshopModelSelect'), '');

  injectElmAdvanced();
  bindEvents();
  bindAiDelegation();

  await loadElmProfiles();
  elmPopulateProfiles();

  await updateVersionsUi();
  await refreshSecurityUi();
  await loadWorkshopProfile();
  await renderVehicles();
  await renderInterventions();
  await renderLocalAudit();
  await loadWallpaper();

  setInterval(() => safeWorkshopSync(false), 15 * 60 * 1000);
  setInterval(async () => {
    try {
      await syncData(false);
    } catch {}
  }, 6 * 60 * 60 * 1000);

  try {
    await subscribePush();
  } catch (err) {
    console.warn('Push non souscrit:', err);
  }

  if (isNative() && !getApiBase()) {
    toast('APK natif : renseignez URL backend dans Admin.', 'error');
    switchTab('admin');
  }

  const params = new URLSearchParams(location.search);
  if (params.get('tab')) switchTab(params.get('tab'));
}

boot().catch(err => {
  console.error(err);
  toast('Erreur démarrage : ' + err.message, 'error');
});
