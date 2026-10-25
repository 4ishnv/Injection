const HUE = 335; // 0 red, 30 orange, 60 yellow, 140 green, 185 cyan, 220 blue, 270 purple, 335 pink
const LRC_OFFSET = 0; // seconds. Raise it if lyrics appear too early, lower it if too late.
const $ = s => document.querySelector(s);
const audio = $('#audio'), track = $('#track'), lyricsBox = $('#lyrics'), canvas = $('#orb'), ctx = canvas.getContext('2d');
let ac, an, data, lines = [], els = [], cur = -2, bass = 0;
let queue = [], now = -1, shuffle = false, objUrl = null;

/* ---------- audio ---------- */
function setupAudio(){
  if (ac) return;
  ac = new AudioContext();
  const src = ac.createMediaElementSource(audio);
  an = ac.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = .82;
  src.connect(an); an.connect(ac.destination);
  data = new Uint8Array(an.frequencyBinCount);
}
/* ---------- saved library (IndexedDB) ---------- */
let db;
function openDB(){
  return new Promise((res, rej) => {
    const r = indexedDB.open('afterglow', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('songs', {keyPath: 'id', autoIncrement: true});
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const store = mode => db.transaction('songs', mode).objectStore('songs');
const dbAll = () => new Promise(res => {
  try { const r = store('readonly').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); } catch (e){ res([]); }
});
function dbPut(t){ // saves or updates one song (file, lyrics and all)
  return new Promise(res => {
    try {
      const rec = {name: t.name, q: t.q, file: t.file, lines: t.lines, status: t.status};
      if (t.id != null) rec.id = t.id;
      const r = store('readwrite').put(rec);
      r.onsuccess = () => { t.id = r.result; res(); };
      r.onerror = () => res();
    } catch (e){ res(); }
  });
}
const dbDel = id => new Promise(res => {
  try { const r = store('readwrite').delete(id); r.onsuccess = r.onerror = () => res(); } catch (e){ res(); }
});

/* ---------- playlist ---------- */
function addFiles(files){
  const before = queue.length;
  for (const f of files){
    if (!f.type.startsWith('audio/')) continue;
    const name = f.name.replace(/\.[^.]+$/, '');
    if (queue.some(x => x.name === name && x.file.size === f.size)) continue; // already in the library
    const t = {file: f, name, lines: null, status: '',
      q: name.replace(/_+/g, ' ').replace(/[\(\[].*?[\)\]]/g, '').replace(/\s+/g, ' ').trim()};
    queue.push(t); t.saved = dbPut(t);
  }
  if (queue.length - before > 1){ $('#list').classList.add('open'); $('#showList').classList.add('active'); }
  if (queue.length > before && now < 0) playAt(before); else renderList();
}
function playAt(i){
  if (i < 0 || i >= queue.length) return;
  setupAudio(); ac.resume();
  now = i; const t = queue[i];
  if (objUrl) URL.revokeObjectURL(objUrl);
  objUrl = URL.createObjectURL(t.file);
  audio.src = objUrl;
  $('#title').textContent = t.name;
  $('#q').value = t.q;
  audio.play();
  if (t.lines){ setLyrics(t.lines); $('#status').textContent = t.status; }
  else { setLyrics([{t:-1, text:'♪'}]); findLyrics(); }
  renderList();
}
function step(d){
  if (!queue.length) return;
  if (d < 0 && audio.currentTime > 3){ audio.currentTime = 0; return; }
  let i;
  if (shuffle && queue.length > 1){ do { i = Math.floor(Math.random() * queue.length); } while (i === now); }
  else i = (now + d + queue.length) % queue.length;
  playAt(i);
}
function removeAt(i){
  const gone = queue.splice(i, 1)[0];
  (gone.saved || Promise.resolve()).then(() => gone.id != null && dbDel(gone.id));
  if (i < now) now--;
  else if (i === now){
    now = -1; audio.pause(); audio.removeAttribute('src'); audio.load();
    $('#title').textContent = 'No song loaded';
    setLyrics([{t:-1, text:'Play a song and lyrics will show up here'}]);
    if (queue.length){ playAt(Math.min(i, queue.length - 1)); return; }
  }
  renderList();
}
function renderList(){
  const L = $('#list'); L.innerHTML = '';
  if (!queue.length){ const p = document.createElement('p'); p.textContent = 'Your queue is empty. Use “Add songs” or drop audio files on the page.'; L.appendChild(p); return; }
  queue.forEach((t, i) => {
    const d = document.createElement('div'); d.className = 'item' + (i === now ? ' now' : ''); d.tabIndex = 0;
    const s = document.createElement('span'); s.textContent = t.name;
    const x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', 'Remove ' + t.name);
    x.onclick = e => { e.stopPropagation(); removeAt(i); };
    d.onclick = () => playAt(i);
    d.onkeydown = e => { if (e.key === 'Enter') playAt(i); };
    d.append(s, x); L.appendChild(d);
  });
}

/* ---------- lyrics ---------- */
function parseLRC(text){
  const out = [];
  for (const raw of text.split(/\r?\n/)){
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim() || '♪';
    for (const m of stamps) out.push({t: +m[1] * 60 + +m[2], text: words});
  }
  return out.sort((a, b) => a.t - b.t);
}
function setLyrics(arr){
  lines = arr; cur = -2; track.innerHTML = ''; els = [];
  for (const l of lines){ const d = document.createElement('div'); d.className = 'line'; d.textContent = l.text; track.appendChild(d); els.push(d); }
}
async function findLyrics(){
  const q = $('#q').value.trim(), t = queue[now]; if (!q) return;
  $('#status').textContent = 'Searching for lyrics…';
  try {
    const r = await (await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(q))).json();
    if (queue[now] !== t) return; // skipped to another song meanwhile
    const hit = r.find(x => x.syncedLyrics);
    if (hit){
      t.lines = parseLRC(hit.syncedLyrics); t.status = 'Lyrics: ' + hit.artistName + ' – ' + hit.trackName;
      setLyrics(t.lines); $('#status').textContent = t.status; dbPut(t);
    } else $('#status').textContent = 'No synced lyrics found. Edit the search or open an .lrc file.';
  } catch (e){ if (queue[now] === t) $('#status').textContent = 'Couldn’t reach the lyrics service. You can open an .lrc file instead.'; }
}
async function applyLRC(f){
  const l = parseLRC(await f.text()); setLyrics(l);
  const t = queue[now]; if (t){ t.lines = l; t.status = 'Lyrics loaded from ' + f.name; dbPut(t); }
  $('#status').textContent = 'Lyrics loaded from ' + f.name;
}
function syncLyrics(){
  if (!lines.length) return;
  const t = audio.currentTime + LRC_OFFSET;
  let idx = -1;
  for (let i = 0; i < lines.length && lines[i].t <= t; i++) idx = i;
  if (idx === cur) return;
  cur = idx;
  const focus = Math.max(idx, 0);
  els.forEach((el, i) => {
    el.className = 'line' + (i === idx ? ' on' : Math.abs(i - idx) === 1 ? ' near' : '');
  });
  const el = els[focus];
  track.style.transform = `translateY(${lyricsBox.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2)}px)`;
}

/* ---------- orb ---------- */
function sample(i){
  const lo = Math.floor(i), f = i - lo;
  return ((data[lo] || 0) * (1 - f) + (data[lo + 1] || 0) * f) / 255;
}
function draw(now){
  const dpr = devicePixelRatio || 1, w = innerWidth, h = innerHeight;
  if (canvas.width !== w * dpr){ canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const playing = an && !audio.paused;
  if (playing) an.getByteFrequencyData(data);
  let b = 0;
  if (playing){ for (let i = 1; i < 8; i++) b += data[i]; b = b / 7 / 255; }
  bass += (b - bass) * .2;

  const cx = w / 2, cy = h * .46, base = Math.min(w, h) * .27 * (1 + bass * .1), N = 200;
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 8; k++){
    ctx.beginPath();
    for (let j = 0; j <= N; j++){
      const a = j / N * Math.PI * 2, u = Math.abs(j / N * 2 - 1);
      const v = playing ? sample(1 + u * 44) : .12 + .06 * Math.sin(now / 900 + u * 6);
      const wob = Math.sin(a * 3 + now * .0006 * (1 + k * .1) + k) * .035 + Math.sin(a * 5 - now * .0004 + k * 2) * .02;
      const r = base * (1 + wob + v * .38 * (.5 + k / 8)) + k * 4;
      const x = cx + Math.cos(a - Math.PI / 2) * r, y = cy + Math.sin(a - Math.PI / 2) * r;
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsla(${HUE + k * 3}, 100%, ${72 + k * 2}%, ${.6 - k * .05})`;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = `hsl(${HUE}, 100%, 70%)`; ctx.shadowBlur = 14 + bass * 30;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  syncLyrics();
  if (!seeking){ $('#seek').max = audio.duration || 100; $('#seek').value = audio.currentTime; }
  $('#cur').textContent = fmt(audio.currentTime); $('#dur').textContent = fmt(audio.duration);
  requestAnimationFrame(draw);
}

/* ---------- controls ---------- */
let seeking = false;
const fmt = s => isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00';
const toggle = () => { if (!audio.src) return queue.length ? playAt(Math.max(now, 0)) : $('#songFile').click(); ac && ac.resume(); audio.paused ? audio.play() : audio.pause(); };
audio.onplay = audio.onpause = () => $('#ico').setAttribute('d', audio.paused ? 'M8 5v14l11-7z' : 'M7 5h4v14H7zM13 5h4v14h-4z');
$('#play').onclick = toggle;
$('#seek').oninput = e => { seeking = true; audio.currentTime = e.target.value; };
$('#seek').onchange = () => seeking = false;
$('#songFile').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('#lrcFile').onchange = e => { if (e.target.files[0]) applyLRC(e.target.files[0]); e.target.value = ''; };
$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
$('#shuf').onclick = e => { shuffle = !shuffle; e.currentTarget.classList.toggle('active', shuffle); e.currentTarget.setAttribute('aria-pressed', shuffle); };
$('#showList').onclick = e => { const o = $('#list').classList.toggle('open'); e.currentTarget.classList.toggle('active', o); };
audio.onended = () => step(1);
$('#find').onclick = findLyrics;
$('#q').onkeydown = e => e.key === 'Enter' && findLyrics();
document.querySelectorAll('label.btn').forEach(l => l.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), l.querySelector('input').click()));
addEventListener('keydown', e => { if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); toggle(); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  addFiles(files);
  const lrc = files.find(f => /\.(lrc|txt)$/i.test(f.name)); if (lrc) applyLRC(lrc);
});
addEventListener('resize', () => { cur = -2; });

setLyrics([{t:-1, text:'Play a song and lyrics will show up here'}]);
renderList();
(async () => {
  try {
    db = await openDB();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); // ask the browser not to auto-delete
    const saved = await dbAll();
    saved.forEach(r => queue.push(r));
    renderList();
    if (saved.length) $('#status').textContent = saved.length + ' saved song' + (saved.length > 1 ? 's' : '') + '. Press play or pick one from the playlist.';
  } catch (e){ $('#status').textContent = 'Saving songs isn’t available here, so the playlist will clear on refresh.'; }
})();
requestAnimationFrame(draw);