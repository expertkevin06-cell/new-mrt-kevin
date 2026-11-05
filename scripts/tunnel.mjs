#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);

const shouldVerify = args.includes('--verify');
const shouldOpen = args.includes('--open');
const help = args.includes('--help') || args.includes('-h');

function getArgValue(name, fallback = null) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1]) return args[i + 1];
    if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
  }
  return fallback;
}

const port = Number(getArgValue('--port', process.env.PORT || 3000));
const timeoutMs = Number(getArgValue('--timeout', 45000));
const localUrl = `http://127.0.0.1:${port}`;
const cloudflaredBin = process.env.CLOUDFLARED_BIN || null;

function log(...parts) {
  console.log(...parts);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function printHelp() {
  log(`
DiagAuto Pro — Tunnel PWABuilder

Usage :
  node scripts/tunnel.mjs
  node scripts/tunnel.mjs --verify
  node scripts/tunnel.mjs --verify --open
  node scripts/tunnel.mjs --port 3000 --timeout 60000

Options :
  --verify          Lance automatiquement scripts/auto-verify.mjs contre l'URL HTTPS obtenue.
  --open            Ouvre PWABuilder dans le navigateur avec l'URL tunnellisée.
  --port <port>     Port du serveur local. Défaut : 3000 ou PORT.
  --timeout <ms>    Timeout d'attente de l'URL Cloudflare. Défaut : 45000.
  --help, -h        Affiche cette aide.

Exemples :
  npm run tunnel
  npm run tunnel:verify
  npm run pwabuilder
`);
}

if (help) {
  printHelp();
  process.exit(0);
}

function requestJson(url, timeout = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });

    req.on('error', (err) => {
      resolve({ error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'Timeout HTTP' });
    });
  });
}

async function checkLocalServer() {
  const health = await requestJson(`${localUrl}/api/health`, 4000);

  if (health.error) {
    fail(`Serveur local injoignable sur ${localUrl} : ${health.error}\nDémarre d'abord le serveur avec :\n  npm start`);
  }

  if (health.status !== 200) {
    fail(`Le serveur local répond HTTP ${health.status} sur ${localUrl}/api/health.\nVérifie que npm start tourne correctement.`);
  }

  try {
    const data = JSON.parse(health.body);
    if (data.ok !== true) {
      fail(`Réponse /api/health invalide : ${health.body}`);
    }
  } catch {
    fail(`Réponse /api/health non JSON : ${health.body}`);
  }

  log(`✅ Serveur local joignable : ${localUrl}`);
}

function hasCommand(command) {
  const res = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32'
  });

  return !res.error;
}

function resolveCloudflaredLauncher() {
  if (cloudflaredBin) {
    if (!hasCommand(cloudflaredBin)) {
      fail(`CLOUDFLARED_BIN pointe vers un exécutable introuvable : ${cloudflaredBin}`);
    }
    return {
      command: cloudflaredBin,
      prefixArgs: [],
      shell: false,
      label: cloudflaredBin
    };
  }

  if (hasCommand('cloudflared')) {
    return {
      command: 'cloudflared',
      prefixArgs: [],
      shell: false,
      label: 'cloudflared'
    };
  }

  return {
    command: 'npx',
    prefixArgs: ['--yes', 'cloudflared'],
    shell: process.platform === 'win32',
    label: 'npx --yes cloudflared'
  };
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
    log(`⚠️ Impossible d'ouvrir automatiquement le navigateur : ${err.message}`);
    log(`   Ouvre manuellement : ${url}`);
  }
}

function runVerification(publicUrl) {
  return new Promise((resolve) => {
    log('\n🔎 Lancement de l’auto-vérification PWABuilder...\n');

    const verifyScript = path.join(root, 'scripts', 'auto-verify.mjs');
    const child = spawn(
      process.execPath,
      [
        verifyScript,
        '--live',
        '--pwabuilder',
        '--base',
        publicUrl
      ],
      {
        stdio: 'inherit',
        cwd: root
      }
    );

    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      log(`❌ Erreur lancement vérification : ${err.message}`);
      resolve(1);
    });
  });
}

function startTunnel() {
  return new Promise(async (resolve, reject) => {
    const launcher = resolveCloudflaredLauncher();

    log(`☁️ Démarrage du tunnel Cloudflare via : ${launcher.label}`);
    log(`   Cible locale : ${localUrl}`);
    log('   Attente de l’URL publique HTTPS...\n');

    const child = spawn(
      launcher.command,
      [
        ...launcher.prefixArgs,
        'tunnel',
        '--url',
        localUrl,
        '--no-autoupdate'
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: launcher.shell,
        cwd: root
      }
    );

    let output = '';
    let publicUrl = null;
    let settled = false;

    const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

    const collect = (chunk) => {
      const text = chunk.toString('utf8');
      output += text;

      // Affiche aussi la sortie brute pour diagnostic
      process.stdout.write(text);

      if (!publicUrl) {
        const match = output.match(urlRegex);
        if (match) {
          publicUrl = match[0];
        }
      }
    };

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const interval = setInterval(() => {
      if (publicUrl && !settled) {
        settled = true;
        clearInterval(interval);
        clearTimeout(timeoutTimer);
        resolve({ publicUrl, child });
      }
    }, 250);

    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        clearInterval(interval);
        try {
          child.kill('SIGTERM');
        } catch {}
        reject(new Error(`Timeout : aucune URL trycloudflare.com détectée après ${timeoutMs} ms.`));
      }
    }, timeoutMs);

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearInterval(interval);
        clearTimeout(timeoutTimer);
        reject(err);
      }
    });

    child.on('exit', (code, signal) => {
      if (!settled && !publicUrl) {
        settled = true;
        clearInterval(interval);
        clearTimeout(timeoutTimer);
        reject(new Error(`cloudflared s'est arrêté prématurément (code=${code}, signal=${signal}).\nSortie :\n${output}`));
      }
    });
  });
}

async function main() {
  log('\n==================================================');
  log('  DiagAuto Pro — Tunnel HTTPS pour PWABuilder');
  log('==================================================\n');

  await checkLocalServer();

  let tunnel;
  try {
    tunnel = await startTunnel();
  } catch (err) {
    fail(err.message || String(err));
    return;
  }

  const { publicUrl, child } = tunnel;

  log('\n==================================================');
  log(`✅ Tunnel HTTPS prêt : ${publicUrl}`);
  log('==================================================\n');

  log('Tu peux maintenant :');
  log(`  1. Ouvrir PWABuilder : https://www.pwabuilder.com`);
  log(`  2. Coller cette URL : ${publicUrl}`);
  log(`  3. Générer le package Android / APK`);
  log('');

  let exitCode = 0;

  if (shouldVerify) {
    exitCode = await runVerification(publicUrl);

    if (exitCode !== 0) {
      log('\n❌ La vérification PWABuilder a échoué. Corrige les erreurs indiquées ci-dessus.');
    } else {
      log('\n✅ Vérification PWABuilder réussie.');
    }
  }

  if (shouldOpen) {
    const pwabuilderUrl = `https://www.pwabuilder.com/?url=${encodeURIComponent(publicUrl)}`;
    openBrowser(pwabuilderUrl);
  }

  log('\nAppuie sur Ctrl+C pour arrêter le tunnel.');

  const shutdown = () => {
    log('\n🛑 Arrêt du tunnel...');
    try {
      child.kill('SIGTERM');
    } catch {}
    setTimeout(() => process.exit(exitCode), 500);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  fail(err.message || String(err));
});
