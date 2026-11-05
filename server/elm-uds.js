import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROFILES_FILE = path.join(__dirname, 'elm-profiles.json');
const LOGS_FILE = path.join(__dirname, 'elm-logs.json');

fs.mkdirSync(__dirname, { recursive: true });

let profilesCache = null;
let logsCache = null;

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[ELM-UDS] JSON illisible ${file}:`, err.message);
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function validateElmProfiles(profiles) {
  if (!profiles || typeof profiles !== 'object') {
    throw new Error('Profils ELM invalides');
  }

  if (!profiles.version) {
    throw new Error('Profils ELM sans version');
  }

  if (!profiles.transport_defaults || typeof profiles.transport_defaults !== 'object') {
    throw new Error('Profils ELM sans transport_defaults');
  }

  if (!Array.isArray(profiles.ecu_groups)) {
    throw new Error('Profils ELM sans ecu_groups[]');
  }

  for (const group of profiles.ecu_groups) {
    if (!group.id || !group.name) {
      throw new Error('Groupe ECU invalide : id/name requis');
    }

    if (!group.tx_id || !group.rx_id) {
      throw new Error(`Groupe ECU ${group.id} sans tx_id/rx_id`);
    }

    if (group.variables && !Array.isArray(group.variables)) {
      throw new Error(`Groupe ECU ${group.id} variables doit être un tableau`);
    }

    if (group.routines && !Array.isArray(group.routines)) {
      throw new Error(`Groupe ECU ${group.id} routines doit être un tableau`);
    }
  }

  return true;
}

export function loadElmProfiles() {
  if (profilesCache) return profilesCache;

  const fallback = {
    version: '0.0.0',
    updated_at: 0,
    safety: {},
    transport_defaults: {
      protocol: 6,
      tx_id: '7E0',
      rx_id: '7E8',
      functional_id: '7DF',
      padding: 'CC',
      block_size: 0,
      st_min: 0,
      timeout_ms: 5000
    },
    nrc: {},
    services: {},
    standard_dids: {},
    brands: {},
    brand_aliases: {},
    ecu_groups: []
  };

  const loaded = readJson(PROFILES_FILE, fallback);

  try {
    validateElmProfiles(loaded);
    profilesCache = loaded;
    return profilesCache;
  } catch (err) {
    console.error('[ELM-UDS] Profils invalides, utilisation fallback:', err.message);
    profilesCache = fallback;
    return profilesCache;
  }
}

export function saveElmProfiles(nextProfiles) {
  validateElmProfiles(nextProfiles);

  const toSave = {
    ...nextProfiles,
    updated_at: Date.now()
  };

  writeJson(PROFILES_FILE, toSave);
  profilesCache = toSave;
  return toSave;
}

export function getElmProfileSummary() {
  const profiles = loadElmProfiles();

  return {
    version: profiles.version,
    updated_at: profiles.updated_at || 0,
    brands: Object.keys(profiles.brands || {}).length,
    ecu_groups: (profiles.ecu_groups || []).length,
    standard_dids: Object.keys(profiles.standard_dids || {}).length,
    services: Object.keys(profiles.services || {}).length
  };
}

function loadElmLogs() {
  if (logsCache) return logsCache;
  logsCache = readJson(LOGS_FILE, []);
  if (!Array.isArray(logsCache)) logsCache = [];
  return logsCache;
}

export function appendElmLog(entry) {
  const logs = loadElmLogs();

  const record = {
    id: entry.id || crypto.randomUUID(),
    ts: entry.ts || Date.now(),
    deviceId: entry.deviceId || null,
    actor: entry.actor || 'anonymous',
    action: String(entry.action || 'elm_event').slice(0, 120),
    command: String(entry.command || '').slice(0, 1000),
    response: String(entry.response || '').slice(0, 4000),
    ok: entry.ok !== false,
    meta: entry.meta || null
  };

  logs.unshift(record);

  const trimmed = logs.slice(0, 2000);
  writeJson(LOGS_FILE, trimmed);
  logsCache = trimmed;

  return record;
}

export function getElmLogs(limit = 200) {
  const logs = loadElmLogs();
  const max = Math.min(Math.max(Number(limit) || 200, 1), 2000);
  return logs.slice(0, max);
}

export function sanitizeElmProfilesForClient(profiles) {
  const copy = JSON.parse(JSON.stringify(profiles || loadElmProfiles()));

  if (copy.safety) {
    copy.safety.owner_only_writes = true;
    copy.safety.require_confirmation_for_dangerous_routines = true;
  }

  return copy;
}
