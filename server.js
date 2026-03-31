// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const DATA_FILE = path.join(__dirname, 'visitors.json');
const TEMP_FILE = path.join(__dirname, 'visitors.json.tmp');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.set('trust proxy', true);

// Allow your static site origin to call the API
// Replace the origin below with your site origin if different
app.use(cors({ origin: 'https://francis.quest' }));

// Simple in-process mutex to serialize file operations
let lock = Promise.resolve();
function withLock(fn) {
  lock = lock.then(() => fn()).catch(() => fn());
  return lock;
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { ips: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.ips)) parsed.ips = [];
    return parsed;
  } catch (err) {
    return { ips: [] };
  }
}

function writeStoreAtomic(store) {
  const data = JSON.stringify(store, null, 2);
  fs.writeFileSync(TEMP_FILE, data, 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

function normalizeIp(ip) {
  if (!ip) return null;
  return String(ip).replace(/^::ffff:/, '').trim();
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return xf.split(',')[0].trim();
  if (req.body && req.body.ip) return String(req.body.ip).trim();
  if (req.ip) return req.ip;
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return null;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// GET count
app.get('/api/count', (req, res) => {
  withLock(() => {
    ensureDataFile();
    const store = readStore();
    return Promise.resolve(res.json({ count: store.ips.length }));
  }).catch(err => {
    console.error('Lock error', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  });
});

// POST visit
app.post('/api/visit', (req, res) => {
  const rawIp = getClientIp(req);
  const ip = normalizeIp(rawIp);
  if (!ip) return res.status(400).json({ error: 'No IP provided' });

  withLock(() => {
    ensureDataFile();
    const store = readStore();
    if (!store.ips.includes(ip)) {
      store.ips.push(ip);
      try {
        writeStoreAtomic(store);
      } catch (err) {
        console.error('Failed to write store', err);
      }
    }
    return Promise.resolve(res.json({ count: store.ips.length }));
  }).catch(err => {
    console.error('Lock error', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  });
});

// Optional clear endpoint (protect with CLEAR_SECRET env var)
app.post('/api/clear', (req, res) => {
  const secret = process.env.CLEAR_SECRET || '';
  if (!secret || req.body.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  withLock(() => {
    const store = { ips: [] };
    try { writeStoreAtomic(store); } catch (err) { console.error('Failed to clear store', err); }
    return Promise.resolve(res.json({ count: 0 }));
  }).catch(err => {
    console.error('Lock error', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  });
});

app.listen(PORT, () => {
  console.log(`Visitor counter listening on port ${PORT}`);
});
