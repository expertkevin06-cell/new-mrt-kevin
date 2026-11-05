#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);

let live = args.includes('--live') || args.includes('--prod');
const pwabuilder = args.includes('--pwabuilder');
const strict = args.includes('--strict');
const insecure = args.includes('--insecure');

let base = process.env.VERIFY_BASE || 'http://localhost:3000';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) {
    base = args[i + 1];
    i++;
  } else if (args[i].startsWith('--base=')) {
    base = args[i].slice('--base='.length);
  }
}

base = String(base).replace(/\/+$/, '');

let errors = 0;
let warnings = 0;

function ok(message) {
  console.log(`✅ ${message}`);
}

function warn(message) {
  warnings++;
  console.log(`⚠️ ${message}`);
}

function fail(message) {
  errors++;
  console.log(`❌ ${message}`);
}

function info(message) {
  console.log(`ℹ️ ${message}`);
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

function readBuffer(rel) {
  try {
    return fs.readFileSync(path.join(root, rel));
  } catch {
    return null;
  }
}

function parseJson(rel) {
  const txt = read(rel);
  if (txt == null) {
    fail(`Fichier absent ou illisible : ${rel}`);
    return null;
  }

  try {
    return JSON.parse(txt);
  } catch (err) {
    fail(`JSON invalide : ${rel} — ${err.message}`);
    return null;
  }
}

function requireFile(rel, label = rel) {
  if (exists(rel)) ok(`Présent : ${label}`);
  else fail(`Manquant : ${label}`);
}

function requireContains(text, needles, label) {
  if (!text) {
    fail(`${label} absent ou illisible`);
    return;
  }

  const missing = needles.filter(needle => !text.includes(needle));

  if (missing.length) {
    fail(`${label} : éléments manquants -> ${missing.join(', ')}`);
  } else {
    ok(`${label} : contenu vérifié`);
  }

  const forbidden = [];
  if (label === 'public/index.html' && text.includes('/js/elm-advanced.js')) {
    forbidden.push('/js/elm-advanced.js');
  }
  if (label === 'public/index.html' && text.includes('/js/uds-iso15765.js')) {
    forbidden.push('/js/uds-iso15765.js');
  }

  if (forbidden.length) {
    fail(`${label} : références externes interdites détectées -> ${forbidden.join(', ')}`);
  }
}

function isPngBuffer(buf) {
  return Boolean(
    buf &&
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function isLocalIconSrc(src) {
  return typeof src === 'string' && (src.startsWith('/') || src.startsWith('./') || src.startsWith('../'));
}

function normalizeLocalIconPath(src) {
  return src.replace(/^(\.\/|\/)/, '');
}

function isRelativeOrRootUrl(value) {
  return typeof value === 'string' && (value === '/' || value.startsWith('/') || value === '.' || value.startsWith('./'));
}

console.log('\n==================================================');
console.log('  DiagAuto Pro — Auto-vérification production');
console.log('==================================================\n');

console.log('🔎 Vérification statique du projet\n');

const requiredFiles = [
  'package.json',
  '.gitignore',
  'capacitor.config.json',

  'server/index.js',

  'public/index.html',
  'public/styles.css',
  'public/app.js',
  'public/sw.js',
  'public/manifest.webmanifest',

  'public/icons/icon.svg',
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
  'public/icons/icon-maskable-192.png',
  'public/icons/icon-maskable-512.png'
];

for (const file of requiredFiles) {
  requireFile(file);
}

const pkg = parseJson('package.json');
if (pkg) {
  if (!pkg.scripts?.start) fail('package.json : script "start" manquant');
  else ok('package.json : script start présent');

  if (!pkg.scripts?.icons) warn('package.json : script "icons" manquant.');
  if (!pkg.scripts?.verify) warn('package.json : script "verify" manquant.');
  if (!pkg.dependencies?.express) fail('package.json : dépendance express manquante');
  else ok('package.json : dépendance express présente');

  if (!pkg.type || pkg.type !== 'module') warn('package.json : "type": "module" recommandé.');
}

const gitignore = read('.gitignore');
requireContains(gitignore, ['server/data', 'public/media', 'android', '*.apk'], '.gitignore');

const capacitor = parseJson('capacitor.config.json');
if (capacitor) {
  if (capacitor.webDir !== 'public') fail('capacitor.config.json : webDir doit être "public"');
  else ok('capacitor.config.json : webDir correct');

  if (!capacitor.appId) fail('capacitor.config.json : appId manquant');
  if (!capacitor.appName) fail('capacitor.config.json : appName manquant');
}

const serverSrc = read('server/index.js');
requireContains(serverSrc, [
  '/api/health',
  '/api/version',
  '/api/bootstrap',
  '/api/settings/public',
  '/api/auth/owner',
  '/api/access/request',
  '/api/access/list',
  '/api/security/revocations',
  '/api/workshop/push',
  '/api/elm/profiles',
  'WebSocketServer',
  'webPush',
  'DEFAULT_ELM_PROFILES'
], 'server/index.js');

const indexHtml = read('public/index.html');
requireContains(indexHtml, [
  '<link rel="manifest"',
  '/manifest.webmanifest',
  '/styles.css',
  '/app.js',
  'id="wallpaper"',
  'id="wallpaperImg"',
  'id="wallpaperVideo"',
  'id="wallpaperOverlay"',
  'id="panel-elm"',
  'id="elmAdvancedHost"',
  'id="toastHost"',
  'id="lockOverlay"',
  'id="pinOverlay"',
  'viewport'
], 'public/index.html');

const appJs = read('public/app.js');
requireContains(appJs, [
  'registerServiceWorker',
  '/sw.js',
  'class ElmManager',
  'class ElmUdsChannel',
  'function injectElmAdvanced',
  'async function boot',
  'apiUrl(',
  'subscribePush'
], 'public/app.js');

const swJs = read('public/sw.js');
requireContains(swJs, [
  '/index.html',
  '/app.js',
  '/manifest.webmanifest',
  "self.addEventListener('install'",
  "self.addEventListener('activate'",
  "self.addEventListener('fetch'",
  "self.addEventListener('push'",
  "self.addEventListener('notificationclick'",
  'SKIP_WAITING'
], 'public/sw.js');

const manifest = parseJson('public/manifest.webmanifest');
if (manifest) {
  const requiredManifestKeys = [
    'name',
    'short_name',
    'start_url',
    'scope',
    'display',
    'theme_color',
    'background_color',
    'icons'
  ];

  for (const key of requiredManifestKeys) {
    if (!(key in manifest)) fail(`manifest.webmanifest : clé "${key}" manquante`);
  }

  if (manifest.display !== 'standalone') {
    warn('manifest.webmanifest : display devrait être "standalone".');
  }

  if (!isRelativeOrRootUrl(manifest.start_url)) {
    fail('manifest.webmanifest : start_url doit être relative, ex: "/"');
  }

  if (!isRelativeOrRootUrl(manifest.scope)) {
    fail('manifest.webmanifest : scope doit être relatif, ex: "/"');
  }

  const hexColor = /^#[0-9a-f]{6}$/i;
  if (!hexColor.test(manifest.theme_color)) warn('manifest.webmanifest : theme_color devrait être #rrggbb');
  if (!hexColor.test(manifest.background_color)) warn('manifest.webmanifest : background_color devrait être #rrggbb');

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  if (!icons.length) fail('manifest.webmanifest : icons[] manquant ou vide');

  const sizes = icons.flatMap(icon => String(icon.sizes || '').split(/\s+/).filter(Boolean));
  const purposes = icons.flatMap(icon => String(icon.purpose || 'any').split(/\s+/).filter(Boolean));

  if (!sizes.includes('192x192')) fail('manifest.webmanifest : icône 192x192 manquante');
  if (!sizes.includes('512x512')) fail('manifest.webmanifest : icône 512x512 manquante');

  if (!purposes.includes('any')) warn('manifest.webmanifest : aucune icône purpose "any" détectée');
  if (!purposes.includes('maskable')) fail('manifest.webmanifest : aucune icône purpose "maskable" détectée.');

  for (const icon of icons) {
    if (!icon.src) {
      fail('manifest.webmanifest : une icône est sans src');
      continue;
    }

    if (!isLocalIconSrc(icon.src)) {
      warn(`manifest.webmanifest : icône distante détectée (${icon.src}).`);
      continue;
    }

    const rel = path.join('public', normalizeLocalIconPath(icon.src));
    if (!exists(rel)) {
      fail(`manifest.webmanifest : icône référencée absente -> ${icon.src}`);
    } else if (rel.toLowerCase().endsWith('.png')) {
      const buf = readBuffer(rel);
      if (!isPngBuffer(buf)) fail(`manifest.webmanifest : fichier PNG invalide -> ${icon.src}`);
    }
  }
}

const iconFiles = [
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
  'public/icons/icon-maskable-192.png',
  'public/icons/icon-maskable-512.png'
];

for (const iconFile of iconFiles) {
  const buf = readBuffer(iconFile);
  if (!buf) {
    fail(`Icône absente : ${iconFile}`);
  } else if (!isPngBuffer(buf)) {
    fail(`Icône PNG invalide : ${iconFile}`);
  } else if (buf.length < 200) {
    warn(`Icône suspectement petite : ${iconFile} (${buf.length} octets)`);
  } else {
    ok(`Icône PNG valide : ${iconFile}`);
  }
}

if (!exists('public/icons/apple-touch-icon.png')) {
  warn('public/icons/apple-touch-icon.png absent. Lancez npm run icons.');
} else {
  const buf = readBuffer('public/icons/apple-touch-icon.png');
  if (!isPngBuffer(buf)) fail('public/icons/apple-touch-icon.png invalide');
  else ok('public/icons/apple-touch-icon.png valide');
}

console.log('\n──────────────────────────────────────────────────\n');

function fetchUrl(target, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 3) {
      resolve({ error: 'Trop de redirections HTTP' });
      return;
    }

    let url;
    try {
      url = new URL(target);
    } catch {
      resolve({ error: `URL invalide : ${target}` });
      return;
    }

    const lib = url.protocol === 'https:' ? https : http;
    let settled = false;

    const done = (obj) => {
      if (!settled) {
        settled = true;
        resolve(obj);
      }
    };

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'User-Agent': 'DiagAutoPro-AutoVerify/4.3.0',
        Accept: '*/*'
      },
      timeout: 8000,
      rejectUnauthorized: !insecure
    };

    const req = lib.get(options, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        done(fetchUrl(next, redirects + 1));
        return;
      }

      const chunks = [];
      let size = 0;
      const limit = 50 * 1024 * 1024;

      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          res.destroy();
          done({ error: `Réponse trop volumineuse (> ${Math.round(limit / 1024 / 1024)} Mo)` });
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        done({
          status: res.statusCode,
          headers: res.headers,
          buffer,
          body: buffer.toString('utf8'),
          size
        });
      });

      res.on('error', (err) => done({ error: err.message }));
    });

    req.on('error', (err) => {
      let message = err.message;

      if (
        err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        err.code === 'CERT_HAS_EXPIRED' ||
        err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        err.code === 'SELF_SIGNED_CERT_IN_CHAIN'
      ) {
        message = `Certificat HTTPS invalide (${err.code}). Pour test local auto-signé, ajoutez --insecure.`;
      }

      done({ error: message });
    });

    req.on('timeout', () => {
      req.destroy();
      done({ error: 'Timeout HTTP' });
    });
  });
}

