#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);

const valueFlagNames = new Set([
  'port',
  'timeout',
  'server-timeout',
  'local-host',
  'local-url',
  'cloudflared-bin',
  'url-file'
]);

const flags = new Set();
const values = {};

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];

  if (!arg.startsWith('--')) continue;

  const eq = arg.indexOf('=');

  if (eq !== -1) {
    const key = arg.slice(2, eq);
    const value = arg.slice(eq + 1);

    if (valueFlagNames.has(key)) values[key] = value;
    else flags.add(key);

    continue;
  }

  const key = arg.slice(2);

  if (valueFlagNames.has(key) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
    values[key] = argv[++i];
  } else {
    flags.add(key);
  }
}

function printHelp() {
  console.log(`
DiagAuto Pro — Tunnel HTTPS pour PWABuilder

Usage :
  node scripts/tunnel.mjs
  node scripts/tunnel.mjs --verify
  node scripts/tunnel.mjs --verify --open
  node scripts/tunnel.mjs --start --verify --open
  node scripts/tunnel.mjs --verify --once --url-file tunnel-url.txt

Options :
  --start                    Démarre automatiquement le serveur local via npm run start.
  --verify                   Lance scripts/auto-verify.mjs en mode PWABuilder contre l'URL HTTPS.
  --open                     Ouvre PWABuilder dans le navigateur avec l'URL du tunnel.
  --force-open               Ouvre PWABuilder même si la vérification échoue.
  --once                     Arrête le tunnel après la vérification. Utile en CI/test rapide.
  --raw                      Affiche la sortie brute de cloudflared.
  --quiet                    Réduit les logs non essentiels.
  --strict                   Passe --strict à auto-verify.mjs.
  --insecure                 Passe --insecure à auto-verify.mjs pour certificats auto-signés.
  --no-verify                Désactive la vérification même si le script npm l'ajoute.
  --no-open                  Désactive l'ouverture navigateur même si le script npm l'ajoute.
  --port <port>              Port du serveur local. Défaut : 3000 ou PORT.
  --timeout <ms>             Timeout d'attente de l'URL Cloudflare. Défaut : 60000.
  --server-timeout <ms>      Timeout d'attente du serveur local. Défaut : 20000.
  --local-host <host>        Hôte local à tuner. Défaut : 127.0.0.1.
  --local-url <url>          URL locale complète. Défaut : http://127.0.0.1:<port>.
  --cloudflared-bin <path>   Chemin explicite vers cloudflared.
  --url-file <path>          Écrit l'URL publique HTTPS dans un fichier.
  --help, -h                 Affiche cette aide.

Exemples npm :
  npm run tunnel
  npm run tunnel:verify
  npm run pwabuilder
  npm run pwabuilder -- --start
  npm run pwabuilder -- --start --verify --open
  npm run tunnel -- --verify --once --url-file tunnel-url.txt --quiet
`);
}

if (flags.has('help') || flags.has('h')) {
  printHelp();
  process.exit(0);
}

const port = Number(values.port || process.env.PORT || 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`❌ Port invalide : ${values.port || process.env.PORT || 3000}`);
  process.exit(1);
}

const localHost = values['local-host'] || '127.0.0.1';
const localUrl = values['local-url'] || `http://${localHost}:${port}`;
const tunnelTimeout = Number(values.timeout || process.env.TUNNEL_TIMEOUT || 60000);
const serverTimeout = Number(values['server-timeout'] || process.env.SERVER_TIMEOUT || 20000);

const verify = flags.has('verify') && !flags.has('no-verify');
const open = flags.has('open') && !flags.has('no-open');
const forceOpen = flags.has('force-open');
const once = flags.has('once');
const startServer = flags.has('start');
const raw = flags.has('raw');
const quiet = flags.has('quiet');
const strict = flags.has('strict');
const insecure = flags.has('insecure');
const urlFile = values['url-file'] ? path.resolve(root, values['url-file']) : null;

function log(...parts) {
  if (!quiet) console.log(...parts);
}

function info(...parts) {
  log('ℹ️', ...parts);
}

function success(...parts) {
  log('✅', ...parts);
}

