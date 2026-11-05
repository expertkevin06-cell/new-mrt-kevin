import {
  ElmUdsChannel,
  hexToBytes,
  bytesToHex,
  normalizeHex,
  parseElmHex,
  describeNrc
} from './uds-iso15765.js';

const HOST_EVENT = 'diagauto:elm-host-ready';

const ADV = {
  host: null,
  profiles: null,
  channel: null,
  liveTimer: null,
  liveRunning: false,
  logs: []
};

function waitForHost() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.DiagAutoElmHost) {
        ADV.host = window.DiagAutoElmHost;
        resolve(ADV.host);
        return true;
      }
      return false;
    };

    if (check()) return;

    window.addEventListener(HOST_EVENT, () => {
      if (check()) return;
    }, { once: true });

    const interval = setInterval(() => {
      if (check()) clearInterval(interval);
    }, 120);

    setTimeout(() => clearInterval(interval), 15000);
  });
}

function injectCss() {
  if (document.getElementById('elm-advanced-css')) return;

  const style = document.createElement('style');
  style.id = 'elm-advanced-css';
  style.textContent = `
    .ea-card{border:1px solid rgba(6,182,212,.25);background:linear-gradient(180deg,rgba(8,47,73,.35),rgba(2,6,23,.92))}
    .ea-title{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
    .ea-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
    .ea-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .ea-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:.9rem}
    .ea-table th,.ea-table td{border:1px solid rgba(255,255,255,.08);padding:8px;text-align:left;vertical-align:top}
    .ea-table th{background:rgba(255,255,255,.05);color:#93c5fd}
    .ea-console{background:#020617;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;min-height:160px;max-height:320px;overflow:auto;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:.84rem}
    .ea-badge{display:inline-block;padding:4px 9px;border-radius:999px;font-size:.75rem;font-weight:800;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#cbd5e1}
    .ea-badge.ok{color:#22c55e;border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.1)}
    .ea-badge.ko{color:#ef4444;border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.1)}
    .ea-badge.warn{color:#f59e0b;border-color:rgba(245,158,11,.3);background:rgba(245,158,11,.1)}
    .ea-small{font-size:.86rem;color:#94a3b8}
    .ea-danger{border-color:rgba(239,68,68,.35)!important;background:rgba(239,68,68,.08)!important}
    .ea-section{margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)}
    .ea-section h3{margin:0 0 10px;font-size:1rem;color:#06b6d4}
  `;

  document.head.appendChild(style);
}

function toast(message, type = 'info') {
  if (ADV.host?.toast) ADV.host.toast(message, type);
  else console.log(`[ELM-ADVANCED] ${message}`);
}

