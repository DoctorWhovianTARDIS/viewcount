// server.js
const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const path = require('path');

const REPO = 'DoctorWhovianTARDIS/viewcount';
const BRANCH = 'main';
const FILE_PATH = 'all-time.json';
const GITHUB_API = 'https://api.github.com';
const PAT = process.env.GITHUB_PAT;
if (!PAT) {
  console.error('Missing GITHUB_PAT environment variable');
  process.exit(1);
}

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-process mutex to serialize updates
let lock = Promise.resolve();
function withLock(fn) {
  lock = lock.then(() => fn()).catch(() => fn());
  return lock;
}

async function fetchRawFile() {
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE_PATH}`;
  const r = await fetch(rawUrl, { cache: 'no-store' });
  if (!r.ok) return [];
  try { return await r.json(); } catch (e) { return []; }
}

async function getFileSha() {
  const url = `${GITHUB_API}/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
  const r = await fetch(url, {
    headers: { Authorization: `token ${PAT}`, Accept: 'application/vnd.github+json' }
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.sha;
}

async function putFile(newContent, sha) {
  const url = `${GITHUB_API}/repos/${REPO}/contents/${FILE_PATH}`;
  const body = {
    message: `Log visit`,
    content: Buffer.from(JSON.stringify(newContent, null, 2)).toString('base64'),
    branch: BRANCH,
    sha
  };
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `token ${PAT}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r;
}

async function addIpIfNew(ip) {
  return withLock(async () => {
    const arr = await fetchRawFile();
    if (!Array.isArray(arr)) throw new Error('bad file format');

    if (arr.includes(ip)) return { recorded: false, count: arr.length };

    // Retry loop to handle SHA conflicts
    for (let attempt = 0; attempt < 4; attempt++) {
      const sha = await getFileSha();
      const newArr = arr.concat([ip]);
      const res = await putFile(newArr, sha);
      if (res.ok) return { recorded: true, count: newArr.length };

      const status = res.status;
      if (status === 409 || status === 422) {
        // refresh arr and retry
        const refreshed = await fetchRawFile();
        if (!Array.isArray(refreshed)) throw new Error('bad file format on refresh');
        if (refreshed.includes(ip)) return { recorded: false, count: refreshed.length };
        // update arr reference for next attempt
        arr.length = 0;
        refreshed.forEach(x => arr.push(x));
        continue;
      } else {
        const text = await res.text();
        throw new Error(`GitHub PUT failed ${status}: ${text}`);
      }
    }
    throw new Error('Failed to commit after retries');
  });
}

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Count endpoint
app.get('/count', async (req, res) => {
  try {
    const arr = await fetchRawFile();
    res.json({ ok: true, count: Array.isArray(arr) ? arr.length : 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Log endpoint
app.post('/log', async (req, res) => {
  try {
    const ip = (req.body && req.body.ip) || req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    if (!ip) return res.status(400).json({ ok: false, error: 'no ip' });

    const result = await addIpIfNew(ip);
    res.json({ ok: true, recorded: result.recorded, count: result.count });
  } catch (e) {
    console.error('log error', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`listening on ${port}`));
