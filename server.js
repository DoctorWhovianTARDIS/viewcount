const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: 'https://francis.quest' }));
app.set('trust proxy', true);

const DATA_FILE = path.join(__dirname, 'visitors.json');

function load() {
  if (!fs.existsSync(DATA_FILE)) return { ips: [] };
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/count', (req, res) => {
  const data = load();
  res.json({ count: data.ips.length });
});

app.post('/api/visit', (req, res) => {
  const ip = req.body.ip;
  if (!ip) return res.status(400).json({ error: 'No IP' });

  const data = load();
  if (!data.ips.includes(ip)) {
    data.ips.push(ip);
    save(data);
  }

  res.json({ count: data.ips.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running'));