function warn(...parts) {
  if (!quiet) console.warn('⚠️', ...parts);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function tail(text, maxChars = 1800) {
  const clean = stripAnsi(text);
  const lines = clean.split(/\r?\n/).filter(Boolean);
  const out = lines.slice(-40).join('\n');
  return out.length > maxChars ? out.slice(-maxChars) : out;
}

function normalizeTryUrl(value) {
  return stripAnsi(value)
    .replace(/[.,;:)\]}>"'`]+$/g, '')
    .trim();
}

function requestUrl(target, timeout = 5000) {
  return new Promise((resolve) => {
    let url;

    try {
      url = new URL(target);
    } catch {
      resolve({ error: `URL invalide : ${target}` });
      return;
    }

    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.get(
      url,
      {
        timeout,
        headers: {
          'User-Agent': 'DiagAutoPro-Tunnel/4.2.1',
          Accept: '*/*'
        }
      },
      (res) => {
        const chunks = [];
        let size = 0;
        const limit = 2 * 1024 * 1024;

        res.on('data', (chunk) => {
          size += chunk.length;

          if (size > limit) {
            res.destroy();
            resolve({ error: 'Réponse HTTP trop volumineuse' });
            return;
          }

          chunks.push(chunk);
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });

        res.on('error', (err) => {
          resolve({ error: err.message });
        });
      }
    );

    req.on('error', (err) => {
      resolve({ error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'Timeout HTTP' });
    });
  });
}

async function waitForServer() {
  const started = Date.now();
  let lastState = 'inconnu';

  while (Date.now() - started < serverTimeout) {
    const health = await requestUrl(`${localUrl}/api/health`, 3000);

    if (!health.error && health.status === 200) {
      try {
        const data = JSON.parse(health.body);

        if (data && data.ok === true) {
          success(`Serveur local joignable : ${localUrl}`);
          return;
        }
      } catch {
        // health endpoint pas en JSON valide, on tente la page d'accueil
      }
    }

    const home = await requestUrl(localUrl, 3000);

    if (!home.error && home.status === 200) {
      success(`Serveur local joignable via page d'accueil : ${localUrl}`);
      return;
    }

    lastState =
      health.error ||
      home.error ||
      `health=${health.status ?? 'n/a'}, home=${home.status ?? 'n/a'}`;

    await sleep(700);
  }

  fail(
    `Serveur local injoignable sur ${localUrl} après ${serverTimeout} ms.\n` +
    `Dernier état : ${lastState}\n\n` +
    `Démarrez-le avec :\n` +
    `  npm start\n\n` +
    `Ou utilisez ce script avec --start :\n` +
    `  npm run pwabuilder -- --start`
  );
}

function trySpawnSync(command, args, shell) {
  try {
    const res = spawnSync(command, args, {
      stdio: 'ignore',
      shell,
      timeout: 7000
    });

    return !res.error && res.status === 0;
  } catch {
    return false;
  }
}

function commandExists(command) {
  if (!command) return false;

  if (trySpawnSync(command, ['--version'], false)) return true;
  if (process.platform === 'win32' && trySpawnSync(command, ['--version'], true)) return true;

  return false;
}

function resolveLauncher() {
  const explicit = values['cloudflared-bin'] || process.env.CLOUDFLARED_BIN;

  if (explicit) {
    if (!commandExists(explicit)) {
      fail(`Cloudflared introuvable avec le chemin fourni : ${explicit}`);
    }

    return {
      command: explicit,
      prefix: [],
      shell: false,
      label: explicit
    };
  }

  if (commandExists('cloudflared')) {
    return {
      command: 'cloudflared',
      prefix: [],
      shell: false,
      label: 'cloudflared'
    };
  }

  if (commandExists('npx')) {
    return {
      command: 'npx',
      prefix: ['--yes', 'cloudflared'],
      shell: process.platform === 'win32',
      label: 'npx --yes cloudflared'
    };
  }

  fail(
    'Impossible de trouver cloudflared ni npx.\n' +
    'Installez Cloudflare Tunnel :\n\n' +
    'macOS :\n' +
    '  brew install cloudflared\n\n' +
    'Windows :\n' +
    '  winget install Cloudflare.cloudflared\n\n' +
    'Linux :\n' +
    '  Télécharger cloudflared depuis les releases GitHub Cloudflare.'
  );
}

