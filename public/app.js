/* ================= YK LearnHub client ================= */
const $ = s => document.querySelector(s);

let playlists = [];
let progress = {};
let musicUrls = { pause: null, distraction: null };
let currentPlaylist = null;   // { id, title }
let currentVideos = [];
let currentVideo = null;      // { file, title, ... }

/* ---------------- tabs ---------------- */
document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tabpage').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  };
});

/* ---------------- helpers ---------------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 3200);
}
function fmtTime(s) {
  if (!s || !isFinite(s)) return '—';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
function fmtSize(bytes) {
  return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2) + ' GB'
       : bytes >= 1048576 ? Math.round(bytes / 1048576) + ' MB'
       : Math.round(bytes / 1024) + ' KB';
}
function keyOf(playlistId, file) { return playlistId + '/' + file; }
async function api(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

/* =========================================================
   MUSIC ENGINE  (LOUD 🔊)
   - your files from music\pause\ and music\distraction\
   - built-in loud synth melody as fallback
   ========================================================= */
const pauseAudio = new Audio();
const distractionAudio = new Audio();
pauseAudio.loop = true;
distractionAudio.loop = true;
pauseAudio.volume = 1.0;
distractionAudio.volume = 1.0;

let audioCtx = null;
let synthTimer = null;
function synthStart(kind) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    synthStop();
    const chill = [261.6, 329.6, 392.0, 523.3, 392.0, 329.6];   // gentle arpeggio
    const alert = [659.3, 523.3, 659.3, 523.3, 784.0, 659.3];   // nagging "come back!"
    const notes = kind === 'pause' ? chill : alert;
    const tempo = kind === 'pause' ? 500 : 260;
    let i = 0;
    synthTimer = setInterval(() => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = kind === 'pause' ? 'triangle' : 'square';
      osc.frequency.value = notes[i++ % notes.length];
      gain.gain.setValueAtTime(kind === 'pause' ? 0.5 : 0.35, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + tempo / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + tempo / 1000);
    }, tempo);
  } catch (e) { /* audio unavailable */ }
}
function synthStop() {
  if (synthTimer) { clearInterval(synthTimer); synthTimer = null; }
}

/* Safari blocks programmatic audio until a real user tap "unlocks" it */
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch (e) {}
  [pauseAudio, distractionAudio].forEach(el => {
    if (!el.src) return;
    el.muted = true;
    el.play().then(() => { el.pause(); el.currentTime = 0; el.muted = false; })
      .catch(() => { el.muted = false; });
  });
}
document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });

function playMusic(kind) {
  stopMusic(); // never both at once
  const url = musicUrls[kind];
  const el = kind === 'pause' ? pauseAudio : distractionAudio;
  if (url) {
    if (!el.src.endsWith(encodeURI(url))) el.src = url;
    el.volume = 1.0;
    el.play().catch(() => synthStart(kind));
  } else {
    synthStart(kind);
  }
}
function stopMusic() {
  pauseAudio.pause();
  distractionAudio.pause();
  synthStop();
}

/* ---------- triggers: pause music + leave-tab music ---------- */
const video = $('#video');
let leftTab = false;

video.addEventListener('pause', () => {
  if (video.ended || video.seeking || !isPlayerOpen() || leftTab) return;
  playMusic('pause');
});
video.addEventListener('play', () => { if (!leftTab) stopMusic(); });
video.addEventListener('ended', () => stopMusic());

function onLeave() {
  if (!isPlayerOpen()) return;
  leftTab = true;
  playMusic('distraction');
}
function onReturn() {
  if (!leftTab) return;
  leftTab = false;
  stopMusic();
  if (isPlayerOpen() && video.paused && !video.ended) playMusic('pause');
}
document.addEventListener('visibilitychange', () => document.hidden ? onLeave() : onReturn());
window.addEventListener('blur', onLeave);
window.addEventListener('focus', onReturn);

/* =========================================================
   PLAYER + PROGRESS TRACKING
   ========================================================= */
function isPlayerOpen() { return !$('#player').classList.contains('hidden'); }

