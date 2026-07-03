// LearnHub — Yuvraj's personal learning platform server (zero dependencies)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 4321;
const VIDEO_ROOT = path.join(ROOT, 'videos');
const THUMB_DIR = path.join(ROOT, 'thumbs');
const MUSIC_DIR = path.join(ROOT, 'music');
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');

// self-bootstrap: a fresh clone creates its own folders
[DATA_DIR, THUMB_DIR, VIDEO_ROOT, path.join(MUSIC_DIR, 'pause'), path.join(MUSIC_DIR, 'distraction')]
  .forEach(d => fs.mkdirSync(d, { recursive: true }));

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.ogg', '.wav', '.aac', '.opus']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.aac': 'audio/aac', '.opus': 'audio/opus', '.ico': 'image/x-icon'
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
function safeName(name) {
  return path.basename(String(name || '')).replace(/[<>:"|?*\x00-\x1f]/g, '').trim();
}
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
function pretty(name) {
  return name.replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\b(Ml|Ai|Sql|Nlp|Api)\b/g, s => s.toUpperCase()).trim();
}
function thumbName(playlist, file) {
  return (playlist + '__' + file).replace(/\.[^.]+$/, '') + '.jpg';
}

function listPlaylists() {
  if (!fs.existsSync(VIDEO_ROOT)) return [];
  return fs.readdirSync(VIDEO_ROOT)
    .filter(d => fs.statSync(path.join(VIDEO_ROOT, d)).isDirectory())
    .sort(naturalSort)
    .map(d => {
      const vids = listVideos(d);
      return {
        id: d,
        title: pretty(d),
        count: vids.length,
        cover: vids.find(v => v.thumb) ? vids.find(v => v.thumb).thumb : null,
        videos: vids.map(v => v.file)
      };
    });
}

function listVideos(playlist) {
  const dir = path.join(VIDEO_ROOT, safeName(playlist));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .sort(naturalSort)
    .map(f => {
      const st = fs.statSync(path.join(dir, f));
      const t = thumbName(playlist, f);
      const tPath = path.join(THUMB_DIR, t);
      return {
        file: f,
        title: f.replace(/\.[^.]+$/, '').replace(/[_.]+/g, ' ').trim(),
        sizeMB: Math.round(st.size / 1048576),
        thumb: fs.existsSync(tPath)
          ? '/thumbs/' + encodeURIComponent(t) + '?v=' + Math.round(fs.statSync(tPath).mtimeMs)
          : null
      };
    });
}

function firstAudio(dir) {
  try {
    const f = fs.readdirSync(dir).filter(x => AUDIO_EXT.has(path.extname(x).toLowerCase())).sort()[0];
    return f || null;
  } catch { return null; }
}

function streamFile(req, res, filePath, extraHeaders = {}) {
  const stat = fs.statSync(filePath);
  const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m[1] ? parseInt(m[1]) : 0;
    let end = m[2] ? parseInt(m[2]) : stat.size - 1;
    if (isNaN(start) || start >= stat.size) start = 0;
    if (isNaN(end) || end >= stat.size) end = stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime,
      ...extraHeaders
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes', ...extraHeaders });
    fs.createReadStream(filePath).pipe(res);
  }
}