async function runLiveChecks() {
  console.log('🌐 Vérification live du serveur\n');

  let baseUrl;
  try {
    baseUrl = new URL(base);
  } catch {
    fail(`Base URL invalide : ${base}`);
    return;
  }

  if (pwabuilder) {
    if (baseUrl.protocol !== 'https:') {
      fail('PWABuilder exige une URL HTTPS publique. Votre base actuelle n’est pas HTTPS.');
    } else {
      ok('Protocole HTTPS détecté pour PWABuilder');
    }

    if (['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname)) {
      fail('PWABuilder ne peut pas tester localhost. Déployez sur un domaine HTTPS public ou utilisez un tunnel.');
    }
  }

  const ping = await fetchUrl(`${base}/api/health`);
  if (ping.error) {
    fail(`Serveur injoignable sur ${base} : ${ping.error}`);
    info('Démarrez le serveur avec : npm start');
    info('Puis relancez : npm run verify:live');
    return;
  }

  ok(`Serveur joignable : ${base}`);

  async function checkJson(endpoint, label, validator, allowedStatus = [200]) {
    const res = await fetchUrl(`${base}${endpoint}`);

    if (res.error) {
      fail(`${label} : erreur réseau -> ${res.error}`);
      return null;
    }

    if (!allowedStatus.includes(res.status)) {
      fail(`${label} : HTTP ${res.status} attendu ${allowedStatus.join(' ou ')}`);
      return null;
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      fail(`${label} : réponse non JSON valide`);
      return null;
    }

    if (typeof validator === 'function') {
      validator(data, res);
    } else {
      ok(label);
    }

    return data;
  }

  await checkJson('/api/health', 'API /api/health', (data) => {
    if (data.ok !== true) fail('/api/health : ok !== true');
    else ok('/api/health valide');
  });

  await checkJson('/api/version', 'API /api/version', (data) => {
    if (typeof data.data_version !== 'number' || data.data_version <= 0) {
      fail('/api/version : data_version invalide');
    } else {
      ok(`/api/version : data_version=${data.data_version}`);
    }
  });

  await checkJson('/api/bootstrap', 'API /api/bootstrap', (data) => {
    const brands = Array.isArray(data.brands) ? data.brands.length : 0;
    const models = Array.isArray(data.models) ? data.models.length : 0;
    const engines = Array.isArray(data.engines) ? data.engines.length : 0;
    const faults = Array.isArray(data.faults) ? data.faults.length : 0;

    if (!brands) fail('/api/bootstrap : aucune marque');
    if (!models) fail('/api/bootstrap : aucun modèle');
    if (!engines) warn('/api/bootstrap : aucune motorisation');
    if (!faults) fail('/api/bootstrap : aucun code DTC');

    if (brands && models && faults) {
      ok(`/api/bootstrap : marques=${brands}, modèles=${models}, moteurs=${engines}, DTC=${faults}`);
    }
  });

  await checkJson('/api/settings/public', 'API /api/settings/public', (data) => {
    if (!data || typeof data !== 'object') fail('/api/settings/public : objet attendu');
    else ok('/api/settings/public valide');
  });

  await checkJson('/api/security/public-key', 'API /api/security/public-key', (data) => {
    if (!data.spki_b64 || String(data.spki_b64).length < 50) {
      fail('/api/security/public-key : spki_b64 manquant ou trop court');
    } else {
      ok('/api/security/public-key valide');
    }
  });

  await checkJson('/api/security/revocations', 'API /api/security/revocations', (data) => {
    if (!data.payload || !data.signature_b64) {
      fail('/api/security/revocations : payload ou signature_b64 manquant');
    } else {
      ok('/api/security/revocations valide');
    }
  });

  const authMe = await fetchUrl(`${base}/api/auth/me`);
  if (authMe.error) {
    fail(`/api/auth/me : erreur réseau -> ${authMe.error}`);
  } else if (authMe.status === 401) {
    ok('/api/auth/me correctement protégé (401 sans token)');
  } else if (authMe.status === 200) {
    warn('/api/auth/me répond 200 sans token. Vérifiez la politique d’authentification.');
  } else {
    fail(`/api/auth/me : statut inattendu ${authMe.status}`);
  }

  const elmProfilesRes = await fetchUrl(`${base}/api/elm/profiles`);
  if (elmProfilesRes.error) {
    fail(`/api/elm/profiles : erreur réseau -> ${elmProfilesRes.error}`);
  } else if (elmProfilesRes.status === 200) {
    try {
      const data = JSON.parse(elmProfilesRes.body);
      if (!Array.isArray(data.ecu_groups) || !data.ecu_groups.length) {
        fail('/api/elm/profiles : ecu_groups vide');
      } else {
        ok(`/api/elm/profiles accessible : ${data.ecu_groups.length} groupe(s) ECU`);
      }
    } catch {
      fail('/api/elm/profiles : JSON invalide');
    }
  } else if (elmProfilesRes.status === 401) {
    info('/api/elm/profiles protégé par authentification');
  } else {
    fail(`/api/elm/profiles : statut inattendu ${elmProfilesRes.status}`);
  }

  const home = await fetchUrl(`${base}/`);
  if (home.error) {
    fail(`Page d’accueil injoignable : ${home.error}`);
  } else if (home.status !== 200) {
    fail(`Page d’accueil : HTTP ${home.status}`);
  } else if (!home.body.includes('/manifest.webmanifest')) {
    fail('Page d’accueil : lien manifest absent');
  } else {
    ok('Page d’accueil servie correctement');
  }

  const manifestRes = await fetchUrl(`${base}/manifest.webmanifest`);
  if (manifestRes.error) {
    fail(`/manifest.webmanifest : ${manifestRes.error}`);
  } else if (manifestRes.status !== 200) {
    fail(`/manifest.webmanifest : HTTP ${manifestRes.status}`);
  } else {
    try {
      JSON.parse(manifestRes.body);
      ok('/manifest.webmanifest servi et parsable');
    } catch {
      fail('/manifest.webmanifest servi mais JSON invalide');
    }
  }

  const swRes = await fetchUrl(`${base}/sw.js`);
  if (swRes.error) {
    fail(`/sw.js : ${swRes.error}`);
  } else if (swRes.status !== 200) {
    fail(`/sw.js : HTTP ${swRes.status}`);
  } else if (!swRes.body.includes("self.addEventListener('install'")) {
    fail('/sw.js : install handler manquant');
  } else {
    ok('/sw.js servi correctement');
  }

  const liveIcons = [
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-192.png',
    '/icons/icon-maskable-512.png'
  ];

  for (const iconPath of liveIcons) {
    const res = await fetchUrl(`${base}${iconPath}`);
    if (res.error) {
      fail(`${iconPath} : ${res.error}`);
    } else if (res.status !== 200) {
      fail(`${iconPath} : HTTP ${res.status}`);
    } else if (!isPngBuffer(res.buffer)) {
      fail(`${iconPath} : contenu non PNG`);
    } else {
      ok(`${iconPath} servie en PNG valide`);
    }
  }

  if (baseUrl.protocol === 'https:' && home.body) {
    const matches = home.body.match(/\bhttp:\/\/[^"'\s)>]+/gi) || [];
    const bad = matches.filter(m => !/localhost|127\.0\.0\.1|::1|w3\.org|schema\.org|purl\.org/i.test(m));

    if (bad.length) {
      fail(`Mixed content détecté dans la page d’accueil : ${bad.slice(0, 5).join(', ')}`);
    } else {
      ok('Aucun mixed content évident détecté');
    }
  }
}

if (live) {
  await runLiveChecks();
} else {
  info('Vérification live non exécutée. Utilisez : npm run verify:live');
  info('Pour PWABuilder sur URL publique : npm run verify:prod -- --base https://votre-domaine.com');
}

console.log('\n==================================================');
console.log(`  Résultat : ${errors} erreur(s), ${warnings} avertissement(s)`);
console.log('==================================================\n');

if (errors > 0) {
  console.log('❌ ÉCHEC : corrigez les erreurs avant production PWABuilder / APK / web HTTPS.');
  process.exit(1);
}

if (strict && warnings > 0) {
  console.log('⚠️ Mode strict activé : les avertissements bloquent la validation production.');
  process.exit(1);
}

if (warnings > 0) {
  console.log('✅ Validation acceptée avec avertissements.');
} else {
  console.log('✅ Validation complète réussie.');
}

if (!live) {
  console.log('\nProchaine étape conseillée :');
  console.log('  npm start');
  console.log('  npm run verify:live');
}

if (live && !pwabuilder) {
  console.log('\nPour PWABuilder, déployez sur HTTPS puis exécutez :');
  console.log('  npm run verify:prod -- --base https://votre-domaine.com');
}