function openVideo(v, index) {
  currentVideo = v;
  $('#playerTitle').textContent = v.title;
  $('#playerBadge').textContent = `#${String(index + 1).padStart(2, '0')}`;
  $('#player').classList.remove('hidden');
  video.src = `/video/${encodeURIComponent(currentPlaylist.id)}/${encodeURIComponent(v.file)}`;
  const saved = progress[keyOf(currentPlaylist.id, v.file)];
  if (saved && saved.time > 3 && (saved.percent || 0) < 90) {
    // Safari ignores seeks before metadata is loaded — wait for it
    const seek = () => {
      video.currentTime = saved.time;
      toast(`Resumed from ${fmtTime(saved.time)}`);
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
  }
  video.play().catch(() => {});
}

function closePlayer() {
  saveProgress(true);
  stopMusic();
  leftTab = false;
  video.pause();
  video.removeAttribute('src');
  video.load();
  $('#player').classList.add('hidden');
  currentVideo = null;
  renderVideos();
  renderPlaylists();
}
$('#closePlayer').onclick = closePlayer;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && isPlayerOpen()) closePlayer(); });

let lastSave = 0;
let watchedSeconds = 0;
let lastTick = null;

video.addEventListener('timeupdate', () => {
  if (!currentVideo || !video.duration) return;
  const now = Date.now();
  if (lastTick && !video.paused) watchedSeconds += Math.min(2, (now - lastTick) / 1000);
  lastTick = now;
  if (now - lastSave > 5000) { lastSave = now; saveProgress(); }
});

function saveProgress(flush) {
  if (!currentVideo || !video.duration || !currentPlaylist) return;
  const key = keyOf(currentPlaylist.id, currentVideo.file);
  const percent = Math.min(100, Math.round((video.currentTime / video.duration) * 100));
  const prev = progress[key] || {};
  progress[key] = {
    ...prev,
    time: video.currentTime,
    duration: video.duration,
    percent: Math.max(prev.percent || 0, percent),
    completed: (prev.completed || percent >= 90)
  };
  api('/api/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, progress: progress[key] })
  });
  if (watchedSeconds >= 10 || (flush && watchedSeconds > 0)) {
    api('/api/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: Math.round(watchedSeconds) })
    }).then(loadStats);
    watchedSeconds = 0;
  }
}
window.addEventListener('beforeunload', () => saveProgress(true));

/* =========================================================
   PLAYLISTS VIEW
   ========================================================= */
function playlistStats(pl) {
  let pctSum = 0, done = 0;
  pl.videos.forEach(f => {
    const p = progress[keyOf(pl.id, f)] || {};
    pctSum += Math.min(100, p.percent || 0);
    if (p.completed) done++;
  });
  return { pct: pl.videos.length ? Math.round(pctSum / pl.videos.length) : 0, done };
}

function renderPlaylists() {
  const grid = $('#playlistGrid');
  grid.innerHTML = '';
  $('#emptyPlaylists').classList.toggle('hidden', playlists.length > 0);

  let overallSum = 0, overallCount = 0;
  playlists.forEach(pl => {
    const s = playlistStats(pl);
    overallSum += s.pct * pl.count; overallCount += pl.count;

    const card = document.createElement('div');
    card.className = 'card' + (s.pct >= 100 && pl.count ? ' watched-done' : '');
    card.innerHTML = `
      <div class="thumb">
        ${pl.cover ? `<img loading="lazy" src="${pl.cover}">` : `<div class="placeholder">YK</div>`}
        ${pl.count && s.done === pl.count ? '<div class="card-done">DONE</div>' : ''}
        <div class="play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></div>
      </div>
      <div class="card-body">
        <div class="card-title">${pl.title}</div>
        <div class="card-meta">
          <span>${pl.count} video${pl.count === 1 ? '' : 's'}</span>
          <span>${s.done}/${pl.count} done · ${s.pct}%</span>
        </div>
        <div class="card-bar"><div class="card-bar-fill" style="width:${s.pct}%"></div></div>
      </div>`;
    card.onclick = () => openPlaylist(pl);
    grid.appendChild(card);
  });

  const overall = overallCount ? Math.round(overallSum / overallCount) : 0;
  $('#courseBar').style.width = overall + '%';
  $('#courseProgressLabel').textContent = `${overall}% complete · ${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`;
  $('#ringLabel').textContent = overall + '%';
  $('#ringFill').style.strokeDashoffset = 327 - (327 * overall / 100);
}

/* =========================================================
   VIDEOS-INSIDE-PLAYLIST VIEW
   ========================================================= */
async function openPlaylist(pl) {
  currentPlaylist = pl;
  currentVideos = await api('/api/videos?playlist=' + encodeURIComponent(pl.id));
  $('#view-playlists').classList.add('hidden');
  $('#view-videos').classList.remove('hidden');
  $('#playlistTitle').textContent = pl.title;
  renderVideos();
  generateThumbs();
}
$('#backToPlaylists').onclick = async () => {
  $('#view-videos').classList.add('hidden');
  $('#view-playlists').classList.remove('hidden');
  currentPlaylist = null;
  playlists = await api('/api/playlists');
  renderPlaylists();
};