function body(req) {
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 20 * 1048576) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// ---- face auth + session logging ----
const FACE_FILE = path.join(DATA_DIR, 'face.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const FACE_THRESHOLD = 0.5;

function sessionsDir() {
  const cfg = readJson(CONFIG_FILE, {});
  if (!cfg.sessionsFolder) {
    cfg.sessionsFolder = 'sessions-' + require('crypto').randomBytes(4).toString('hex');
    writeJson(CONFIG_FILE, cfg);
  }
  const dir = path.join(DATA_DIR, cfg.sessionsFolder);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function faceDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

function logSession(entry) {
  const dir = sessionsDir();
  const file = path.join(dir, 'login-' + Date.now() + '-' + require('crypto').randomBytes(3).toString('hex') + '.json');
  writeJson(file, entry);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);

    // ---- face auth ----
    if (p === '/api/face' && req.method === 'GET')
      return json(res, { enrolled: fs.existsSync(FACE_FILE) });

    if (p === '/api/face' && req.method === 'DELETE') {
      try { fs.unlinkSync(FACE_FILE); } catch {}
      return json(res, { ok: true });
    }

    if (p === '/api/face/enroll' && req.method === 'POST') {
      const { descriptors } = JSON.parse(await body(req));
      if (!Array.isArray(descriptors) || !descriptors.length ||
          !descriptors.every(d => Array.isArray(d) && d.length === 128 && d.every(n => typeof n === 'number')))
        return json(res, { error: 'bad descriptors' }, 400);
      writeJson(FACE_FILE, { descriptors, enrolledAt: new Date().toISOString() });
      logSession({ time: new Date().toISOString(), event: 'enrolled', ua: req.headers['user-agent'] || '' });
      return json(res, { ok: true });
    }

    if (p === '/api/face/login' && req.method === 'POST') {
      const { descriptor } = JSON.parse(await body(req));
      const face = readJson(FACE_FILE, null);
      if (!face) return json(res, { error: 'not enrolled' }, 400);
      if (!Array.isArray(descriptor) || descriptor.length !== 128)
        return json(res, { error: 'bad descriptor' }, 400);
      let best = Infinity;
      for (const d of face.descriptors) best = Math.min(best, faceDistance(d, descriptor));
      const ok = best <= FACE_THRESHOLD;
      if (ok) logSession({ time: new Date().toISOString(), event: 'login', distance: Number(best.toFixed(3)), ua: req.headers['user-agent'] || '' });
      return json(res, { ok, distance: Number(best.toFixed(3)) });
    }

    if (p === '/api/sessions' && req.method === 'GET') {
      const dir = sessionsDir();
      const sessions = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
        .map(f => readJson(path.join(dir, f), null)).filter(Boolean)
        .sort((a, b) => (b.time || '').localeCompare(a.time || '')).slice(0, 50);
      return json(res, { folder: path.basename(dir), sessions });
    }

    // ---- API ----
    if (p === '/api/playlists') return json(res, listPlaylists());

    if (p === '/api/videos') return json(res, listVideos(url.searchParams.get('playlist') || ''));

    if (p === '/api/playlist' && req.method === 'POST') {
      const { name } = JSON.parse(await body(req));
      const clean = safeName(name).replace(/[\\/]/g, '');
      if (!clean) return json(res, { error: 'invalid name' }, 400);
      fs.mkdirSync(path.join(VIDEO_ROOT, clean), { recursive: true });
      return json(res, listPlaylists());
    }

    if (p === '/api/playlist' && req.method === 'DELETE') {
      const name = safeName(url.searchParams.get('name'));
      const dir = path.join(VIDEO_ROOT, name);
      if (!name || !fs.existsSync(dir)) return json(res, { error: 'not found' }, 404);
      fs.rmSync(dir, { recursive: true, force: true });
      try {
        fs.readdirSync(THUMB_DIR).filter(t => t.startsWith(name + '__'))
          .forEach(t => { try { fs.unlinkSync(path.join(THUMB_DIR, t)); } catch {} });
      } catch {}
      const pf = path.join(DATA_DIR, 'progress.json');
      const all = readJson(pf, {});
      Object.keys(all).forEach(k => { if (k.startsWith(name + '/')) delete all[k]; });
      writeJson(pf, all);
      return json(res, listPlaylists());
    }

    if (p === '/api/video' && req.method === 'DELETE') {
      const playlist = safeName(url.searchParams.get('playlist'));
      const name = safeName(url.searchParams.get('name'));
      const f = path.join(VIDEO_ROOT, playlist, name);
      if (!playlist || !name || !fs.existsSync(f)) return json(res, { error: 'not found' }, 404);
      fs.unlinkSync(f);
      try { fs.unlinkSync(path.join(THUMB_DIR, thumbName(playlist, name))); } catch {}
      const pf = path.join(DATA_DIR, 'progress.json');
      const all = readJson(pf, {});
      delete all[playlist + '/' + name];
      writeJson(pf, all);
      return json(res, { ok: true });
    }

    // ---- BIG upload: raw body streamed straight to disk, no size limit ----
    if (p === '/api/upload' && req.method === 'POST') {
      const playlist = safeName(url.searchParams.get('playlist'));
      const name = safeName(url.searchParams.get('name'));
      const dir = path.join(VIDEO_ROOT, playlist);
      if (!playlist || !fs.existsSync(dir)) return json(res, { error: 'playlist not found' }, 400);
      if (!name || !VIDEO_EXT.has(path.extname(name).toLowerCase()))
        return json(res, { error: 'not a video file' }, 400);
      const finalPath = path.join(dir, name);
      const tmpPath = finalPath + '.part';
      const ws = fs.createWriteStream(tmpPath);
      req.pipe(ws);
      let failed = false;
      const cleanup = () => { try { ws.destroy(); fs.unlinkSync(tmpPath); } catch {} };
      req.on('aborted', () => { failed = true; cleanup(); });
      ws.on('error', () => { failed = true; cleanup(); json(res, { error: 'write failed' }, 500); });
      ws.on('finish', () => {
        if (failed) return;
        try {
          if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
          fs.renameSync(tmpPath, finalPath);
          json(res, { ok: true, file: name });
        } catch (e) { json(res, { error: e.message }, 500); }
      });
      return;
    }

    if (p === '/api/progress' && req.method === 'GET')
      return json(res, readJson(path.join(DATA_DIR, 'progress.json'), {}));

    if (p === '/api/progress' && req.method === 'POST') {
      const data = JSON.parse(await body(req));
      const file = path.join(DATA_DIR, 'progress.json');
      const all = readJson(file, {});
      all[data.key] = { ...(all[data.key] || {}), ...data.progress, updatedAt: new Date().toISOString() };
      writeJson(file, all);
      return json(res, { ok: true });
    }

    if (p === '/api/stats' && req.method === 'GET')
      return json(res, readJson(path.join(DATA_DIR, 'stats.json'), { days: {} }));

    if (p === '/api/stats' && req.method === 'POST') {
      const { seconds } = JSON.parse(await body(req));
      const file = path.join(DATA_DIR, 'stats.json');
      const stats = readJson(file, { days: {} });
      const today = new Date().toISOString().slice(0, 10);
      stats.days[today] = (stats.days[today] || 0) + (Number(seconds) || 0);
      writeJson(file, stats);
      return json(res, { ok: true });
    }

    if (p === '/api/updates' && req.method === 'GET')
      return json(res, readJson(path.join(DATA_DIR, 'updates.json'), []));

    if (p === '/api/updates' && req.method === 'POST') {
      const { text } = JSON.parse(await body(req));
      const file = path.join(DATA_DIR, 'updates.json');
      const updates = readJson(file, []);
      updates.unshift({ id: Date.now(), text: String(text).slice(0, 2000), date: new Date().toISOString() });
      writeJson(file, updates);
      return json(res, updates);
    }

    if (p === '/api/updates' && req.method === 'DELETE') {
      const id = Number(url.searchParams.get('id'));
      const file = path.join(DATA_DIR, 'updates.json');
      const updates = readJson(file, []).filter(u => u.id !== id);
      writeJson(file, updates);
      return json(res, updates);
    }

    if (p === '/api/thumb' && req.method === 'POST') {
      const { playlist, file, dataUrl } = JSON.parse(await body(req));
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl || '');
      if (!m) return json(res, { error: 'bad image' }, 400);
      const name = thumbName(safeName(playlist), safeName(file));
      fs.writeFileSync(path.join(THUMB_DIR, name), Buffer.from(m[1], 'base64'));
      return json(res, { thumb: '/thumbs/' + encodeURIComponent(name) });
    }

    if (p === '/api/music') {
      const pause = firstAudio(path.join(MUSIC_DIR, 'pause'));
      const distraction = firstAudio(path.join(MUSIC_DIR, 'distraction'));
      return json(res, {
        pause: pause ? '/music/pause/' + encodeURIComponent(pause) : null,
        distraction: distraction ? '/music/distraction/' + encodeURIComponent(distraction) : null
      });
    }

    // ---- media ----
    if (p.startsWith('/video/')) {
      const parts = p.slice(7).split('/');
      const f = path.join(VIDEO_ROOT, safeName(parts[0]), safeName(parts[1] || ''));
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('not found'); }
      return streamFile(req, res, f);
    }
    if (p.startsWith('/thumbs/')) {
      const f = path.join(THUMB_DIR, safeName(p.slice(8)));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
      return streamFile(req, res, f);
    }
    if (p.startsWith('/music/pause/') || p.startsWith('/music/distraction/')) {
      const sub = p.startsWith('/music/pause/') ? 'pause' : 'distraction';
      const f = path.join(MUSIC_DIR, sub, safeName(p.split('/').pop()));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
      return streamFile(req, res, f);
    }

    // ---- static ----
    let staticPath = p === '/' ? '/index.html' : p;
    const f = path.join(PUBLIC_DIR, path.normalize(staticPath).replace(/^([\\/.]+)/, ''));
    if (f.startsWith(PUBLIC_DIR) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      // never cache app files — UI updates must always load
      return streamFile(req, res, f, { 'Cache-Control': 'no-store' });
    }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    try {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    } catch {}
  }
});

server.listen(PORT, () => {
  console.log(`\n  LearnHub running →  http://localhost:${PORT}\n`);
  console.log(`  Playlists live in:           ${VIDEO_ROOT}`);
  console.log(`  Pause music file in:         ${path.join(MUSIC_DIR, 'pause')}`);
  console.log(`  Distraction music file in:   ${path.join(MUSIC_DIR, 'distraction')}\n`);
});