let shuttingDown = false;
let tunnel = null;
let serverChild = null;
let keepAlive = null;

function killTree(proc) {
  if (!proc || proc.killed) return;

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: false
      });
    } else {
      proc.kill('SIGTERM');

      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {}
      }, 1000);
    }
  } catch {}
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  log('\n🛑 Arrêt du tunnel...');

  if (keepAlive) {
    clearInterval(keepAlive);
    keepAlive = null;
  }

  try {
    if (tunnel?.child && !tunnel.exited) {
      tunnel.child.kill('SIGTERM');
    }
  } catch {}

  try {
    if (serverChild) {
      killTree(serverChild);
    }
  } catch {}

  setTimeout(() => {
    try {
      if (tunnel?.child && !tunnel.exited) {
        tunnel.child.kill('SIGKILL');
      }
    } catch {}

    process.exit(code);
  }, 1200);
}

function startTunnel() {
  const launcher = resolveLauncher();

  info(`☁️ Démarrage du tunnel Cloudflare via : ${launcher.label}`);
  info(`   Cible locale : ${localUrl}`);
  info(`   Timeout : ${tunnelTimeout} ms`);
  log('');

  const args = [
    ...launcher.prefix,
    'tunnel',
    '--url',
    localUrl,
    '--no-autoupdate'
  ];

  const child = spawn(launcher.command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: launcher.shell,
    env: {
      ...process.env,
      NO_COLOR: raw ? '0' : '1'
    }
  });

  let output = '';
  let publicUrl = null;
  let settled = false;

  const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g;

  const ingest = (chunk) => {
    const text = chunk.toString('utf8');
    output += text;

    if (raw) {
      process.stdout.write(text);
    }

    if (!publicUrl) {
      const matches = stripAnsi(output).match(urlRegex);

      if (matches && matches.length) {
        publicUrl = normalizeTryUrl(matches[0]);
        success(`Tunnel HTTPS prêt : ${publicUrl}`);

        if (urlFile) {
          try {
            fs.writeFileSync(urlFile, `${publicUrl}\n`, 'utf8');
            info(`URL publique écrite dans : ${urlFile}`);
          } catch (err) {
            warn(`Impossible d'écrire le fichier d'URL ${urlFile} : ${err.message}`);
          }
        }
      }
    }
  };

  child.stdout?.on('data', ingest);
  child.stderr?.on('data', ingest);

  return new Promise((resolve, reject) => {
    const finish = (obj) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve(obj);
    };

    const rejectNow = (err) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);

      try {
        child.kill('SIGTERM');
      } catch {}

      reject(err);
    };

    const poll = setInterval(() => {
      if (publicUrl) {
        finish({
          child,
          publicUrl,
          exited: false,
          getOutput: () => output
        });
      }
    }, 100);

    const timer = setTimeout(() => {
      rejectNow(
        new Error(
          `Timeout : aucune URL trycloudflare.com détectée après ${tunnelTimeout} ms.\n` +
          `Sortie récente :\n${tail(output, 1800)}`
        )
      );
    }, tunnelTimeout);

    child.on('error', (err) => {
      rejectNow(err);
    });

    child.on('exit', (code, signal) => {
      if (publicUrl) {
        finish({
          child,
          publicUrl,
          exited: true,
          code,
          signal,
          getOutput: () => output
        });
      } else {
        rejectNow(
          new Error(
            `cloudflared s'est arrêté avant de fournir une URL publique.\n` +
            `Code : ${code}\n` +
            `Signal : ${signal}\n` +
            `Sortie récente :\n${tail(output, 2200)}`
          )
        );
      }
    });
  });
}

function runVerification(publicUrl) {
  return new Promise((resolve) => {
    const verifyScript = path.join(root, 'scripts', 'auto-verify.mjs');

    if (!fs.existsSync(verifyScript)) {
      warn('scripts/auto-verify.mjs introuvable. Vérification ignorée.');
      resolve(0);
      return;
    }

    log('\n🔎 Lancement de l’auto-vérification PWABuilder...\n');

    const args = [
      verifyScript,
      '--live',
      '--pwabuilder',
      '--base',
      publicUrl
    ];

    if (strict) args.push('--strict');
    if (insecure) args.push('--insecure');

    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: 'inherit'
    });

    child.on('error', (err) => {
      warn(`Erreur lancement de la vérification : ${err.message}`);
      resolve(1);
    });

    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });
}