function renderVideos() {
  if (!currentPlaylist) return;
  const grid = $('#videoGrid');
  grid.innerHTML = '';

  let done = 0, pctSum = 0;
  currentVideos.forEach((v, i) => {
    const p = progress[keyOf(currentPlaylist.id, v.file)] || {};
    if (p.completed) done++;
    pctSum += Math.min(100, p.percent || 0);

    const card = document.createElement('div');
    card.className = 'card' + (p.completed ? ' watched-done' : '');
    card.innerHTML = `
      <div class="thumb">
        ${v.thumb ? `<img loading="lazy" src="${v.thumb}">` : `<div class="placeholder">YK</div>`}
        <div class="card-num">${String(i + 1).padStart(2, '0')}</div>
        ${p.completed ? '<div class="card-done">DONE</div>' : ''}
        <div class="play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></div>
      </div>
      <div class="card-body">
        <div class="card-title">${v.title}</div>
        <div class="card-meta">
          <span>${p.duration ? fmtTime(p.duration) : (v.sizeMB + ' MB')}</span>
          <span>${p.percent ? (p.completed ? 'completed' : p.percent + '% watched') : 'not started'}</span>
        </div>
        <div class="card-bar"><div class="card-bar-fill" style="width:${p.percent || 0}%"></div></div>
      </div>`;
    card.onclick = () => openVideo(v, i);
    grid.appendChild(card);
  });

  const total = currentVideos.length;
  const pct = total ? Math.round(pctSum / total) : 0;
  $('#playlistBar').style.width = pct + '%';
  $('#playlistProgressLabel').textContent = `${pct}% complete · ${done} / ${total} videos`;
}

/* ---------- auto-generate thumbnails (one time, saved to server) ---------- */
async function generateThumbs() {
  if (!currentPlaylist) return;
  const pl = currentPlaylist;
  for (const v of currentVideos) {
    if (v.thumb || currentPlaylist !== pl) continue;
    try {
      const url = await captureFrame(`/video/${encodeURIComponent(pl.id)}/${encodeURIComponent(v.file)}`);
      if (!url) continue;
      const r = await api('/api/thumb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlist: pl.id, file: v.file, dataUrl: url })
      });
      if (r.thumb) { v.thumb = r.thumb; if (currentPlaylist === pl) renderVideos(); }
    } catch (e) { /* skip */ }
  }
}
function captureFrame(src) {
  return new Promise(resolve => {
    const vid = document.createElement('video');
    vid.muted = true;
    vid.preload = 'metadata';
    vid.src = src;
    const bail = setTimeout(() => resolve(null), 20000);
    vid.onloadedmetadata = () => { vid.currentTime = Math.min(vid.duration * 0.25, 90); };
    vid.onseeked = () => {
      const c = document.createElement('canvas');
      c.width = 640; c.height = Math.round(640 * vid.videoHeight / vid.videoWidth) || 360;
      c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
      clearTimeout(bail);
      resolve(c.toDataURL('image/jpeg', 0.72));
      vid.src = '';
    };
    vid.onerror = () => { clearTimeout(bail); resolve(null); };
  });
}

/* =========================================================
   ADMIN — create playlist + upload GB videos
   ========================================================= */
function refreshUploadSelect(selectId) {
  const opts = playlists.length
    ? playlists.map(p => `<option value="${p.id}">${p.title}</option>`).join('')
    : '<option value="">— create a playlist first —</option>';
  const upload = $('#uploadPlaylist');
  const manage = $('#managePlaylist');
  // fill the "Add videos" dropdown first — it must update even if anything below fails
  if (upload) {
    const keep = selectId || upload.value;
    upload.innerHTML = opts;
    if (keep && playlists.some(p => p.id === keep)) upload.value = keep;
  }
  if (manage) {
    const keep = selectId || manage.value;
    manage.innerHTML = opts;
    if (keep && playlists.some(p => p.id === keep)) manage.value = keep;
    renderManage();
  }
}

/* ---------- manage: custom thumbnails + delete ---------- */
let pendingThumb = null; // { playlist, file }
let manageOpen = false;  // list stays hidden until asked for

$('#toggleManage').onclick = () => {
  manageOpen = !manageOpen;
  $('#toggleManage').textContent = manageOpen ? 'Hide videos' : 'Show videos';
  renderManage();
};