function esc(value) {
  if (ADV.host?.esc) return ADV.host.esc(value);
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createPanel() {
  const parent = document.getElementById('panel-elm');
  if (!parent) return null;

  if (document.getElementById('elmAdvancedCard')) {
    return document.getElementById('elmAdvancedCard');
  }

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
        <div class="field">
          <label for="eaBrandSelect">Marque / profil</label>
          <select id="eaBrandSelect"><option value="">Charger profils…</option></select>
        </div>
        <div class="field">
          <label for="eaEcuSelect">Calculateur / groupe ECU</label>
          <select id="eaEcuSelect"><option value="">Aucun</option></select>
        </div>
        <div class="field">
          <label for="eaTxId">Tx ID hex</label>
          <input id="eaTxId" placeholder="7E0" />
        </div>
        <div class="field">
          <label for="eaRxId">Rx ID hex</label>
          <input id="eaRxId" placeholder="7E8" />
        </div>
        <div class="field">
          <label for="eaPadding">Padding hex</label>
          <input id="eaPadding" placeholder="CC" />
        </div>
        <div class="field">
          <label for="eaTimeout">Timeout ms</label>
          <input id="eaTimeout" type="number" min="500" step="100" value="5000" />
        </div>
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
        <thead>
          <tr><th>Variable</th><th>Source</th><th>Valeur</th><th>Unité</th></tr>
        </thead>
        <tbody id="eaVariablesBody">
          <tr><td colspan="4">Aucune variable.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="ea-section">
      <h3>🧪 DID lecture / écriture</h3>
      <div class="ea-grid">
        <div class="field">
          <label for="eaDidInput">DID hex</label>
          <input id="eaDidInput" placeholder="F190" />
        </div>
        <div class="field">
          <label for="eaDidDataInput">Données hex écriture</label>
          <input id="eaDidDataInput" placeholder="Ex : 00 01 02" />
        </div>
      </div>
      <div class="ea-row">
        <button id="eaReadDidBtn" class="btn btn-primary">Lire DID 22</button>
        <button id="eaWriteDidBtn" class="btn btn-danger ea-danger">Écrire DID 2E</button>
      </div>
      <div id="eaDidResult" class="ea-small" style="margin-top:10px;"></div>
    </div>

    <div class="ea-section">
      <h3>🔐 Security access UDS</h3>
      <div class="ea-small">
        Demande de seed et envoi de clé. Cet outil ne calcule pas de clé OEM propriétaire.
        Utilisation uniquement avec autorisation légitime.
      </div>
      <div class="ea-grid" style="margin-top:10px;">
        <div class="field">
          <label for="eaSecurityLevel">Niveau impair hex</label>
          <input id="eaSecurityLevel" placeholder="01" value="01" />
        </div>
        <div class="field">
          <label for="eaSecurityKey">Clé hex</label>
          <input id="eaSecurityKey" placeholder="Clé légitime fournie" />
        </div>
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
        <div class="field">
          <label for="eaRoutineSelect">Routine</label>
          <select id="eaRoutineSelect"><option value="">Aucune</option></select>
        </div>
        <div class="field">
          <label for="eaRoutineOption">Option record hex</label>
          <input id="eaRoutineOption" placeholder="Optionnel" />
        </div>
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
      <div class="field">
        <label for="eaRawPayload">Payload hex UDS</label>
        <input id="eaRawPayload" placeholder="Ex : 22 F1 90 ou 31 01 XX XX XX" />
      </div>
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

  parent.appendChild(card);
  return card;
}

function $adv(selector) {
  return document.querySelector(selector);
}

function getSelectedBrandId() {
  return $adv('#eaBrandSelect')?.value || '';
}

function getSelectedEcuGroup() {
  const id = $adv('#eaEcuSelect')?.value;
  if (!ADV.profiles || !id) return null;
  return (ADV.profiles.ecu_groups || []).find(g => g.id === id) || null;
}

function getCurrentEcuConfig() {
  const profiles = ADV.profiles;
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

function ensureElmConnected() {
  if (!ADV.host?.S?.elm?.connected) {
    toast('Connectez d’abord l’adaptateur ELM dans la carte Connexion ELM.', 'error');
    return false;
  }
  return true;
}

function getChannel() {
  if (!ADV.channel) {
    ADV.channel = new ElmUdsChannel({
      sendAt: (cmd) => ADV.host.S.elm.send(cmd),
      timeout: 5000
    });
  }
  return ADV.channel;
}

function appendConsole(text) {
  const el = $adv('#eaConsole');
  if (!el) return;
  el.textContent += (el.textContent ? '\n' : '') + text;
  el.scrollTop = el.scrollHeight;
}

async function logElm(action, command, response, ok = true, meta = null) {
  const record = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    action,
    command: String(command || '').slice(0, 1000),
    response: String(response || '').slice(0, 4000),
    ok: !!ok,
    meta
  };

  ADV.logs.unshift(record);
  ADV.logs = ADV.logs.slice(0, 300);
  renderLogs();

  try {
    if (ADV.host?.api) {
      await ADV.host.api('/api/elm/log', {
        method: 'POST',
        body: JSON.stringify({
          action,
          command: record.command,
          response: record.response,
          ok: record.ok
        })
      });
    }
  } catch {
    // journal serveur optionnel
  }
}

function renderLogs() {
  const host = $adv('#eaLogs');
  if (!host) return;

  if (!ADV.logs.length) {
    host.innerHTML = '<div class="ea-small">Aucun journal local.</div>';
    return;
  }

  host.innerHTML = ADV.logs.slice(0, 80).map(log => `
    <div class="audit-item">
      <strong>${esc(log.action)}</strong>
      <span class="ea-badge ${log.ok ? 'ok' : 'ko'}" style="margin-left:8px;">${log.ok ? 'OK' : 'KO'}</span>
      <div class="muted small">${new Date(log.ts).toLocaleString()}</div>
      <div class="small small-break">${esc(log.command)}</div>
      ${log.response ? `<div class="muted small small-break">→ ${esc(log.response)}</div>` : ''}
    </div>
  `).join('');
}

function renderRoleBadge() {
  const badge = $adv('#eaRoleBadge');
  if (!badge) return;

  const role = ADV.host?.S?.role || 'none';
  badge.textContent = role === 'owner' ? '👑 Propriétaire / écritures autorisées' :
    role === 'guest' ? '🟢 Invité / lecture seule' :
    '⚪ Non connecté';
  badge.className = `ea-badge ${role === 'owner' ? 'ok' : role === 'guest' ? '' : 'warn'}`;
}

function isOwner() {
  return (ADV.host?.S?.role || '') === 'owner';
}

function requireOwner(actionLabel = 'Cette opération') {
  if (!isOwner()) {
    toast(`${actionLabel} réservé au mode propriétaire/admin.`, 'error');
    return false;
  }
  return true;
}

function renderProfiles() {
  const brandSelect = $adv('#eaBrandSelect');
  const ecuSelect = $adv('#eaEcuSelect');
  const status = $adv('#eaConfigStatus');

  if (!ADV.profiles) {
    brandSelect.innerHTML = '<option value="">Profils non chargés</option>';
    ecuSelect.innerHTML = '<option value="">Aucun</option>';
    status.textContent = 'Profils non chargés.';
    return;
  }

  const brands = Object.entries(ADV.profiles.brands || {});
  brandSelect.innerHTML = '<option value="">Marque générique</option>' +
    brands.map(([id, b]) => `<option value="${esc(id)}">${esc(b.name || id)}</option>`).join('');

  const groups = ADV.profiles.ecu_groups || [];
  ecuSelect.innerHTML = groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');

  const firstGroup = groups[0];
  if (firstGroup) {
    $adv('#eaTxId').value = firstGroup.tx_id || ADV.profiles.transport_defaults?.tx_id || '7E0';
    $adv('#eaRxId').value = firstGroup.rx_id || ADV.profiles.transport_defaults?.rx_id || '7E8';
    $adv('#eaPadding').value = ADV.profiles.transport_defaults?.padding || 'CC';
    $adv('#eaTimeout').value = ADV.profiles.transport_defaults?.timeout_ms || 5000;
  }

  renderEcuDetails();
  status.textContent = `Profils chargés : version ${ADV.profiles.version}, ${groups.length} groupes ECU, ${brands.length} marques.`;
}

function renderEcuDetails() {
  const ecu = getCurrentEcuConfig();
  const variablesBody = $adv('#eaVariablesBody');
  const routineSelect = $adv('#eaRoutineSelect');

  if (!ecu) {
    variablesBody.innerHTML = '<tr><td colspan="4">Aucun groupe ECU sélectionné.</td></tr>';
    routineSelect.innerHTML = '<option value="">Aucune</option>';
    return;
  }

  if (!ecu.variables.length) {
    variablesBody.innerHTML = '<tr><td colspan="4">Aucune variable définie pour ce groupe.</td></tr>';
  } else {
    variablesBody.innerHTML = ecu.variables.map((v, index) => `
      <tr data-ea-variable-index="${index}">
        <td>${esc(v.name)}</td>
        <td>${esc(v.source === 'pid' ? `PID ${v.pid}` : `DID ${v.did}`)}</td>
        <td data-ea-variable-value>—</td>
        <td>${esc(v.unit || '')}</td>
      </tr>
    `).join('');
  }

  if (!ecu.routines.length) {
    routineSelect.innerHTML = '<option value="">Aucune routine définie</option>';
  } else {
    routineSelect.innerHTML = ecu.routines.map(r => `
      <option value="${esc(r.id)}">${esc(r.name)} ${r.danger ? '⚠️' : ''}</option>
    `).join('');
  }
}

async function loadProfiles() {
  try {
    if (!ADV.host?.api) throw new Error('Host API indisponible');
    ADV.profiles = await ADV.host.api('/api/elm/profiles');
    renderProfiles();
    renderRoleBadge();
    toast('Profils ELM/UDS chargés.', 'success');
    await logElm('profiles_loaded', 'GET /api/elm/profiles', `${ADV.profiles?.ecu_groups?.length || 0} groupes`, true);
  } catch (err) {
    toast('Erreur chargement profils : ' + err.message, 'error');
    $adv('#eaConfigStatus').textContent = 'Erreur : ' + err.message;
  }
}

async function loadServerLogs() {
  try {
    if (!requireOwner('Journal serveur')) return;
    const rows = await ADV.host.api('/api/elm/logs?limit=120');
    ADV.logs = rows.map(r => ({
      id: r.id,
      ts: r.ts,
      action: r.action,
      command: r.command,
      response: r.response,
      ok: r.ok
    }));
    renderLogs();
    toast('Journal serveur chargé.', 'success');
  } catch (err) {
    toast('Journal serveur : ' + err.message, 'error');
  }
}

async function udsRequest(payloadHex, ecuOverride = null) {
  if (!ensureElmConnected()) throw new Error('ELM non connecté');

  const ecu = ecuOverride || getCurrentEcuConfig();
  if (!ecu?.tx_id) throw new Error('Tx ID non défini');

  const channel = getChannel();
  const bytes = await channel.request(ecu.tx_id, payloadHex, {
    protocol: ecu.protocol,
    padding: ecu.padding,
    blockSize: ecu.block_size,
    stMin: ecu.st_min,
    timeout: ecu.timeout_ms
  });

  await logElm('uds_request', `${ecu.tx_id} -> ${normalizeHex(payloadHex)}`, bytesToHex(bytes), true);
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

async function readVariable(variable, ecu) {
  if (variable.source === 'pid') {
    const resp = await ADV.host.elmSend(variable.pid);
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

async function scanEcus() {
  if (!ADV.profiles) {
    toast('Chargez d’abord les profils.', 'error');
    return;
  }

  if (!ensureElmConnected()) return;

  const results = [];
  const groups = ADV.profiles.ecu_groups || [];

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
      const vin = new TextDecoder().decode(data).replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17);
      results.push({ group, ok: true, vin: vin || bytesToHex(data) });
    } catch (err) {
      results.push({ group, ok: false, error: err.message });
    }
  }

  const host = $adv('#eaVehicleInfo');
  host.innerHTML = results.map(r => `
    <div class="card" style="margin:0;padding:12px;">
      <strong>${esc(r.group.name)}</strong>
      <div class="ea-badge ${r.ok ? 'ok' : 'ko'}" style="margin-top:6px;">${r.ok ? 'Répond' : 'Silencieux / NRC'}</div>
      <div class="muted small">${esc(r.group.tx_id)} → ${esc(r.group.rx_id)}</div>
      <div class="small">${esc(r.ok ? `VIN/ID : ${r.vin}` : r.error)}</div>
    </div>
  `).join('');

  toast(`Scan terminé : ${results.filter(r => r.ok).length}/${results.length} ECUs actifs.`, 'success');
  await logElm('scan_ecus', '22 F190 sur groupes', JSON.stringify(results.map(r => ({ id: r.group.id, ok: r.ok }))), true);
}

async function readVin() {
  try {
    const ecu = getCurrentEcuConfig();
    const bytes = await udsRequest('22 F190', ecu);
    const data = parseDidPositive(bytes, 'F190');
    const vin = new TextDecoder().decode(data).replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17);
    $adv('#eaVehicleInfo').innerHTML = `
      <div class="card" style="margin:0;padding:12px;">
        <strong>VIN</strong>
        <div style="font-size:1.2rem;font-weight:900;color:#06b6d4;">${esc(vin || bytesToHex(data))}</div>
      </div>
    `;
    toast('VIN lu.', 'success');
  } catch (err) {
    toast('VIN : ' + err.message, 'error');
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

async function readDtc() {
  try {
    const resp = await ADV.host.elmSend('03');
    const dtcs = parseDtcText(resp);
    $adv('#eaDtcResults').innerHTML = dtcs.length
      ? dtcs.map(d => `<div class="fault medium"><div class="code">${esc(d)}</div></div>`).join('')
      : '<div class="ea-small">Aucun DTC.</div>';
    toast(`${dtcs.length} DTC.`, 'success');
    await logElm('read_dtc', '03', resp, true);
  } catch (err) {
    toast('DTC : ' + err.message, 'error');
  }
}

async function clearDtc() {
  if (!requireOwner('Effacement DTC')) return;
  if (!confirm('Effacer les DTC ? Cela peut masquer un défaut sans réparer la cause.')) return;

  try {
    const resp = await ADV.host.elmSend('04');
    $adv('#eaDtcResults').innerHTML = '<div class="ea-small">DTC effacés si supportés.</div>';
    toast('DTC effacés.', 'success');
    await logElm('clear_dtc', '04', resp, true);
  } catch (err) {
    toast('Effacement DTC : ' + err.message, 'error');
  }
}

async function readiness() {
  try {
    const resp = await ADV.host.elmSend('07');
    appendConsole('Readiness : ' + resp);
    toast('Readiness lu.', 'success');
    await logElm('readiness', '07', resp, true);
  } catch (err) {
    toast('Readiness : ' + err.message, 'error');
  }
}

async function testerPresent() {
  try {
    const bytes = await udsRequest('3E 00');
    appendConsole('Tester present : ' + bytesToHex(bytes));
    toast('Tester présent OK.', 'success');
  } catch (err) {
    toast('Tester présent : ' + err.message, 'error');
  }
}

async function startLive() {
  stopLive();

  const ecu = getCurrentEcuConfig();
  if (!ecu?.variables?.length) {
    toast('Aucune variable pour ce groupe ECU.', 'error');
    return;
  }

  if (!ensureElmConnected()) return;

  const interval = Math.max(500, Number($adv('#eaLiveInterval').value || 2000));

  ADV.liveTimer = setInterval(async () => {
    if (ADV.liveRunning) return;
    ADV.liveRunning = true;

    try {
      for (const variable of ecu.variables) {
        const row = document.querySelector(`[data-ea-variable-index="${ecu.variables.indexOf(variable)}"] [data-ea-variable-value]`);
        if (!row) continue;

        try {
          const value = await readVariable(variable, ecu);
          row.textContent = `${value} ${variable.unit || ''}`;
        } catch (err) {
          row.textContent = 'Erreur';
          row.title = err.message;
        }

        await new Promise(r => setTimeout(r, 80));
      }
    } finally {
      ADV.liveRunning = false;
    }
  }, interval);

  toast('Live variables démarrées.', 'success');
}

function stopLive() {
  if (ADV.liveTimer) clearInterval(ADV.liveTimer);
  ADV.liveTimer = null;
  ADV.liveRunning = false;
}

async function readDid() {
  try {
    const did = normalizeHex($adv('#eaDidInput').value);
    if (!did) throw new Error('DID requis');

    const bytes = await udsRequest(`22 ${did}`);
    const data = parseDidPositive(bytes, did);
    $adv('#eaDidResult').textContent = `DID ${did} : ${bytesToHex(data)} | ASCII : ${new TextDecoder().decode(data).replace(/[^\x20-\x7E]/g, '.')}`;
    toast('DID lu.', 'success');
  } catch (err) {
    $adv('#eaDidResult').textContent = 'Erreur : ' + err.message;
    toast('DID : ' + err.message, 'error');
  }
}

async function writeDid() {
  if (!requireOwner('Écriture DID')) return;

  const did = normalizeHex($adv('#eaDidInput').value);
  const data = normalizeHex($adv('#eaDidDataInput').value);

  if (!did) return toast('DID requis.', 'error');
  if (!data) return toast('Données hex requises.', 'error');
  if (!confirm(`Écrire DID ${did} avec données ${data} ?\n\nCette opération peut modifier un calculateur. Continuer uniquement si la procédure constructeur est maîtrisée.`)) return;

  try {
    const bytes = await udsRequest(`2E ${did} ${data}`);
    $adv('#eaDidResult').textContent = `Écriture DID ${did} : ${bytesToHex(bytes)}`;
    toast('DID écrit (si accepté).', 'success');
    await logElm('write_did', `2E ${did} ${data}`, bytesToHex(bytes), true);
  } catch (err) {
    $adv('#eaDidResult').textContent = 'Erreur écriture : ' + err.message;
    toast('Écriture DID : ' + err.message, 'error');
  }
}

async function requestSeed() {
  if (!requireOwner('Security access')) return;

  const level = normalizeHex($adv('#eaSecurityLevel').value) || '01';

  try {
    const bytes = await udsRequest(`27 ${level}`);
    if (bytes[0] !== 0x67) throw new Error('Réponse seed inattendue : ' + bytesToHex(bytes));
    const seed = bytesToHex(bytes.slice(2));
    $adv('#eaSecurityResult').textContent = `Seed : ${seed}`;
    toast('Seed reçu. Saisissez la clé légitime.', 'success');
    await logElm('security_seed', `27 ${level}`, seed, true);
  } catch (err) {
    $adv('#eaSecurityResult').textContent = 'Erreur seed : ' + err.message;
    toast('Seed : ' + err.message, 'error');
  }
}

async function sendKey() {
  if (!requireOwner('Security access')) return;

  const level = normalizeHex($adv('#eaSecurityLevel').value) || '01';
  const key = normalizeHex($adv('#eaSecurityKey').value);

  if (!key) return toast('Clé hex requise.', 'error');

  const evenLevel = (parseInt(level, 16) + 1).toString(16).padStart(2, '0').toUpperCase();

  if (!confirm(`Envoyer clé de sécurité ${key} au niveau ${evenLevel} ?\n\nAucun calcul automatique de clé OEM n'est fourni.`)) return;

  try {
    const bytes = await udsRequest(`27 ${evenLevel} ${key}`);
    $adv('#eaSecurityResult').textContent = `Réponse security access : ${bytesToHex(bytes)}`;
    toast('Clé envoyée.', 'success');
    await logElm('security_key', `27 ${evenLevel} ${key}`, bytesToHex(bytes), true);
  } catch (err) {
    $adv('#eaSecurityResult').textContent = 'Erreur clé : ' + err.message;
    toast('Clé : ' + err.message, 'error');
  }
}

function getSelectedRoutine() {
  const ecu = getCurrentEcuConfig();
  const id = $adv('#eaRoutineSelect').value;
  return ecu?.routines?.find(r => r.id === id) || null;
}

async function runRoutine(action) {
  const routine = getSelectedRoutine();
  if (!routine) return toast('Sélectionnez une routine.', 'error');

  const labels = { start: 'Démarrer', stop: 'Arrêter', results: 'Résultats' };
  const sub = { start: '01', stop: '02', results: '03' }[action];

  if (routine.requires_owner && !requireOwner(`Routine ${routine.name}`)) return;

  if (routine.danger && action === 'start') {
    if (!confirm(`⚠️ ROUTINE SENSIBLE : ${routine.name}\n\n${routine.warning || ''}\n\nContinuer uniquement si vous êtes habilité et si la procédure constructeur est maîtrisée.`)) return;
  }

  const option = normalizeHex($adv('#eaRoutineOption').value);
  const payload = `31 ${sub} ${normalizeHex(routine.routine_id)}${option ? ' ' + option : ''}`;

  try {
    const bytes = await udsRequest(payload);
    $adv('#eaRoutineResult').textContent = `${labels[action]} ${routine.name} : ${bytesToHex(bytes)}`;
    toast(`Routine ${labels[action].toLowerCase()} envoyée.`, 'success');
    await logElm(`routine_${action}`, payload, bytesToHex(bytes), true, { routine: routine.id });
  } catch (err) {
    $adv('#eaRoutineResult').textContent = `Erreur routine ${routine.name} : ${err.message}`;
    toast(`Routine : ${err.message}`, 'error');
  }
}

function isWriteService(payloadHex) {
  const service = parseInt(normalizeHex(payloadHex).slice(0, 2), 16);
  return [0x14, 0x27, 0x28, 0x2E, 0x31, 0x34, 0x85, 0x11, 0x19].includes(service) && service !== 0x19;
}

async function sendRawUds() {
  const payload = normalizeHex($adv('#eaRawPayload').value);
  if (!payload) return toast('Payload hex requis.', 'error');

  if (isWriteService(payload) && !requireOwner('Requête UDS écriture')) return;

  if (isWriteService(payload) && !confirm(`Envoyer requête brute d'écriture ?\n\n${payload}\n\nRéservé utilisateur compétent.`)) return;

  try {
    const bytes = await udsRequest(payload);
    appendConsole(`> ${payload}\n< ${bytesToHex(bytes)}`);
    toast('Requête UDS envoyée.', 'success');
  } catch (err) {
    appendConsole(`> ${payload}\nERREUR : ${err.message}`);
    toast('UDS brut : ' + err.message, 'error');
  }
}

async function controlDtc(enabled) {
  if (!requireOwner('Control DTC')) return;

  const payload = enabled ? '85 02' : '85 01';
  if (!confirm(`Contrôle enregistrement DTC : ${enabled ? 'ACTIVER' : 'DÉSACTIVER'} ?`)) return;

  try {
    const bytes = await udsRequest(payload);
    appendConsole(`${payload} -> ${bytesToHex(bytes)}`);
    toast('Control DTC envoyé.', 'success');
    await logElm('control_dtc', payload, bytesToHex(bytes), true);
  } catch (err) {
    toast('Control DTC : ' + err.message, 'error');
  }
}

function bindAdvanced() {
  $adv('#eaLoadProfilesBtn').onclick = loadProfiles;
  $adv('#eaRefreshBtn').onclick = () => {
    renderProfiles();
    renderRoleBadge();
    toast('Interface actualisée.', 'success');
  };

  $adv('#eaBrandSelect').onchange = renderEcuDetails;
  $adv('#eaEcuSelect').onchange = () => {
    const ecu = getCurrentEcuConfig();
    if (ecu) {
      $adv('#eaTxId').value = ecu.tx_id;
      $adv('#eaRxId').value = ecu.rx_id;
    }
    renderEcuDetails();
  };

  $adv('#eaScanEcusBtn').onclick = scanEcus;
  $adv('#eaTesterPresentBtn').onclick = testerPresent;
  $adv('#eaReadVinBtn').onclick = readVin;
  $adv('#eaReadDtcBtn').onclick = readDtc;
  $adv('#eaClearDtcBtn').onclick = clearDtc;
  $adv('#eaReadinessBtn').onclick = readiness;

  $adv('#eaLiveStartBtn').onclick = startLive;
  $adv('#eaLiveStopBtn').onclick = () => {
    stopLive();
    toast('Live arrêté.', 'info');
  };

  $adv('#eaReadDidBtn').onclick = readDid;
  $adv('#eaWriteDidBtn').onclick = writeDid;

  $adv('#eaRequestSeedBtn').onclick = requestSeed;
  $adv('#eaSendKeyBtn').onclick = sendKey;

  $adv('#eaRoutineStartBtn').onclick = () => runRoutine('start');
  $adv('#eaRoutineStopBtn').onclick = () => runRoutine('stop');
  $adv('#eaRoutineResultsBtn').onclick = () => runRoutine('results');

  $adv('#eaRawSendBtn').onclick = sendRawUds;
  $adv('#eaControlDtcOffBtn').onclick = () => controlDtc(false);
  $adv('#eaControlDtcOnBtn').onclick = () => controlDtc(true);

  $adv('#eaLoadLogsBtn').onclick = loadServerLogs;
  $adv('#eaClearLocalLogsBtn').onclick = () => {
    ADV.logs = [];
    renderLogs();
    toast('Journal local vidé.', 'success');
  };
}

async function initElmAdvanced() {
  await waitForHost();
  if (!ADV.host) {
    console.warn('[ELM-ADVANCED] Host DiagAutoElmHost indisponible. Ajoutez l’exposition dans app.js.');
    return;
  }

  injectCss();
  const card = createPanel();
  if (!card) return;

  bindAdvanced();
  renderRoleBadge();
  renderLogs();

  try {
    await loadProfiles();
  } catch {
    $adv('#eaConfigStatus').textContent = 'Profils non chargés. Cliquez sur Charger profils serveur.';
  }

  const observer = new MutationObserver(() => renderRoleBadge());
  observer.observe(document.body, { childList: true, subtree: true });
}

initElmAdvanced();