function openBrowser(url) {
  let command;
  let args;

  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32'
    });

    child.unref();
    log(`🌐 Ouverture du navigateur : ${url}`);
  } catch (err) {
    warn(`Impossible d'ouvrir automatiquement le navigateur : ${err.message}`);
    log(`   Ouvrez manuellement : ${url}`);
  }
}

function openPwabuilder(publicUrl) {
  const target = `https://www.pwabuilder.com/?url=${encodeURIComponent(publicUrl)}`;
  openBrowser(target);
}

async function main() {
  log('\n==================================================');
  log('  DiagAuto Pro — Tunnel HTTPS pour PWABuilder');
  log('==================================================\n');

  if (startServer) {
    info('Démarrage automatique du serveur local (--start)...');

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    serverChild = spawn(npmCommand, ['run', 'start'], {
      cwd: root,
      stdio: raw ? 'inherit' : 'pipe',
      shell: false
    });

    if (!raw) {
      serverChild.stdout?.on('data', (chunk) => process.stdout.write(chunk));
      serverChild.stderr?.on('data', (chunk) => process.stderr.write(chunk));
    }

    serverChild.on('error', (err) => {
      fail(`Impossible de démarrer le serveur local : ${err.message}`);
    });

    serverChild.on('exit', (code, signal) => {
      serverChild = null;

      if (!shuttingDown) {
        warn(`Le serveur local s'est arrêté (code=${code}, signal=${signal}).`);
        shutdown(1);
      }
    });
  }

  await waitForServer();

  try {
    tunnel = await startTunnel();
  } catch (err) {
    fail(err.message || String(err));
    return;
  }

  if (tunnel.exited) {
    fail(
      `Le tunnel s'est arrêté immédiatement après avoir fourni l'URL.\n` +
      `Code : ${tunnel.code}\n` +
      `Signal : ${tunnel.signal}\n` +
      `Sortie récente :\n${tail(tunnel.getOutput(), 2200)}`
    );
  }

  tunnel.child.on('exit', (code, signal) => {
    tunnel.exited = true;

    if (!shuttingDown) {
      warn(`Le tunnel Cloudflare s'est arrêté (code=${code}, signal=${signal}).`);
      shutdown(1);
    }
  });

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  log('\n==================================================');
  success(`URL publique HTTPS : ${tunnel.publicUrl}`);
  log('==================================================\n');

  log('Pour PWABuilder :');
  log('  1. Ouvrir https://www.pwabuilder.com');
  log(`  2. Coller cette URL : ${tunnel.publicUrl}`);
  log('  3. Générer le package Android / APK');
  log('');

  if (urlFile) {
    log(`L'URL a aussi été enregistrée dans : ${urlFile}`);
    log('');
  }

  let verifyExitCode = 0;

  if (verify) {
    verifyExitCode = await runVerification(tunnel.publicUrl);

    if (verifyExitCode === 0) {
      success('Vérification PWABuilder réussie.');
    } else {
      warn('Vérification PWABuilder échouée. Corrigez les erreurs affichées ci-dessus.');
    }

    log('');
  }

  if (open && (!verify || verifyExitCode === 0 || forceOpen)) {
    openPwabuilder(tunnel.publicUrl);
    log('');
  } else if (open && verify && verifyExitCode !== 0 && !forceOpen) {
    warn('Ouverture de PWABuilder ignorée car la vérification a échoué.');
    warn('Utilisez --force-open pour ouvrir malgré tout.');
    log('');
  }

  if (once) {
    log('Mode --once : arrêt du tunnel après vérification.');
    shutdown(verifyExitCode);
    return;
  }

  log('Le tunnel reste actif.');
  log('Appuyez sur Ctrl+C pour l’arrêter.');
  log('');

  keepAlive = setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(`❌ ${err?.stack || err?.message || err}`);
  process.exit(1);
});