async function renderManage() {
  const playlist = $('#managePlaylist').value;
  const wrap = $('#manageList');
  if (!playlist || !manageOpen) { wrap.innerHTML = ''; return; }
  const vids = await api('/api/videos?playlist=' + encodeURIComponent(playlist));
  if ($('#managePlaylist').value !== playlist) return;
  wrap.innerHTML = vids.length ? '' : '<p class="dim">No videos in this playlist yet.</p>';
  vids.forEach(v => {
    const row = document.createElement('div');
    row.className = 'manage-item';
    row.innerHTML = `
      ${v.thumb ? `<img class="manage-thumb" src="${v.thumb}">` : '<div class="manage-thumb">YK</div>'}
      <div class="manage-info">
        <div class="nm">${v.title}</div>
        <div class="sz">${v.sizeMB} MB</div>
      </div>
      <button class="btn-ghost set-thumb">Set thumbnail</button>
      <button class="btn-ghost btn-danger del-video">Delete</button>`;
    row.querySelector('.set-thumb').onclick = () => {
      pendingThumb = { playlist, file: v.file };
      $('#thumbInput').click();
    };
    row.querySelector('.del-video').onclick = async () => {
      if (!confirm(`Delete "${v.title}"?\nThis permanently removes the file from the E: drive.`)) return;
      const r = await api(`/api/video?playlist=${encodeURIComponent(playlist)}&name=${encodeURIComponent(v.file)}`, { method: 'DELETE' });
      if (r.ok) {
        toast(`Deleted "${v.title}"`);
        playlists = await api('/api/playlists');
        refreshUploadSelect();
        renderPlaylists();
        if (currentPlaylist && currentPlaylist.id === playlist) {
          currentVideos = await api('/api/videos?playlist=' + encodeURIComponent(playlist));
          renderVideos();
        }
      } else toast('Delete failed');
    };
    wrap.appendChild(row);
  });
}
$('#managePlaylist').onchange = renderManage;

$('#thumbInput').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !pendingThumb) return;
  const dataUrl = await imageToJpeg(file);
  if (!dataUrl) return toast('Could not read that image');
  const r = await api('/api/thumb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlist: pendingThumb.playlist, file: pendingThumb.file, dataUrl })
  });
  pendingThumb = null;
  if (r.thumb) {
    toast('Thumbnail updated');
    playlists = await api('/api/playlists');
    renderPlaylists();
    renderManage();
    if (currentPlaylist) {
      currentVideos = await api('/api/videos?playlist=' + encodeURIComponent(currentPlaylist.id));
      renderVideos();
    }
  } else toast('Thumbnail failed');
};

function imageToJpeg(file) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale) || 640;
      c.height = Math.round(img.height * scale) || 360;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); resolve(null); };
    img.src = URL.createObjectURL(file);
  });
}

$('#deletePlaylistBtn').onclick = async () => {
  const playlist = $('#managePlaylist').value;
  if (!playlist) return;
  const pl = playlists.find(p => p.id === playlist);
  if (!confirm(`Delete playlist "${pl ? pl.title : playlist}" and ALL ${pl ? pl.count : ''} video(s) inside it?\nThis permanently removes the files from the E: drive.`)) return;
  playlists = await api('/api/playlist?name=' + encodeURIComponent(playlist), { method: 'DELETE' });
  refreshUploadSelect();
  renderPlaylists();
  if (currentPlaylist && currentPlaylist.id === playlist) $('#backToPlaylists').click();
  toast('Playlist deleted');
};

$('#createPlaylist').onclick = async () => {
  const name = $('#newPlaylistName').value.trim();
  if (!name) return toast('Type a playlist name first');
  const before = new Set(playlists.map(p => p.id));
  playlists = await api('/api/playlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  $('#newPlaylistName').value = '';
  const created = playlists.find(p => !before.has(p.id))
    || playlists.find(p => p.title.toLowerCase() === name.toLowerCase());
  refreshUploadSelect(created ? created.id : undefined);
  renderPlaylists();
  toast(`Playlist "${name}" created — selected in Add videos`);
};

$('#fileInput').onchange = async e => {
  const playlist = $('#uploadPlaylist').value;
  if (!playlist) return toast('Create/select a playlist first');
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) await uploadFile(playlist, f);
  playlists = await api('/api/playlists');
  refreshUploadSelect();
  renderPlaylists();
};

function uploadFile(playlist, file) {
  return new Promise(resolve => {
    const item = document.createElement('div');
    item.className = 'up-item';
    item.innerHTML = `
      <div class="up-name"><span>${file.name}</span><span class="st">0% · ${fmtSize(file.size)}</span></div>
      <div class="up-bar"><div class="up-bar-fill"></div></div>`;
    $('#uploadQueue').prepend(item);
    const st = item.querySelector('.st');
    const bar = item.querySelector('.up-bar-fill');
    const started = Date.now();

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?playlist=${encodeURIComponent(playlist)}&name=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = ev => {
      if (!ev.lengthComputable) return;
      const pct = Math.round(ev.loaded / ev.total * 100);
      const speed = ev.loaded / ((Date.now() - started) / 1000);
      bar.style.width = pct + '%';
      st.textContent = `${pct}% · ${fmtSize(ev.loaded)} / ${fmtSize(ev.total)} · ${fmtSize(speed)}/s`;
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        item.classList.add('done');
        bar.style.width = '100%';
        st.textContent = `Added · ${fmtSize(file.size)}`;
        setTimeout(() => item.remove(), 4000); // clear finished uploads
      } else {
        item.classList.add('error');
        st.textContent = 'Failed: ' + xhr.responseText.slice(0, 80);
      }
      resolve();
    };
    xhr.onerror = () => { item.classList.add('error'); st.textContent = 'Upload failed'; resolve(); };
    xhr.send(file);
  });
}

/* ---------- Face ID + login sessions (admin) ---------- */
async function loadSessions() {
  const el = $('#sessionsList');
  if (!el) return;
  const r = await api('/api/sessions');
  $('#sessionsFolder').textContent = 'log folder: data\\' + r.folder;
  el.innerHTML = r.sessions.length ? '' : '<p class="dim">No logins recorded yet.</p>';
  r.sessions.forEach(s => {
    const row = document.createElement('div');
    row.className = 'session-item';
    row.innerHTML = `
      <span class="ev">${s.event === 'enrolled' ? 'Face enrolled' : 'Face login'}</span>
      <span class="dim">${s.distance != null ? 'match ' + s.distance : ''}</span>
      <span>${new Date(s.time).toLocaleString()}</span>`;
    el.appendChild(row);
  });
}
const resetFaceBtn = $('#resetFace');
if (resetFaceBtn) resetFaceBtn.onclick = async () => {
  if (!confirm('Reset Face ID?\nNext launch will ask you to register your face again.')) return;
  await api('/api/face', { method: 'DELETE' });
  toast('Face ID reset — re-register on next launch');
};

/* =========================================================
   UPDATES
   ========================================================= */
function renderUpdates(list) {
  const wrap = $('#updatesList');
  wrap.innerHTML = list.length ? '' : '<p class="dim">No updates yet. Write your first one above.</p>';
  list.forEach(u => {
    const el = document.createElement('div');
    el.className = 'update-item';
    el.innerHTML = `
      <button class="update-del" title="delete">&times;</button>
      <p></p>
      <time>${new Date(u.date).toLocaleString()}</time>`;
    el.querySelector('p').textContent = u.text;
    el.querySelector('.update-del').onclick = async () => {
      renderUpdates(await api('/api/updates?id=' + u.id, { method: 'DELETE' }));
    };
    wrap.appendChild(el);
  });
}
$('#addUpdate').onclick = async () => {
  const text = $('#updateText').value.trim();
  if (!text) return;
  $('#updateText').value = '';
  renderUpdates(await api('/api/updates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }));
  toast('Update posted');
};

/* =========================================================
   STATS (today + streak)
   ========================================================= */
async function loadStats() {
  const stats = await api('/api/stats');
  const days = stats.days || {};
  const today = new Date().toISOString().slice(0, 10);
  const secs = days[today] || 0;
  $('#todayTime').textContent = secs >= 3600
    ? `${(secs / 3600).toFixed(1)}h` : `${Math.round(secs / 60)}m`;
  let streak = 0;
  const d = new Date();
  if (!days[today] || days[today] < 60) d.setDate(d.getDate() - 1);
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if ((days[key] || 0) >= 60) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  $('#streak').textContent = streak;
}

/* =========================================================
   INIT
   ========================================================= */
(async function init() {
  [playlists, progress, musicUrls] = await Promise.all([
    api('/api/playlists'), api('/api/progress'), api('/api/music')
  ]);
  // preload music files so Safari's unlock-on-first-tap can prime them
  if (musicUrls.pause) pauseAudio.src = musicUrls.pause;
  if (musicUrls.distraction) distractionAudio.src = musicUrls.distraction;
  renderPlaylists();
  refreshUploadSelect();
  renderUpdates(await api('/api/updates'));
  loadStats();
  loadSessions();
})();
