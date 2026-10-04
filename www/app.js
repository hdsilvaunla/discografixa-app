/* =========================================================================
   DISCOGRAFÍA v7.0.10 — Colección profesional de CDs (DESKTOP + TAURI)
   Autor: HDSystem IT · Tel: +54 9 11 4563-0851

   v7.0.10: SUBCATEGORÍAS
   v7.0.10-tauri: Compatibilidad con .exe de Tauri
     - FileSystemDefault detecta navegador vs Tauri automáticamente
     - En Tauri usa window.__DISCO_FS__ (plugin dialog + comandos Rust)
     - BarcodeScanner: BarcodeDetector nativo + fallback html5-qrcode
     - Streaming y <a target=_blank>: parcheados desde Rust en el .exe
   ========================================================================= */

const APP_VERSION = "7.0.10";
const STORAGE_KEY = 'discografia_db_v3';
const NOTFOUND_KEY = 'discografia_notfound_v1';
const OWNER_KEY = 'discografia_owner_v1';
const METACACHE_KEY = 'discografia_metacache_v1';
const CUSTOMFIELDS_KEY = 'discografia_custom_fields_v1';
const HISTORY_KEY = 'discografia_history_v1';
const THEME_KEY = 'discografia_theme_v1';
const UNDO_LIMIT = 30;
const MB_API = 'https://musicbrainz.org/ws/2/';
const DISCOGS_API = 'https://api.discogs.com';
const DISCOGS_CONFIG_KEY = 'discografia_discogs_config_v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MIN_CONFIDENCE = 90;
const ISRC_REGEX = /^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/;
const DEFAULT_AUTHOR = "HDSystem IT";
const DEFAULT_PHONE = "+54 9 11 4563-0851";
const COPYRIGHT_TEXT = "© 2024-" + new Date().getFullYear() + " HDSystem IT · Todos los derechos reservados";
const FETCH_TIMEOUT_MS = 8000;
const DISCOGS_TEST_TIMEOUT_MS = 25000;
const DISCOGS_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_CORS_PROXY = 'https://api.allorigins.win/raw?url=';

const RESOLVED_LINKS_KEY = 'discografia_resolved_links_v1';
const LEGAL_NOTICE_KEY = 'discografia_legal_accepted_v1';
const LEGAL_SIGNATURE_KEY = 'discografia_legal_signature_v1';
const RESOLVED_TTL = 30 * 24 * 3600000;
const RESOLVED_MAX = 500;

const ALLOWED_STREAM_DOMAINS = [
  'open.spotify.com',
  'music.youtube.com','youtube.com','youtu.be',
  'music.apple.com','itunes.apple.com',
  'deezer.com',
  'tidal.com',
  'music.amazon.com','amazon.com',
  'soundcloud.com',
  'discogs.com'
];

const isFileProtocol = () => location.protocol === 'file:';

function buildMBUserAgent(){
  let contact = '';
  try { const o = JSON.parse(localStorage.getItem(OWNER_KEY) || '{}'); contact = (o.email || o.contact || '').trim(); } catch(e){}
  if (!contact) contact = 'noreply@example.com';
  return `DiscografiaApp/${APP_VERSION} ( ${contact} )`;
}
let MB_USER_AGENT = buildMBUserAgent();

function isAlbumUrl(url, svcKey){
  if (!url) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase() + u.search.toLowerCase();
    switch(svcKey){
      case 'spotify':    return path.includes('/album/') && !path.includes('/track/') && !path.includes('/playlist/');
      case 'apple':      return path.includes('/album/');
      case 'deezer':     return path.includes('/album/') && !path.includes('/track/');
      case 'tidal':      return path.includes('/album/') && !path.includes('/track/');
      case 'youtube':    return path.includes('olak5uy') || path.includes('/browse/') || path.includes('/playlist');
      case 'amazon':     return path.includes('/albums/') && !path.includes('/tracks/');
      case 'soundcloud': return path.includes('/sets/');
      default: return true;
    }
  } catch(e){ return false; }
}

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function freeLocalStorageCaches(){
  const keysToDrop = [METACACHE_KEY, RESOLVED_LINKS_KEY, HISTORY_KEY, NOTFOUND_KEY];
  let freed = 0;
  for (const k of keysToDrop){
    try {
      const prev = localStorage.getItem(k);
      if (prev){ freed += prev.length; localStorage.removeItem(k); }
    } catch(e){}
  }
  try { if (typeof MetadataCache !== 'undefined' && MetadataCache.clear) MetadataCache.clear(); } catch(e){}
  try { if (typeof ResolvedLinks !== 'undefined' && ResolvedLinks.clear) ResolvedLinks.clear(); } catch(e){}
  try {
    const keep = new Set([STORAGE_KEY, DISCOGS_CONFIG_KEY, OWNER_KEY, 'discografia_legal_v1', 'discografia_theme_v1', 'discografia_folder_path_v1']);
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (k && k.startsWith('discografia_') && !keep.has(k) && k !== STORAGE_KEY) toRemove.push(k);
    }
    for (const k of toRemove){
      try {
        const prev = localStorage.getItem(k);
        if (prev) freed += prev.length;
        localStorage.removeItem(k);
      } catch(e){}
    }
  } catch(e){}
  return freed;
}
function isQuotaError(e){
  return !!(e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message||''))));
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s ?? '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const upper = v => (v === null || v === undefined) ? "" : String(v).toUpperCase();

const STREAMING_SERVICES = [
  { key:'spotify',   name:'Spotify',       icon:'🟢', pattern:/open\.spotify\.com/i,     color:'#1db954' },
  { key:'youtube',   name:'YouTube Music', icon:'🔴', pattern:/(music\.)?youtube\.com/i, color:'#ff0000' },
  { key:'apple',     name:'Apple Music',   icon:'🍎', pattern:/music\.apple\.com/i,      color:'#fa243c' },
  { key:'deezer',    name:'Deezer',        icon:'🎵', pattern:/deezer\.com/i,            color:'#a238ff' },
  { key:'tidal',     name:'Tidal',         icon:'🌊', pattern:/tidal\.com/i,             color:'#00d4ff' },
  { key:'amazon',    name:'Amazon Music',  icon:'📦', pattern:/music\.amazon\./i,        color:'#ff9900' },
  { key:'soundcloud',name:'SoundCloud',    icon:'☁️', pattern:/soundcloud\.com/i,        color:'#ff5500' },
  { key:'discogs',   name:'Discogs',       icon:'💿', pattern:/discogs\.com/i,           color:'#555555' }
];

function isAnyModalOpen(){
  const modals = ["#modal","#pasteModal","#catModal","#manualModal","#bulkEnrichModal","#notFoundModal","#discogsConfigModal","#ownerConfigModal","#bulkMoveModal","#viewModal","#folderConfigModal","#folderBrowserModal","#networkDiagModal","#autoBackupModal","#duplicatesModal","#customFieldsModal","#historyModal","#scannerModal","#loansModal","#exitModal","#albumConfirmModal","#legalModal"];
  return modals.some(sel => $(sel)?.classList.contains("open")) || !!$("#coverLightbox")?.classList.contains("open");
}

function highlight(texto, q){
  const t = esc(texto);
  if (!q) return t;
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return t;
  const accented = {'a':'[aàáâäãå]','e':'[eèéêë]','i':'[iìíîï]','o':'[oòóôöõ]','u':'[uùúûü]','n':'[nñ]','c':'[cç]','y':'[yýÿ]'};
  const buildPattern = term => term.split('').map(ch => { const low = ch.toLowerCase(); if (accented[low]) return accented[low]; return ch.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }).join('');
  const pattern = terms.map(buildPattern).join("|");
  try { return t.replace(new RegExp(`(${pattern})`,"ig"), "<mark>$1</mark>"); } catch { return t; }
}
function debounce(fn, ms=160){ let t; const w = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; w.cancel = () => { clearTimeout(t); t = null; }; return w; }
function download(filename, content, mime="application/json"){
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}
function timestamp(){ const d = new Date(), pad = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; }
function findRowByKey(key){ if (!key) return null; return $$("#tbodyCD tr").find(tr => tr.dataset.key === key) || null; }

function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS){
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(new DOMException(`Timeout after ${timeoutMs}ms`, 'TimeoutError')); }
    catch(_) { controller.abort(); }
  }, timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const _lastCallBySource = { MusicBrainz: 0, Discogs: 0 };
const _minDelayBySource = { MusicBrainz: 1000, Discogs: 1000 };
async function throttleSource(source){
  const minMs = _minDelayBySource[source] ?? 500;
  const now = Date.now();
  const wait = Math.max(0, minMs - (now - (_lastCallBySource[source] || 0)));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCallBySource[source] = Date.now();
}
let _mb503Until = 0, _discogs429Until = 0;

function umbralAdaptativo(a, b){
  const lenMin = Math.min(String(a||'').length, String(b||'').length);
  if (lenMin <= 4) return 0.95;
  if (lenMin <= 7) return 0.92;
  if (lenMin <= 12) return 0.88;
  return 0.85;
}

function stripParenthetical(s){
  return String(s||'').replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeYear(y){
  if (y === null || y === undefined || y === '') return null;
  const n = parseInt(String(y).slice(0, 4), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 1900 || n > 2100) return null;
  return n;
}

function esSoloOrtografia(a, b){
  const A = String(a||'').trim(), B = String(b||'').trim();
  if (!A || !B) return false;
  const an = normMatch(A), bn = normMatch(B);
  if (an === bn) return true;
  const ap = normMatch(stripParenthetical(A));
  const bp = normMatch(stripParenthetical(B));
  if (ap && bp && ap === bp) return true;
  const sim = similarity(A, B);
  const lenDiff = Math.abs(A.length - B.length);
  if (sim >= 0.90 && lenDiff <= 3) return true;
  return false;
}

function corregirCampo(valorActual, valorAPI, confianza, replace, umbralMin = 85){
  const cur = String(valorActual || '').trim();
  const api = String(valorAPI  || '').trim();
  if (!api) return null;
  if (Number(confianza) < umbralMin) return null;
  if (cur === api) return null;
  if (!cur) return api;
  if (esSoloOrtografia(cur, api)) return api;
  if (replace) return api;
  return null;
}

function confidenceChip(conf){
  const n = Number(conf) || 0;
  const color = n >= 90 ? 'var(--ok)' : n >= 75 ? 'var(--accent2)' : 'var(--warn)';
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:.68rem;font-weight:700;background:${color}22;color:${color};border:1px solid ${color}55">● ${n}%</span>`;
}

function limpiarTituloParaBusqueda(titulo){
  let t = String(titulo || '').trim();
  if (!t) return '';
  t = t.replace(/[*#]+/g, ' ');
  t = t.replace(/\.{2,}/g, ' ');
  const parts = t.split(/\s*\/\s*/);
  if (parts.length === 2 && normMatch(parts[0]) === normMatch(parts[1])) t = parts[0];
  t = t.replace(/\s*\(\s*(en\s+vivo|live)\s*\)\s*$/i, '').trim();
  t = t.replace(/\s+(CD|VOL|VOLUMEN|PARTE|DISC|DISCO)\s*#?\s*\d+\s*$/i, '').trim();
  t = t.replace(/\s+GIRA\s+/i, ' ').trim();
  t = t.replace(/\s+([AB])\s*$/i, (m) => {
    const sinLado = t.replace(/\s+([AB])\s*$/i, '').trim();
    return sinLado.length >= 5 ? '' : m;
  }).trim();
  return t.replace(/\s+/g, ' ').trim();
}

const TYPOS_INTERPRETES = {
  'soda estereo': 'Soda Stereo','soda estéreo': 'Soda Stereo','the beatle': 'The Beatles',
  'beatle': 'The Beatles','rolling stone': 'The Rolling Stones','led zeppelin': 'Led Zeppelin',
  'pink floid': 'Pink Floyd','ac dc': 'AC/DC','acdc': 'AC/DC','guns and roses': "Guns N' Roses",
  'gun n roses': "Guns N' Roses",'black sabath': 'Black Sabbath','charly garcia': 'Charly García',
  'charly garcía': 'Charly García','luis alberto spinetta': 'Luis Alberto Spinetta',
  'spinetta jade': 'Spinetta Jade','seru giran': 'Serú Girán','seru girá': 'Serú Girán',
  'fito paez': 'Fito Páez','fito páez': 'Fito Páez','enanos verdes': 'Enanitos Verdes',
  'los enanitos verdes': 'Enanitos Verdes','los fabulosos cadillacs': 'Los Fabulosos Cadillacs',
  'patricio rey': 'Patricio Rey y sus Redonditos de Ricota',
  'redonditos de ricota': 'Patricio Rey y sus Redonditos de Ricota'
};
function limpiarInterpreteParaBusqueda(interprete){
  let i = String(interprete || '').trim();
  if (!i) return '';
  i = i.replace(/[*#]+/g, ' ').trim();
  i = i.replace(/\s+/g, ' ').trim();
  const key = normMatch(i);
  if (TYPOS_INTERPRETES[key]) i = TYPOS_INTERPRETES[key];
  return i;
}

/* ═══════════════════════════════════════════════════════════════════
   Módulos base
   ═══════════════════════════════════════════════════════════════════ */

const ThemeManager = (() => {
  function load(){ try { const s = localStorage.getItem(THEME_KEY); if (s === 'light' || s === 'dark') return s; return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch(e){ return 'dark'; } }
  function apply(theme){
    document.body.classList.toggle('theme-light', theme === 'light');
    const btn = $('#themeToggle'); if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
  }
  function toggle(){
    const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch(e){}
    apply(next);
    Toast.show(next === 'light' ? '☀️ Tema claro' : '🌙 Tema oscuro', 'info', 1800);
  }
  function init(){ apply(load()); }
  return { init, toggle, apply };
})();

/* ═══════════════════════════════════════════════════════════════════
   FileSystemDefault — dual: navegador (File System Access API) + Tauri
   ═══════════════════════════════════════════════════════════════════ */
const FileSystemDefault = (() => {
  const DB_NAME = 'discografia_fs_v1', STORE = 'handles', HANDLE_KEY = 'defaultDir';
  const LS_PATH_KEY = 'discografia_folder_path_v1';

  let dirHandle = null;   // modo navegador
  let folderPath = null;  // modo Tauri
  let mode = 'browser';   // 'browser' | 'tauri' | 'unsupported'

  function detectMode(){
    try {
      if (window.__DISCO_FS__ && typeof window.__DISCO_FS__.isAvailable === 'function' && window.__DISCO_FS__.isAvailable()){
        return 'tauri';
      }
    } catch(e){}
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'showSaveFilePicker' in window){
      return 'browser';
    }
    return 'unsupported';
  }

  function openDB(){ return new Promise((res, rej) => { const req = indexedDB.open(DB_NAME, 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); }; req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
  async function idbPut(k, v){ const db = await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
  async function idbGet(k){ const db = await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const r = tx.objectStore(STORE).get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbDel(k){ const db = await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }

  async function ensurePermission(h, m = 'readwrite'){
    if (!h) return false;
    try {
      const o = { mode: m };
      if ((await h.queryPermission(o)) === 'granted') return true;
      if ((await h.requestPermission(o)) === 'granted') return true;
    } catch(e){ return false; }
    return false;
  }

  async function load(){
    mode = detectMode();
    if (mode === 'tauri'){
      try { folderPath = localStorage.getItem(LS_PATH_KEY) || null; } catch(e){ folderPath = null; }
      return;
    }
    if (mode === 'browser'){
      try {
        const h = await idbGet(HANDLE_KEY);
        if (h) dirHandle = h;
      } catch(e){ console.warn('FS load:', e); }
    }
  }

  async function pickFolder(){
    if (mode === 'tauri'){
      const p = await window.__DISCO_FS__.pickFolder();
      if (!p) throw new Error('Sin selección');
      folderPath = String(p);
      try { localStorage.setItem(LS_PATH_KEY, folderPath); } catch(e){}
      return { name: folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath };
    }
    if (mode === 'browser'){
      const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'discografia-default', startIn: 'documents' });
      if (!(await ensurePermission(h, 'readwrite'))) throw new Error('Permiso denegado');
      dirHandle = h;
      await idbPut(HANDLE_KEY, h);
      return h;
    }
    throw new Error('Navegador sin soporte');
  }

  async function clear(){
    if (mode === 'tauri'){
      folderPath = null;
      try { localStorage.removeItem(LS_PATH_KEY); } catch(e){}
      return;
    }
    dirHandle = null;
    try { await idbDel(HANDLE_KEY); } catch(e){}
  }

  const getHandle = () => dirHandle;
  const getName = () => {
    if (mode === 'tauri') return folderPath ? (folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath) : null;
    return dirHandle?.name || null;
  };
  const isSet = () => (mode === 'tauri') ? !!folderPath : !!dirHandle;
  const isSupported = () => mode !== 'unsupported';
  const getMode = () => mode;

  async function ensureReady(m = 'readwrite'){
    if (mode === 'tauri') return !!folderPath;
    if (mode === 'browser'){ if (!dirHandle) return false; return await ensurePermission(dirHandle, m); }
    return false;
  }

  function joinPath(dir, name){
    if (!dir) return name;
    const sep = dir.indexOf('\\') !== -1 ? '\\' : '/';
    const clean = String(dir).replace(/[\\/]+$/, '');
    return clean + sep + name;
  }

  async function saveFile(name, content, mime = 'application/json'){
    if (mode === 'tauri'){
      if (!folderPath) throw new Error('Sin carpeta');
      const full = joinPath(folderPath, name);
      await window.__DISCO_FS__.save(full, content);
      return true;
    }
    if (mode === 'browser'){
      if (!dirHandle) throw new Error('Sin carpeta');
      if (!(await ensureReady('readwrite'))) throw new Error('Permiso denegado');
      const fh = await dirHandle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(new Blob([content], { type: mime + ';charset=utf-8' }));
      await w.close();
      return true;
    }
    throw new Error('Navegador sin soporte');
  }

  async function listFiles(){
    if (mode === 'tauri'){
      if (!folderPath) return [];
      const items = await window.__DISCO_FS__.list(folderPath);
      return (items || [])
        .filter(it => it.isFile)
        .map(it => ({ name: it.name, size: it.size || 0, modifiedTime: it.modifiedTime || 0, handle: null }))
        .sort((a, b) => (b.modifiedTime || 0) - (a.modifiedTime || 0));
    }
    if (mode === 'browser'){
      if (!dirHandle) return [];
      if (!(await ensureReady('read'))) return [];
      const out = [];
      for await (const [name, h] of dirHandle.entries()){
        if (h.kind === 'file'){
          try {
            const f = await h.getFile();
            out.push({ name, size: f.size, modifiedTime: f.lastModified, handle: h });
          } catch(e){}
        }
      }
      return out.sort((a, b) => b.modifiedTime - a.modifiedTime);
    }
    return [];
  }

  async function readFile(name){
    if (mode === 'tauri'){
      if (!folderPath) throw new Error('Sin carpeta');
      const full = joinPath(folderPath, name);
      return await window.__DISCO_FS__.read(full);
    }
    if (mode === 'browser'){
      if (!dirHandle) throw new Error('Sin carpeta');
      if (!(await ensureReady('read'))) throw new Error('Permiso denegado');
      const fh = await dirHandle.getFileHandle(name);
      const f = await fh.getFile();
      return await f.text();
    }
    throw new Error('Navegador sin soporte');
  }

  async function deleteFile(name){
    if (mode === 'tauri'){
      if (!folderPath) throw new Error('Sin carpeta');
      const full = joinPath(folderPath, name);
      await window.__DISCO_FS__.del(full);
      return true;
    }
    if (mode === 'browser'){
      if (!dirHandle) throw new Error('Sin carpeta');
      if (!(await ensureReady('readwrite'))) throw new Error('Permiso denegado');
      await dirHandle.removeEntry(name);
      return true;
    }
    throw new Error('Navegador sin soporte');
  }

  function refreshBadge(){
    const b = $("#folderBadge"); if (!b) return;
    const n = getName();
    if (n){
      b.textContent = '· ' + n;
      b.style.display = 'inline';
      b.style.cssText = 'display:inline-block;background:rgba(79,195,247,.25);color:var(--accent);border-radius:10px;padding:1px 7px;font-size:.62rem;font-weight:700;margin-left:6px';
    } else {
      b.textContent = ''; b.style.display = 'none';
    }
  }

  return { load, isSupported, isSet, getName, getHandle, pickFolder, clear, ensureReady, saveFile, listFiles, readFile, deleteFile, refreshBadge, getMode };
})();

async function saveOrDownload(filename, content, mimeType = "application/json"){
  if (FileSystemDefault.isSet() && FileSystemDefault.isSupported()){
    try { await FileSystemDefault.saveFile(filename, content, mimeType); Toast.show(`💾 Guardado en "${FileSystemDefault.getName()}"`, "ok", 3500); return true; }
    catch(err){ Toast.show(`No se pudo escribir: ${err.message}. Descargando…`, "warn", 5500); }
  }
  download(filename, content, mimeType);
  Toast.show("📥 Archivo descargado", "ok", 2800);
  return true;
}

const OwnerConfig = (() => {
  let data = { name: "", contact: "", email: "" };
  function load(){ try { const r = localStorage.getItem(OWNER_KEY); if (r) data = Object.assign(data, JSON.parse(r) || {}); } catch(e){} }
  function persist(){ try { localStorage.setItem(OWNER_KEY, JSON.stringify(data)); } catch(e){} }
  const get = () => ({ ...data });
  function set(d){ data = { name: String(d.name||'').trim(), contact: String(d.contact||'').trim(), email: String(d.email||'').trim() }; persist(); MB_USER_AGENT = buildMBUserAgent(); render(); }
  function clear(){ data = { name:'', contact:'', email:'' }; localStorage.removeItem(OWNER_KEY); MB_USER_AGENT = buildMBUserAgent(); render(); }
  const displayName = () => data.name || DEFAULT_AUTHOR;
  function contactLine(){ const p = []; if (data.contact) p.push(data.contact); if (data.email) p.push(data.email); return p.join(' · '); }
  function render(){
    const dc = contactLine() || DEFAULT_PHONE;
    const fl = $("#footerAuthorLine"); if (fl) fl.innerHTML = `<b>Autor:</b> ${esc(displayName())} <span class="sep">|</span><b>Tel:</b> ${esc(dc)} <span class="sep">|</span><span class="copy"><span class="footer-version">Discografía v${APP_VERSION}</span> · ${esc(COPYRIGHT_TEXT)}</span>`;
    const pl = $("#printOwnerLine"); if (pl) pl.innerHTML = `Lista generada el <span id="printDate">—</span> · ${esc(displayName())} · ${esc(dc)}`;
    const pf = $("#printFooterLine"); if (pf) pf.textContent = `Discografía v${APP_VERSION} — ${displayName()} — ${dc} — ${COPYRIGHT_TEXT}`;
    const mi = $("#manualOwnerInfo"); if (mi) mi.innerHTML = `<b>${esc(displayName())}</b><br>📞 ${esc(dc)}<br>${esc(COPYRIGHT_TEXT)}`;
  }
  return { load, persist, get, set, clear, render, displayName, contactLine };
})();

const MetadataCache = (() => {
  let cache = {};
  function load(){ try { const r = localStorage.getItem(METACACHE_KEY); if (r){ const p = JSON.parse(r); if (p && typeof p === 'object') cache = p; } } catch(e){ cache = {}; } }
  function persist(){ try { localStorage.setItem(METACACHE_KEY, JSON.stringify(cache)); } catch(e){} }
  const key = (t, i, y) => norm(`${i||''}|${t||''}|${y||''}`).replace(/\s+/g,' ').trim();
  function get(t, i, y){ const k = key(t, i, y); const e = cache[k]; if (!e) return null; if (Date.now() - (e.ts||0) > CACHE_TTL_MS){ delete cache[k]; return null; } return e.data; }
  function set(t, i, y, d){ if (!d) return; const c = Number(d.confidence||0); if (c < CACHE_MIN_CONFIDENCE) return; cache[key(t,i,y)] = { ts: Date.now(), data: d }; persist(); }
  function clear(){ cache = {}; try { localStorage.removeItem(METACACHE_KEY); } catch(e){} }
  return { load, persist, get, set, clear };
})();

const Toast = (() => {
  const container = $("#toasts");
  const icons = { ok:'✓', err:'✕', warn:'⚠', info:'ℹ' };
  return {
    show(msg, type="ok", ms=3200, action=null){
      const el = document.createElement("div");
      el.className = "toast " + type;
      el.innerHTML = `<div class="toast-icon">${icons[type]||icons.info}</div><div class="toast-content">${esc(msg)}</div>`;
      if (action){ const b = document.createElement("button"); b.type = "button"; b.textContent = action.label; b.onclick = () => { action.fn(); el.remove(); }; el.appendChild(b); }
      container.appendChild(el);
      setTimeout(() => { el.classList.add("hide"); setTimeout(() => el.remove(), 220); }, ms);
    }
  };
})();

const CustomFields = (() => {
  let fields = [];
  function load(){ try { const r = localStorage.getItem(CUSTOMFIELDS_KEY); if (r) fields = JSON.parse(r) || []; } catch(e){ fields = []; } }
  function persist(){ try { localStorage.setItem(CUSTOMFIELDS_KEY, JSON.stringify(fields)); } catch(e){} }
  const getAll = () => [...fields];
  function add({ name, type, options }){
    if (!name || !name.trim()) return false;
    const clean = name.trim().slice(0, 40);
    if (fields.some(f => f.name.toLowerCase() === clean.toLowerCase())){ Toast.show('Ya existe un campo con ese nombre', 'warn'); return false; }
    fields.push({ id: 'cf_' + Date.now().toString(36), name: clean, type: type || 'text', options: options ? options.split(',').map(o => o.trim()).filter(Boolean) : [] });
    persist(); return true;
  }
  function remove(id){ fields = fields.filter(f => f.id !== id); persist(); }
  function render(){
    const list = $('#cfList'); if (!list) return;
    if (!fields.length){ list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:.82rem">Sin campos personalizados</div>'; return; }
    list.innerHTML = fields.map(f => `<div class="cf-item"><div class="cf-name">${esc(f.name)}</div><div class="cf-type">${esc(f.type)}</div><button type="button" data-cf-del="${esc(f.id)}" title="Eliminar">🗑️</button></div>`).join('');
    list.querySelectorAll('[data-cf-del]').forEach(btn => {
      btn.addEventListener('click', () => { if (!confirm('¿Eliminar este campo?')) return; remove(btn.dataset.cfDel); render(); Toast.show('Campo eliminado','warn'); });
    });
  }
  function renderInModal(values = {}){
    const host = $('#customFieldsHost'); if (!host) return;
    if (!fields.length){ host.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:.82rem">No hay campos personalizados definidos.</div>'; return; }
    host.innerHTML = fields.map(f => {
      const val = values[f.id] ?? '';
      let input;
      if (f.type === 'number') input = `<input type="number" data-cf-input="${esc(f.id)}" value="${esc(val)}" style="width:100%;padding:9px 12px;background:var(--bg2);border:1px solid var(--line);border-radius:9px;color:var(--txt);font-size:.9rem">`;
      else if (f.type === 'date') input = `<input type="date" data-cf-input="${esc(f.id)}" value="${esc(val)}" style="width:100%;padding:9px 12px;background:var(--bg2);border:1px solid var(--line);border-radius:9px;color:var(--txt);font-size:.9rem">`;
      else if (f.type === 'boolean') input = `<select data-cf-input="${esc(f.id)}" style="width:100%;padding:9px 12px;background:var(--bg2);border:1px solid var(--line);border-radius:9px;color:var(--txt);font-size:.9rem"><option value="">—</option><option value="true"${val==='true'?' selected':''}>Sí</option><option value="false"${val==='false'?' selected':''}>No</option></select>`;
      else if (f.type === 'select') input = `<select data-cf-input="${esc(f.id)}" style="width:100%;padding:9px 12px;background:var(--bg2);border:1px solid var(--line);border-radius:9px;color:var(--txt);font-size:.9rem"><option value="">—</option>${f.options.map(o => `<option value="${esc(o)}"${val===o?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
      else input = `<input type="text" data-cf-input="${esc(f.id)}" data-uppercase value="${esc(val)}" style="width:100%;padding:9px 12px;background:var(--bg2);border:1px solid var(--line);border-radius:9px;color:var(--txt);font-size:.9rem">`;
      return `<div class="field"><label>${esc(f.name)} <span style="font-size:.6rem;color:var(--muted)">(${esc(f.type)})</span></label>${input}</div>`;
    }).join('');
  }
  function readFromModal(){
    const out = {};
    $$('#customFieldsHost [data-cf-input]').forEach(el => { const v = el.value.trim(); if (v !== '') out[el.dataset.cfInput] = v; });
    return out;
  }
  return { load, persist, getAll, add, remove, render, renderInModal, readFromModal };
})();

const HistoryLog = (() => {
  const MAX = 200;
  let items = [];
  function load(){ try { const r = localStorage.getItem(HISTORY_KEY); if (r) items = JSON.parse(r) || []; } catch(e){ items = []; } }
  function persist(){ try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-MAX))); } catch(e){} }
  function log(cat, title, detail){
    items.push({ id: 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6), cat: cat||'INFO', title: String(title||'').slice(0,120), detail: String(detail||'').slice(0,200), ts: new Date().toISOString() });
    if (items.length > MAX) items = items.slice(-MAX);
    persist();
  }
  const getAll = () => [...items].reverse();
  function clear(){ items = []; persist(); }
  function filtered(cat, search){
    let out = getAll();
    if (cat) out = out.filter(i => i.cat === cat);
    if (search){ const s = norm(search); out = out.filter(i => norm(i.title + ' ' + i.detail).includes(s)); }
    return out;
  }
  function render(){
    const list = $('#histList'); if (!list) return;
    const cat = $('#histFilter')?.value || '';
    const search = $('#histSearch')?.value || '';
    const fi = filtered(cat, search);
    if (!fi.length){ list.innerHTML = '<div style="padding:32px;text-align:center;color:var(--muted);font-style:italic">Sin actividad registrada</div>'; return; }
    const icons = { CREATE:'➕', EDIT:'✏️', DELETE:'🗑️', IMPORT:'📥', ENRICH:'✨', LOAN:'📚', EXPORT:'📄', INFO:'ℹ️' };
    list.innerHTML = fi.map(i => `<div class="history-item cat-${esc(i.cat)}"><span class="hi-icon">${icons[i.cat]||'📌'}</span><div class="hi-text"><div class="hi-title">${esc(i.title)}</div>${i.detail ? `<div class="hi-detail">${esc(i.detail)}</div>` : ''}</div><div class="hi-time">${new Date(i.ts).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'})}</div></div>`).join('');
  }
  function exportCSV(){
    const all = getAll();
    if (!all.length){ Toast.show('Historial vacío','warn'); return; }
    const sep = ';';
    const e = v => { const s = String(v??''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
    const rows = [['Fecha','Categoría','Acción','Detalle'].join(sep)];
    for (const i of all) rows.push([i.ts, i.cat, i.title, i.detail].map(e).join(sep));
    saveOrDownload(`discografia_historial_${timestamp()}.csv`, '\uFEFF' + rows.join('\r\n'), 'text/csv');
  }
  return { load, persist, log, getAll, clear, filtered, render, exportCSV };
})();

const Store = (() => {
  let db = null;
  let _allCDsCache = null;
  function invalidateCache(){ _allCDsCache = null; }
  function buildEmpty(){ return { version: 5, updated: null, seeded: true, categories: {}, prefs: { enrich: true, autoBackup: true, replaceOnEnrich: true } }; }
  function slugify(str){ return String(str||'').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,32) || "cat_" + Date.now().toString(36); }
  function uniqueKey(base, cats){ let k = base, i = 2; while (cats[k]) k = base + "_" + (i++); return k; }
  function sanitizeProvenance(p){
    if (!p || typeof p !== 'object') return {};
    const out = {};
    for (const k in p){
      const v = p[k]; if (!v || typeof v !== 'object') continue;
      out[k] = { source: v.source ? String(v.source) : null, confidence: (typeof v.confidence === 'number' && Number.isFinite(v.confidence)) ? v.confidence : null, date: v.date || null };
    }
    return out;
  }
  function genSubId(){ return 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }
  function sanitizeSubcategories(arr){
    if (!Array.isArray(arr)) return [];
    return arr.map(s => ({
      id: s.id || genSubId(),
      label: String(s.label || 'Sin nombre'),
      icon: String(s.icon || '📂')
    }));
  }
  function hydrate(cd){
    return {
      id: cd.id || (crypto.randomUUID ? crypto.randomUUID() : "cd_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2)),
      nro: cd.nro ?? 0,
      titulo: upper(cd.titulo),
      interprete: upper(cd.interprete),
      anio: cd.anio ?? null,
      anioEdicion: cd.anioEdicion ?? null,
      formato: cd.formato ?? "CD", estado: cd.estado ?? "Excelente",
      estadoDisco: cd.estadoDisco ?? "", estadoCaja: cd.estadoCaja ?? "",
      estadoFolleto: cd.estadoFolleto ?? "", estadoArte: cd.estadoArte ?? "",
      sello: upper(cd.sello), genero: upper(cd.genero), catalogo: upper(cd.catalogo),
      codigo: cd.codigo ?? "", isrc: (cd.isrc ?? "").toString().toUpperCase(), edicion: upper(cd.edicion), pais: upper(cd.pais),
      ubicacion: upper(cd.ubicacion), cantidad: cd.cantidad ?? 1,
      adquisicion: cd.adquisicion ?? "", valor: cd.valor ?? null, moneda: cd.moneda ?? "ARS",
      notas: cd.notas ?? "",
      mbId: cd.mbId ?? null, discogsId: cd.discogsId ?? null,
      portada: cd.portada ?? null, portadaSource: cd.portadaSource ?? null,
      enrichmentSource: cd.enrichmentSource ?? null, enrichmentConfidence: cd.enrichmentConfidence ?? null, enrichedAt: cd.enrichedAt ?? null,
      provenance: sanitizeProvenance(cd.provenance),
      prestadoA: upper(cd.prestadoA), fechaPrestamo: cd.fechaPrestamo ?? "",
      fechaDevolucion: cd.fechaDevolucion ?? "", notasPrestamo: upper(cd.notasPrestamo),
      customFields: (cd.customFields && typeof cd.customFields === 'object') ? { ...cd.customFields } : {},
      links: (cd.links && typeof cd.links === 'object' && !Array.isArray(cd.links)) ? { ...cd.links } : {},
      subcat: cd.subcat ?? null
    };
  }
  function load(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw){
        const p = JSON.parse(raw);
        if (p && p.categories && typeof p.categories === 'object'){
          const clean = {};
          for (const k in p.categories){
            const c = p.categories[k] || {};
            clean[k] = {
              label: c.label || k,
              icon: c.icon || "📀",
              subcategories: sanitizeSubcategories(c.subcategories),
              cds: Array.isArray(c.cds) ? c.cds.map(hydrate) : []
            };
          }
          db = { version: 5, updated: p.updated || null, seeded: p.seeded === true, categories: clean, prefs: Object.assign({ enrich: true, autoBackup: true, replaceOnEnrich: true }, p.prefs || {}) };
          invalidateCache();
          return;
        }
      }
    } catch(e){ console.warn("localStorage:", e); }
    db = buildEmpty();
    invalidateCache();
  }
  function persist(){
    try { db.updated = new Date().toISOString(); localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); invalidateCache(); updateModifiedLabel(); }
    catch(e){
      if (isQuotaError(e)){
        freeLocalStorageCaches();
        try {
          db.updated = new Date().toISOString();
          localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
          invalidateCache(); updateModifiedLabel();
          Toast.show("⚠️ Storage lleno: se liberaron cachés y se reintentó guardar.", "warn", 8000);
          return;
        } catch(e2){
          Toast.show("⚠️ Almacenamiento lleno. Exportá un backup YA (Ctrl+S) y vaciá caché en ⚙️.", "err", 12000);
        }
      } else Toast.show("No se pudo guardar: " + e.message, "err", 7000);
    }
  }
  const persistSilent = persist;
  function updateModifiedLabel(){
    const el = $("#fModified"); if (!el) return;
    if (db.updated){ const d = new Date(db.updated); el.innerHTML = `· 💾 ${d.toLocaleDateString('es-AR')} ${d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}`; el.style.color = "var(--ok)"; }
    else { el.textContent = "· Sin cambios"; el.style.color = "var(--muted)"; }
  }
  function allCDs(){ if (!_allCDsCache) _allCDsCache = Object.values(db.categories).flatMap(c => c.cds); return _allCDsCache; }
  const total = () => allCDs().length;
  const get = cat => db.categories[cat];
  const getCDs = cat => db.categories[cat]?.cds || [];
  const categories = () => db.categories;
  const catKeys = () => Object.keys(db.categories);
  function resetAll(){ localStorage.removeItem(STORAGE_KEY); db = buildEmpty(); invalidateCache(); persist(); try { localStorage.removeItem(NOTFOUND_KEY); } catch(e){} if (typeof NotFoundList !== "undefined") NotFoundList.clear(); }
  function replaceAll(nd){
    db = { version: 5, updated: new Date().toISOString(), seeded: true, categories: {}, prefs: db?.prefs || { enrich: true, autoBackup: true, replaceOnEnrich: true } };
    const src = nd?.categories || {};
    for (const k in src){
      const c = src[k] || {};
      db.categories[k] = {
        label: c.label || k,
        icon: c.icon || "📀",
        subcategories: sanitizeSubcategories(c.subcategories),
        cds: Array.isArray(c.cds) ? c.cds.map(hydrate) : []
      };
    }
    invalidateCache(); persist();
  }
  function addCategory({ label, icon } = {}){
    const key = uniqueKey(slugify(label), db.categories);
    db.categories[key] = { label: label || "Nueva categoría", icon: icon || "📀", subcategories: [], cds: [] };
    persist(); return key;
  }
  function updateCategory(key, { label, icon } = {}){
    if (!db.categories[key]) return false;
    if (label !== undefined) db.categories[key].label = label;
    if (icon !== undefined) db.categories[key].icon = icon;
    persist(); return true;
  }
  function deleteCategory(key){ if (!db.categories[key]) return false; delete db.categories[key]; persist(); return true; }
  function addSubcategory(catKey, { label, icon } = {}){
    const cat = db.categories[catKey];
    if (!cat) return null;
    if (!Array.isArray(cat.subcategories)) cat.subcategories = [];
    const id = genSubId();
    cat.subcategories.push({ id, label: String(label || 'Subcategoría'), icon: icon || '📂' });
    persist();
    return id;
  }
  function updateSubcategory(catKey, subId, { label, icon } = {}){
    const cat = db.categories[catKey];
    if (!cat || !Array.isArray(cat.subcategories)) return false;
    const sub = cat.subcategories.find(s => s.id === subId);
    if (!sub) return false;
    if (label !== undefined) sub.label = label;
    if (icon !== undefined) sub.icon = icon;
    persist();
    return true;
  }
  function deleteSubcategory(catKey, subId){
    const cat = db.categories[catKey];
    if (!cat || !Array.isArray(cat.subcategories)) return false;
    const idx = cat.subcategories.findIndex(s => s.id === subId);
    if (idx === -1) return false;
    cat.subcategories.splice(idx, 1);
    for (const cd of cat.cds){ if (cd.subcat === subId) cd.subcat = null; }
    persist();
    return true;
  }
  function moveSubcategory(catKey, subId, dir){
    const cat = db.categories[catKey];
    if (!cat || !Array.isArray(cat.subcategories)) return false;
    const i = cat.subcategories.findIndex(s => s.id === subId);
    if (i === -1) return false;
    const j = dir === 'left' ? i - 1 : i + 1;
    if (j < 0 || j >= cat.subcategories.length) return false;
    [cat.subcategories[i], cat.subcategories[j]] = [cat.subcategories[j], cat.subcategories[i]];
    persist();
    return true;
  }
  function getSubcategories(catKey){
    const cat = db.categories[catKey];
    return (cat && Array.isArray(cat.subcategories)) ? cat.subcategories.map(s => ({ ...s })) : [];
  }
  function getSubcategory(catKey, subId){
    const cat = db.categories[catKey];
    if (!cat || !Array.isArray(cat.subcategories)) return null;
    const s = cat.subcategories.find(x => x.id === subId);
    return s ? { ...s } : null;
  }
  function renameCategoryKey(oldKey, newLabel){
    if (!db.categories[oldKey]) return null;
    const nk = uniqueKey(slugify(newLabel), db.categories);
    const rebuilt = {};
    for (const k in db.categories){ if (k === oldKey) rebuilt[nk] = db.categories[oldKey]; else rebuilt[k] = db.categories[k]; }
    db.categories = rebuilt; db.categories[nk].label = newLabel; persist(); return nk;
  }
  function moveCategory(key, dir){
    const keys = catKeys(); const i = keys.indexOf(key); if (i === -1) return false;
    const j = dir === 'left' ? i - 1 : i + 1;
    if (j < 0 || j >= keys.length) return false;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    const rebuilt = {}; for (const k of keys) rebuilt[k] = db.categories[k];
    db.categories = rebuilt; persist(); return true;
  }
  const getPref = (k, d) => db.prefs?.[k] ?? d;
  function setPref(k, v){ db.prefs = db.prefs || {}; db.prefs[k] = v; persist(); }
  return { load, persist, persistSilent, resetAll, replaceAll, allCDs, total, get, getCDs, categories, catKeys, addCategory, updateCategory, deleteCategory, renameCategoryKey, moveCategory, hydrate, buildEmpty, slugify, uniqueKey, getPref, setPref, addSubcategory, updateSubcategory, deleteSubcategory, moveSubcategory, getSubcategories, getSubcategory, get isEmpty(){ return total() === 0 && catKeys().length === 0; } };
})();

const NotFoundList = (() => {
  let items = [];
  function load(){ try { const r = localStorage.getItem(NOTFOUND_KEY); if (r){ const p = JSON.parse(r); if (Array.isArray(p)) items = p; } } catch(e){} updateBadge(); }
  function persist(){ try { localStorage.setItem(NOTFOUND_KEY, JSON.stringify(items)); } catch(e){} updateBadge(); }
  function add(cd){ const i = items.findIndex(x => x.catKey === cd.catKey && x.nro === cd.nro); if (i === -1) items.push({ ...cd, ts: new Date().toISOString() }); else items[i] = { ...items[i], ...cd, ts: new Date().toISOString() }; }
  function remove(catKey, nro){ const before = items.length; items = items.filter(x => !(x.catKey === catKey && x.nro === nro)); return items.length < before; }
  function clear(){ items = []; persist(); }
  const getAll = () => [...items];
  const count = () => items.length;
  function updateBadge(){ const b = $("#notFoundBadge"); const btn = $("#btnNotFound"); if (b) b.textContent = items.length; if (btn) btn.style.display = items.length > 0 ? "" : "none"; }
  return { load, persist, add, remove, clear, getAll, count, updateBadge };
})();

const AutoBackup = (() => {
  let changeCount = 0, pendingTimer = null, lastReason = "";
  const DEBOUNCE_MS = 4000, RE_ASK_MS = 120000;
  const getEnabled = () => { try { return Store.getPref("autoBackup", true); } catch(e){ return true; } };
  function setEnabled(v){ try { Store.setPref("autoBackup", !!v); } catch(e){} if (!v){ changeCount = 0; if (pendingTimer){ clearTimeout(pendingTimer); pendingTimer = null; } } updateBadge(); syncToggle(); }
  function syncToggle(){ const cb = $("#autoBackupToggle"); if (cb) cb.checked = getEnabled(); }
  function updateBadge(){ const b = $("#autobackupBadge"); if (!b) return; if (changeCount > 0 && getEnabled()){ b.textContent = changeCount; b.style.display = ""; } else b.style.display = "none"; }
  function markChange(reason){
    lastReason = reason || ''; changeCount++; updateBadge();
    if (!getEnabled()) return;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (changeCount <= 0) return;
      if (isAnyModalOpen()){ pendingTimer = setTimeout(() => { pendingTimer = null; if (changeCount > 0 && getEnabled() && !isAnyModalOpen()) askBackup(); }, 10000); return; }
      askBackup();
    }, DEBOUNCE_MS);
  }
  function askBackup(){
    $("#autoBackupCount").textContent = changeCount + " cambio" + (changeCount === 1 ? "" : "s");
    $("#autoBackupReason").textContent = lastReason || "modificación";
    $("#autoBackupModal").classList.add("open");
  }
  function doBackup(){
    $("#autoBackupModal").classList.remove("open");
    const dis = $("#autoBackupDisableAfter")?.checked;
    changeCount = 0; updateBadge(); exportFullJSON();
    if (dis){ $("#autoBackupDisableAfter").checked = false; setEnabled(false); Toast.show("Backup automático desactivado.","warn"); }
  }
  function later(){
    $("#autoBackupModal").classList.remove("open");
    const dis = $("#autoBackupDisableAfter")?.checked;
    if (dis){ $("#autoBackupDisableAfter").checked = false; setEnabled(false); Toast.show("Backup automático desactivado","warn",4000); return; }
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingTimer = null; if (changeCount > 0 && getEnabled() && !isAnyModalOpen()) askBackup(); }, RE_ASK_MS);
  }
  function reset(){ changeCount = 0; updateBadge(); }
  const hasPending = () => changeCount > 0 && getEnabled();
  return { markChange, askBackup, doBackup, later, getEnabled, setEnabled, updateBadge, syncToggle, reset, hasPending };
})();

const Undo = (() => {
  const stack = [];
  function updateBadge(){
    const b = $("#btnUndo"); if (!b) return;
    if (stack.length > 0){ b.classList.add("active"); b.title = `Deshacer: ${stack[stack.length-1].label} (Ctrl+Z) — ${stack.length} operación(es)`; }
    else { b.classList.remove("active"); b.title = "Nada que deshacer"; }
  }
  return {
    push(label, restore){ if (typeof restore !== "function") return; stack.push({ label, restore }); if (stack.length > UNDO_LIMIT) stack.shift(); updateBadge(); },
    pop(){ const op = stack.pop(); updateBadge(); if (!op){ Toast.show("Nada que deshacer","warn",1800); return; } op.restore(); Toast.show("Deshecho: " + op.label,"ok",2200); },
    clear(){ stack.length = 0; updateBadge(); },
    updateBadge
  };
})();

const Duplicates = (() => {
  function find(threshold = 0.92){
    const groups = [];
    const all = Store.allCDs().map(cd => {
      let cat = null;
      for (const k of Store.catKeys()){ if (Store.getCDs(k).includes(cd)){ cat = k; break; } }
      return { cd, cat };
    });
    const visited = new Set();
    for (let i = 0; i < all.length; i++){
      if (visited.has(i)) continue;
      const group = [all[i]]; visited.add(i);
      for (let j = i + 1; j < all.length; j++){
        if (visited.has(j)) continue;
        const a = all[i].cd, b = all[j].cd;
        const sT = similarity(a.titulo, b.titulo);
        const sA = similarity(a.interprete, b.interprete);
        const score = sT * 0.55 + sA * 0.35 + (a.anio && b.anio && a.anio === b.anio ? 0.10 : 0);
        if (score >= threshold){ group.push(all[j]); visited.add(j); }
      }
      if (group.length > 1) groups.push(group);
    }
    return groups;
  }
  function render(){
    const groups = find(0.92);
    const summary = $('#dupSummary'), list = $('#dupList');
    if (!summary || !list) return;
    if (!groups.length){
      summary.innerHTML = `✅ <b>No se detectaron duplicados</b> — analizados ${Store.total()} CDs con umbral 92%.`;
      summary.style.borderLeftColor = 'var(--ok)'; summary.style.background = 'rgba(93,220,154,.08)';
      list.innerHTML = ''; return;
    }
    const totalDup = groups.reduce((s, g) => s + g.length, 0);
    summary.innerHTML = `⚠️ <b>${groups.length} grupo${groups.length === 1 ? '' : 's'}</b> de posibles duplicados · <b>${totalDup}</b> CDs involucrados.`;
    summary.style.borderLeftColor = 'var(--warn)'; summary.style.background = 'rgba(255,169,77,.08)';
    list.innerHTML = groups.map((g, gi) => `<div class="dup-group"><div class="dup-group-head"><div class="dgh-title">🔍 Grupo #${gi+1} — ${g.length} CDs similares</div><div class="dgh-score">${Math.round(similarity(g[0].cd.titulo, g[1]?.cd.titulo||'')*100)}% similitud</div></div><div class="dup-items">${g.map(({cd, cat}) => `<div class="dup-item">${cd.portada ? `<img src="${esc(cd.portada)}" alt="">` : `<div class="dup-ph">💿</div>`}<div style="min-width:0"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cd.titulo)}</div><div style="font-size:.72rem;color:var(--muted)">${esc(cd.interprete)} · ${cd.anio ?? '—'} · Nº ${cd.nro} · ${esc(Store.get(cat)?.label || cat)}</div></div><button type="button" class="btn danger" data-dup-del="${esc(cdKey(cat, cd))}" title="Eliminar">🗑️</button></div>`).join('')}</div></div>`).join('');
    list.querySelectorAll('[data-dup-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { cat, id } = parseCDKey(btn.dataset.dupDel);
        const cd = Store.getCDs(cat).find(c => c.id === id);
        if (!cd) return;
        if (!confirm(`¿Eliminar "${cd.titulo}" de "${Store.get(cat).label}"?`)) return;
        const before = snapshotAll();
        const list = Store.getCDs(cat);
        const idx = list.findIndex(c => c.id === id);
        if (idx !== -1) list.splice(idx, 1);
        Undo.push('eliminar duplicado', () => restoreAll(before));
        Store.persist();
        HistoryLog.log('DELETE', `Duplicado eliminado: ${cd.titulo}`, cd.interprete);
        AutoBackup.markChange('eliminación de duplicado');
        render(); renderTabs(); renderAll();
        Toast.show('Duplicado eliminado', 'ok');
      });
    });
  }
  function exportCSV(){
    const groups = find(0.92);
    if (!groups.length){ Toast.show('Sin duplicados', 'warn'); return; }
    const sep = ';';
    const e = v => { const s = String(v??''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
    const rows = [['Grupo','Nº','Título','Intérprete','Año','Categoría'].join(sep)];
    groups.forEach((g, gi) => { g.forEach(({cd, cat}) => { rows.push([gi+1, cd.nro, cd.titulo, cd.interprete, cd.anio ?? '', Store.get(cat)?.label || cat].map(e).join(sep)); }); });
    saveOrDownload(`discografia_duplicados_${timestamp()}.csv`, '\uFEFF' + rows.join('\r\n'), 'text/csv');
  }
  return { find, render, exportCSV };
})();

const DuplicateChecker = (() => {
  let _set = null;
  function rebuild(){ const g = Duplicates.find(0.92); const s = new Set(); for (const grp of g){ for (const {cd, cat} of grp){ s.add(cdKey(cat, cd)); } } _set = s; }
  function isDuplicate(cd){ if (!_set) rebuild(); for (const k of Store.catKeys()){ if (Store.getCDs(k).includes(cd)) return _set.has(cdKey(k, cd)); } return false; }
  function invalidate(){ _set = null; }
  return { isDuplicate, invalidate };
})();

const Loans = (() => {
  const isLoaned = cd => !!(cd.prestadoA && cd.prestadoA.trim());
  function isOverdue(cd){ if (!isLoaned(cd) || !cd.fechaDevolucion) return false; return new Date(cd.fechaDevolucion) < new Date(); }
  function getAll(){
    const out = [];
    for (const k of Store.catKeys()){ for (const cd of Store.getCDs(k)){ if (isLoaned(cd)) out.push({ cd, cat: k }); } }
    return out.sort((a, b) => { const da = a.cd.fechaDevolucion || '9999-12-31'; const db = b.cd.fechaDevolucion || '9999-12-31'; return da.localeCompare(db); });
  }
  function render(){
    const all = getAll();
    const summary = $('#loansSummary'), list = $('#loansList');
    if (!summary || !list) return;
    if (!all.length){ summary.innerHTML = '✅ <b>No hay CDs prestados</b> actualmente.'; summary.style.borderLeftColor = 'var(--ok)'; summary.style.background = 'rgba(93,220,154,.08)'; list.innerHTML = ''; return; }
    const overdue = all.filter(({cd}) => isOverdue(cd)).length;
    summary.innerHTML = `📚 <b>${all.length}</b> CD${all.length === 1 ? '' : 's'} prestado${all.length === 1 ? '' : 's'}${overdue > 0 ? ` · <b style="color:var(--danger)">${overdue} vencido${overdue === 1 ? '' : 's'}</b>` : ''}.`;
    list.innerHTML = `<div style="display:grid;grid-template-columns:1fr;gap:6px">${all.map(({cd, cat}) => {
      const ov = isOverdue(cd);
      return `<div class="loan-info-box${ov ? ' overdue' : ''}" style="display:grid;grid-template-columns:60px 1fr auto;gap:12px;align-items:center">${cd.portada ? `<img src="${esc(cd.portada)}" style="width:48px;height:48px;border-radius:6px;object-fit:cover">` : `<div style="width:48px;height:48px;border-radius:6px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:1.2rem">💿</div>`}<div style="min-width:0"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cd.titulo)}</div><div style="font-size:.72rem;color:var(--muted);margin-top:2px">${esc(cd.interprete)} · Nº ${cd.nro} · ${esc(Store.get(cat)?.label || cat)}</div><div style="font-size:.72rem;margin-top:4px"><b>Prestado a:</b> ${esc(cd.prestadoA)}${cd.fechaDevolucion ? ` · <b>Devolución:</b> ${new Date(cd.fechaDevolucion).toLocaleDateString('es-AR')}${ov ? ' <span style="color:var(--danger);font-weight:700">(VENCIDO)</span>' : ''}` : ''}</div></div><button type="button" class="btn" data-loan-return="${esc(cdKey(cat, cd))}">↩️ Devolver</button></div>`;
    }).join('')}</div>`;
    list.querySelectorAll('[data-loan-return]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { cat, id } = parseCDKey(btn.dataset.loanReturn);
        const cd = Store.getCDs(cat).find(c => c.id === id);
        if (!cd) return;
        if (!confirm(`¿Marcar "${cd.titulo}" como devuelto?`)) return;
        const before = snapshotAll();
        cd.prestadoA = ''; cd.fechaPrestamo = ''; cd.fechaDevolucion = ''; cd.notasPrestamo = '';
        Undo.push('devolver CD', () => restoreAll(before));
        Store.persist();
        HistoryLog.log('LOAN', `Devuelto: ${cd.titulo}`, cd.interprete);
        AutoBackup.markChange('devolución');
        render(); renderAll();
        Toast.show('Marcado como devuelto', 'ok');
      });
    });
  }
  function exportCSV(){
    const all = getAll();
    if (!all.length){ Toast.show('Sin préstamos', 'warn'); return; }
    const sep = ';';
    const e = v => { const s = String(v??''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
    const rows = [['Nº','Título','Intérprete','Categoría','Prestado a','Fecha préstamo','Fecha devolución','Estado'].join(sep)];
    for (const {cd, cat} of all){ rows.push([cd.nro, cd.titulo, cd.interprete, Store.get(cat)?.label || cat, cd.prestadoA || '', cd.fechaPrestamo || '', cd.fechaDevolucion || '', isOverdue(cd) ? 'VENCIDO' : 'En plazo'].map(e).join(sep)); }
    saveOrDownload(`discografia_prestamos_${timestamp()}.csv`, '\uFEFF' + rows.join('\r\n'), 'text/csv');
  }
  return { isLoaned, isOverdue, getAll, render, exportCSV };
})();

/* ═══════════════════════════════════════════════════════════════════
   BarcodeScanner — dual: BarcodeDetector nativo + html5-qrcode fallback
   ═══════════════════════════════════════════════════════════════════ */
const BarcodeScanner = (() => {
  let stream = null;
  let nativeDetector = null;
  let html5Scanner = null;
  let rafId = null;
  let running = false;
  let onDetected = null;

  const hasNativeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const hasHtml5Qr = typeof window !== 'undefined' && typeof window.Html5Qrcode !== 'undefined';

  async function start(callback){
    onDetected = callback;
    if (hasNativeDetector){
      return startNative();
    }
    if (hasHtml5Qr){
      return startHtml5();
    }
    const fb = $('#scanFallback');
    if (fb){ fb.style.display = 'block'; fb.innerHTML = '⚠️ No hay soporte de escáner disponible. Ingresá el código manualmente abajo.'; }
    const sw = $('#scanWrap'); if (sw) sw.style.display = 'none';
    const st = $('#scanStatus');
    if (st){ st.textContent = 'Escaneo automático no disponible.'; st.className = 'scanner-status err'; }
  }

  async function startNative(){
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = $('#scanVideo'); video.srcObject = stream; await video.play();
      nativeDetector = new window.BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128'] });
      running = true;
      $('#scanStatus').textContent = 'Apuntá al código de barras…';
      $('#scanStatus').className = 'scanner-status';
      scanLoopNative();
    } catch(err){
      $('#scanStatus').textContent = 'No se pudo acceder a la cámara: ' + err.message;
      $('#scanStatus').className = 'scanner-status err';
    }
  }

  async function scanLoopNative(){
    if (!running) return;
    const video = $('#scanVideo');
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA){
      rafId = requestAnimationFrame(scanLoopNative);
      return;
    }
    try {
      const results = await nativeDetector.detect(video);
      if (results && results.length){
        const code = results[0].rawValue;
        running = false;
        $('#scanStatus').textContent = '✓ Código detectado: ' + code;
        $('#scanStatus').className = 'scanner-status ok';
        if (typeof onDetected === 'function') onDetected(code);
        stop();
        return;
      }
    } catch(e){}
    rafId = requestAnimationFrame(scanLoopNative);
  }

  async function startHtml5(){
    try {
      const container = $('#scanWrap');
      const video = $('#scanVideo');
      const overlay = container.querySelector('.scan-overlay');
      if (video) video.style.display = 'none';
      if (overlay) overlay.style.display = 'none';

      let host = document.getElementById('html5qrReader');
      if (!host){
        host = document.createElement('div');
        host.id = 'html5qrReader';
        host.style.width = '100%';
        host.style.height = '100%';
        container.appendChild(host);
      }
      host.style.display = '';

      html5Scanner = new window.Html5Qrcode('html5qrReader', { verbose: false });
      const config = { fps: 10, qrbox: { width: 260, height: 160 }, aspectRatio: 1.333 };
      running = true;
      $('#scanStatus').textContent = 'Apuntá al código de barras…';
      $('#scanStatus').className = 'scanner-status';

      await html5Scanner.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          if (!running) return;
          running = false;
          $('#scanStatus').textContent = '✓ Código detectado: ' + decodedText;
          $('#scanStatus').className = 'scanner-status ok';
          if (typeof onDetected === 'function') onDetected(decodedText);
          stop();
        },
        () => {}
      );
    } catch(err){
      $('#scanStatus').textContent = 'No se pudo acceder a la cámara: ' + (err.message || err);
      $('#scanStatus').className = 'scanner-status err';
    }
  }

  function stop(){
    running = false;
    if (rafId){ cancelAnimationFrame(rafId); rafId = null; }
    if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
    const v = $('#scanVideo'); if (v){ v.srcObject = null; v.style.display = ''; }
    const overlay = $('#scanWrap')?.querySelector('.scan-overlay');
    if (overlay) overlay.style.display = '';
    if (html5Scanner){
      try {
        Promise.resolve(html5Scanner.stop()).then(() => { try { html5Scanner.clear(); } catch(_){} }).catch(()=>{});
      } catch(e){}
      html5Scanner = null;
    }
    const host = document.getElementById('html5qrReader');
    if (host) host.style.display = 'none';
  }

  return { start, stop, isSupported: () => hasNativeDetector || hasHtml5Qr };
})();

const AdvancedSearch = (() => {
  function tokenize(query){
    const tokens = []; let cur = ''; let inQ = false;
    for (let i = 0; i < query.length; i++){
      const ch = query[i];
      if (ch === '"'){ inQ = !inQ; continue; }
      if (!inQ && /\s/.test(ch)){ if (cur) { tokens.push(cur); cur = ''; } } else cur += ch;
    }
    if (cur) tokens.push(cur);
    return tokens;
  }
  function matches(cd, query){
    const tokens = tokenize(query);
    if (!tokens.length) return true;
    let result = true, pendingOp = 'AND';
    for (const tk of tokens){
      if (tk === 'AND' || tk === 'OR'){ pendingOp = tk; continue; }
      if (!tk || tk === '-' || tk === '--') continue;
      const neg = tk.startsWith('-');
      const clean = neg ? tk.slice(1) : tk;
      if (!clean) continue;
      let hit;
      if (clean.includes(':')){
        const idx = clean.indexOf(':');
        const f = clean.slice(0, idx).toLowerCase();
        const v = clean.slice(idx + 1);
        if (!v) continue;
        hit = matchField(cd, f, v);
      } else {
        hit = matchGlobal(cd, clean);
      }
      if (neg) hit = !hit;
      result = pendingOp === 'OR' ? (result || hit) : (result && hit);
      pendingOp = 'AND';
    }
    return result;
  }
  function matchField(cd, field, value){
    const v = norm(value);
    const cmp = value.match(/^(>=|<=|>|<|=)/);
    const isCmp = !!cmp;
    function compare(target){
      if (isCmp){
        const n1 = parseFloat(target), n2 = parseFloat(value.replace(cmp[0], ''));
        if (isNaN(n1) || isNaN(n2)) return false;
        switch(cmp[0]){ case '>': return n1 > n2; case '<': return n1 < n2; case '>=': return n1 >= n2; case '<=': return n1 <= n2; case '=': return n1 === n2; }
      }
      return norm(target).includes(v);
    }
    switch(field){
      case 'artist': case 'artista': case 'interprete': case 'intérprete': return compare(cd.interprete);
      case 'title': case 'titulo': case 'título': return compare(cd.titulo);
      case 'year': case 'anio': case 'año': return compare(String(cd.anio ?? ''));
      case 'genre': case 'genero': case 'género': return compare(cd.genero);
      case 'label': case 'sello': return compare(cd.sello);
      case 'format': case 'formato': return compare(cd.formato);
      case 'catalog': case 'catalogo': case 'catálogo': return compare(cd.catalogo);
      case 'isrc': return compare(cd.isrc);
      case 'country': case 'pais': case 'país': return compare(cd.pais);
      case 'location': case 'ubicacion': case 'ubicación': return compare(cd.ubicacion);
      case 'nro': case 'numero': case 'número': return compare(String(cd.nro));
      case 'loaned': case 'prestado': const isL = Loans.isLoaned(cd); return value === 'true' ? isL : value === 'false' ? !isL : isL;
      default: return matchGlobal(cd, value);
    }
  }
  function matchGlobal(cd, term){
    const t = norm(term); if (!t) return true;
    const h = norm([cd.titulo, cd.interprete, cd.sello, cd.anio, cd.genero, cd.ubicacion, cd.catalogo, cd.pais, cd.edicion, cd.notas].join(' '));
    return h.includes(t);
  }
  function isAdvanced(query){
    const q = String(query || '').trim();
    if (!q) return false;
    if (/\b[a-zA-Z_ñÑáéíóúÁÉÍÓÚ]+\s*:\s*\S+/.test(q)) return true;
    if (/(^|\s)(AND|OR)(\s|$)/.test(q)) return true;
    if (/(^|\s)-[^\s-]/.test(q)) return true;
    return false;
  }
  return { matches, isAdvanced };
})();

function normMatch(s){ return String(s||'').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim(); }
function levenshtein(a, b){
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}
function stripArticles(s){ return String(s||'').replace(/^(the|a|an|el|la|los|las|un|una)\s+/i,'').replace(/\s+(the|a|an|el|la|los|las|un|una)$/i,'').trim(); }
function similarity(a, b){
  const x = normMatch(stripArticles(a)), y = normMatch(stripArticles(b));
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const A = new Set(x.split(' ')), B = new Set(y.split(' '));
  const inter = [...A].filter(v => B.has(v)).length;
  const union = new Set([...A, ...B]).size;
  const j = union ? inter / union : 0;
  const lev = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  return Math.max(j, lev * 0.9);
}
function matchConfidence(t, i, cand){ return Math.round((similarity(t, cand.title) * 0.6 + similarity(i, cand.artist) * 0.4) * 100); }

function enrichMeta(base, t, i, pre){
  base.confidence = typeof pre === 'number'
    ? pre
    : matchConfidence(t, i, { title: base._title || t, artist: base._artist || i });
  base.enrichedAt = new Date().toISOString();
  return base;
}
function makeProvenance(source, confidence){ return { source: source || null, confidence: (typeof confidence === 'number' && Number.isFinite(confidence)) ? confidence : null, date: new Date().toISOString() }; }
function verificarFechaEmision(info, userYear){
  if (!info) return info;
  const y = parseInt(userYear); if (!y || !info.anio) return info;
  const d = info.anio - y;
  info.yearUser = y; info.yearFound = info.anio;
  if (d === 0) info.confidence = Math.min(100, (info.confidence||0)+5);
  else if (Math.abs(d) <= 1){}
  else if (d < 0 && Math.abs(d) > 20){ info.yearReissue = true; info.confidence = Math.min(100, (info.confidence||0)+3); }
  else if (d > 0 && d <= 5){ info.confidence = Math.max(0, (info.confidence||0)-10); info.yearWarning = true; }
  else if (d > 5){ info.confidence = Math.max(0, (info.confidence||0)-25); info.yearMismatch = true; }
  else info.yearWarning = true;
  return info;
}

function getDiscogsConfig(){
  try { return JSON.parse(localStorage.getItem(DISCOGS_CONFIG_KEY) || '{}') || {}; }
  catch(e){ return {}; }
}
function getDiscogsToken(){ return String(getDiscogsConfig().token || '').trim(); }
function getDiscogsProxy(){ return String(getDiscogsConfig().proxy || '').trim(); }
function saveDiscogsConfig(token, proxy){
  const t = String(token || '').trim().replace(/^["']+|["']+$/g, '').replace(/^Discogs\s+token\s*=\s*/i, '').replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
  const p = String(proxy || '').trim();
  if (!t && !p){ try { localStorage.removeItem(DISCOGS_CONFIG_KEY); } catch(e){} return true; }
  const payload = JSON.stringify({ token: t, proxy: p, updatedAt: new Date().toISOString() });
  try {
    localStorage.setItem(DISCOGS_CONFIG_KEY, payload);
    return true;
  } catch(e1){
    if (!isQuotaError(e1)){ console.error('saveDiscogsConfig', e1); return false; }
    const freed = freeLocalStorageCaches();
    console.warn('[Discogs] Quota excedida. Liberados ~', freed, 'chars de caché. Reintentando…');
    try {
      localStorage.setItem(DISCOGS_CONFIG_KEY, payload);
      try { if (typeof Toast !== 'undefined') Toast.show('⚠️ Storage lleno: se liberaron cachés y se guardó el token.', 'warn', 6000); } catch(_){}
      return true;
    } catch(e2){
      console.error('saveDiscogsConfig retry failed', e2);
      try {
        if (typeof Toast !== 'undefined') Toast.show('Storage lleno. Exportá un backup (Ctrl+S) y vaciá caché en ⚙️.', 'err', 9000);
      } catch(_){}
      return false;
    }
  }
}
function clearDiscogsConfig(){ try { localStorage.removeItem(DISCOGS_CONFIG_KEY); } catch(e){} }

function discogsUrl(url, tokenOverride = null, useProxy = false){
  const token = tokenOverride !== null ? String(tokenOverride).trim() : getDiscogsToken();
  let finalUrl = String(url);
  if (useProxy && token){
    const sep = finalUrl.includes('?') ? '&' : '?';
    finalUrl += sep + 'token=' + encodeURIComponent(token);
  }
  if (!useProxy) return finalUrl;
  const configuredProxy = getDiscogsProxy();
  const proxy = configuredProxy || DEFAULT_CORS_PROXY;
  if (/[?&]url=$/.test(proxy) || proxy.endsWith('=')){ return proxy + encodeURIComponent(finalUrl); }
  if (proxy.endsWith('/')){ return proxy + finalUrl.replace(/^https?:\/\//, ''); }
  return proxy + '?url=' + encodeURIComponent(finalUrl);
}
function discogsHeaders(tokenOverride = null){
  const token = tokenOverride !== null ? String(tokenOverride).trim() : getDiscogsToken();
  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = 'Discogs token=' + token;
  return headers;
}
function isDiscogsNetworkError(err){
  if (!err) return false;
  const name = String(err.name || '');
  const msg  = String(err.message || '');
  return (name === 'TypeError' || name === 'AbortError' || name === 'TimeoutError' ||
    /failed to fetch/i.test(msg) || /network/i.test(msg) || /cors/i.test(msg) ||
    /aborted/i.test(msg) || /timeout/i.test(msg));
}
async function fetchDiscogsDirect(url, token, timeoutMs = DISCOGS_FETCH_TIMEOUT_MS){
  return await fetchWithTimeout(url, { method: 'GET', headers: discogsHeaders(token), credentials: 'omit', cache: 'no-store' }, timeoutMs);
}
async function fetchDiscogsProxy(url, token, timeoutMs = DISCOGS_FETCH_TIMEOUT_MS){
  const proxyUrl = discogsUrl(url, token, true);
  return await fetchWithTimeout(proxyUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'omit', cache: 'no-store' }, timeoutMs);
}
async function fetchDiscogs(url, timeoutMs = DISCOGS_FETCH_TIMEOUT_MS, tokenOverride = null){
  const token = tokenOverride !== null ? String(tokenOverride).trim() : getDiscogsToken();
  if (!token) throw new Error('No hay token de Discogs configurado.');
  const manualProxy = getDiscogsProxy();
  if (manualProxy){
    try { return await fetchDiscogsProxy(url, token, timeoutMs); }
    catch(err){ throw new Error('No se pudo conectar con Discogs mediante el proxy configurado.'); }
  }
  try { const response = await fetchDiscogsDirect(url, token, timeoutMs); return response; }
  catch(directError){
    if (!isDiscogsNetworkError(directError)) throw directError;
  }
  try { const response = await fetchDiscogsProxy(url, token, Math.max(timeoutMs, 20000)); return response; }
  catch(proxyError){ throw new Error('No se pudo conectar con Discogs.'); }
}
async function testDiscogsConnection(tokenOverride = null, attempt = 1){
  const token = String(tokenOverride ?? getDiscogsToken()).trim();
  if (!token) throw new Error('No hay token configurado.');
  const MAX = 2;
  try {
    const res = await fetchDiscogs(`${DISCOGS_API}/oauth/identity`, DISCOGS_TEST_TIMEOUT_MS, token);
    if (!res.ok){
      let detail = 'HTTP ' + res.status;
      try { const json = await res.json(); if (json?.message) detail += ' · ' + json.message; } catch(_){}
      if (res.status === 401) detail += ' · Token inválido o expirado';
      if (res.status === 403) detail += ' · Acceso rechazado por Discogs';
      if (res.status === 429) detail += ' · Rate limit de Discogs';
      throw new Error(detail);
    }
    return await res.json();
  } catch(err){
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /aborted|timeout/i.test(String(err?.message || ''));
    if (isTimeout && attempt < MAX){ await new Promise(r => setTimeout(r, 1500)); return testDiscogsConnection(tokenOverride, attempt + 1); }
    throw err;
  }
}
function updateDiscogsStatus(kind, text){
  const el = $("#discogsStatus"); if (!el) return;
  const icons = { ok: '🟢', warn: '🟠', error: '🔴', idle: '⚪' };
  el.innerHTML = `${icons[kind] || icons.idle} ${esc(text)}`;
}
function updateDiscogsProtoHint(){
  const el = $("#discogsProtoHint"); if (!el) return;
  const manualProxy = getDiscogsProxy();
  if (isFileProtocol()){
    el.style.display = 'block';
    el.style.background = 'rgba(93,220,154,.08)';
    el.style.borderLeft = '4px solid var(--ok)';
    if (manualProxy){ el.innerHTML = `🟢 <b>file:// + proxy manual:</b> <code>${esc(manualProxy)}</code>.`; }
    else { el.innerHTML = `🟢 <b>file://:</b> se intentará conexión directa y fallback automático.`; }
  } else {
    el.style.display = 'block';
    el.style.background = 'rgba(79,195,247,.08)';
    el.style.borderLeft = '4px solid var(--accent)';
    if (manualProxy){ el.innerHTML = `🟢 <b>Proxy manual activo:</b> <code>${esc(manualProxy)}</code>.`; }
    else { el.innerHTML = `ℹ️ Se usará <b>conexión directa</b> con Discogs (token por header).`; }
  }
  updateDiscogsSecurityWarning();
}
function updateDiscogsSecurityWarning(){
  const el = $("#discogsSecurityWarning"); if (!el) return;
  const manualProxy = getDiscogsProxy();
  const token = getDiscogsToken();
  const shouldShow = !!(token && (manualProxy || isFileProtocol()));
  el.style.display = shouldShow ? 'flex' : 'none';
  if (shouldShow){ el.innerHTML = `<div><b>Seguridad:</b> cuando se usa un proxy, el token viaja en la URL.</div>`; }
}
function openDiscogsConfig(){
  const modal = $("#discogsConfigModal"); if (!modal) return;
  const config = getDiscogsConfig();
  $("#discogsTokenInput").value = config.token || "";
  $("#discogsProxyInput").value = config.proxy || "";
  updateDiscogsStatus(config.token ? 'warn' : 'idle', config.token ? 'Token guardado.' : 'Sin configurar');
  updateDiscogsProtoHint();
  modal.classList.add('open');
}
function closeDiscogsConfig(){ $("#discogsConfigModal")?.classList.remove('open'); }

async function fetchDiscogsReleaseDetails(id){
  if (!id) return null;
  try { await throttleSource("Discogs"); const res = await fetchDiscogs(`${DISCOGS_API}/releases/${id}`); if (!res.ok) return null; const d = await res.json(); const p = d.images?.find(i => i.type === 'primary') || d.images?.[0]; const y = d.year ? parseInt(d.year) : null; return { cover: p?.uri || p?.uri150 || null, year: (y && y >= 1900) ? y : null }; }
  catch(e){ return null; }
}
async function fetchDiscogsMasterDetails(masterId){
  if (!masterId) return null;
  try { await throttleSource("Discogs"); const res = await fetchDiscogs(`${DISCOGS_API}/masters/${masterId}`); if (!res.ok) return null; const d = await res.json(); const y = d.year ? parseInt(d.year) : null; return { year: (y && y >= 1900 && y <= 2100) ? y : null, cover: (d.images?.find(i => i.type === 'primary') || d.images?.[0])?.uri || null, title: d.title || null, masterId: masterId }; }
  catch(e){ return null; }
}
async function fetchCoverArtFromCAA(mbId){
  if (!mbId) return null;
  try { const res = await fetchWithTimeout(`https://coverartarchive.org/release/${mbId}`, {}, 6000); if (!res.ok) return null; const d = await res.json(); if (!Array.isArray(d.images) || !d.images.length) return null; const f = d.images.find(i => i.front) || d.images[0]; return f.image || f.thumbnails?.["500"] || f.thumbnails?.large || f.thumbnails?.["250"] || null; }
  catch(e){ return null; }
}
function cleanDiscogsTitle(raw){ return String(raw||'').replace(/\s*\(\d+\)\s*$/, '').replace(/\s*\[[^\]]*\]\s*$/, '').trim(); }

async function fetchExternalLinks(mbid){
  if (!mbid) return {};
  try {
    await throttleSource("MusicBrainz");
    const res = await fetchWithTimeout(`${MB_API}release/${mbid}?inc=url-rels&fmt=json`, { headers: { 'User-Agent': MB_USER_AGENT } }, 8000);
    if (!res.ok) return {};
    const d = await res.json();
    const links = {};
    for (const rel of (d.relations || [])){
      const url = rel?.url?.resource;
      if (!url) continue;
      for (const svc of STREAMING_SERVICES){
        if (svc.pattern.test(url) && !links[svc.key]) links[svc.key] = url;
      }
    }
    return links;
  } catch(e){ return {}; }
}

function isSafeStreamUrl(url){
  if (!url || typeof url !== 'string') return false;
  if (!/^https:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return ALLOWED_STREAM_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch(e){ return false; }
}

const ResolvedLinks = {
  _cache: null,
  _load(){
    if (this._cache) return this._cache;
    try { this._cache = JSON.parse(localStorage.getItem(RESOLVED_LINKS_KEY) || '{}'); } catch(e){ this._cache = {}; }
    return this._cache;
  },
  get(cdId){
    const c = this._load();
    const e = c[cdId];
    if (!e) return null;
    if (Date.now() - (e.ts||0) > RESOLVED_TTL){ delete c[cdId]; this._persist(); return null; }
    return e.links;
  },
  set(cdId, links){
    const c = this._load();
    c[cdId] = { links, ts: Date.now() };
    const keys = Object.keys(c);
    if (keys.length > RESOLVED_MAX){
      keys.sort((a,b) => (c[a].ts||0) - (c[b].ts||0));
      for (let i = 0; i < 100; i++) delete c[keys[i]];
    }
    this._persist();
  },
  _persist(){ try { localStorage.setItem(RESOLVED_LINKS_KEY, JSON.stringify(this._cache)); } catch(e){} },
  clear(){ this._cache = {}; try { localStorage.removeItem(RESOLVED_LINKS_KEY); } catch(e){} }
};

async function findAppleAlbumMatch(cd){
  const term = `${cd.interprete || ''} ${cd.titulo || ''}`.trim();
  if (!term) return null;
  const countries = ['US', 'AR', 'ES', 'MX'];
  let allResults = [];
  for (const country of countries){
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=50&country=${country}`;
      const r = await fetchWithTimeout(url, { cache: 'no-store' }, 8000);
      if (!r.ok) continue;
      const data = await r.json();
      if (data.results && data.results.length){ allResults = data.results; break; }
    } catch(_){}
  }
  if (!allResults.length) return null;

  const nArtist = normMatch(cd.interprete || '');
  const nTitle  = normMatch(cd.titulo || '');
  const year    = cd.anio ? String(cd.anio) : '';

  const albumsOnly = allResults.filter(r => {
    if (r.wrapperType !== 'collection') return false;
    if (r.collectionType === 'Single') return false;
    if ((r.trackCount || 0) < 4) return false;
    return true;
  });
  const pool = albumsOnly.length ? albumsOnly : allResults;

  const badWords = ['live','en vivo','en directo','compilation','greatest hits',
                    'the best of','best of','anthology','karaoke','tribute',
                    'remastered 20','deluxe edition','bonus tracks'];
  function scoreAlbum(r){
    let s = 0;
    const ra = normMatch(r.artistName || '');
    const rt = normMatch(r.collectionName || '');
    const ry = (r.releaseDate || '').slice(0, 4);
    const tc = r.trackCount || 0;

    if (ra !== nArtist && !ra.includes(nArtist) && !nArtist.includes(ra)) return -1;
    if (ra === nArtist) s += 100;
    else if (ra.includes(nArtist) || nArtist.includes(ra)) s += 50;

    if (rt === nTitle) s += 100;
    else if (rt.includes(nTitle) || nTitle.includes(rt)) s += 40;
    else return -1;

    if (year && ry === year) s += 30;
    else if (year && Math.abs(parseInt(ry) - parseInt(year)) <= 1) s += 10;

    for (const bw of badWords){
      if (rt.includes(bw) && !nTitle.includes(bw)) s -= 60;
    }
    s += Math.min(tc, 20);
    return s;
  }

  const scored = pool.map(r => ({ r, s: scoreAlbum(r) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.length ? scored[0].r : null;
}

const ODESLI_PLATFORM_MAP = {
  spotify: 'spotify',
  appleMusic: 'apple', itunes: 'apple',
  youtubeMusic: 'youtube', youtube: 'youtube',
  amazonMusic: 'amazon', amazon: 'amazon',
  deezer: 'deezer',
  tidal: 'tidal',
  soundcloud: 'soundcloud'
};

async function resolveAllPlatformLinks(appleMusicUrl){
  const links = {};
  if (appleMusicUrl && isSafeStreamUrl(appleMusicUrl)) links.apple = appleMusicUrl;
  try {
    const odesliUrl = `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(appleMusicUrl)}&userCountry=US`;
    const r = await fetchWithTimeout(odesliUrl, { cache: 'no-store' }, 8000);
    if (r.ok){
      const data = await r.json();
      const platforms = data.linksByPlatform || {};
      for (const [odeKey, odeData] of Object.entries(platforms)){
        const ourKey = ODESLI_PLATFORM_MAP[odeKey];
        if (!ourKey || !odeData?.url) continue;
        if (!isSafeStreamUrl(odeData.url)) continue;
        if (!isAlbumUrl(odeData.url, ourKey)) continue;
        if (!links[ourKey]) links[ourKey] = odeData.url;
      }
    } else {
      console.warn('Odesli HTTP', r.status, '— usando solo Apple Music');
    }
  } catch (err){
    console.warn('Odesli no disponible:', err?.message || err);
  }
  return links;
}

function guardarLinksEnCD(cd, links){
  if (!cd.links) cd.links = {};
  let changed = false;
  for (const [k, v] of Object.entries(links)){
    if (v && isSafeStreamUrl(v) && isAlbumUrl(v, k) && !cd.links[k]){ cd.links[k] = v; changed = true; }
  }
  if (changed){
    Store.persist();
    HistoryLog.log('EDIT', `Links de streaming guardados`, cd.titulo);
    AutoBackup.markChange('links streaming');
  }
  return changed;
}

function mostrarModalConfirmacionAlbum(cd, match, links, svcName, svcIcon){
  return new Promise((resolve) => {
    const m = $("#albumConfirmModal");
    const body = $("#albumConfirmBody");
    if (!m || !body){ resolve('cancel'); return; }
    const available = Object.keys(links);
    const cover = match.artworkUrl100 ? match.artworkUrl100.replace('100x100', '300x300') : (cd.portada || '');
    const platformsList = available.map(k => {
      const svc = STREAMING_SERVICES.find(s => s.key === k);
      return svc ? `<span class="ca-plat">${svc.icon} ${esc(svc.name)}</span>` : '';
    }).join('');
    body.innerHTML = `
      <div class="ca-hero">
        ${cover ? `<img src="${esc(cover)}" alt="Portada" onerror="this.style.display='none'">` : `<div style="width:110px;height:110px;border-radius:10px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:2.5rem;border:1px solid var(--line)">💿</div>`}
        <div class="ca-info">
          <h3>${esc(match.collectionName || cd.titulo)}</h3>
          <p>${esc(match.artistName || cd.interprete)}${match.releaseDate ? ` · ${match.releaseDate.slice(0,4)}` : ''}</p>
          <div style="font-size:.72rem;color:var(--muted);margin-top:8px">Se abrirá en <b style="color:var(--accent)">${esc(svcName)}</b></div>
        </div>
      </div>
      <div class="ca-plats">${platformsList || '<span style="color:var(--muted);font-size:.78rem">Sin plataformas disponibles</span>'}</div>
      <div class="ca-warn">⚠️ Si no es el álbum correcto (versión en vivo, cover, edición especial), elegí "Buscar manualmente".</div>
    `;
    const modalBox = m.querySelector('.modal');
    modalBox.querySelector('.ca-foot')?.remove();
    const footer = document.createElement('div');
    footer.className = 'ca-foot modal-foot';
    footer.innerHTML = `
      <button type="button" class="btn" data-dec="cancel">✗ Buscar manualmente</button>
      <button type="button" class="btn" data-dec="once">🔗 Solo abrir</button>
      <button type="button" class="btn primary" data-dec="save">⭐ Recordar</button>
    `;
    modalBox.appendChild(footer);
    function cleanup(dec){
      m.classList.remove('open');
      modalBox.querySelector('.ca-foot')?.remove();
      document.body.style.overflow = '';
      resolve(dec);
    }
    footer.querySelectorAll('button[data-dec]').forEach(b => {
      b.addEventListener('click', () => cleanup(b.dataset.dec));
    });
    const closeBtn = $("#albumConfirmClose");
    const closeHandler = () => cleanup('cancel');
    closeBtn?.addEventListener('click', closeHandler, { once: true });
    const overlayHandler = (e) => { if (e.target.id === 'albumConfirmModal') cleanup('cancel'); };
    m.addEventListener('click', overlayHandler, { once: true });
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}

function abrirBuscadorWebManual(cd, svcKey){
  const q = encodeURIComponent(`${cd.interprete || ''} ${cd.titulo || ''}${cd.anio ? ' ' + cd.anio : ''}`.trim());
  const urls = {
    spotify: `https://open.spotify.com/search/${q}/albums`,
    youtube: `https://music.youtube.com/search?q=${q}&sp=EgIQAw%253D%253D`,
    apple: `https://music.apple.com/search?term=${q}&entity=album`,
    deezer: `https://www.deezer.com/search/${q}/album`,
    tidal: `https://tidal.com/search?q=${q}`,
    amazon: `https://music.amazon.com/search/${q}`,
    soundcloud: `https://soundcloud.com/search?q=${q}`,
    discogs: `https://www.discogs.com/search/?q=${q}&type=release`
  };
  const url = urls[svcKey];
  if (url && isSafeStreamUrl(url)) window.open(url, '_blank', 'noopener');
}

function attachLongPress(el, callback, ms=600){
  let timer = null;
  let wasLong = false;
  const start = () => {
    wasLong = false;
    timer = setTimeout(() => {
      wasLong = true;
      if (navigator.vibrate) navigator.vibrate(30);
      callback();
    }, ms);
  };
  const cancel = () => { if (timer){ clearTimeout(timer); timer = null; } };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', (e) => { cancel(); if (wasLong){ e.preventDefault(); e.stopPropagation(); } }, { passive: false });
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('touchmove', cancel);
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', (e) => { cancel(); if (wasLong){ e.preventDefault(); e.stopPropagation(); } });
  el.addEventListener('mouseleave', cancel);
  el.addEventListener('click', (e) => { if (wasLong){ e.preventDefault(); e.stopPropagation(); wasLong = false; } }, true);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

function removeResolvedLinkFromCD(cd, svcKey){
  if (!cd.links || !cd.links[svcKey]) return false;
  delete cd.links[svcKey];
  Store.persist();
  HistoryLog.log('EDIT', `Link quitado: ${svcKey}`, cd.titulo);
  AutoBackup.markChange('link quitado');
  return true;
}

function mostrarMenuQuitarLink(cd, svcKey, svcName, svcIcon){
  return new Promise(resolve => {
    const url = cd.links?.[svcKey] || '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.style.zIndex = '400';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:460px">
        <div class="modal-head">
          <h3><span>🔗</span><span>Link guardado</span></h3>
          <button type="button" class="close" data-mql-x>✕</button>
        </div>
        <div class="modal-body">
          <div style="display:flex;gap:12px;align-items:center;padding:14px;background:rgba(93,220,154,.06);border:1px solid rgba(93,220,154,.3);border-radius:12px;margin-bottom:14px">
            <span style="font-size:1.8rem">${svcIcon}</span>
            <div style="min-width:0;flex:1">
              <div style="font-size:.9rem;font-weight:700">${esc(svcName)}</div>
              <div style="font-size:.72rem;color:var(--muted);margin-top:2px">${esc(cd.titulo || '—')}</div>
            </div>
          </div>
          <div style="font-size:.76rem;color:var(--warn);padding:10px 12px;background:rgba(255,169,77,.06);border-left:3px solid var(--warn);border-radius:8px;line-height:1.55">
            Si quitás este link, la próxima vez que toques <b>${svcIcon} ${esc(svcName)}</b> te voy a preguntar de nuevo.
          </div>
          <div style="margin-top:10px;padding:10px 12px;background:rgba(79,195,247,.06);border-left:3px solid var(--accent);border-radius:8px;font-size:.72rem;color:var(--muted);line-height:1.5;word-break:break-all">
            <b>URL actual:</b><br>${esc(url)}
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-mql-cancel>Cancelar</button>
          <div class="right"><button type="button" class="btn danger" data-mql-remove>🗑️ Quitar link</button></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cerrar = (resultado) => { overlay.remove(); resolve(resultado); };
    overlay.querySelector('[data-mql-x]').addEventListener('click', () => cerrar(false));
    overlay.querySelector('[data-mql-cancel]').addEventListener('click', () => cerrar(false));
    overlay.querySelector('[data-mql-remove]').addEventListener('click', () => cerrar(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) cerrar(false); });
  });
}

function mostrarMenuResetearLinks(cd){
  return new Promise(resolve => {
    const links = cd.links || {};
    const keys = Object.keys(links).filter(k => STREAMING_SERVICES.some(s => s.key === k));
    if (!keys.length){ resolve(false); return; }
    const lista = keys.map(k => {
      const svc = STREAMING_SERVICES.find(s => s.key === k);
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:.82rem"><span style="font-size:1.1rem">${svc?.icon||'🔗'}</span><span>${esc(svc?.name||k)}</span></div>`;
    }).join('');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.style.zIndex = '400';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:460px">
        <div class="modal-head">
          <h3><span>🔄</span><span>Resetear links guardados</span></h3>
          <button type="button" class="close" data-mrl-x>✕</button>
        </div>
        <div class="modal-body">
          <div style="font-size:.82rem;color:var(--muted);line-height:1.55;margin-bottom:12px">
            Se van a quitar <b>${keys.length}</b> link${keys.length === 1 ? '' : 's'} de <b>${esc(cd.titulo || '—')}</b>.
          </div>
          <div style="padding:12px 14px;background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:10px">${lista}</div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-mrl-cancel>Cancelar</button>
          <div class="right"><button type="button" class="btn danger" data-mrl-reset>🗑️ Quitar todos</button></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cerrar = (resultado) => { overlay.remove(); resolve(resultado); };
    overlay.querySelector('[data-mrl-x]').addEventListener('click', () => cerrar(false));
    overlay.querySelector('[data-mrl-cancel]').addEventListener('click', () => cerrar(false));
    overlay.querySelector('[data-mrl-reset]').addEventListener('click', () => cerrar(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) cerrar(false); });
  });
}

function wireStreamingSectionEvents(section, cd){
  if (!section || !cd) return;
  section.querySelectorAll('[data-smart-search]').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    const svcKey = btn.dataset.smartSearch;
    const svcDef = STREAMING_SERVICES.find(s => s.key === svcKey);
    if (!svcDef) return;
    btn.addEventListener('click', () => {
      if (btn.dataset.busy === '1') return;
      btn.dataset.busy = '1';
      buscarYReproducir(cd, svcDef.key, svcDef.name, svcDef.icon, btn).finally(() => { delete btn.dataset.busy; });
    });
  });

  section.querySelectorAll('[data-saved-key]').forEach(el => {
    const svcKey = el.dataset.savedKey;
    const svcDef = STREAMING_SERVICES.find(s => s.key === svcKey);
    if (!svcDef) return;
    if (!el.dataset.wired){
      el.dataset.wired = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const url = cd.links?.[svcKey];
        if (url && isSafeStreamUrl(url)) window.open(url, '_blank', 'noopener');
        else Toast.show('🔒 URL no permitida', 'warn', 3000);
      });
      attachLongPress(el, async () => {
        const quitar = await mostrarMenuQuitarLink(cd, svcKey, svcDef.name, svcDef.icon);
        if (quitar){
          removeResolvedLinkFromCD(cd, svcKey);
          refreshStreamingSectionInDetail(cd);
          Toast.show(`🗑️ Link de ${svcDef.name} quitado`, 'info', 2500);
        }
      });
    }
  });

  const resetBtn = section.querySelector('#resetLinksBtn');
  if (resetBtn && !resetBtn.dataset.wired){
    resetBtn.dataset.wired = '1';
    resetBtn.addEventListener('click', async () => {
      const confirmar = await mostrarMenuResetearLinks(cd);
      if (confirmar){
        const keys = Object.keys(cd.links || {}).filter(k => STREAMING_SERVICES.some(s => s.key === k));
        keys.forEach(k => delete cd.links[k]);
        Store.persist();
        HistoryLog.log('EDIT', `Links reseteados`, `${keys.length} · ${cd.titulo}`);
        AutoBackup.markChange('reset links');
        refreshStreamingSectionInDetail(cd);
        Toast.show(`🗑️ ${keys.length} link${keys.length === 1 ? '' : 's'} quitado${keys.length === 1 ? '' : 's'}`, 'info', 2800);
      }
    });
  }
}

function refreshStreamingSectionInDetail(cd){
  const viewBody = $("#viewBody");
  if (!viewBody) return;
  const oldSection = viewBody.querySelector('.stream-section');
  if (!oldSection) return;
  const temp = document.createElement('div');
  temp.innerHTML = renderStreamingSection(cd);
  const newSection = temp.firstElementChild;
  if (!newSection) return;
  oldSection.replaceWith(newSection);
  wireStreamingSectionEvents(newSection, cd);
}

async function buscarYReproducir(cd, svcKey, svcName, svcIcon, triggerBtn){
  const original = triggerBtn ? triggerBtn.innerHTML : '';

  if (cd.links && cd.links[svcKey]){
    const url = cd.links[svcKey];
    if (!isSafeStreamUrl(url)){ Toast.show('🔒 URL no permitida', 'warn', 3500); return; }
    window.open(url, '_blank', 'noopener');
    return;
  }

  const cached = ResolvedLinks.get(cd.id);
  if (cached && cached[svcKey]){
    const url = cached[svcKey];
    if (!isSafeStreamUrl(url)){ Toast.show('🔒 URL no permitida', 'warn', 3000); return; }
    window.open(url, '_blank', 'noopener');
    return;
  }

  if (triggerBtn){
    triggerBtn.disabled = true;
    triggerBtn.classList.add('busy');
    triggerBtn.innerHTML = `<span class="si">${svcIcon}</span><span class="sn">Buscando…</span><span class="sx">⏳</span>`;
  }

  try {
    const appleMatch = await findAppleAlbumMatch(cd);
    if (!appleMatch) throw new Error('No encontré el álbum en iTunes.');
    if (!appleMatch.collectionViewUrl) throw new Error('Sin URL de Apple Music');

    const links = await resolveAllPlatformLinks(appleMatch.collectionViewUrl);
    if (!links[svcKey] && !links.apple && !Object.keys(links).length){
      throw new Error(`No encontré links de streaming para ${svcName}`);
    }
    if (!links[svcKey] && links.apple && svcKey !== 'apple'){
      links._fallbackService = svcKey;
    }

    if (triggerBtn){
      triggerBtn.innerHTML = original;
      triggerBtn.disabled = false;
      triggerBtn.classList.remove('busy');
    }

    const decision = await mostrarModalConfirmacionAlbum(cd, appleMatch, links, svcName, svcIcon);
    if (decision === 'cancel'){ abrirBuscadorWebManual(cd, svcKey); return; }
    ResolvedLinks.set(cd.id, links);
    if (decision === 'save'){
      guardarLinksEnCD(cd, links);
      refreshStreamingSectionInDetail(cd);
      Toast.show('⭐ Guardado', 'ok', 2800);
    }
    let finalUrl = links[svcKey];
    if (!finalUrl && links.apple && svcKey !== 'apple'){
      Toast.show(`⚠️ ${svcName} no disponible vía API. Abriendo Apple Music / buscador…`, 'warn', 4000);
      finalUrl = links.apple;
      setTimeout(() => abrirBuscadorWebManual(cd, svcKey), 600);
    }
    if (!isSafeStreamUrl(finalUrl)){ Toast.show('🔒 URL bloqueada', 'warn', 4000); return; }
    window.open(finalUrl, '_blank', 'noopener');
  } catch (error){
    Toast.show('⚠️ ' + error.message, 'warn', 4500);
    if (triggerBtn){ triggerBtn.innerHTML = original; triggerBtn.disabled = false; triggerBtn.classList.remove('busy'); }
    abrirBuscadorWebManual(cd, svcKey);
  }
}

function renderStreamingSection(cd){
  const cdLinks = cd.links || {};
  const knownKeys = STREAMING_SERVICES.map(s => s.key);
  const directCount = Object.keys(cdLinks).filter(k => knownKeys.includes(k) && isSafeStreamUrl(cdLinks[k])).length;
  const otherLinks = Object.entries(cdLinks).filter(([k, v]) => !knownKeys.includes(k) && isSafeStreamUrl(v));

  const parts = [];
  if (cd.titulo)     parts.push(`"${cd.titulo}"`);
  if (cd.interprete) parts.push(`"${cd.interprete}"`);
  if (cd.anio)       parts.push(String(cd.anio));
  const q = encodeURIComponent(parts.join(' ').trim());

  const discogsSearch = `https://www.discogs.com/search/?q=${q}&type=release`;
  const SMART_SERVICES = new Set(['spotify', 'youtube', 'apple', 'deezer', 'tidal', 'amazon', 'soundcloud']);

  const badge = directCount > 0
    ? `<span class="stream-count">✅ ${directCount} guardado${directCount === 1 ? '' : 's'}</span>`
    : `<span class="stream-count" style="background:rgba(255,169,77,.15);color:var(--warn);border-color:rgba(255,169,77,.4)">🎯 Búsqueda inteligente</span>`;

  const items = STREAMING_SERVICES.map(svc => {
    const direct = cdLinks[svc.key];
    if (direct && isSafeStreamUrl(direct)){
      return `<button type="button" class="stream-btn direct" style="--svc-color:${svc.color}" data-saved-key="${svc.key}" data-url="${esc(direct)}" title="Abrir en ${esc(svc.name)} — mantené presionado para gestionar">
        <span class="si">${svc.icon}</span><span class="sn">${esc(svc.name)}</span><span class="sx">↗</span>
      </button>`;
    }
    if (svc.key === 'discogs'){
      return `<a href="${esc(discogsSearch)}" target="_blank" rel="noopener" class="stream-btn search" style="--svc-color:${svc.color}" title="Buscar en Discogs">
        <span class="si">${svc.icon}</span><span class="sn">${esc(svc.name)}</span><span class="sx">🔍</span>
      </a>`;
    }
    if (SMART_SERVICES.has(svc.key)){
      return `<button type="button" class="stream-btn search" style="--svc-color:${svc.color}" data-smart-search="${svc.key}" title="Búsqueda inteligente en ${esc(svc.name)}">
        <span class="si">${svc.icon}</span><span class="sn">${esc(svc.name)}</span><span class="sx">🎯</span>
      </button>`;
    }
    return '';
  }).join('');

  const othersHTML = otherLinks.length ? `
    <div style="margin-top:12px">
      <div style="font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px">🔗 Otros enlaces</div>
      <div class="stream-grid">${otherLinks.filter(([,url]) => isSafeStreamUrl(url)).map(([k, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener" class="stream-btn direct" style="--svc-color:var(--purple)"><span class="si">🔗</span><span class="sn">${esc(k)}</span><span class="sx">↗</span></a>`).join('')}</div>
    </div>` : '';

  let note = '';
  if (directCount === 0 && !otherLinks.length){
    note = `<div class="stream-hint-note stream-hint-warn">💡 <b style="color:var(--warn)">Sin links guardados.</b> Tocá un servicio 🎯. Te muestro el álbum encontrado y podés <b style="color:var(--accent2)">⭐ Recordar</b> para que la próxima abra directo.</div>`;
  } else if (directCount > 0){
    note = `<div class="stream-hint-note stream-hint-ok">
      💾 <b style="color:var(--ok)">${directCount} link${directCount === 1 ? '' : 's'} guardado${directCount === 1 ? '' : 's'}</b>. Tocá cualquiera y abre directo.
      <div style="margin-top:8px;font-size:.68rem;color:var(--muted);line-height:1.5">🔧 <b>¿Te equivocaste con alguno?</b> Mantené presionado el link guardado (600 ms) para quitarlo.</div>
    </div>`;
  }

  const resetBtn = directCount > 0 ? `<button type="button" id="resetLinksBtn">🔄 Resetear todos los links guardados</button>` : '';

  return `<div class="stream-section">
    <div class="stream-head">
      <span>🎧 Escuchar en ${badge}</span>
      <span class="lock">🔒 Solo streaming</span>
    </div>
    <div class="stream-grid">${items}</div>
    ${othersHTML}
    ${note}
    ${resetBtn}
    <div class="stream-note">✅ <b style="color:var(--ok)">Solo reproducción legal.</b> Este visor <b>no descarga</b> ni aloja contenido.</div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   LEGAL
   ═══════════════════════════════════════════════════════════════════ */

async function firmarAceptacionLegal(){
  const payload = `v${APP_VERSION}|${Date.now()}|${navigator.userAgent}|${location.origin}`;
  try {
    if (crypto?.subtle?.digest){
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    }
  } catch(e){}
  let h = 0;
  const s = `v${APP_VERSION}|${Date.now()}|${navigator.userAgent}`;
  for (let i = 0; i < s.length; i++){ h = (h*31 + s.charCodeAt(i)) | 0; }
  return 'fallback_' + Math.abs(h).toString(16);
}

function buildLegalBodyHTML(){
  const sig = (() => { try { return JSON.parse(localStorage.getItem(LEGAL_SIGNATURE_KEY) || 'null'); } catch(e){ return null; } })();
  const accepted = localStorage.getItem(LEGAL_NOTICE_KEY) === '1';
  const acceptedLine = (accepted && sig)
    ? `<div class="lg-sig"><b>Aceptado:</b> ${esc(sig.acceptedAt || '—')}<br><b>Firma SHA-256:</b> ${esc(sig.hash || '—')}<br><b>Versión:</b> ${esc(sig.version || APP_VERSION)}</div>` : '';
  return `
    <div class="legal-hero">
      <span class="lh-icon">⚖️</span>
      <div>
        <h3>Información importante sobre el uso de la app</h3>
        <p>Discografía v${APP_VERSION} es una herramienta de catalogación personal.</p>
      </div>
    </div>
    <div class="lg-box yes"><b>✅ Lo que SÍ hace</b><ul>
      <li>Abre el reproductor oficial del servicio elegido.</li>
      <li>Pre-carga la búsqueda del álbum.</li>
      <li>Usa APIs públicas (iTunes Search, MusicBrainz; Odesli si disponible).</li>
      <li>Guarda localmente el link directo si el usuario lo confirma.</li>
    </ul></div>
    <div class="lg-box no"><b>❌ Lo que NO hace</b><ul>
      <li>NO descarga audio ni video.</li>
      <li>NO reproduce contenido de forma no autorizada.</li>
      <li>NO evade DRM ni extrae streams.</li>
      <li>NO comparte tu colección con terceros.</li>
    </ul></div>
    <div class="lg-box info"><b>🛡️ Whitelist de dominios</b>
      <ul>${ALLOWED_STREAM_DOMAINS.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
    </div>
    <label class="lg-check">
      <input type="checkbox" id="legalAcepto">
      <span>He leído y acepto los términos. Entiendo que la app <b>NO descarga contenido</b>.</span>
    </label>
    ${acceptedLine}
  `;
}

function openLegalModal(){
  const m = $("#legalModal");
  const body = $("#legalBody");
  if (!m || !body) return;
  body.innerHTML = buildLegalBodyHTML();
  const chk = $("#legalAcepto");
  const btn = $("#legalAceptar");
  if (chk && btn){
    chk.checked = false;
    btn.disabled = true;
    btn.style.opacity = '.45';
    btn.style.cursor = 'not-allowed';
    if (chk._legalHandler){
      try { chk.removeEventListener('change', chk._legalHandler); } catch(_){}
      chk._legalHandler = null;
    }
    const handler = () => {
      btn.disabled = !chk.checked;
      btn.style.opacity = chk.checked ? '1' : '.45';
      btn.style.cursor = chk.checked ? 'pointer' : 'not-allowed';
    };
    chk.addEventListener('change', handler);
    chk._legalHandler = handler;
  }
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLegalModal(){
  const chk = $("#legalAcepto");
  if (chk && chk._legalHandler){
    try { chk.removeEventListener('change', chk._legalHandler); } catch(_){}
    chk._legalHandler = null;
  }
  $("#legalModal")?.classList.remove('open');
  document.body.style.overflow = '';
}

async function aceptarLegal(){
  const chk = $("#legalAcepto");
  if (chk && !chk.checked){ Toast.show('⚠️ Marcá la casilla primero', 'warn', 3000); return; }
  const hash = await firmarAceptacionLegal();
  try {
    localStorage.setItem(LEGAL_NOTICE_KEY, '1');
    localStorage.setItem(LEGAL_SIGNATURE_KEY, JSON.stringify({
      hash, version: APP_VERSION,
      acceptedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      origin: location.origin
    }));
  } catch(e){}
  closeLegalModal();
  HistoryLog.log('INFO', 'Aviso legal aceptado', `Firma: ${hash.slice(0,16)}…`);
  Toast.show(`✅ Aviso aceptado · Firma: ${hash.slice(0,12)}…`, 'ok', 3500);
}

function exportLegalPDF(){
  const sig = (() => { try { return JSON.parse(localStorage.getItem(LEGAL_SIGNATURE_KEY) || 'null'); } catch(e){ return null; } })();
  const o = OwnerConfig.get();
  const now = new Date().toLocaleString('es-AR');
  const win = window.open('', '_blank');
  if (!win){ Toast.show('Permitir popups', 'warn', 5000); return; }
  win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Aviso legal — Discografía v${APP_VERSION}</title>
  <style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:'Segoe UI',Roboto,sans-serif;color:#1a2332;line-height:1.6;padding:24px;font-size:11pt}h1{margin:0 0 6px;font-size:20pt;color:#1976d2}h2{margin:22px 0 10px;font-size:13pt;color:#333;border-bottom:2px solid #1976d2;padding-bottom:6px}.meta{font-size:9pt;color:#666;margin-bottom:20px}ul{padding-left:22px;margin:8px 0}li{margin:5px 0}.box{padding:12px 14px;border-radius:8px;margin:12px 0;font-size:10.5pt}.yes{background:#e8f5e9;border-left:4px solid #2ea043}.no{background:#ffebee;border-left:4px solid #d32f2f}.info{background:#e3f2fd;border-left:4px solid #1976d2}.sig{font-family:ui-monospace,Menlo,monospace;font-size:8.5pt;background:#f5f7fa;padding:12px;border-radius:6px;word-break:break-all;margin-top:14px}.foot{margin-top:40px;padding-top:14px;border-top:1px solid #ddd;font-size:9pt;color:#888;text-align:center}@media print{body{padding:0}}</style></head><body>
  <h1>⚖️ Aviso legal — Discografía v${APP_VERSION}</h1>
  <div class="meta">Generado: ${esc(now)} · ${esc(o.name || DEFAULT_AUTHOR)} · ${esc(OwnerConfig.contactLine() || DEFAULT_PHONE)}</div>
  <h2>1. Qué es</h2><p>Herramienta de catalogación personal de CDs.</p>
  <h2>2. Lo que SÍ hace</h2><div class="box yes"><ul><li>Abre el reproductor oficial.</li><li>Usa APIs públicas.</li></ul></div>
  <h2>3. Lo que NO hace</h2><div class="box no"><ul><li>NO descarga audio.</li><li>NO evade DRM.</li><li>NO sube datos a servidores propios.</li></ul></div>
  <h2>4. Whitelist</h2><div class="box info"><ul>${ALLOWED_STREAM_DOMAINS.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>
  ${sig ? `<h2>5. Firma SHA-256</h2><div class="sig"><b>Hash:</b> ${esc(sig.hash || '—')}<br><b>Fecha:</b> ${esc(sig.acceptedAt || '—')}</div>` : ''}
  <div class="foot">Discografía v${APP_VERSION} — ${esc(o.name || DEFAULT_AUTHOR)} — ${esc(COPYRIGHT_TEXT)}</div>
  <script>setTimeout(()=>window.print(),500)<\/script></body></html>`);
  win.document.close();
  HistoryLog.log('EXPORT', 'Aviso legal exportado a PDF');
}

function maybeShowLegalOnFirstRun(){
  if (localStorage.getItem(LEGAL_NOTICE_KEY) === '1') return;
  setTimeout(() => { if (!isAnyModalOpen()) openLegalModal(); }, 1500);
}

/* ═══════════════════════════════════════════════════════════════════
   MusicBrainz
   ═══════════════════════════════════════════════════════════════════ */

async function enrichFromMusicBrainz(titulo, interprete, hints = {}){
  if (!titulo || !interprete) return null;
  const waitMs = _mb503Until - Date.now();
  if (waitMs > 0){
    _lastCallBySource.MusicBrainz = 0;
    throw new Error('COOLDOWN');
  }

  const tituloLimpio = limpiarTituloParaBusqueda(titulo);
  const interpreteLimpio = limpiarInterpreteParaBusqueda(interprete);

  const strategies = [
    { name: 'exacta',        query: `release:"${titulo}" AND artist:"${interprete}"` },
    { name: 'limpia',        query: `release:"${tituloLimpio}" AND artist:"${interpreteLimpio}"` },
    { name: 'sin-comillas',  query: `release:${tituloLimpio} AND artist:${interpreteLimpio}` },
    { name: 'solo-titulo',   query: `release:"${tituloLimpio}"` }
  ];
  const seen = new Set();
  const uniqueStrategies = strategies.filter(s => { if (seen.has(s.query)) return false; seen.add(s.query); return true; });

  let lastError = 'no-results';
  for (const strat of uniqueStrategies){
    try {
      await throttleSource("MusicBrainz");
      const q = encodeURIComponent(strat.query);
      const res = await fetchWithTimeout(`${MB_API}release?query=${q}&fmt=json&limit=10&inc=release-groups`, { headers: { 'User-Agent': MB_USER_AGENT } });
      if (res.status === 503){
        _mb503Until = Date.now() + 60000;
        console.warn(`[MB] ❄️ 503 — enfriando 60s`);
        throw new Error('COOLDOWN');
      }
      if (res.status === 429){
        const ra = parseInt(res.headers.get('Retry-After') || '60');
        _mb503Until = Date.now() + Math.max(60000, ra * 1000);
        throw new Error('COOLDOWN');
      }
      if (!res.ok){ lastError = 'HTTP ' + res.status; continue; }
      const d = await res.json();
      if (!d.releases?.length){ lastError = 'no-results'; continue; }

      const añosH = hints.anio ? parseInt(hints.anio) : null;
      const ranked = d.releases.map(r => {
        const ct = r.title;
        const ca = (r["artist-credit"] || []).map(x => x.name || x.artist?.name).join(" ");
        let sc = matchConfidence(tituloLimpio, interpreteLimpio, { title: ct, artist: ca });
        const rgd = r['release-group']?.['first-release-date'];
        if (añosH && rgd){ const y = parseInt(String(rgd).slice(0, 4), 10); if (Number.isFinite(y) && Math.abs(y - añosH) <= 1) sc = Math.min(100, sc + 8); }
        if (Array.isArray(r.format) && r.format.some(f => /cd/i.test(f))) sc = Math.min(100, sc + 3);
        const rgTitle = r['release-group']?.title || '';
        if (rgTitle && normMatch(rgTitle) === normMatch(tituloLimpio)) sc = Math.min(100, sc + 15);
        return { r, ct, ca, sc };
      }).sort((a, b) => b.sc - a.sc);

      if (!ranked.length || ranked[0].sc < 40){ lastError = 'low-confidence'; continue; }

      let best = null, coverUrl = null, externalLinks = {};
      for (const c of ranked.slice(0, 3)){
        const [cc, lk] = await Promise.all([fetchCoverArtFromCAA(c.r.id), fetchExternalLinks(c.r.id)]);
        if (cc){ best = c; coverUrl = cc; externalLinks = lk; break; }
        if (!best){ best = c; externalLinks = lk; }
      }
      if (!best){ lastError = 'no-cover'; continue; }

      const r = best.r;
      let anio = null;
      const rgDate = r['release-group']?.['first-release-date'];
      if (rgDate) anio = normalizeYear(String(rgDate).slice(0, 4));
      if (!anio && r.date) anio = normalizeYear(String(r.date).slice(0, 4));
      if (!anio && Array.isArray(r['release-events']) && r['release-events'][0]?.date){ anio = normalizeYear(String(r['release-events'][0].date).slice(0, 4)); }
      const anioPrensada = normalizeYear(r.date ? String(r.date).slice(0, 4) : null);

      console.log(`[MB] ✅ "${strat.name}" → ${best.ct} — ${best.ca} (score ${best.sc})`);
      return enrichMeta({
        source: "MusicBrainz", anio, anioPrensada, anioMaster: anio,
        sello: r['label-info']?.[0]?.label?.name || '', pais: r.country || '',
        catalogo: r['label-info']?.[0]?.['catalog-number'] || '',
        genero: r['release-group']?.genres?.[0]?.name || r.genres?.[0]?.name || r.tags?.[0]?.name || '',
        mbId: r.id, releaseGroupId: r['release-group']?.id || null,
        portada: coverUrl, portadaSource: coverUrl ? "MusicBrainz CAA" : null,
        links: externalLinks,
        _title: upper(best.ct), _artist: upper(best.ca),
        _strategy: strat.name
      }, titulo, interprete, best.sc);
    } catch(err){
      if (err.message === 'COOLDOWN') throw err;
      lastError = err.message;
    }
  }
  console.warn(`[MB] ❌ "${titulo}" de "${interprete}" → ${lastError}`);
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   Discogs
   ═══════════════════════════════════════════════════════════════════ */

async function enrichFromDiscogs(titulo, interprete, hints = {}){
  if (!getDiscogsToken()) return null;
  if (!titulo && !interprete && !hints.barcode) return null;
  const waitMs = _discogs429Until - Date.now();
  if (waitMs > 0){ _lastCallBySource.Discogs = 0; throw new Error('COOLDOWN'); }

  const tituloLimpio = limpiarTituloParaBusqueda(titulo);
  const interpreteLimpio = limpiarInterpreteParaBusqueda(interprete);
  const tituloParaQuery = tituloLimpio || titulo;
  const interpreteParaQuery = interpreteLimpio || interprete;

  const añosH  = hints.anio ? parseInt(hints.anio) : null;
  const paísH  = (hints.pais     || '').trim().toLowerCase();
  const selloH = (hints.sello    || '').trim().toLowerCase();
  const catH   = (hints.catalogo || '').trim().toLowerCase();
  const bcClean = hints.barcode ? String(hints.barcode).replace(/\s+/g,'') : '';
  let results = [];
  try {
    if (bcClean){
      await throttleSource("Discogs");
      const params = new URLSearchParams({ barcode: bcClean, type: 'release', per_page: '10' });
      const res = await fetchDiscogs(`${DISCOGS_API}/database/search?${params.toString()}`);
      if (res.status === 429){ const ra = parseInt(res.headers.get('Retry-After') || '60'); _discogs429Until = Date.now() + Math.max(30000, ra*1000); throw new Error('COOLDOWN'); }
      if (res.ok){ const d = await res.json(); if (d.results?.length) results = d.results; }
    }
    if (!results.length && tituloParaQuery && interpreteParaQuery){
      await throttleSource("Discogs");
      const params = new URLSearchParams({ artist: interpreteParaQuery, release_title: tituloParaQuery, type: 'release', per_page: '10' });
      const res = await fetchDiscogs(`${DISCOGS_API}/database/search?${params.toString()}`);
      if (res.status === 429){ const ra = parseInt(res.headers.get('Retry-After') || '60'); _discogs429Until = Date.now() + Math.max(30000, ra*1000); throw new Error('COOLDOWN'); }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      if (d.results?.length) results = d.results;
    }
    if (!results.length) return null;
    const ranked = results.map(r => {
      const rt = String(r.title || '');
      const sep = rt.includes(' – ') ? ' – ' : ' - ';
      const parts = rt.split(sep);
      const ca = parts.length > 1 ? parts[0].trim() : '';
      const ct = parts.length > 1 ? cleanDiscogsTitle(parts.slice(1).join(sep)) : cleanDiscogsTitle(rt);
      const bs = matchConfidence(tituloLimpio || ct, interpreteLimpio || ca, { title: ct, artist: ca || interpreteLimpio });
      let bonus = 0;
      if (añosH && r.year && Math.abs(parseInt(r.year) - añosH) <= 1) bonus += 8;
      if (paísH && r.country && normMatch(r.country).includes(normMatch(paísH))) bonus += 5;
      if (selloH && Array.isArray(r.label) && r.label.some(l => normMatch(l).includes(normMatch(selloH)))) bonus += 8;
      if (catH && r.catno && normMatch(r.catno).includes(normMatch(catH))) bonus += 15;
      if (Array.isArray(r.format) && r.format.some(f => /cd/i.test(f))) bonus += 3;
      if (bcClean && r.barcode && String(r.barcode).replace(/\s+/g,'') === bcClean) bonus += 25;
      const hc = (r.cover_image && !r.cover_image.includes('spacer.gif')) || (r.thumb && !r.thumb.includes('spacer.gif'));
      if (hc) bonus += 6;
      return { r, ct, ca, score: Math.min(100, bs + bonus), hc };
    }).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.hc !== b.hc) return b.hc ? 1 : -1;
      return 0;
    });
    const best = ranked[0];
    if (!best || Number(best.score || 0) < 70) return null;
    const r = best.r;
    let portada = null;
    if (r.cover_image && !r.cover_image.includes('spacer.gif')) portada = r.cover_image;
    else if (r.thumb && !r.thumb.includes('spacer.gif')) portada = r.thumb;
    let anioSearch = normalizeYear(r.year);
    let masterYear = null;
    if (r.master_id){ const master = await fetchDiscogsMasterDetails(r.master_id); if (master){ if (master.year) masterYear = master.year; if (!portada && master.cover) portada = master.cover; } }
    if (masterYear) anioSearch = masterYear;
    if (!portada || !anioSearch){ const det = await fetchDiscogsReleaseDetails(r.id); if (det){ if (!portada) portada = det.cover; if (!anioSearch) anioSearch = det.year; } }
    anioSearch = normalizeYear(anioSearch);
    return enrichMeta({
      source: 'Discogs', anio: anioSearch, anioPrensada: normalizeYear(r.year), anioMaster: masterYear,
      sello: upper(Array.isArray(r.label) ? (r.label[0] || '') : ''), pais: upper(r.country || ''),
      catalogo: upper(r.catno || ''), genero: upper(Array.isArray(r.genre) ? (r.genre[0] || '') : ''),
      discogsId: r.id, discogsMasterId: r.master_id || null,
      discogsUrl: r.uri ? `https://www.discogs.com${r.uri}` : null,
      portada, portadaSource: portada ? 'Discogs' : null,
      links: r.uri ? { discogs: `https://www.discogs.com${r.uri}` } : {},
      _title: upper(best.ct), _artist: upper(best.ca || interprete),
      _strategy: 'discogs-search'
    }, titulo || best.ct, interprete || best.ca, best.score);
  } catch(err){
    if (err.message === 'COOLDOWN') throw err;
    console.warn('[Discogs]', err.message);
    return null;
  }
}

async function enrichFromChain(titulo, interprete, options = {}){
  const { onSource = null, useSources = null, minConfidence = 70, useCache = true, hints = {}, prioridad = 'discogs' } = options;
  const cy = hints.anio || "";
  if (useCache){
    const c = MetadataCache.get(titulo, interprete, cy);
    if (c && c.portada){ if (onSource){ ["Discogs","MusicBrainz"].forEach(s => onSource(s, s === c.source ? "ok" : "skipped")); } return { ...c, _fromCache: true }; }
  }
  const hT = !!getDiscogsToken();
  const allSources = [
    { name: "Discogs", fn: (t,i,h) => enrichFromDiscogs(t,i,h), enabled: hT },
    { name: "MusicBrainz", fn: (t,i,h) => enrichFromMusicBrainz(t,i,h), enabled: true }
  ];
  const ordered = prioridad === 'musicbrainz'
    ? [allSources[1], allSources[0]]
    : [allSources[0], allSources[1]];
  const sources = ordered.filter(s => s.enabled && (!useSources || useSources.includes(s.name)));
  if (onSource) allSources.filter(s => !s.enabled).forEach(s => onSource(s.name, "skipped"));
  let best = null;
  for (const s of sources){
    if (onSource) onSource(s.name, "querying");
    let info = null;
    try {
      info = await s.fn(titulo, interprete, hints);
    } catch(err){
      if (err.message === 'COOLDOWN'){ if (onSource) onSource(s.name, "skipped"); continue; }
      if (onSource) onSource(s.name, "fail");
      continue;
    }
    if (info){
      verificarFechaEmision(info, hints.anio);
      if (onSource) onSource(s.name, "ok");
      if (!best || Number(info.confidence || 0) > Number(best.confidence || 0)) best = info;
      if (Number(info.confidence || 0) >= 95 && info.portada) break;
      if (best && best.portada && Number(best.confidence || 0) >= 85) break;
    } else if (onSource) onSource(s.name, "fail");
    await new Promise(r => setTimeout(r, 200));
  }
  if (best && Number(best.confidence || 0) < minConfidence) return null;
  if (best && useCache) MetadataCache.set(titulo, interprete, cy, best);
  return best;
}

function showEnrichBar(msg, active = true){ const b = $("#enrichBar"); if (!b) return; b.style.display = "flex"; b.classList.toggle("active", active); $("#enrichMsg").textContent = msg; }
function showEnrichResult(txt, src){ const b = $("#enrichBar"); if (!b) return; b.style.display = "flex"; b.classList.remove("active"); $("#enrichMsg").textContent = src ? `✓ Encontrado en ${src}` : "✓ Info encontrada"; $("#enrichResult").innerHTML = txt; setTimeout(() => b.style.display = "none", 3500); }
function showEnrichSources(states){
  const c = $("#enrichSources"); if (!c) return;
  const s = Object.keys(states);
  if (!s.length){ c.style.display = "none"; c.innerHTML = ""; return; }
  c.style.display = "flex";
  c.innerHTML = `<span class="label">Fuentes:</span>` + s.map(n => {
    const st = states[n] || "";
    const cl = st === "ok" ? "chip ok" : st === "querying" ? "chip querying" : st === "skipped" ? "chip skipped" : st === "fail" ? "chip fail" : "chip";
    return `<span class="${cl}"><span class="dot"></span>${n}</span>`;
  }).join("");
}
function renderCoverPreview(url, source){
  const img = $("#coverPreviewImg"), info = $("#coverPreviewSource"), clr = $("#btnClearCover");
  if (!img || !info) return;
  if (!url){ img.innerHTML = `<div class="cover-empty">💿</div>`; info.textContent = "Sin portada"; if (clr) clr.style.display = "none"; return; }
  img.innerHTML = `<img src="${esc(url)}" alt="Portada" loading="lazy">`;
  info.innerHTML = `<code>${esc(url.slice(0, 45))}${url.length > 45 ? "…" : ""}</code>${source ? `<br><b>${esc(source)}</b>` : ""}`;
  if (clr) clr.style.display = "";
}
async function fetchCoverManually(){
  const t = $("#fTitulo").value.trim(), i = $("#fInterprete").value.trim();
  if (!t || !i){ Toast.show("Completá título e intérprete", "warn"); return; }
  const btn = $("#btnFetchCover"); const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner-xs"></span> Buscando…`;
  const states = {};
  try {
    const info = await enrichFromChain(t, i, { hints: { anio: $("#fAnio")?.value, pais: $("#fPais")?.value, sello: $("#fSello")?.value, catalogo: $("#fCatalogo")?.value, barcode: $("#fCodigo")?.value }, useCache: false, onSource: (n, s) => {
      if (s === 'querying'){ states[n] = 'querying'; showEnrichBar(`Buscando en ${n}…`); } else { states[n] = s === 'ok' ? 'ok' : s === 'skipped' ? 'skipped' : 'fail'; }
      showEnrichSources(states);
    }});
    if (info && info.portada){
      $("#fCoverUrl").value = info.portada;
      $("#fCoverUrl").dataset.enrichmentSource = info.source || "";
      $("#fCoverUrl").dataset.enrichmentConfidence = info.confidence ?? "";
      $("#fCoverUrl").dataset.enrichedAt = info.enrichedAt || "";
      renderCoverPreview(info.portada, info.portadaSource);
      showEnrichBar(`✓ Portada en ${info.source}`);
    } else showEnrichBar("Sin portada");
    setTimeout(() => { $("#enrichBar").style.display = "none"; $("#enrichSources").style.display = "none"; }, 2500);
  } finally { btn.disabled = false; btn.innerHTML = orig; }
}

let _enrichTimer = null, _enrichRequestId = 0;
function scheduleEnrichment(delay = 750){ if (_enrichTimer) clearTimeout(_enrichTimer); _enrichTimer = setTimeout(() => { _enrichTimer = null; autoEnrich(); }, delay); }
async function autoEnrich(){
  const tg = $("#enrichToggle"); if (!tg || !tg.checked) return;
  const t = $("#fTitulo").value.trim(), i = $("#fInterprete").value.trim();
  if (!t || !i) return;
  const myId = ++_enrichRequestId;
  const rc = $("#replaceToggle"); const re = rc ? rc.checked : Store.getPref("replaceOnEnrich", true);
  showEnrichBar("Buscando…"); const states = {};
  const info = await enrichFromChain(t, i, { hints: { anio: $("#fAnio")?.value, pais: $("#fPais")?.value, sello: $("#fSello")?.value, catalogo: $("#fCatalogo")?.value, barcode: $("#fCodigo")?.value }, onSource: (n, s) => {
    if (s === 'querying'){ states[n] = 'querying'; showEnrichBar(`Consultando ${n}…`); } else { states[n] = s === 'ok' ? 'ok' : s === 'skipped' ? 'skipped' : 'fail'; }
    showEnrichSources(states);
  }});
  if (myId !== _enrichRequestId) return;
  if (!info){ showEnrichBar("Sin datos"); setTimeout(() => { $("#enrichBar").style.display = "none"; $("#enrichSources").style.display = "none"; }, 2500); return; }
  const campos = [], reps = [];
  const cv = s => String($(s)?.value ?? "").trim();
  function ap(sel, nv, l){
    if (nv === null || nv === undefined || nv === "") return;
    const ov = cv(sel);
    if (re){ if (ov && ov !== String(nv)) reps.push(`${l}: ${ov} → ${nv}`); $(sel).value = nv; campos.push(l); }
    else if (!ov){ $(sel).value = nv; campos.push(l); }
  }
  (function(){
    const anioAlbumActual = parseInt(cv("#fAnio")) || null;
    const anioApi = info.anio;
    if (anioApi && anioAlbumActual && (anioApi - anioAlbumActual) > 5){
      const anioEdActual = parseInt(cv("#fAnioEdicion")) || null;
      if (re || !anioEdActual){
        if (anioEdActual !== anioApi){ $("#fAnioEdicion").value = anioApi; campos.push("📅 Año edición"); }
      }
    } else { ap("#fAnio", anioApi, "Año álbum"); }
  })();
  ap("#fSello", upper(info.sello), "Sello");
  ap("#fGenero", upper(info.genero), "Género");
  ap("#fPais", upper(info.pais), "País");
  ap("#fCatalogo", upper(info.catalogo), "Catálogo");
  if (info._title){
    const nuevo = corregirCampo(cv("#fTitulo"), upper(info._title), info.confidence, re);
    if (nuevo && nuevo !== cv("#fTitulo")){ reps.push(`Título: "${cv("#fTitulo")}" → "${nuevo}"`); $("#fTitulo").value = upper(nuevo); campos.push("🎵 Título"); }
  }
  if (info._artist){
    const nuevo = corregirCampo(cv("#fInterprete"), upper(info._artist), info.confidence, re);
    if (nuevo && nuevo !== cv("#fInterprete")){ reps.push(`Intérprete: "${cv("#fInterprete")}" → "${nuevo}"`); $("#fInterprete").value = upper(nuevo); campos.push("🎤 Intérprete"); }
  }
  if (info.portada){
    const oc = cv("#fCoverUrl");
    if (re || !oc){
      if (oc && oc !== info.portada) reps.push("Portada reemplazada");
      $("#fCoverUrl").value = info.portada;
      $("#fCoverUrl").dataset.enrichmentSource = info.source || "";
      $("#fCoverUrl").dataset.enrichmentConfidence = info.confidence ?? "";
      $("#fCoverUrl").dataset.enrichedAt = info.enrichedAt || "";
      renderCoverPreview(info.portada, info.portadaSource);
      campos.push("🖼️ Portada");
    }
  }
  if (info.links && Object.keys(info.links).length){
    const actuales = (() => { try { return JSON.parse($("#fLinks").value || '{}'); } catch(e){ return {}; } })();
    const merged = re ? { ...actuales, ...info.links } : { ...info.links, ...actuales };
    $("#fLinks").value = JSON.stringify(merged);
    campos.push("🎧 Links streaming");
  }
  showEnrichSources(states);
  if (reps.length) Toast.show(`🔄 ${reps.join(" · ")}`, "info", 5500);
  if (campos.length) showEnrichResult(campos.join(" · ") + " " + confidenceChip(info.confidence), info.source);
  else { showEnrichBar(`Sin campos nuevos`); setTimeout(() => { $("#enrichBar").style.display = "none"; $("#enrichSources").style.display = "none"; }, 2500); }
}

/* ═══════════════════════════════════════════════════════════════════
   BULK ENRICH
   ═══════════════════════════════════════════════════════════════════ */

const BulkEnrich = (() => {
  let running = false, cancelled = false;
  let stats = { total: 0, ok: 0, skip: 0, fail: 0, fields: 0, covers: 0, cached: 0, links: 0, requeued: 0 };
  let items = [], requeueIdx = [], sourceStats = {}, notFoundInRun = [];

  function log(icon, cls, title, detail){
    const el = $("#bulkLog"); if (!el) return;
    const e = document.createElement("div"); e.className = "log-entry";
    e.innerHTML = `<span class="log-icon">${icon}</span><span class="log-${cls}"><span class="log-title">${esc(title)}</span>${detail ? ` <span class="log-detail">— ${esc(detail)}</span>` : ""}</span>`;
    el.appendChild(e); el.scrollTop = el.scrollHeight;
  }
  function updateSourcesViz(states){
    const el = $("#bulkSourcesViz"); if (!el) return;
    el.innerHTML = ["Discogs","MusicBrainz"].map(s => {
      const st = states[s] || "";
      const cl = st === "ok" ? "sv-chip ok" : st === "querying" ? "sv-chip querying" : st === "skipped" ? "sv-chip skipped" : st === "fail" ? "sv-chip fail" : "sv-chip";
      return `<span class="${cl}"><span class="sv-dot"></span>${s}</span>`;
    }).join("");
  }
  function updateRequeueBadge(){
    const el = $("#bulkRequeue"); if (!el) return;
    if (requeueIdx.length > 0) el.innerHTML = `<span class="requeue-badge">🔁 ${requeueIdx.length} re-encolados</span>`;
    else el.innerHTML = '';
  }
  function reset(){
    running = false; cancelled = false;
    stats = { total: 0, ok: 0, skip: 0, fail: 0, fields: 0, covers: 0, cached: 0, links: 0, requeued: 0 };
    items = []; requeueIdx = []; sourceStats = {}; notFoundInRun = [];
    $("#bulkLog").innerHTML = ""; $("#bulkBar").style.width = "0%"; $("#bulkCurrent").textContent = "0"; $("#bulkTotal").textContent = "0";
    $("#bulkEta").textContent = ""; $("#bulkSourcesViz").innerHTML = "";
    $("#bulkEnrichConfig").style.display = "";
    $("#bulkEnrichProgress").style.display = "none";
    $("#bulkEnrichSummary").style.display = "none";
    $("#bulkEnrichStart").style.display = ""; $("#bulkEnrichStart").disabled = false;
    $("#bulkEnrichStop").style.display = "none"; $("#bulkEnrichStop").disabled = false;
    $("#bulkEnrichStop").textContent = "⏹️ Detener";
    $("#bulkNotFoundActions").style.display = "none";
    const rq = $("#bulkRequeue"); if (rq) rq.innerHTML = '';
  }
  function getFields(){ return { anio: $("#optAnio")?.checked, anioEdicion: $("#optAnioEdicion")?.checked, sello: $("#optSello")?.checked, genero: $("#optGenero")?.checked, pais: $("#optPais")?.checked, catalogo: $("#optCatalogo")?.checked, portada: $("#optPortada")?.checked, links: $("#optLinks")?.checked }; }
  function activeSources(){ const s = []; if ($("#srcDiscogs")?.checked && getDiscogsToken()) s.push("Discogs"); if ($("#srcMB")?.checked) s.push("MusicBrainz"); return s; }
  function needs(cd, f){ if (f.anio && !cd.anio) return true; if (f.anioEdicion && !cd.anioEdicion) return true; if (f.sello && !cd.sello) return true; if (f.genero && !cd.genero) return true; if (f.pais && !cd.pais) return true; if (f.catalogo && !cd.catalogo) return true; if (f.portada && !cd.portada) return true; if (f.links && (!cd.links || !Object.keys(cd.links).length)) return true; return false; }
  function isVarious(cd){ const i = norm(cd.interprete); return i.includes("various") || i.includes("varios") || i.includes("vv.aa") || i.includes("vv aa") || i === ""; }
  function computeItems(){
    const f = getFields();
    const scope = document.querySelector('input[name="scope"]:checked')?.value || "incomplete";
    const forceAll = scope === "all-force";
    const sd = forceAll ? false : ($("#optSkipDone")?.checked !== false);
    const sv = $("#optSkipVarious")?.checked !== false;
    let src = [];
    if (scope === "category"){ if (App.cat && App.cat !== ALL_CATS) src = Store.getCDs(App.cat).map(cd => ({ cd, cat: App.cat })); else for (const k of Store.catKeys()) for (const cd of Store.getCDs(k)) src.push({ cd, cat: k }); }
    else { for (const k of Store.catKeys()) for (const cd of Store.getCDs(k)) src.push({ cd, cat: k }); }
    items = src.filter(({cd}) => { if (sv && isVarious(cd)) return false; if (!forceAll && sd && !needs(cd, f)) return false; return true; });
    return items;
  }
  function updatePreview(){
    const list = computeItems(); const el = $("#bulkPreview"); if (!el) return;
    const f = getFields(); const af = Object.entries(f).filter(([,v]) => v).map(([k]) => k);
    const as = activeSources(); const re = $("#optReplace")?.checked !== false;
    let warn = '';
    if ($("#srcDiscogs")?.checked && !getDiscogsToken()){
      warn = `<div class="bulk-token-warning">⚠️ <b>Discogs está tildado pero NO tenés token configurado.</b> Se usará solo MusicBrainz (rate limit 1 req/seg → puede fallar en lotes grandes). Configurá el token en ⚙️ → 🎚️ Configurar Discogs.</div>`;
    }
    if (!af.length){ el.innerHTML = `⚠️ Seleccioná al menos un campo.${warn}`; $("#bulkEnrichStart").disabled = true; return; }
    if (!as.length){ el.innerHTML = `⚠️ Sin fuentes activas.${warn}`; $("#bulkEnrichStart").disabled = true; return; }
    if (!list.length){ el.innerHTML = `ℹ️ No hay CDs para enriquecer.${warn}`; $("#bulkEnrichStart").disabled = true; return; }
    const modo = re ? "🔄 REEMPLAZO" : "✨ solo vacíos";
    el.innerHTML = `🎯 <b>${list.length}</b> CDs · Modo: <b>${modo}</b>.<br><span style="font-size:.78rem">Campos: <b>${af.join(", ")}</b> · Fuentes: <b>${as.join(" → ")}</b></span>${warn}`;
    $("#bulkEnrichStart").disabled = false;
  }
  async function processOne(idx, as, re, tnf, uc, retry, f){
    const { cd, cat } = items[idx];
    $("#bulkCurrent").textContent = idx + 1; $("#bulkTotal").textContent = items.length;
    $("#bulkBar").style.width = ((idx+1)/items.length*100).toFixed(1) + "%";
    log("🔍", "info", `Buscando: ${cd.titulo}`);
    const rowKey = cdKey(cat, cd); const row = findRowByKey(rowKey);
    if (row && (App.cat === ALL_CATS || cat === App.cat)) row.classList.add("enriching");
    let info = null; const tried = [], states = {};
    if (uc){ const c = MetadataCache.get(cd.titulo, cd.interprete, cd.anio); if (c){ info = { ...c, _fromCache: true }; stats.cached++; states[c.source || "Discogs"] = "ok"; } }
    if (!info){
      for (const sn of as){
        if (sn === "MusicBrainz" && Date.now() < _mb503Until){
          states[sn] = "skipped";
          const waitS = Math.ceil((_mb503Until - Date.now())/1000);
          log("❄️", "warn", "MB enfriando", `${waitS}s · re-encolando`);
          if (!requeueIdx.includes(idx)){ requeueIdx.push(idx); updateRequeueBadge(); }
          continue;
        }
        if (sn === "Discogs" && Date.now() < _discogs429Until){
          states[sn] = "skipped";
          const waitS = Math.ceil((_discogs429Until - Date.now())/1000);
          log("❄️", "warn", "Discogs enfriando", `${waitS}s · re-encolando`);
          if (!requeueIdx.includes(idx)){ requeueIdx.push(idx); updateRequeueBadge(); }
          continue;
        }
        tried.push(sn); states[sn] = "querying"; updateSourcesViz(states);
        let att = 0;
        while (att <= (retry ? 1 : 0)){
          try {
            if (sn === "Discogs") info = await enrichFromDiscogs(cd.titulo, cd.interprete, { anio: cd.anio, pais: cd.pais, sello: cd.sello, catalogo: cd.catalogo, barcode: cd.codigo });
            else info = await enrichFromMusicBrainz(cd.titulo, cd.interprete, { anio: cd.anio });
          } catch(err){
            if (err.message === 'COOLDOWN'){
              if (!requeueIdx.includes(idx)){ requeueIdx.push(idx); updateRequeueBadge(); }
              break;
            }
          }
          if (info && info.portada) break;
          if (info && !f.portada) break;
          att++;
          if (att <= (retry ? 1 : 0)) await new Promise(r => setTimeout(r, 1000));
          if (info) break;
        }
        if (info){ verificarFechaEmision(info, cd.anio); states[sn] = "ok"; if (uc) MetadataCache.set(cd.titulo, cd.interprete, cd.anio, info); }
        else states[sn] = "fail";
        updateSourcesViz(states);
        if (info && info.portada) break;
        if (info && !f.portada) break;
      }
    }
    if (row && (App.cat === ALL_CATS || cat === App.cat)) row.classList.remove("enriching");
    if (!info){
      stats.fail++; log("❌", "err", cd.titulo, "Sin resultados");
      if (tnf) notFoundInRun.push({ catKey: cat, catLabel: Store.get(cat)?.label || cat, nro: cd.nro, titulo: cd.titulo, interprete: cd.interprete, anio: cd.anio ?? null, sources: tried.join(", ") });
      return;
    }
    let changes = 0, reps = 0; const dp = []; const prov = cd.provenance || {}; const stamp = makeProvenance(info.source, info.confidence);
    function ap(k, nv, ov, l){
      if (nv === null || nv === undefined || nv === "") return false;
      const ho = ov !== null && ov !== undefined && String(ov).trim() !== "";
      if (re){ cd[k] = upper(nv); prov[k] = stamp; if (ho && String(ov) !== String(nv)){ dp.push(`${l} ${ov}→${nv}`); reps++; } else dp.push(l); return true; }
      else if (!ho){ cd[k] = upper(nv); prov[k] = stamp; dp.push(l); return true; }
      return false;
    }
    if (info._title && Number(info.confidence) >= 85){
      const nuevo = corregirCampo(cd.titulo, upper(info._title), info.confidence, re);
      if (nuevo && nuevo !== cd.titulo){ if (cd.titulo){ dp.push(`Título "${cd.titulo}"→"${nuevo}"`); reps++; } else dp.push("Título"); cd.titulo = upper(nuevo); prov.titulo = stamp; changes++; }
    }
    if (info._artist && Number(info.confidence) >= 85){
      const nuevo = corregirCampo(cd.interprete, upper(info._artist), info.confidence, re);
      if (nuevo && nuevo !== cd.interprete){ if (cd.interprete){ dp.push(`Intérprete "${cd.interprete}"→"${nuevo}"`); reps++; } else dp.push("Intérprete"); cd.interprete = upper(nuevo); prov.interprete = stamp; changes++; }
    }
    if (f.anio && info.anio){
      const esReed = cd.anio && (info.anio - cd.anio) > 5;
      if (esReed){
        if (f.anioEdicion){
          const prev = cd.anioEdicion;
          if (re){ if (prev !== info.anio){ if (prev) dp.push(`Año edición ${prev}→${info.anio}`); else dp.push("Año edición"); cd.anioEdicion = info.anio; prov.anioEdicion = stamp; changes++; } }
          else if (!prev){ cd.anioEdicion = info.anio; prov.anioEdicion = stamp; dp.push("Año edición"); changes++; }
        }
      } else { if (ap("anio", info.anio, cd.anio, "Año álbum")) changes++; }
    } else if (f.anioEdicion && info.anio && !cd.anioEdicion && !cd.anio){
      cd.anioEdicion = info.anio; prov.anioEdicion = stamp; dp.push("Año edición"); changes++;
    }
    if (f.sello && info.sello && ap("sello", info.sello, cd.sello, "Sello")) changes++;
    if (f.genero && info.genero && ap("genero", info.genero, cd.genero, "Género")) changes++;
    if (f.pais && info.pais && ap("pais", info.pais, cd.pais, "País")) changes++;
    if (f.catalogo && info.catalogo && ap("catalogo", info.catalogo, cd.catalogo, "Catálogo")) changes++;
    if (f.portada && info.portada){
      const hc = !!cd.portada;
      if (re || !hc){
        if (hc && cd.portada !== info.portada){ dp.push("Portada reemplazada"); reps++; } else dp.push("Portada");
        cd.portada = info.portada; cd.portadaSource = info.portadaSource; prov.portada = stamp;
        changes++; stats.covers++;
      }
    }
    if (f.links && info.links && Object.keys(info.links).length){
      const prev = cd.links || {};
      const merged = re ? { ...prev, ...info.links } : { ...info.links, ...prev };
      const nuevos = Object.keys(merged).filter(k => !prev[k]).length;
      if (nuevos > 0 || re){
        cd.links = merged;
        if (nuevos > 0){ dp.push(`🎧 ${nuevos} link${nuevos === 1 ? '' : 's'}`); changes++; stats.links += nuevos; }
      }
    }
    if (info.mbId && !cd.mbId) cd.mbId = info.mbId;
    if (info.discogsId && !cd.discogsId) cd.discogsId = info.discogsId;
    if (info.source){ cd.enrichmentSource = info.source; cd.enrichmentConfidence = info.confidence ?? null; cd.enrichedAt = info.enrichedAt || new Date().toISOString(); }
    cd.provenance = prov;
    if (changes > 0){
      stats.ok++; stats.fields += changes; sourceStats[info.source] = (sourceStats[info.source] || 0) + 1;
      const strategyTag = info._strategy ? ` [${info._strategy}]` : '';
      log(reps > 0 ? "🔄" : "✅", reps > 0 ? "warn" : "ok", cd.titulo, `[${info.source}${strategyTag}] ${dp.join(", ")}`);
    } else { stats.skip++; log("⏭️", "warn", cd.titulo, "Sin cambios"); }
  }
  async function run(){
    if (running) return;
    reset(); computeItems();
    if (!items.length){ Toast.show("No hay CDs para enriquecer", "warn"); return; }
    const f = getFields(); const retry = $("#optRetry")?.checked !== false; const as = activeSources();
    if (!as.length){ Toast.show("Sin fuentes activas", "warn", 6000); return; }
    const tnf = $("#optTrackNotFound")?.checked !== false; const uc = $("#optUseCache")?.checked !== false; const re = $("#optReplace")?.checked !== false;
    running = true; cancelled = false; stats.total = items.length;
    $("#bulkEnrichConfig").style.display = "none"; $("#bulkEnrichProgress").style.display = "";
    $("#bulkEnrichStart").style.display = "none"; $("#bulkEnrichStop").style.display = "";
    log("🚀", "info", `Iniciando${re ? " (REEMPLAZO)" : ""}`, `${items.length} CDs · ${as.join(" → ")}`);
    let saveC = 0;
    for (let i = 0; i < items.length; i++){
      if (cancelled){ log("⏹️", "warn", "Cancelado"); break; }
      await processOne(i, as, re, tnf, uc, retry, f);
      saveC++; if (saveC >= 5){ Store.persistSilent(); saveC = 0; }
      if (i < items.length - 1 && !cancelled) await new Promise(r => setTimeout(r, 1200));
    }
    if (requeueIdx.length > 0 && !cancelled){
      const req = [...requeueIdx]; requeueIdx = []; updateRequeueBadge();
      log("🔁", "info", `Re-procesando ${req.length} CDs saltados`, "esperando fin de cooldown…");
      while (Date.now() < _mb503Until && !cancelled){
        const waitS = Math.ceil((_mb503Until - Date.now())/1000);
        $("#bulkEta").textContent = `⏸️ Esperando ${waitS}s (rate limit)`;
        await new Promise(r => setTimeout(r, 2000));
      }
      stats.requeued = req.length;
      for (const idx of req){
        if (cancelled) break;
        log("🔁", "info", `Retry: ${items[idx].cd.titulo}`);
        await processOne(idx, as, re, tnf, uc, retry, f);
        Store.persistSilent();
        await new Promise(r => setTimeout(r, 1200));
      }
    }
    if (saveC > 0) Store.persistSilent();
    Store.persist();
    if (notFoundInRun.length){ for (const it of notFoundInRun) NotFoundList.add(it); NotFoundList.persist(); }
    running = false;
    $("#bulkEnrichProgress").style.display = "none";
    $("#bulkEnrichSummary").style.display = "";
    $("#bulkEnrichStop").style.display = "none";
    const sb = Object.entries(sourceStats).map(([s, n]) => `<div class="sum-item"><div class="sum-icon">📡</div><div class="sum-label">${s}</div><div class="sum-value ok">${n}</div></div>`).join("");
    $("#bulkSummaryGrid").innerHTML = `
      <div class="sum-item"><div class="sum-icon">📊</div><div class="sum-label">Procesados</div><div class="sum-value">${stats.total}</div></div>
      <div class="sum-item"><div class="sum-icon">✅</div><div class="sum-label">Enriquecidos</div><div class="sum-value ok">${stats.ok}</div></div>
      <div class="sum-item"><div class="sum-icon">💨</div><div class="sum-label">Desde caché</div><div class="sum-value">${stats.cached}</div></div>
      <div class="sum-item"><div class="sum-icon">⏭️</div><div class="sum-label">Sin cambios</div><div class="sum-value warn">${stats.skip}</div></div>
      <div class="sum-item"><div class="sum-icon">❌</div><div class="sum-label">Sin resultados</div><div class="sum-value err">${stats.fail}</div></div>
      <div class="sum-item"><div class="sum-icon">📝</div><div class="sum-label">Campos</div><div class="sum-value ok">${stats.fields}</div></div>
      <div class="sum-item"><div class="sum-icon">🖼️</div><div class="sum-label">Portadas</div><div class="sum-value ok">${stats.covers}</div></div>
      <div class="sum-item"><div class="sum-icon">🎧</div><div class="sum-label">Links streaming</div><div class="sum-value ok">${stats.links}</div></div>
      ${stats.requeued > 0 ? `<div class="sum-item"><div class="sum-icon">🔁</div><div class="sum-label">Re-encolados</div><div class="sum-value ok">${stats.requeued}</div></div>` : ''}
      ${sb}`;
    if (notFoundInRun.length){ $("#bulkNotFoundActions").style.display = "flex"; $("#bulkNotFoundCount").textContent = notFoundInRun.length; }
    $("#bulkLogFinal").innerHTML = $("#bulkLog").innerHTML;
    renderTabs(); renderAll();
    if (stats.ok > 0){ AutoBackup.markChange(`enriquecimiento masivo (${stats.ok})`); HistoryLog.log('ENRICH', `Enriquecimiento masivo`, `${stats.ok} CDs · ${stats.fields} campos · ${stats.covers} portadas · ${stats.links} links`); }
    Toast.show(`Terminado: ${stats.ok} CDs · ${stats.fields} campos · ${stats.covers} portadas · ${stats.links} links`, "ok", 6000);
  }
  function stop(){ if (!running) return; if (!confirm("¿Detener?")) return; cancelled = true; $("#bulkEnrichStop").disabled = true; $("#bulkEnrichStop").textContent = "Deteniendo…"; }
  function open(){
    reset();
    updatePreview();
    $("#bulkEnrichModal").classList.add("open");
    if (!getDiscogsToken()){
      setTimeout(() => { Toast.show("💡 Sin token de Discogs. Solo se usará MusicBrainz.", "warn", 7000); }, 500);
    }
  }
  function close(){ if (running){ if (!confirm("¿Detener?")) return; cancelled = true; } $("#bulkEnrichModal").classList.remove("open"); if (running) setTimeout(() => { renderTabs(); renderAll(); }, 500); }
  return { open, close, run, stop, updatePreview, isRunning: () => running };
})();

async function runNetworkDiagnostics(){
  const host = $("#networkDiagContent"); if (!host) return;
  host.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted)"><span class="disc-loader"></span> Ejecutando…</div>`;
  const results = [];
  const checks = [
    { name: "MusicBrainz", fetcher: () => fetchWithTimeout(`${MB_API}release?query=release:%22test%22&fmt=json&limit=1`, { headers: { 'User-Agent': MB_USER_AGENT } }, 8000) },
    { name: "Discogs", fetcher: () => { if (!getDiscogsToken()) return Promise.reject(new Error('SIN_TOKEN')); return fetchDiscogs(`${DISCOGS_API}/database/search?q=test&per_page=1`, 8000); } },
    { name: "Cover Art Archive", fetcher: () => fetchWithTimeout(`https://coverartarchive.org/release/76df3287-6cda-33eb-8e9a-044b5e15ffdd`, {}, 8000) },
    { name: "iTunes Search", fetcher: () => fetchWithTimeout(`https://itunes.apple.com/search?term=test&entity=album&limit=1&country=US`, { cache: 'no-store' }, 8000) },
    { name: "Odesli", fetcher: () => fetchWithTimeout(`https://api.song.link/v1-alpha.1/links?url=https%3A%2F%2Fmusic.apple.com%2Fus%2Falbum%2Ftest%2F123456789&userCountry=US`, { cache: 'no-store' }, 8000) }
  ];
  for (const c of checks){
    const t0 = Date.now(); let st = "—", col = "var(--muted)", ic = "❔", det = "";
    try {
      const r = await c.fetcher();
      const el = Date.now() - t0; st = `HTTP ${r.status} · ${el}ms`;
      if (r.ok){ col = "var(--ok)"; ic = "✅"; det = "OK"; }
      else if (r.status === 401){
        if (c.name === "Odesli"){
          col = "var(--warn)"; ic = "⚠️";
          det = "API pública deprecada (401). Streaming usa iTunes + Apple Music + buscador.";
          try {
            const body = await r.clone().json();
            if (body?.code) det += ` [${body.code}]`;
          } catch(_){}
        } else {
          col = "var(--warn)"; ic = "🔑"; det = "Requiere token válido.";
        }
      }
      else if (r.status === 429){ col = "var(--warn)"; ic = "⏱️"; det = "Rate limit."; }
      else if (r.status === 503){ col = "var(--warn)"; ic = "❄️"; det = "Servicio no disponible."; }
      else if (r.status === 404){ col = "var(--ok)"; ic = "✅"; det = "API responde."; st = `HTTP 404 · ${el}ms`; }
      else { col = "var(--warn)"; ic = "⚠️"; det = "Respuesta no esperada."; }
    } catch (err){
      if (err.message === 'SIN_TOKEN'){
        const el = Date.now() - t0;
        st = `Sin token · ${el}ms`; col = "var(--warn)"; ic = "🔑"; det = "Configurá token Discogs.";
        results.push({ name: c.name, status: st, color: col, icon: ic, detail: det });
        continue;
      }
      const el = Date.now() - t0; st = `${err.name === 'AbortError' || err.name === 'TimeoutError' ? 'Timeout' : err.message} · ${el}ms`; col = "var(--danger)"; ic = "❌";
      det = (err.name === 'AbortError' || err.name === 'TimeoutError') ? "Timeout (>8s)." : "Error de red o CORS.";
    }
    results.push({ name: c.name, status: st, color: col, icon: ic, detail: det });
  }
  const manual = String(getDiscogsConfig().proxy || '').trim();
  const tk = getDiscogsToken() ? `✅ (${getDiscogsToken().length} chars)` : `❌ NO configurado`;
  let pi;
  if (manual) pi = `Proxy: <code>${esc(manual)}</code> (manual)`;
  else pi = `Modo: <b>directo → fallback automático</b>`;
  const mbC = _mb503Until > Date.now() ? ` · ❄️ ${Math.ceil((_mb503Until-Date.now())/1000)}s` : '';
  const dcC = _discogs429Until > Date.now() ? ` · ❄️ ${Math.ceil((_discogs429Until-Date.now())/1000)}s` : '';
  host.innerHTML = `
    <div style="padding:12px 14px;background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:10px;margin-bottom:14px;font-size:.82rem;line-height:1.7">
      Protocolo: <code>${esc(location.protocol)}//${esc(location.host || '…')}</code><br>
      Token: <b>${tk}</b><br>
      UA: <code>${esc(MB_USER_AGENT)}</code><br>
      ${pi}${mbC}${dcC}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:.85rem">
      <thead><tr style="background:rgba(255,255,255,.03)"><th style="text-align:left;padding:10px 12px;font-size:.65rem;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)">Fuente</th><th style="text-align:left;padding:10px 12px;font-size:.65rem;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)">Estado</th><th style="text-align:left;padding:10px 12px;font-size:.65rem;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)">Detalle</th></tr></thead>
      <tbody>${results.map(r => `<tr><td style="padding:10px 12px;border-bottom:1px solid rgba(37,45,58,.5);font-weight:600">${r.icon} ${esc(r.name)}</td><td style="padding:10px 12px;border-bottom:1px solid rgba(37,45,58,.5);color:${r.color};font-family:ui-monospace,monospace;font-size:.78rem">${esc(r.status)}</td><td style="padding:10px 12px;border-bottom:1px solid rgba(37,45,58,.5);color:var(--muted);font-size:.8rem">${r.detail}</td></tr>`).join('')}</tbody>
    </table>
    <div style="margin-top:14px;padding:10px 12px;background:rgba(79,195,247,.06);border-left:3px solid var(--accent);border-radius:8px;font-size:.78rem;color:var(--muted);line-height:1.55">
      💡 <b style="color:var(--txt)">Tips:</b> sin token Discogs el enriquecimiento usa solo MusicBrainz (más lento). 
      Si Odesli aparece deprecado, el streaming sigue funcionando con <b>iTunes → Apple Music</b> y buscadores web.
    </div>`;
}
function openNetworkDiag(){ $("#networkDiagModal").classList.add("open"); runNetworkDiagnostics(); }
function closeNetworkDiag(){ $("#networkDiagModal")?.classList.remove("open"); }

function updateFolderSupportStatus(){
  const el = $("#folderSupportStatus"); if (!el) return;
  const mode = FileSystemDefault.getMode();
  if (mode === 'tauri'){
    el.innerHTML = '🟢 <b>Modo nativo (Tauri)</b>: usando plugin <code>dialog + fs</code> del sistema.';
    el.style.borderLeft = "4px solid var(--ok)";
  } else if (mode === 'browser'){
    el.innerHTML = '🟢 <b>Modo navegador</b>: usando File System Access API.';
    el.style.borderLeft = "4px solid var(--ok)";
  } else {
    el.innerHTML = '🟠 <b>No soportado</b>. Se usará descarga clásica.';
    el.style.borderLeft = "4px solid var(--warn)";
  }
  const n = $("#folderCurrentName"); if (n) n.textContent = FileSystemDefault.getName() || "— Sin carpeta configurada —";
  const p = $("#folderPick"), c = $("#folderChange"), r = $("#folderRemove"), t = $("#folderTestPermission");
  const h = FileSystemDefault.isSet();
  if (p) p.style.display = h ? "none" : "";
  if (c) c.style.display = h ? "" : "none";
  if (r) r.style.display = h ? "" : "none";
  if (t) t.style.display = h ? "" : "none";
}
function openFolderConfig(){ updateFolderSupportStatus(); $("#folderConfigModal").classList.add("open"); }
function closeFolderConfig(){ $("#folderConfigModal")?.classList.remove("open"); }
async function pickDefaultFolder(){
  try { const h = await FileSystemDefault.pickFolder(); updateFolderSupportStatus(); FileSystemDefault.refreshBadge(); Toast.show(`📂 Carpeta: ${h.name}`, "ok", 4000); closeFolderConfig(); }
  catch (err){ if (err.name === "AbortError") return; Toast.show("Error: " + err.message, "err", 6500); }
}
async function removeDefaultFolder(){ if (!FileSystemDefault.isSet()) return; if (!confirm("¿Quitar la carpeta?")) return; await FileSystemDefault.clear(); FileSystemDefault.refreshBadge(); updateFolderSupportStatus(); Toast.show("Carpeta quitada", "warn", 3200); }
async function openFolderBrowser(){
  if (!FileSystemDefault.isSet()){ Toast.show("Configurá una carpeta primero", "warn"); openFolderConfig(); return; }
  $("#folderBrowserModal").classList.add("open"); await refreshFolderList();
}
function closeFolderBrowser(){ $("#folderBrowserModal")?.classList.remove("open"); }
async function refreshFolderList(){
  const host = $("#folderFileList"); if (!host) return;
  const n = $("#folderBrowserName"); if (n) n.textContent = FileSystemDefault.getName() || "—";
  host.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)"><span class="disc-loader"></span> Cargando…</div>`;
  try {
    if (!(await FileSystemDefault.ensureReady("read"))){
      host.innerHTML = `<div style="padding:24px;text-align:center;color:var(--warn);line-height:1.6">🔐 El navegador requiere reautorizar.<br><br><button type="button" class="btn primary" id="folderReauth">🔓 Reautorizar acceso</button></div>`;
      $("#folderReauth")?.addEventListener("click", async () => { await FileSystemDefault.ensureReady("readwrite"); refreshFolderList(); });
      return;
    }
    const files = await FileSystemDefault.listFiles();
    const info = $("#folderBrowserInfo"); if (info) info.textContent = `${files.length} archivo${files.length === 1 ? "" : "s"} en la carpeta`;
    if (!files.length){
      host.innerHTML = `<div style="padding:32px 20px;text-align:center;color:var(--muted)">📭 Sin archivos.<br><br><button type="button" class="btn primary" id="folderUploadEmpty">💾 Guardar primer backup</button></div>`;
      $("#folderUploadEmpty")?.addEventListener("click", saveBackupToFolder);
      return;
    }
    host.innerHTML = files.map(f => {
      const s = f.size ? `${(f.size/1024).toFixed(1)} KB` : '—';
      const d = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('es-AR', {dateStyle:'short', timeStyle:'short'}) : '—';
      const i = f.name.endsWith('.csv') ? '📊' : f.name.endsWith('.md') ? '📝' : '💾';
      return `<div class="folder-row gdrive-row" data-name="${esc(f.name)}"><span class="gdrive-icon">${i}</span><span class="gdrive-info"><span class="gdrive-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="gdrive-meta">${esc(d)} · ${esc(s)}</span></span><span class="gdrive-actions"><button type="button" class="btn primary" data-act="restore">⬇️ Restaurar</button><button type="button" class="btn danger" data-act="delete" title="Eliminar">🗑️</button></span></div>`;
    }).join("");
    host.querySelectorAll(".folder-row").forEach(row => {
      const n = row.dataset.name;
      row.querySelector('[data-act="restore"]')?.addEventListener("click", () => restoreFromFolder(n));
      row.querySelector('[data-act="delete"]')?.addEventListener("click", () => deleteFromFolder(n));
    });
  } catch (err){ host.innerHTML = `<div style="padding:24px;text-align:center;color:var(--danger)">Error: ${esc(err.message)}</div>`; }
}
async function saveBackupToFolder(){
  try {
    if (!FileSystemDefault.isSet()){ openFolderConfig(); return; }
    if (!(await FileSystemDefault.ensureReady("readwrite"))){ Toast.show("Permiso denegado", "err"); return; }
    const o = OwnerConfig.get();
    const pl = { version: 5, appVersion: APP_VERSION, exported: new Date().toISOString(), owner: o.name || DEFAULT_AUTHOR, contact: OwnerConfig.contactLine() || DEFAULT_PHONE, categories: {} };
    for (const k of Store.catKeys()){ const c = Store.get(k); pl.categories[k] = { label: c.label, icon: c.icon, subcategories: c.subcategories || [], cds: c.cds }; }
    const fn = `discografia_v${APP_VERSION}_backup_${timestamp()}.json`;
    await FileSystemDefault.saveFile(fn, JSON.stringify(pl, null, 2), "application/json");
    Toast.show(`💾 Guardado: ${fn}`, "ok", 4000);
    if ($("#folderBrowserModal")?.classList.contains("open")) refreshFolderList();
  } catch (err){ Toast.show("Error: " + err.message, "err", 6500); }
}
async function restoreFromFolder(name){
  if (!name) return;
  if (!confirm(`¿Restaurar "${name}"?`)) return;
  try {
    const text = await FileSystemDefault.readFile(name);
    const data = JSON.parse(text);
    const before = JSON.stringify(Store.categories());
    if (data && data.categories){
      Store.replaceAll(data); NotFoundList.clear();
      Undo.push("restaurar", () => { Store.replaceAll({ categories: JSON.parse(before) }); ensureValidCat(); renderTabs(); renderAll(); });
      App.artista = null; App.q = ""; App.selected.clear(); App.focusedKey = null; App.subcat = null;
      $("#q").value = ""; $("#searchBox").classList.remove("has-value");
      ensureValidCat(); renderTabs(); renderAll();
      HistoryLog.log('IMPORT', `Restaurado: ${name}`);
      AutoBackup.markChange("restauración");
      Toast.show("Backup restaurado", "ok", 4000);
      closeFolderBrowser();
    } else Toast.show("Formato inesperado", "err", 6000);
  } catch (err){ Toast.show("Error: " + err.message, "err", 7000); }
}
async function deleteFromFolder(name){
  if (!name) return;
  if (!confirm(`¿Eliminar "${name}"?`)) return;
  try { await FileSystemDefault.deleteFile(name); Toast.show("Eliminado", "ok"); refreshFolderList(); }
  catch (err){ Toast.show("Error: " + err.message, "err", 6000); }
}

const Lightbox = (() => {
  let cur = [], idx = 0;
  function open(url, t, key){
    if (!url) return;
    cur = [];
    $$("#tbodyCD tr").forEach(tr => { const i = tr.querySelector(".cover-thumb"); if (i) cur.push({ url: i.src, titulo: i.dataset.title || "", key: i.dataset.key || tr.dataset.key }); });
    idx = cur.findIndex(x => x.key === key); if (idx === -1) idx = 0;
    render();
    $("#coverLightbox").classList.add("open"); document.body.style.overflow = "hidden";
  }
  function render(){
    if (!cur.length) return;
    const it = cur[idx];
    $("#lbImg").src = it.url;
    $("#lbInfo").textContent = `${it.titulo} (${idx+1} de ${cur.length})`;
    $("#lbPrev").style.display = cur.length > 1 ? "" : "none";
    $("#lbNext").style.display = cur.length > 1 ? "" : "none";
  }
  function next(){ if (cur.length < 2) return; idx = (idx + 1) % cur.length; render(); }
  function prev(){ if (cur.length < 2) return; idx = (idx - 1 + cur.length) % cur.length; render(); }
  function close(){ $("#coverLightbox").classList.remove("open"); document.body.style.overflow = ""; }
  return { open, next, prev, close };
})();

function openNotFoundModal(){
  App.notFoundFilter = "";
  const si = $("#notFoundSearch"); if (si) si.value = "";
  renderNotFoundTable();
  const d = new Date();
  const fmt = d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'});
  const pd = $("#printDate"); if (pd) pd.textContent = fmt;
  OwnerConfig.render();
  $("#notFoundModal").classList.add("open");
}
function closeNotFoundModal(){ $("#notFoundModal").classList.remove("open"); }
function renderNotFoundTable(){
  const items = NotFoundList.getAll();
  const filter = norm(App.notFoundFilter || "").trim();
  const tbody = $("#notFoundTbody"); const cnt = $("#notFoundCount");
  if (cnt) cnt.textContent = items.length;
  if (!items.length){ tbody.innerHTML = `<tr><td colspan="7" class="nf-empty">✅ No hay CDs pendientes.</td></tr>`; return; }
  let f = items;
  if (filter) f = items.filter(x => norm([x.titulo, x.interprete, x.catLabel].join(" ")).includes(filter));
  if (!f.length){ tbody.innerHTML = `<tr><td colspan="7" class="nf-empty">Sin coincidencias.</td></tr>`; return; }
  tbody.innerHTML = f.map((item, i) => {
    const cleanT = limpiarTituloParaBusqueda(item.titulo);
    const cleanI = limpiarInterpreteParaBusqueda(item.interprete);
    const cleanInfo = (cleanT !== item.titulo || cleanI !== item.interprete)
      ? `<br><span style="font-size:.65rem;color:var(--ok);opacity:.85">🔍 "${esc(cleanT)}" · "${esc(cleanI)}"</span>` : '';
    return `<tr data-nf-idx="${i}">
      <td class="nf-num">${item.nro}</td>
      <td class="nf-cat">${esc(item.catLabel)}</td>
      <td class="nf-titulo">${highlight(upper(item.titulo), App.notFoundFilter)}${cleanInfo}</td>
      <td class="nf-interprete">${highlight(upper(item.interprete), App.notFoundFilter)}</td>
      <td class="nf-anio">${item.anio ?? "—"}</td>
      <td>${esc(item.sources || "—")}</td>
      <td>
        <button type="button" class="btn primary" data-nf-retry="${i}" title="Reintentar">🔁 Reintentar</button>
        <button type="button" class="btn" data-nf-search="${i}" title="Buscar en Google">🌐</button>
      </td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-nf-retry]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.nfRetry, 10);
      const item = f[idx];
      if (!item) return;
      btn.disabled = true;
      const orig = btn.innerHTML;
      btn.innerHTML = '⏳';
      try {
        const info = await enrichFromChain(item.titulo, item.interprete, { hints: { anio: item.anio }, useCache: false });
        if (!info){ Toast.show('❌ Sigue sin encontrarse', 'warn', 3000); btn.innerHTML = '❌'; setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2000); return; }
        const cat = item.catKey;
        const cd = Store.getCDs(cat).find(c => c.nro === item.nro);
        if (!cd){ Toast.show('CD no encontrado en la base', 'warn'); btn.innerHTML = orig; btn.disabled = false; return; }
        const prov = cd.provenance || {};
        const stamp = makeProvenance(info.source, info.confidence);
        if (info.anio && !cd.anio){ cd.anio = info.anio; prov.anio = stamp; }
        if (info.sello && !cd.sello){ cd.sello = upper(info.sello); prov.sello = stamp; }
        if (info.genero && !cd.genero){ cd.genero = upper(info.genero); prov.genero = stamp; }
        if (info.pais && !cd.pais){ cd.pais = upper(info.pais); prov.pais = stamp; }
        if (info.catalogo && !cd.catalogo){ cd.catalogo = upper(info.catalogo); prov.catalogo = stamp; }
        if (info.portada && !cd.portada){ cd.portada = info.portada; cd.portadaSource = info.portadaSource; prov.portada = stamp; }
        if (info.links && Object.keys(info.links).length){ cd.links = { ...(cd.links || {}), ...info.links }; }
        if (info._title && info.confidence >= 85 && cd.titulo) cd.titulo = upper(info._title);
        if (info._artist && info.confidence >= 85 && cd.interprete) cd.interprete = upper(info._artist);
        cd.enrichmentSource = info.source;
        cd.enrichmentConfidence = info.confidence ?? null;
        cd.enrichedAt = info.enrichedAt || new Date().toISOString();
        cd.provenance = prov;
        Store.persist();
        NotFoundList.remove(item.catKey, item.nro);
        NotFoundList.persist();
        AutoBackup.markChange('reintento OK');
        renderNotFoundTable();
        renderTabs(); renderAll();
        Toast.show(`✅ Encontrado en ${info.source} (${info.confidence}%)`, 'ok', 3500);
        HistoryLog.log('ENRICH', `Reintento OK: ${cd.titulo}`, info.source);
      } catch(err){
        Toast.show('⚠️ ' + err.message, 'warn', 4000);
        btn.innerHTML = orig; btn.disabled = false;
      }
    });
  });
  tbody.querySelectorAll('[data-nf-search]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.nfSearch, 10);
      const item = f[idx];
      if (!item) return;
      const q = encodeURIComponent(`${item.interprete} ${item.titulo}${item.anio ? ' ' + item.anio : ''}`.trim());
      window.open(`https://www.google.com/search?q=${q}`, '_blank', 'noopener');
    });
  });
}
function printNotFoundList(){ const m = $("#notFoundModal"); m.classList.add("printing"); setTimeout(() => { window.print(); setTimeout(() => m.classList.remove("printing"), 500); }, 100); }
async function exportNotFoundCSV(){
  const items = NotFoundList.getAll();
  if (!items.length){ Toast.show("Lista vacía", "warn"); return; }
  const sep = ";";
  const e = v => { const s = String(v ?? ""); return /[";\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
  const rows = [["Nº","Categoría","Título","Intérprete","Año","Fuentes"].join(sep)];
  for (const i of items) rows.push([i.nro, i.catLabel, i.titulo, i.interprete, i.anio ?? "", i.sources || ""].map(e).join(sep));
  await saveOrDownload(`discografia_no_encontrados_${timestamp()}.csv`, "\uFEFF" + rows.join("\r\n"), "text/csv");
}
async function exportNotFoundJSON(){
  const items = NotFoundList.getAll();
  if (!items.length){ Toast.show("Lista vacía", "warn"); return; }
  const o = OwnerConfig.get();
  await saveOrDownload(`discografia_no_encontrados_${timestamp()}.json`, JSON.stringify({ exported: new Date().toISOString(), appVersion: APP_VERSION, owner: o.name || null, contact: OwnerConfig.contactLine() || null, total: items.length, cds: items }, null, 2));
}
function clearNotFoundList(){ const n = NotFoundList.count(); if (!n) return; if (!confirm(`¿Limpiar los ${n} CDs?`)) return; NotFoundList.clear(); renderNotFoundTable(); Toast.show("Lista limpiada", "warn"); }

const ALL_CATS = "__all__";
const App = { cat: null, q: "", sortKey: "nro", sortDir: 1, artista: null, selected: new Set(), focusedKey: null, editing: null, filters: { estado: "", formato: "", anioDesde: "", anioHasta: "", ubicacion: "", portada: "", prestamo: "" }, view: "table", notFoundFilter: "", detailCD: null, subcat: null };

const cdKey = (cat, cdOrNro) => {
  if (cdOrNro && typeof cdOrNro === "object" && cdOrNro.id) return `${cat}|${cdOrNro.id}`;
  const cd = Store.getCDs(cat).find(c => c.nro === cdOrNro);
  if (cd && cd.id) return `${cat}|${cd.id}`;
  return `${cat}|nro:${cdOrNro}`;
};
const parseCDKey = key => {
  const s = String(key || ""); const i = s.indexOf("|");
  if (i < 0) return { cat: s, id: "" };
  const cat = s.slice(0, i); const idPart = s.slice(i + 1);
  if (idPart.startsWith("nro:")){ const nro = parseInt(idPart.slice(4), 10); const cd = Store.getCDs(cat).find(c => c.nro === nro); return { cat, id: cd?.id || "" }; }
  return { cat, id: idPart };
};

function findCategoryOfCD(cd){
  if (!cd) return null;
  for (const k of Store.catKeys()){ if (Store.getCDs(k).some(c => c.id === cd.id)) return k; }
  return null;
}
function viewCDs(){
  if (App.cat === ALL_CATS) return Store.allCDs();
  return App.cat ? Store.getCDs(App.cat) : [];
}
function cdKeyForView(cd){
  const cat = App.cat === ALL_CATS ? findCategoryOfCD(cd) : App.cat;
  return cat ? cdKey(cat, cd) : `${ALL_CATS}|${cd?.id}`;
}

function ensureValidCat(){
  const keys = Store.catKeys();
  if (!keys.length){ App.cat = null; return; }
  if (App.cat === ALL_CATS) return;
  if (!App.cat || !Store.get(App.cat)) App.cat = keys[0];
}
function getFiltered(cat = App.cat){
  if (!cat) return [];
  const q = App.q.trim();
  const f = App.filters;
  const useAdvanced = AdvancedSearch.isAdvanced(q);
  const qn = norm(q).trim();
  const terms = qn ? qn.split(/\s+/).filter(Boolean) : [];
  const source = (cat === ALL_CATS) ? Store.allCDs() : Store.getCDs(cat);
  return source.filter(cd => {
    if (App.artista && cd.interprete !== App.artista) return false;
    if (App.subcat && cd.subcat !== App.subcat) return false;
    if (f.estado === "__sin_estado__"){ if (cd.estado && cd.estado.trim()) return false; }
    else if (f.estado && (cd.estado || "Excelente") !== f.estado) return false;
    if (f.formato && (cd.formato || "CD") !== f.formato) return false;
    if (f.anioDesde){ const a = parseInt(f.anioDesde); if (!isNaN(a) && (cd.anio ?? -Infinity) < a) return false; }
    if (f.anioHasta){ const a = parseInt(f.anioHasta); if (!isNaN(a) && (cd.anio ?? Infinity) > a) return false; }
    if (f.ubicacion === "__con__" && !cd.ubicacion) return false;
    if (f.ubicacion === "__sin__" && cd.ubicacion) return false;
    if (f.portada === "__con__" && !cd.portada) return false;
    if (f.portada === "__sin__" && cd.portada) return false;
    if (f.prestamo === "__prestados__" && !Loans.isLoaned(cd)) return false;
    if (f.prestamo === "__disponibles__" && Loans.isLoaned(cd)) return false;
    if (f.prestamo === "__vencidos__" && !Loans.isOverdue(cd)) return false;
    if (!q) return true;
    if (useAdvanced) return AdvancedSearch.matches(cd, q);
    if (!terms.length) return true;
    const h = norm([cd.titulo, cd.interprete, cd.sello, cd.anio, cd.ubicacion, cd.catalogo].join(" "));
    return terms.every(t => h.includes(t));
  });
}
function sortCDs(arr){
  const { sortKey, sortDir } = App;
  return arr.slice().sort((a, b) => {
    let A = a[sortKey], B = b[sortKey];
    if (sortKey === "anio"){ A = A ?? -Infinity; B = B ?? -Infinity; return (A - B) * sortDir; }
    if (typeof A === "string") return norm(A).localeCompare(norm(B), "es") * sortDir;
    return ((A ?? 0) - (B ?? 0)) * sortDir;
  });
}
function renderTabs(){
  const el = $("#tabs"); el.innerHTML = "";

  const wrapAll = document.createElement("div"); wrapAll.className = "tab-wrap";
  const tabAll = document.createElement("div");
  tabAll.role = "tab"; tabAll.tabIndex = 0;
  tabAll.className = "tab tab-all" + (App.cat === ALL_CATS ? " active" : "");
  tabAll.innerHTML = `<span>🗂️</span><span>Todas</span><span class="badge">${Store.total()}</span>`;
  tabAll.title = "Ver todas las categorías juntas";
  tabAll.addEventListener("click", () => {
    if (App.cat === ALL_CATS) return;
    App.cat = ALL_CATS; App.artista = null; App.subcat = null; App.selected.clear(); App.focusedKey = null;
    renderTabs(); renderStats(); renderAll();
  });
  tabAll.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); tabAll.click(); } });
  wrapAll.appendChild(tabAll); el.appendChild(wrapAll);

  for (const k of Store.catKeys()){
    const c = Store.get(k);
    const wrap = document.createElement("div"); wrap.className = "tab-wrap";
    const tab = document.createElement("div");
    tab.role = "tab"; tab.tabIndex = 0;
    tab.className = "tab" + (k === App.cat ? " active" : "");
    tab.innerHTML = `<span>${esc(c.icon)}</span><span>${esc(c.label)}</span><span class="badge">${c.cds.length}</span>`;
    tab.addEventListener("click", (e) => {
      if (e.target.closest(".tab-menu-btn")) return;
      if (App.cat === k) return;
      App.cat = k; App.artista = null; App.subcat = null; App.selected.clear(); App.focusedKey = null;
      renderTabs(); renderStats(); renderAll();
    });
    tab.addEventListener("keydown", (e) => { if (e.target.closest(".tab-menu-btn")) return; if (e.key === "Enter" || e.key === " "){ e.preventDefault(); tab.click(); } });
    const mb = document.createElement("button");
    mb.type = "button"; mb.className = "tab-menu-btn"; mb.title = "Opciones"; mb.textContent = "⋯";
    mb.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); abrirMenuCategoria(k, mb); });
    tab.appendChild(mb); wrap.appendChild(tab); el.appendChild(wrap);
  }
  const add = document.createElement("button");
  add.type = "button"; add.className = "tab tab-add";
  add.innerHTML = `<span>➕</span><span>Nueva categoría</span>`;
  add.addEventListener("click", () => abrirModalCategoria("crear"));
  el.appendChild(add);
}

function renderSubtabs(){
  const el = $("#subtabs");
  if (!el) return;
  if (!App.cat || App.cat === ALL_CATS){
    el.classList.remove("show");
    el.innerHTML = "";
    App.subcat = null;
    return;
  }
  const cat = Store.get(App.cat);
  if (!cat){ el.classList.remove("show"); el.innerHTML = ""; return; }
  const subs = Array.isArray(cat.subcategories) ? cat.subcategories : [];
  if (App.subcat && !subs.some(s => s.id === App.subcat)) App.subcat = null;

  el.classList.add("show");
  el.innerHTML = "";

  if (subs.length){
    const wrapAll = document.createElement("div"); wrapAll.className = "tab-wrap";
    const tabAll = document.createElement("div");
    tabAll.role = "tab"; tabAll.tabIndex = 0;
    tabAll.className = "subtab subtab-all" + (App.subcat === null ? " active" : "");
    tabAll.innerHTML = `<span>📚</span><span>Todas</span><span class="badge">${cat.cds.length}</span>`;
    tabAll.title = "Ver todos los CDs de esta categoría";
    tabAll.addEventListener("click", () => { App.subcat = null; renderSubtabs(); renderAll(); });
    wrapAll.appendChild(tabAll);
    el.appendChild(wrapAll);
  }

  for (const sub of subs){
    const cnt = cat.cds.filter(c => c.subcat === sub.id).length;
    const wrap = document.createElement("div"); wrap.className = "tab-wrap";
    const tab = document.createElement("div");
    tab.role = "tab"; tab.tabIndex = 0;
    tab.className = "subtab" + (App.subcat === sub.id ? " active" : "");
    tab.innerHTML = `<span>${esc(sub.icon)}</span><span>${esc(sub.label)}</span><span class="badge">${cnt}</span>`;
    tab.addEventListener("click", (e) => {
      if (e.target.closest(".subtab-menu-btn")) return;
      App.subcat = (App.subcat === sub.id) ? null : sub.id;
      renderSubtabs(); renderAll();
    });
    tab.addEventListener("keydown", (e) => {
      if (e.target.closest(".subtab-menu-btn")) return;
      if (e.key === "Enter" || e.key === " "){ e.preventDefault(); tab.click(); }
    });
    const mb = document.createElement("button");
    mb.type = "button"; mb.className = "subtab-menu-btn"; mb.title = "Opciones"; mb.textContent = "⋯";
    mb.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); abrirMenuSubcategoria(App.cat, sub.id, mb); });
    tab.appendChild(mb); wrap.appendChild(tab); el.appendChild(wrap);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "subtab subtab-add";
  add.innerHTML = `<span>➕</span><span>${subs.length ? "Subcategoría" : "Crear primera subcategoría"}</span>`;
  add.title = "Crear subcategoría";
  add.addEventListener("click", () => abrirModalSubcategoria("crear", App.cat));
  el.appendChild(add);
}

let _menuSubEl = null;
function cerrarMenuSubcategoria(){ if (_menuSubEl){ _menuSubEl.remove(); _menuSubEl = null; } }
function abrirMenuSubcategoria(catKey, subId, anchor){
  cerrarMenuSubcategoria();
  const cat = Store.get(catKey); const sub = Store.getSubcategory(catKey, subId);
  if (!cat || !sub) return;
  const menu = document.createElement("div");
  menu.style.cssText = `position:fixed;z-index:95;background:#1a2028;border:1px solid var(--line);border-radius:10px;padding:6px;min-width:210px;box-shadow:0 14px 40px rgba(0,0,0,.6);`;
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(window.innerWidth - 220, r.left - 160)) + "px";
  menu.style.top = Math.max(8, Math.min(window.innerHeight - 260, r.bottom + 6)) + "px";
  const items = [
    { icon:"✏️", label:"Renombrar", fn: () => abrirModalSubcategoria("renombrar", catKey, subId) },
    { icon:"🎨", label:"Cambiar icono", fn: () => abrirModalSubcategoria("icono", catKey, subId) },
    { icon:"⬅️", label:"Mover izquierda", fn: () => { if (Store.moveSubcategory(catKey, subId, "left")) { renderSubtabs(); renderAll(); } } },
    { icon:"➡️", label:"Mover derecha", fn: () => { if (Store.moveSubcategory(catKey, subId, "right")) { renderSubtabs(); renderAll(); } } },
    { sep:true },
    { icon:"🗑️", label:"Eliminar subcategoría", danger:true, fn: () => confirmarEliminarSubcategoria(catKey, subId) }
  ];
  for (const it of items){
    if (it.sep){ const s = document.createElement("div"); s.style.cssText = "height:1px;background:var(--line);margin:5px 3px"; menu.appendChild(s); continue; }
    const b = document.createElement("button"); b.type = "button";
    b.style.cssText = `display:flex;align-items:center;gap:10px;width:100%;background:transparent;border:0;color:${it.danger ? "#ffb3b3" : "var(--txt)"};padding:9px 11px;border-radius:7px;cursor:pointer;font-size:.82rem;text-align:left;font-family:inherit`;
    b.innerHTML = `<span>${it.icon}</span><span>${it.label}</span>`;
    b.addEventListener("mouseenter", () => { b.style.background = it.danger ? "rgba(255,107,107,.14)" : "rgba(79,195,247,.12)"; b.style.color = it.danger ? "#fff" : "var(--accent)"; });
    b.addEventListener("mouseleave", () => { b.style.background = "transparent"; b.style.color = it.danger ? "#ffb3b3" : "var(--txt)"; });
    b.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); cerrarMenuSubcategoria(); it.fn(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu); _menuSubEl = menu;
}
document.addEventListener("click", (e) => { if (_menuSubEl && !_menuSubEl.contains(e.target)) cerrarMenuSubcategoria(); });

function confirmarEliminarSubcategoria(catKey, subId){
  const cat = Store.get(catKey); const sub = Store.getSubcategory(catKey, subId);
  if (!cat || !sub) return;
  const n = cat.cds.filter(c => c.subcat === subId).length;
  if (!confirm(`¿Eliminar la subcategoría "${sub.label}"?${n ? `\n\nContiene ${n} CD(s). Quedarán sin subcategoría (no se borran).` : ''}`)) return;
  Store.deleteSubcategory(catKey, subId);
  if (App.subcat === subId) App.subcat = null;
  HistoryLog.log('DELETE', `Subcategoría eliminada: ${sub.label}`, cat.label);
  AutoBackup.markChange('eliminación subcategoría');
  renderSubtabs(); renderTabs(); renderAll();
  Toast.show(`Subcategoría "${sub.label}" eliminada`, 'warn');
}

function abrirModalSubcategoria(mode, catKey, subId = null){
  _cmMode = "sub-" + mode;
  _cmKey = catKey;
  _subKey = subId || null;
  _cmAfter = null;
  _catSaving = false;
  const cat = Store.get(catKey);
  if (!cat) return;
  const sub = subId ? Store.getSubcategory(catKey, subId) : null;
  $("#catModalIcon").textContent = mode === "crear" ? "➕" : mode === "renombrar" ? "✏️" : "🎨";
  $("#catModalTitle").textContent = mode === "crear"
    ? `Nueva subcategoría en "${cat.label}"`
    : mode === "renombrar" ? `Renombrar subcategoría`
    : `Cambiar icono`;
  $("#catLabel").value = sub?.label || "";
  $("#catIcon").value = sub?.icon || "📂";
  $("#catIconPreview").textContent = sub?.icon || "📂";
  $("#wrapCatLabel").style.display = (mode === "icono") ? "none" : "";
  const li = $("#catLabel");
  if (mode === "icono") li.removeAttribute("required"); else li.setAttribute("required", "");
  const picker = $("#catIconPicker"); picker.innerHTML = "";
  const currentIcon = sub?.icon || "📂";
  const SUB_EMOJIS = ["📂","📁","🗂️","🎵","🎤","🎸","🎶","📀","💿","🎼","🎷","🎺","🥁","🎻","🎹","🎧","⭐","🔥","💫","✨","🌎","🇦🇷","🇧🇷","🇺🇸","🇬🇧"];
  for (const e of SUB_EMOJIS){
    const b = document.createElement("button"); b.type = "button"; b.textContent = e;
    if (e === currentIcon) b.classList.add("active");
    b.addEventListener("click", () => {
      $("#catIcon").value = e; $("#catIconPreview").textContent = e;
      picker.querySelectorAll("button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
    });
    picker.appendChild(b);
  }
  $("#catModal").classList.add("open");
  setTimeout(() => { if (mode !== "icono") $("#catLabel").focus(); else $("#catIcon").focus(); }, 80);
}

function populateSubcatOptions(catKey, selectedSubId){
  const sel = $("#fSubcat");
  if (!sel) return;
  sel.innerHTML = '<option value="">— Sin subcategoría —</option>';
  const subs = Store.getSubcategories(catKey);
  for (const sub of subs){
    const o = document.createElement("option");
    o.value = sub.id;
    o.textContent = sub.icon + " " + sub.label;
    if (sub.id === selectedSubId) o.selected = true;
    sel.appendChild(o);
  }
}

let _menuCatEl = null;
function cerrarMenuCategoria(){ if (_menuCatEl){ _menuCatEl.remove(); _menuCatEl = null; } }
function abrirMenuCategoria(key, anchor){
  cerrarMenuCategoria(); if (isAnyModalOpen()) return;
  const cat = Store.get(key); if (!cat) return;
  const menu = document.createElement("div");
  menu.style.cssText = `position:fixed;z-index:95;background:#1a2028;border:1px solid var(--line);border-radius:10px;padding:6px;min-width:210px;box-shadow:0 14px 40px rgba(0,0,0,.6);`;
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(window.innerWidth - 220, r.left - 160)) + "px";
  menu.style.top = Math.max(8, Math.min(window.innerHeight - 260, r.bottom + 6)) + "px";
  const items = [
    { icon:"✏️", label:"Renombrar", fn: () => abrirModalCategoria("renombrar", key) },
    { icon:"🎨", label:"Cambiar icono", fn: () => abrirModalCategoria("icono", key) },
    { icon:"⬅️", label:"Mover izquierda", fn: () => { Store.moveCategory(key, "left"); renderTabs(); } },
    { icon:"➡️", label:"Mover derecha", fn: () => { Store.moveCategory(key, "right"); renderTabs(); } },
    { sep:true },
    { icon:"📂", label:"Nueva subcategoría", fn: () => abrirModalSubcategoria("crear", key) },
    { sep:true },
    { icon:"➕", label:"Nueva categoría aquí", fn: () => abrirModalCategoria("crear", null, key) },
    { sep:true },
    { icon:"🗑️", label:"Eliminar categoría", danger:true, fn: () => confirmarEliminarCategoria(key) }
  ];
  for (const it of items){
    if (it.sep){ const s = document.createElement("div"); s.style.cssText = "height:1px;background:var(--line);margin:5px 3px"; menu.appendChild(s); continue; }
    const b = document.createElement("button"); b.type = "button";
    b.style.cssText = `display:flex;align-items:center;gap:10px;width:100%;background:transparent;border:0;color:${it.danger ? "#ffb3b3" : "var(--txt)"};padding:9px 11px;border-radius:7px;cursor:pointer;font-size:.82rem;text-align:left;font-family:inherit`;
    b.innerHTML = `<span>${it.icon}</span><span>${it.label}</span>`;
    b.addEventListener("mouseenter", () => { b.style.background = it.danger ? "rgba(255,107,107,.14)" : "rgba(79,195,247,.12)"; b.style.color = it.danger ? "#fff" : "var(--accent)"; });
    b.addEventListener("mouseleave", () => { b.style.background = "transparent"; b.style.color = it.danger ? "#ffb3b3" : "var(--txt)"; });
    b.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); cerrarMenuCategoria(); it.fn(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu); _menuCatEl = menu;
}
document.addEventListener("click", (e) => { if (_menuCatEl && !_menuCatEl.contains(e.target)) cerrarMenuCategoria(); });
function confirmarEliminarCategoria(key){
  const cat = Store.get(key); if (!cat) return;
  const n = cat.cds.length;
  if (!confirm(n === 0 ? `¿Eliminar "${cat.label}"?` : `⚠️ ¿Eliminar "${cat.label}"?\n\nContiene ${n} CDs.`)) return;
  if (n > 0 && !confirm("¿Realmente?")) return;
  const before = JSON.stringify(Store.categories());
  Store.deleteCategory(key);
  Undo.push("eliminar categoría", () => { Store.replaceAll({ categories: JSON.parse(before) }); ensureValidCat(); renderTabs(); renderAll(); });
  if (App.cat === key){ ensureValidCat(); App.artista = null; App.subcat = null; App.selected.clear(); App.focusedKey = null; }
  HistoryLog.log('DELETE', `Categoría eliminada: ${cat.label}`, `${n} CDs`);
  renderTabs(); renderStats(); renderAll(); AutoBackup.markChange("eliminación categoría");
  Toast.show(`Categoría "${cat.label}" eliminada`, "warn");
}
const EMOJIS = ["🎵","🎤","🎸","🎶","📀","💿","🎼","🎷","🎺","🥁","🎻","🎹","🎧","⭐","🇦🇷","🇧🇷","🇺🇸","🇬🇧","🌎","🔥","💫","✨","🎬","🎭"];
let _cmMode = "crear", _cmKey = null, _cmAfter = null, _subKey = null;
let _catSaving = false, _cdSaving = false;
function abrirModalCategoria(mode, key = null, after = null){
  _cmMode = mode; _cmKey = key; _cmAfter = after; _catSaving = false; _subKey = null;
  const cat = key ? Store.get(key) : null;
  $("#catModalIcon").textContent = mode === "crear" ? "➕" : mode === "renombrar" ? "✏️" : "🎨";
  $("#catModalTitle").textContent = mode === "crear" ? "Nueva categoría" : mode === "renombrar" ? "Renombrar" : "Cambiar icono";
  $("#catLabel").value = cat?.label || ""; $("#catIcon").value = cat?.icon || "🎵"; $("#catIconPreview").textContent = cat?.icon || "🎵";
  $("#wrapCatLabel").style.display = (mode === "icono") ? "none" : "";
  const li = $("#catLabel");
  if (mode === "icono") li.removeAttribute("required"); else li.setAttribute("required", "");
  const picker = $("#catIconPicker"); picker.innerHTML = "";
  const currentIcon = cat?.icon || "🎵";
  for (const e of EMOJIS){
    const b = document.createElement("button"); b.type = "button"; b.textContent = e;
    if (e === currentIcon) b.classList.add("active");
    b.addEventListener("click", () => {
      $("#catIcon").value = e; $("#catIconPreview").textContent = e;
      picker.querySelectorAll("button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
    });
    picker.appendChild(b);
  }
  $("#catModal").classList.add("open");
  setTimeout(() => { if (mode !== "icono") $("#catLabel").focus(); else $("#catIcon").focus(); }, 80);
}
function cerrarCatModal(){
  $("#catModal").classList.remove("open");
  _cmKey = null; _cmAfter = null; _subKey = null;
  setTimeout(() => {
    _catSaving = false;
    const btn = $("#catSave");
    if (btn){ btn.disabled = false; if (btn.dataset._prev){ btn.textContent = btn.dataset._prev; delete btn.dataset._prev; } }
  }, 300);
}
function guardarCategoria(e){
  if (e) e.preventDefault();
  if (_catSaving) return;
  _catSaving = true;
  const btn = $("#catSave");
  if (btn){ btn.disabled = true; btn.dataset._prev = btn.textContent; btn.textContent = "⏳ Guardando…"; }
  const unlockCat = () => {
    _catSaving = false;
    if (btn){ btn.disabled = false; if (btn.dataset._prev){ btn.textContent = btn.dataset._prev; delete btn.dataset._prev; } }
  };
  const label = upper($("#catLabel").value.trim()), icon = $("#catIcon").value.trim() || "🎵";
  if (typeof _cmMode === 'string' && _cmMode.startsWith("sub-")){
    const subMode = _cmMode.slice(4);
    if (subMode === "crear"){
      if (!label){ $("#wrapCatLabel").classList.add("invalid"); unlockCat(); return; }
      const id = Store.addSubcategory(_cmKey, { label, icon: icon || "📂" });
      if (id){
        App.cat = _cmKey; App.subcat = id;
        HistoryLog.log('CREATE', `Subcategoría creada: ${label}`, Store.get(_cmKey)?.label || '');
        AutoBackup.markChange('nueva subcategoría');
        renderSubtabs(); renderTabs(); renderAll();
        Toast.show(`Subcategoría "${label}" creada`, "ok");
      } else { Toast.show("No se pudo crear la subcategoría", "err"); }
      cerrarCatModal();
      return;
    }
    if (subMode === "renombrar"){
      if (!label){ $("#wrapCatLabel").classList.add("invalid"); unlockCat(); return; }
      if (Store.updateSubcategory(_cmKey, _subKey, { label })){
        HistoryLog.log('EDIT', `Subcategoría renombrada: ${label}`);
        AutoBackup.markChange('renombrar subcategoría');
        renderSubtabs(); renderAll();
        Toast.show(`Renombrada a "${label}"`, "ok");
      }
      cerrarCatModal();
      return;
    }
    if (subMode === "icono"){
      if (Store.updateSubcategory(_cmKey, _subKey, { icon: icon || "📂" })){
        HistoryLog.log('EDIT', `Icono de subcategoría actualizado`);
        AutoBackup.markChange('cambio icono subcategoría');
        renderSubtabs(); renderAll();
        Toast.show("Icono actualizado", "ok");
      }
      cerrarCatModal();
      return;
    }
    unlockCat();
    return;
  }
  if (_cmMode === "crear"){
    if (!label){ $("#wrapCatLabel").classList.add("invalid"); unlockCat(); return; }
    const before = JSON.stringify(Store.categories());
    const nk = Store.addCategory({ label, icon });
    if (_cmAfter && Store.get(_cmAfter)){
      const keys = Store.catKeys(); const ti = keys.indexOf(_cmAfter); const ni = keys.indexOf(nk);
      if (ti !== -1 && ni !== -1){ keys.splice(ni, 1); keys.splice(ti + 1, 0, nk); const rb = {}; for (const k of keys) rb[k] = Store.get(k); Store.replaceAll({ categories: rb }); }
    }
    Undo.push("crear categoría", () => { Store.replaceAll({ categories: JSON.parse(before) }); ensureValidCat(); renderTabs(); renderAll(); });
    App.cat = nk; App.artista = null; App.subcat = null; App.selected.clear(); App.focusedKey = null;
    HistoryLog.log('CREATE', `Categoría creada: ${label}`, icon);
    renderTabs(); renderStats(); renderAll();
    AutoBackup.markChange("nueva categoría");
    Toast.show(`Categoría "${label}" creada`, "ok");
    cerrarCatModal();
    return;
  }
  if (_cmMode === "renombrar"){
    if (!label){ $("#wrapCatLabel").classList.add("invalid"); unlockCat(); return; }
    const cat = Store.get(_cmKey); if (!cat){ unlockCat(); return; }
    const before = JSON.stringify(Store.categories()); const oldKey = _cmKey; let nk = oldKey;
    if (label !== cat.label) nk = Store.renameCategoryKey(oldKey, label) || oldKey; else Store.updateCategory(oldKey, { label });
    Undo.push("renombrar categoría", () => { Store.replaceAll({ categories: JSON.parse(before) }); ensureValidCat(); renderTabs(); renderAll(); });
    if (App.cat === oldKey) App.cat = nk;
    if (nk !== oldKey){
      const rem = new Set();
      for (const k of App.selected){ const { cat: c, id } = parseCDKey(k); rem.add(c === oldKey ? `${nk}|${id}` : k); }
      App.selected = rem;
      if (App.focusedKey && App.focusedKey.startsWith(oldKey + "|")) App.focusedKey = `${nk}|${parseCDKey(App.focusedKey).id}`;
    }
    HistoryLog.log('EDIT', `Categoría renombrada: ${label}`);
    renderTabs(); renderStats(); renderAll(); ensureValidCat();
    AutoBackup.markChange("renombrar categoría");
    Toast.show(`Renombrada a "${label}"`, "ok");
    cerrarCatModal();
    return;
  }
  if (_cmMode === "icono"){
    Store.updateCategory(_cmKey, { icon });
    HistoryLog.log('EDIT', `Icono actualizado`);
    renderTabs(); AutoBackup.markChange("cambio icono");
    Toast.show("Icono actualizado", "ok");
    cerrarCatModal();
    return;
  }
  unlockCat();
}

function setArtistFilter(name){
  if (name){
    App.artista = name;
    App.q = '';
    const qEl = $("#q");
    if (qEl) qEl.value = '';
    $("#searchBox")?.classList.remove("has-value", "adv-mode");
    const advBadge = $("#advModeBadge"); if (advBadge) advBadge.style.display = "none";
    App.filters = { estado: '', formato: '', anioDesde: '', anioHasta: '', ubicacion: '', portada: '', prestamo: '' };
    const fE = $("#fFiltroEstado"); if (fE) fE.value = '';
    const fF = $("#fFiltroFormato"); if (fF) fF.value = '';
    const fAD = $("#fFiltroAnioDesde"); if (fAD) fAD.value = '';
    const fAH = $("#fFiltroAnioHasta"); if (fAH) fAH.value = '';
    const fU = $("#fFiltroUbicacion"); if (fU) fU.value = '';
    const fP = $("#fFiltroPortada"); if (fP) fP.value = '';
    const fPr = $("#fFiltroPrestamo"); if (fPr) fPr.value = '';
    Toast.show(`🎤 Solo ${upper(name)} (exacto)`, 'ok', 2200);
  } else {
    App.artista = null;
    Toast.show('🎤 Filtro de artista quitado', 'info', 1500);
  }
  renderAll();
  const main = document.querySelector('main');
  if (main) main.scrollTop = 0;
}

function renderTabla(){
  const tbody = $("#tbodyCD");
  if (!App.cat){
    tbody.innerHTML = `<tr><td colspan="7" class="empty"><span class="big">📁</span>Creá una categoría.</td></tr>`;
    $("#cdCount").textContent = "—"; $("#checkAll").checked = false; updateSelectionBar(); return;
  }
  const datos = sortCDs(getFiltered());
  const q = App.q.trim();
  if (!datos.length){ tbody.innerHTML = `<tr><td colspan="7" class="empty"><span class="big">💿</span>No hay CDs.</td></tr>`; }
  else {
    const frag = document.createDocumentFragment();
    for (const cd of datos){
      const key = cdKeyForView(cd);
      const tr = document.createElement("tr");
      tr.dataset.key = key; tr.dataset.nro = cd.nro;
      if (App.selected.has(key)) tr.classList.add("selected");
      if (App.focusedKey === key) tr.classList.add("focused");
      const loaned = Loans.isLoaned(cd); const overdue = Loans.isOverdue(cd);
      const coverHtml = cd.portada ? `<img class="cover-thumb" src="${esc(cd.portada)}" alt="" loading="lazy" data-key="${esc(key)}" data-title="${esc(upper(cd.titulo))} — ${esc(upper(cd.interprete))}">` : `<div class="cover-placeholder" title="Sin portada">💿</div>`;
      const loanIcon = loaned ? ` <span class="loan-badge${overdue ? ' overdue' : ''}" title="${overdue ? 'VENCIDO' : 'Prestado'}">📤${overdue ? '!' : ''}</span>` : '';
      const hasLinks = cd.links && Object.keys(cd.links).length > 0;
      tr.innerHTML = `
        <td class="check"><input type="checkbox" ${App.selected.has(key)?"checked":""}></td>
        <td class="cover">${coverHtml}</td>
        <td class="num">${cd.nro}</td>
        <td class="titulo">${highlight(upper(cd.titulo), q)}</td>
        <td class="art" title="${esc(upper(cd.interprete))}">${highlight(upper(cd.interprete), q)}${loanIcon}</td>
        <td class="anio">${cd.anio ?? "—"}</td>
        <td class="actions">${hasLinks ? `<button type="button" class="stream-quick" title="Ver CD y sus links de streaming">🎧</button>` : ''}<button type="button" class="view" title="Ver">👁️</button><button type="button" class="edit" title="Editar">✏️</button><button type="button" class="del" title="Eliminar">🗑️</button></td>`;
      tr.querySelector("td.check input").addEventListener("change", e => { e.stopPropagation(); toggleSelect(key, e.target.checked); });
      tr.querySelector("td.art").addEventListener("click", () => {
        const act = App.artista === cd.interprete;
        setArtistFilter(act ? null : cd.interprete);
      });
      tr.querySelector(".stream-quick")?.addEventListener("click", e => { e.stopPropagation(); abrirVista(cd); setTimeout(() => { $("#viewBody")?.querySelector(".stream-grid")?.scrollIntoView({behavior:"smooth",block:"center"}); }, 150); });
      tr.querySelector(".view").addEventListener("click", e => { e.stopPropagation(); abrirVista(cd); });
      tr.querySelector(".edit").addEventListener("click", e => { e.stopPropagation(); abrirModal("editar", cd); });
      tr.querySelector(".del").addEventListener("click", e => { e.stopPropagation(); eliminarCD(cd); });
      const thumb = tr.querySelector(".cover-thumb");
      if (thumb){ thumb.addEventListener("click", e => { e.stopPropagation(); Lightbox.open(cd.portada, `${cd.titulo} — ${cd.interprete}`, key); }); thumb.addEventListener("error", () => { thumb.outerHTML = `<div class="cover-placeholder" title="Error">⚠️</div>`; }); }
      tr.addEventListener("click", e => { if (e.target.closest("td.check") || e.target.closest("td.actions") || e.target.closest("td.cover")) return; App.focusedKey = key; updateFocusedRow(); });
      frag.appendChild(tr);
    }
    tbody.replaceChildren(frag);
  }
  const total = (App.cat === ALL_CATS) ? Store.total() : Store.getCDs(App.cat).length;
  const fa = Object.values(App.filters).some(v => v) || App.artista || App.q.trim() || App.subcat;
  $("#cdCount").innerHTML = fa ? `Mostrando <b>${datos.length}</b> de ${total} · <b>filtrado</b>` : `Todos: <b>${total}</b>`;
  $$("#tablaCD thead th[data-key]").forEach(th => { const k = th.dataset.key; th.classList.toggle("sorted", k === App.sortKey); th.querySelector(".arrow").textContent = k === App.sortKey ? (App.sortDir === 1 ? "▲" : "▼") : "▲"; });
  $("#checkAll").checked = datos.length > 0 && datos.every(cd => App.selected.has(cdKeyForView(cd)));
  updateSelectionBar();
  const chip = $("#activeArtistChip");
  if (chip){ if (App.artista){ chip.innerHTML = `<span class="artist-chip">🎤 <b>${esc(upper(App.artista))}</b> <button type="button" class="chip-remove" title="Quitar">✕</button></span>`; chip.querySelector(".chip-remove").addEventListener("click", (e) => { e.stopPropagation(); App.artista = null; renderAll(); }); } else chip.innerHTML = ""; }
  const fab = $("#fabVerTodos"); if (fab) fab.classList.toggle("show", !!App.artista);
  const notice = $("#artFilterNotice"); const nn = $("#artFilterName");
  if (notice){ if (App.artista){ notice.classList.add("show"); if (nn) nn.textContent = upper(App.artista); } else notice.classList.remove("show"); }
  if (GridView.isEnabled()) GridView.render();
}
function updateFocusedRow(){ $$("#tbodyCD tr").forEach(tr => tr.classList.toggle("focused", tr.dataset.key === App.focusedKey)); const el = findRowByKey(App.focusedKey); if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }

function renderArtistas(){
  if (!App.cat){ $("#listaArt").innerHTML = ""; $("#artCount").innerHTML = "—"; return; }
  const q = App.q.trim();
  const m = new Map();
  for (const cd of viewCDs()){ if (!cd.interprete) continue; m.set(cd.interprete, (m.get(cd.interprete) || 0) + 1); }
  const sortMode = Store.getPref('artSort', 'count');
  const lista = [...m.entries()].map(([nombre, count]) => ({ nombre, count }));
  if (sortMode === 'alpha'){ lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: 'base', numeric: true })); }
  else if (sortMode === 'alpha-desc'){ lista.sort((a, b) => b.nombre.localeCompare(a.nombre, "es", { sensitivity: 'base', numeric: true })); }
  else { lista.sort((a, b) => b.count - a.count || a.nombre.localeCompare(b.nombre, "es", { sensitivity: 'base', numeric: true })); }
  const max = Math.max(...lista.map(a => a.count), 1);
  const ul = $("#listaArt");
  const frag = document.createDocumentFragment();
  lista.forEach((a, i) => {
    const li = document.createElement("li");
    const act = App.artista === a.nombre;
    li.className = "art-item" + (act ? " active" : "");
    const rankLabel = (sortMode === 'count') ? String(i + 1) : a.nombre.charAt(0).toUpperCase();
    li.innerHTML = `<span class="art-rank">${esc(rankLabel)}</span><span class="art-info"><span class="art-name">${highlight(upper(a.nombre), q)}</span><span class="bar"><i style="width:${Math.round(a.count/max*100)}%"></i></span></span><span class="art-count">${a.count}</span>`;
    li.title = act ? `Quitar filtro` : `Ver los ${a.count} CDs`;
    li.setAttribute("role", "button"); li.setAttribute("tabindex", "0");
    li.addEventListener("click", () => { setArtistFilter(act ? null : a.nombre); });
    li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); li.click(); } });
    frag.appendChild(li);
  });
  ul.replaceChildren(frag);
  $("#artCount").innerHTML = `<b>${lista.length}</b> intérpretes${App.artista ? ` · <span style="color:var(--purple)">${esc(upper(App.artista))}</span>` : ""}`;
}

function renderStats(){
  const cds = viewCDs();
  const años = cds.map(c => c.anio).filter(a => a && a > 0);
  const min = años.length ? Math.min(...años) : 0, max = años.length ? Math.max(...años) : 0;
  const art = new Map();
  for (const c of cds) art.set(c.interprete, (art.get(c.interprete) || 0) + 1);
  const top = [...art.entries()].sort((a, b) => b[1] - a[1])[0];
  const cp = cds.filter(c => c.portada).length;
  $("#stTotal").textContent = cds.length;
  $("#stArt").textContent = art.size;
  $("#stRango").textContent = años.length ? `${min}–${max}` : "—";
  const st = $("#stTop");
  if (top){ const fn = top[0]; st.textContent = `${fn.length > 14 ? fn.slice(0, 14) + "…" : fn} (${top[1]})`; st.title = `${fn} — ${top[1]} CDs`; } else { st.textContent = "—"; st.title = ""; }
  $("#stCovers").textContent = `${cp}/${cds.length}`;
  $("#fTotal").textContent = Store.total();
}
let _charts = {};
function computeDash(){
  const all = Store.allCDs(); const total = all.length;
  const aS = new Set(); const sM = new Map(); const yM = new Map(); const dM = new Map();
  let cU = 0, cV = 0, cS = 0, cG = 0, cA = 0, cC = 0, cP = 0, vT = 0;
  for (const cd of all){
    if (cd.interprete) aS.add(cd.interprete);
    if (cd.sello){ sM.set(cd.sello, (sM.get(cd.sello) || 0) + 1); cS++; }
    if (cd.anio && cd.anio > 0){ yM.set(cd.anio, (yM.get(cd.anio) || 0) + 1); const d = Math.floor(cd.anio / 10) * 10; dM.set(d, (dM.get(d) || 0) + 1); cA++; }
    if (cd.ubicacion) cU++; if (cd.genero) cG++; if (cd.catalogo) cC++; if (cd.portada) cP++;
    if (cd.valor != null && Number.isFinite(Number(cd.valor))){ const cn = Math.max(1, parseInt(cd.cantidad) || 1); vT += Number(cd.valor) * cn; cV++; }
  }
  const años = all.map(c => c.anio).filter(a => a && a > 0);
  const aMin = años.length ? Math.min(...años) : null, aMax = años.length ? Math.max(...años) : null;
  const aM = new Map();
  for (const cd of all){ if (cd.interprete) aM.set(cd.interprete, (aM.get(cd.interprete) || 0) + 1); }
  const topA = [...aM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topA40 = [...aM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  const topS = [...sM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topY = [...yM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const dec = [...dM.entries()].sort((a, b) => a[0] - b[0]);
  const catD = Store.catKeys().map(k => ({ key: k, label: Store.get(k).label, icon: Store.get(k).icon, count: Store.getCDs(k).length }));
  return { total, artistas: aS.size, valorTotal: vT, añoMin: aMin, añoMax: aMax, topArtistas: topA, topArtistasAll: topA40, topSellos: topS, topAnios: topY, decadas: dec, catData: catD, conUbicacion: cU, conValor: cV, conSello: cS, conGenero: cG, conAnio: cA, conCatalogo: cC, conPortada: cP };
}
function destroyCharts(){
  for (const id in _charts){
    try { _charts[id].destroy(); } catch(e){}
    delete _charts[id];
  }
}
function renderDashboard(){
  if (!Store.catKeys().length) return;
  const d = computeDash();
  const kpis = [
    { icon:"💿", label:"Total CDs", value: d.total.toLocaleString("es-AR"), sub: `${Store.catKeys().length} categorías` },
    { icon:"🎤", label:"Intérpretes", value: d.artistas.toLocaleString("es-AR"), sub: d.total && d.artistas ? `${(d.total/d.artistas).toFixed(1)} CDs/int.` : "—" },
    { icon:"📅", label:"Años", value: d.añoMin && d.añoMax ? `${d.añoMin}–${d.añoMax}` : "—", sub: d.añoMin ? `${d.añoMax - d.añoMin + 1} años` : "" },
    { icon:"💰", label:"Valor", value: d.valorTotal > 0 ? `$${d.valorTotal.toLocaleString("es-AR", {maximumFractionDigits: 0})}` : "—", sub: d.conValor > 0 ? `${d.conValor} con valor` : "" },
    { icon:"🖼️", label:"Portadas", value: `${d.conPortada}/${d.total}`, sub: d.total > 0 ? `${Math.round(d.conPortada/d.total*100)}%` : "" }
  ];
  $("#dashKpiRow").innerHTML = kpis.map(k => `<div class="dash-kpi"><div class="kpi-icon">${k.icon}</div><div class="kpi-text"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value">${esc(k.value)}</div><div class="kpi-sub">${esc(k.sub)}</div></div></div>`).join("");
  const chAv = typeof Chart !== "undefined";
  const colors = ["#4fc3f7","#a78bfa","#ffca28","#5ddc9a","#ff6b6b","#ffa94d","#f472b6","#34d399","#60a5fa","#fbbf24","#c084fc","#f87171"];
  function upsert(id, cfg){
    const cv = document.getElementById(id);
    if (!chAv || !cv) return;
    if (_charts[id]){
      try {
        if (_charts[id].canvas === cv){ _charts[id].data = cfg.data; _charts[id].update('none'); return; }
        _charts[id].destroy();
      } catch(e){ try { _charts[id].destroy(); } catch(_){} }
      delete _charts[id];
    }
    try { _charts[id] = new Chart(cv, cfg); } catch(e){ console.warn(id, e); }
  }
  upsert("chartCategorias", { type:"doughnut", data:{ labels: d.catData.map(c => c.icon + " " + c.label), datasets: [{ data: d.catData.map(c => c.count), backgroundColor: colors, borderColor: "rgba(14,17,22,.6)", borderWidth: 2 }] }, options:{ responsive: true, maintainAspectRatio: false, plugins:{ legend:{ position:"bottom", labels:{ color:"#e6ebf2", font:{ size:11 }, boxWidth:12, padding:10 } } } } });
  upsert("chartArtistas", { type:"bar", data:{ labels: d.topArtistas.map(([n]) => n.length > 22 ? n.slice(0,20) + "…" : n), datasets:[{ label:"CDs", data: d.topArtistas.map(([,n]) => n), backgroundColor: "rgba(167,139,250,.7)", borderColor: "#a78bfa", borderWidth: 1, borderRadius: 4 }] }, options:{ indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins:{ legend:{ display: false } }, scales:{ x:{ ticks:{ color:"#8b97a8", font:{ size:10 } }, grid:{ color:"rgba(37,45,58,.4)" } }, y:{ ticks:{ color:"#e6ebf2", font:{ size:10 } }, grid:{ display: false } } } } });
  let acc = 0; const dAcc = d.decadas.map(([,n]) => (acc += n));
  upsert("chartDecadas", { type:"bar", data:{ labels: d.decadas.map(([dc]) => `${dc}s`), datasets:[{ label:"CDs", data: d.decadas.map(([,n]) => n), backgroundColor: "rgba(255,202,40,.55)", borderColor: "#ffca28", borderWidth: 1, borderRadius: 4, yAxisID: "y" }, { type:"line", label:"Acumulado", data: dAcc, borderColor: "#4fc3f7", backgroundColor: "rgba(79,195,247,.15)", borderWidth: 2, tension: .35, pointRadius: 4, pointBackgroundColor: "#4fc3f7", fill: true, yAxisID: "y1" }] }, options:{ responsive: true, maintainAspectRatio: false, plugins:{ legend:{ labels:{ color:"#e6ebf2", font:{ size:11 }, boxWidth:12 } } }, scales:{ x:{ ticks:{ color:"#8b97a8", font:{ size:10 } }, grid:{ display: false } }, y:{ position:"left", ticks:{ color:"#ffca28", font:{ size:10 } }, grid:{ color:"rgba(37,45,58,.4)" } }, y1:{ position:"right", ticks:{ color:"#4fc3f7", font:{ size:10 } }, grid:{ display: false } } } } });
  const sEl = $("#topSellos"); if (sEl) sEl.innerHTML = d.topSellos.length ? d.topSellos.map(([n, v], i) => `<li><span class="tl-rank">${i+1}</span><span class="tl-name" title="${esc(n)}">${esc(n)}</span><span class="tl-value">${v}</span></li>`).join("") : `<li style="color:var(--muted);justify-content:center">Sin datos</li>`;
  const yEl = $("#topAnios"); if (yEl) yEl.innerHTML = d.topAnios.length ? d.topAnios.map(([n, v], i) => `<li><span class="tl-rank">${i+1}</span><span class="tl-name">${n}</span><span class="tl-value">${v}</span></li>`).join("") : `<li style="color:var(--muted);justify-content:center">Sin datos</li>`;
  const wc = $("#wordcloud");
  if (wc){ if (d.topArtistasAll.length){ const mv = d.topArtistasAll[0][1]; wc.innerHTML = d.topArtistasAll.map(([n, v]) => { const s = 0.8 + (v/mv)*1.4; const o = 0.5 + (v/mv)*0.5; return `<span style="font-size:${s}rem;opacity:${o}" title="${esc(n)}: ${v} CDs">${esc(n)}</span>`; }).join(""); } else wc.innerHTML = `<span style="color:var(--muted)">Sin datos</span>`; }
  const hI = [
    { label:"Con año", val: d.conAnio, total: d.total },
    { label:"Con sello", val: d.conSello, total: d.total },
    { label:"Con género", val: d.conGenero, total: d.total },
    { label:"Con ubicación", val: d.conUbicacion, total: d.total },
    { label:"Con Nº catálogo", val: d.conCatalogo, total: d.total },
    { label:"Con valor", val: d.conValor, total: d.total },
    { label:"Con portada", val: d.conPortada, total: d.total }
  ];
  const hg = $("#healthGrid");
  if (hg) hg.innerHTML = hI.map(h => { const p = h.total ? Math.round(h.val / h.total * 100) : 0; return `<div class="health-item"><div class="hi-label">${h.label}</div><div class="hi-value">${h.val} <span style="font-size:.7rem;color:var(--muted);font-weight:400">/ ${h.total}</span></div><div class="hi-bar"><i style="width:${p}%"></i></div><div style="font-size:.65rem;color:var(--muted);text-align:right">${p}%</div></div>`; }).join("");
  renderProjection(d.valorTotal);
}
function renderProjection(vA){
  const ts = $("#projTasa"); if (!ts) return;
  const años = parseInt($("#projAnios").value) || 10;
  let tasa = parseFloat(ts.value); if (ts.value === "custom") tasa = (parseFloat($("#projCustom").value) || 0) / 100;
  let base = $("#projBase").value === "manual" ? (parseFloat($("#projManual").value) || 0) : vA;
  const fut = base * Math.pow(1 + tasa, años); const gan = fut - base; const roi = base > 0 ? ((fut / base) - 1) * 100 : 0;
  const r = $("#projectionResult"); if (!r) return;
  r.innerHTML = `<div class="pr-item"><div class="pr-label">Valor actual</div><div class="pr-value">$${base.toLocaleString("es-AR", {maximumFractionDigits: 0})}</div></div><div class="pr-item"><div class="pr-label">En ${años} años</div><div class="pr-value ${fut >= base ? 'green' : 'red'}">$${fut.toLocaleString("es-AR", {maximumFractionDigits: 0})}</div></div><div class="pr-item"><div class="pr-label">Ganancia/Pérdida</div><div class="pr-value ${gan >= 0 ? 'green' : 'red'}">${gan >= 0 ? '+' : ''}$${gan.toLocaleString("es-AR", {maximumFractionDigits: 0})}</div></div><div class="pr-item"><div class="pr-label">ROI</div><div class="pr-value ${roi >= 0 ? 'green' : 'red'}">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</div></div>`;
}
function setView(v){
  App.view = v; const isD = v === "dashboard";
  $("#tableView").style.display = isD ? "none" : "";
  $("#dashboardView").classList.toggle("active", isD);
  $("#panelArtistas").classList.toggle("hidden-panel", isD);
  const b = $("#btnVista"); b.innerHTML = isD ? `<span class="ico">📋</span><span>Tabla</span>` : `<span class="ico">📊</span><span>Panel</span>`;
  b.classList.toggle("active", isD);
  if (isD) renderDashboard(); else { destroyCharts(); renderTabla(); renderArtistas(); renderStats(); }
}
function renderAll(){
  ensureValidCat();
  renderSubtabs();
  const ie = Store.isEmpty;
  $("#emptyState").classList.toggle("hidden", !ie);
  $("#tableView").style.display = ie || App.view === "dashboard" ? "none" : "";
  $("#dashboardView").classList.toggle("active", !ie && App.view === "dashboard");
  const ap = $("#panelArtistas");
  if (ap){ ap.classList.toggle("hidden-panel", ie || App.view === "dashboard"); }
  if (!ie){ if (App.view === "dashboard") renderDashboard(); else { renderTabla(); renderArtistas(); } renderStats(); }
  else { $("#cdCount").textContent = "—"; $("#artCount").textContent = "—"; $("#stTotal").textContent = "0"; $("#stArt").textContent = "0"; $("#stRango").textContent = "—"; $("#stTop").textContent = "—"; $("#stCovers").textContent = "0/0"; $("#fTotal").textContent = "0"; }
  const n = Store.catKeys().length;
  $("#subtitle").textContent = "Colección profesional de CDs · " + n + " categoría" + (n === 1 ? "" : "s");
  NotFoundList.updateBadge(); FileSystemDefault.refreshBadge();
  const fab = $("#fabVerTodos"); if (fab) fab.classList.toggle("show", !!App.artista);
  DuplicateChecker.invalidate();
}
function toggleSelect(k, c){ if (c) App.selected.add(k); else App.selected.delete(k); const tr = findRowByKey(k); if (tr) tr.classList.toggle("selected", c); updateSelectionBar(); syncCheckAll(); }
function updateSelectionBar(){ const b = $("#selectionBar"); if (App.selected.size === 0){ b.classList.remove("show"); return; } b.classList.add("show"); $("#selCount").textContent = App.selected.size; }
function syncCheckAll(){ const a = $$("#tbodyCD tr").length; const c = $$("#tbodyCD tr.selected").length; $("#checkAll").checked = a > 0 && c === a; $("#checkAll").indeterminate = c > 0 && c < a; }

const GridView = (() => {
  let enabled = false;
  function isEnabled(){ return enabled; }
  function setEnabled(v){
    enabled = !!v;
    const btn = $('#btnGrid'); if (btn) btn.classList.toggle('active', enabled);
    const tw = $('#tableWrap'); const gw = $('#gridWrap');
    if (gw) gw.style.display = enabled ? '' : 'none';
    if (tw) tw.style.display = enabled ? 'none' : '';
    if (enabled) render();
  }
  function render(){
    if (!enabled || !App.cat) return;
    const w = $('#gridWrap'); if (!w) return;
    const datos = sortCDs(getFiltered());
    if (!datos.length){ w.innerHTML = '<div style="grid-column:1/-1;padding:60px 20px;text-align:center;color:var(--muted)"><span style="font-size:3rem;opacity:.5;display:block;margin-bottom:12px">💿</span>No hay CDs</div>'; return; }
    w.innerHTML = datos.map(cd => {
      const key = cdKeyForView(cd);
      const isSel = App.selected.has(key);
      const loaned = Loans.isLoaned(cd); const ov = Loans.isOverdue(cd);
      const dup = DuplicateChecker.isDuplicate(cd);
      const cover = cd.portada ? `<img src="${esc(cd.portada)}" alt="" loading="lazy">` : `<div class="gc-placeholder">💿</div>`;
      const badges = [];
      if (loaned) badges.push(`<span class="gc-badge loan">📤${ov ? '!' : ''}</span>`);
      if (dup) badges.push(`<span class="gc-badge dup">🔍</span>`);
      return `<div class="grid-card${isSel ? ' selected' : ''}" data-gc-key="${esc(key)}">
        <div class="gc-check" data-gc-check="${esc(key)}">${isSel ? '✓' : ''}</div>
        ${badges.length ? `<div class="gc-badges">${badges.join('')}</div>` : ''}
        <div class="gc-cover" data-gc-open="${esc(key)}">${cover}</div>
        <div class="gc-title" title="${esc(upper(cd.titulo))}">${esc(upper(cd.titulo))}</div>
        <div class="gc-artist" title="${esc(upper(cd.interprete))}">${esc(upper(cd.interprete))}</div>
        <div class="gc-meta"><span class="gc-nro">#${cd.nro}</span><span class="gc-year">${cd.anio ?? '—'}</span></div>
        <div class="gc-actions">
          <button type="button" data-gc-view="${esc(key)}" title="Ver">👁️</button>
          <button type="button" data-gc-edit="${esc(key)}" title="Editar">✏️</button>
          <button type="button" data-gc-del="${esc(key)}" title="Eliminar">🗑️</button>
        </div>
      </div>`;
    }).join('');
    w.querySelectorAll('[data-gc-check]').forEach(el => { el.addEventListener('click', (e) => { e.stopPropagation(); const k = el.dataset.gcCheck; toggleSelect(k, !App.selected.has(k)); render(); }); });
    w.querySelectorAll('[data-gc-open]').forEach(el => { el.addEventListener('click', () => { const { cat, id } = parseCDKey(el.dataset.gcOpen); const cd = Store.getCDs(cat).find(c => c.id === id); if (cd && cd.portada) Lightbox.open(cd.portada, `${cd.titulo} — ${cd.interprete}`, el.dataset.gcOpen); }); });
    w.querySelectorAll('[data-gc-view]').forEach(el => { el.addEventListener('click', (e) => { e.stopPropagation(); const { cat, id } = parseCDKey(el.dataset.gcView); const cd = Store.getCDs(cat).find(c => c.id === id); if (cd) abrirVista(cd); }); });
    w.querySelectorAll('[data-gc-edit]').forEach(el => { el.addEventListener('click', (e) => { e.stopPropagation(); const { cat, id } = parseCDKey(el.dataset.gcEdit); const cd = Store.getCDs(cat).find(c => c.id === id); if (cd) abrirModal('editar', cd); }); });
    w.querySelectorAll('[data-gc-del]').forEach(el => { el.addEventListener('click', (e) => { e.stopPropagation(); const { cat, id } = parseCDKey(el.dataset.gcDel); const cd = Store.getCDs(cat).find(c => c.id === id); if (cd) eliminarCD(cd); }); });
  }
  return { isEnabled, setEnabled, render };
})();

const setVal = (s, v) => { const el = $(s); if (el) el.value = v; };
const getVal = s => $(s)?.value ?? "";
function fillDatalist(sel, set){ const dl = $(sel); if (!dl) return; dl.innerHTML = ""; [...set].sort((a, b) => a.localeCompare(b, "es")).forEach(v => { const o = document.createElement("option"); o.value = upper(v); dl.appendChild(o); }); }
function switchModalTab(n){ $$(".modal-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === n)); $$(".tab-panel").forEach(p => p.style.display = p.dataset.panel === n ? "" : "none"); }
function clearValidation(){ $$(".field.invalid").forEach(f => f.classList.remove("invalid")); }
function abrirVista(cd){
  if (!cd) return;
  App.detailCD = cd;
  const v = (val, fb = "—") => (val === null || val === undefined || val === "") ? fb : val;
  const cov = cd.portada ? `<img src="${esc(cd.portada)}" alt="Portada" style="width:180px;height:180px;border-radius:12px;object-fit:cover;border:1px solid var(--line);box-shadow:0 8px 30px rgba(0,0,0,.5);cursor:zoom-in" data-lb-key="${esc(cdKeyForView(cd))}">` : `<div style="width:180px;height:180px;border-radius:12px;background:linear-gradient(135deg,var(--bg3),var(--bg2));border:1px dashed var(--line);display:flex;align-items:center;justify-content:center;font-size:3rem;opacity:.4">💿</div>`;
  const secs = [
    { t: "📀 Edición", c: [["Formato", v(cd.formato)], ["Año álbum", v(cd.anio)], ["Año edición", v(cd.anioEdicion)], ["Sello", v(upper(cd.sello))], ["Género", v(upper(cd.genero))], ["Nº catálogo", v(upper(cd.catalogo))], ["Código de barras", v(cd.codigo)], ["ISRC", v(cd.isrc)], ["Edición", v(upper(cd.edicion))], ["País", v(upper(cd.pais))]] },
    { t: "🔍 Estado físico", c: [["Estado general", v(cd.estado)], ["Disco", v(cd.estadoDisco)], ["Caja", v(cd.estadoCaja)], ["Folleto", v(cd.estadoFolleto)], ["Arte / carátula", v(cd.estadoArte)]] },
    { t: "📍 Ubicación y valor", c: [["Ubicación", v(upper(cd.ubicacion))], ["Cantidad", v(cd.cantidad, 1)], ["Fecha ingreso", v(cd.adquisicion)], ["Valor", cd.valor != null ? `${cd.moneda || "ARS"} ${Number(cd.valor).toLocaleString("es-AR")}` : "—"], ["Moneda", v(cd.moneda)]] }
  ];
  if (Loans.isLoaned(cd)) secs.push({ t: "📚 Préstamo", c: [["Prestado a", v(upper(cd.prestadoA))], ["Fecha préstamo", v(cd.fechaPrestamo)], ["Fecha devolución", v(cd.fechaDevolucion)], ["Notas", v(upper(cd.notasPrestamo))]] });
  const cf = cd.customFields || {};
  const cfs = CustomFields.getAll().filter(f => cf[f.id]);
  if (cfs.length) secs.push({ t: "📝 Personalizados", c: cfs.map(f => [f.name, v(cf[f.id])]) });
  const rSec = (s) => `<div style="margin-bottom:18px"><div class="section-label" style="margin-top:0">${s.t}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 18px">${s.c.map(([k, val]) => `<div><div style="font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;font-weight:600">${esc(k)}</div><div style="font-size:.88rem;color:var(--txt);word-break:break-word;text-transform:uppercase">${esc(String(val))}</div></div>`).join("")}</div></div>`;
  $("#viewTitle").textContent = upper(cd.titulo) || "Detalles del CD";
  const realCat = findCategoryOfCD(cd) || App.cat;
  const realCatObj = Store.get(realCat);
  const subObj = cd.subcat ? Store.getSubcategory(realCat, cd.subcat) : null;
  $("#viewBody").innerHTML = `
    <div style="display:flex;gap:20px;flex-wrap:wrap;padding:16px;background:linear-gradient(135deg,rgba(79,195,247,.07),rgba(167,139,250,.05));border:1px solid rgba(79,195,247,.22);border-radius:12px;margin-bottom:20px;align-items:flex-start">
      <div style="flex:0 0 auto">${cov}</div>
      <div style="flex:1;min-width:200px">
        <div style="font-size:.62rem;color:var(--accent);text-transform:uppercase;letter-spacing:1.2px;font-weight:700;margin-bottom:6px">🎵 Título</div>
        <div style="font-size:1.25rem;font-weight:700;color:var(--txt);margin-bottom:14px;line-height:1.25;text-transform:uppercase">${esc(upper(cd.titulo) || "—")}</div>
        <div style="font-size:.62rem;color:var(--accent);text-transform:uppercase;letter-spacing:1.2px;font-weight:700;margin-bottom:6px">🎤 Intérprete</div>
        <div style="font-size:1rem;color:var(--txt);margin-bottom:14px;text-transform:uppercase">${esc(upper(cd.interprete) || "—")}</div>
        <div style="display:flex;gap:18px;flex-wrap:wrap">
          <div><div style="font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Nº</div><div style="font-size:1rem;font-weight:700;color:var(--accent2)">${cd.nro ?? "—"}</div></div>
          <div><div style="font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Año álbum</div><div style="font-size:1rem;font-weight:700;color:var(--accent2)">${cd.anio ?? "—"}</div></div>
          ${cd.anioEdicion ? `<div><div style="font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Año edición</div><div style="font-size:1rem;font-weight:700;color:var(--purple)">${cd.anioEdicion}</div></div>` : ''}
          <div><div style="font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Categoría</div><div style="font-size:1rem;font-weight:600;color:var(--txt)">${esc(realCatObj?.label || "—")}</div></div>
          ${subObj ? `<div><div style="font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Subcategoría</div><div style="font-size:1rem;font-weight:600;color:var(--purple)">${esc(subObj.icon)} ${esc(subObj.label)}</div></div>` : ''}
        </div>
      </div>
    </div>
    ${secs.map(rSec).join("")}
    ${renderStreamingSection(cd)}
    ${cd.notas ? `<div style="margin-top:8px"><div class="section-label" style="margin-top:0">📝 Observaciones</div><div style="font-size:.85rem;color:var(--txt);line-height:1.6;padding:12px 14px;background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:10px;white-space:pre-wrap">${esc(cd.notas)}</div></div>` : ""}
    ${cd.enrichmentSource ? `<div style="margin-top:16px;padding:10px 14px;background:rgba(79,195,247,.06);border-left:3px solid var(--accent);border-radius:8px;font-size:.75rem;color:var(--muted)">✨ Enriquecido desde <b style="color:var(--accent)">${esc(cd.enrichmentSource)}</b>${cd.enrichmentConfidence != null ? ` · Confianza: <b>${cd.enrichmentConfidence}%</b>` : ""}${cd.enrichedAt ? ` · ${new Date(cd.enrichedAt).toLocaleDateString('es-AR')}` : ""}</div>` : ""}`;
  const m = $("#viewModal"); m.dataset.editKey = cdKeyForView(cd); m.classList.add("open");
  document.body.style.overflow = "hidden";
  const img = $("#viewBody img[data-lb-key]");
  if (img) img.addEventListener("click", () => Lightbox.open(cd.portada, `${cd.titulo} — ${cd.interprete}`, cdKeyForView(cd)));
  const streamSection = $("#viewBody .stream-section");
  if (streamSection) wireStreamingSectionEvents(streamSection, cd);
}
function cerrarVista(){ $("#viewModal").classList.remove("open"); document.body.style.overflow = ""; App.detailCD = null; }
function abrirModal(modo, cd = null){
  _cdSaving = false;
  const _sb = $("#btnSave"), _sn = $("#btnSaveAndNew");
  if (_sb) _sb.disabled = false;
  if (_sn) _sn.disabled = false;
  if (!Store.catKeys().length){ Toast.show("Creá una categoría primero", "warn"); abrirModalCategoria("crear"); return; }
  App.editing = modo === "editar" ? { cat: (App.cat === ALL_CATS ? findCategoryOfCD(cd) : App.cat), original: cd } : null;
  $("#modalIcon").textContent = modo === "editar" ? "✏️" : "➕";
  $("#modalTitle").textContent = modo === "editar" ? "Editar CD" : "Nuevo CD";
  $("#enrichBar").style.display = "none"; $("#enrichResult").textContent = ""; $("#enrichSources").style.display = "none";
  $("#fCoverUrl").value = ""; delete $("#fCoverUrl").dataset.enrichmentSource; delete $("#fCoverUrl").dataset.enrichmentConfidence; delete $("#fCoverUrl").dataset.enrichedAt;
  $("#fLinks").value = modo === "editar" && cd && cd.links ? JSON.stringify(cd.links) : "";
  $("#wrapCoverUrl").style.display = "none"; renderCoverPreview(null, null);
  const tg = $("#enrichToggle"); if (tg) tg.checked = Store.getPref("enrich", true);
  const rt = $("#replaceToggle"); if (rt) rt.checked = Store.getPref("replaceOnEnrich", true);
  const sel = $("#fCat"); sel.innerHTML = "";
  for (const k of Store.catKeys()){ const c = Store.get(k); const o = document.createElement("option"); o.value = k; o.textContent = c.icon + " " + c.label;
    const preselected = (modo === "editar" && App.editing?.cat === k) || (modo === "nuevo" && App.cat !== ALL_CATS && k === App.cat) || (modo === "nuevo" && App.cat === ALL_CATS && k === Store.catKeys()[0]);
    if (preselected) o.selected = true;
    sel.appendChild(o);
  }
  sel.disabled = false;
  const iS = new Set(), sS = new Set(), gS = new Set();
  for (const k of Store.catKeys()){ for (const c of Store.getCDs(k)){ if (c.interprete) iS.add(c.interprete); if (c.sello) sS.add(c.sello); if (c.genero) gS.add(c.genero); } }
  fillDatalist("#interpreteList", iS); fillDatalist("#selloList", sS); fillDatalist("#generoList", gS);
  populateSubcatOptions(sel.value, modo === "editar" && cd ? (cd.subcat || "") : "");
  switchModalTab("edicion"); clearValidation();
  const loanBanner = $("#loanActiveBanner");
  if (modo === "editar" && cd){
    setVal("#fNro", cd.nro); setVal("#fTitulo", upper(cd.titulo)); setVal("#fInterprete", upper(cd.interprete)); setVal("#fAnio", cd.anio ?? ""); setVal("#fAnioEdicion", cd.anioEdicion ?? ""); setVal("#fFormato", cd.formato || "CD");
    setVal("#fEstado", cd.estado || "Excelente"); setVal("#fSello", upper(cd.sello)); setVal("#fGenero", upper(cd.genero)); setVal("#fCatalogo", upper(cd.catalogo));
    setVal("#fCodigo", cd.codigo || ""); setVal("#fISRC", cd.isrc || ""); setVal("#fEdicion", upper(cd.edicion)); setVal("#fPais", upper(cd.pais));
    setVal("#fUbicacion", upper(cd.ubicacion)); setVal("#fCantidad", cd.cantidad || 1); setVal("#fAdquisicion", cd.adquisicion || "");
    setVal("#fValor", cd.valor ?? ""); setVal("#fNotas", cd.notas || ""); setVal("#fMoneda", cd.moneda || "ARS");
    setVal("#fEstadoDisco", cd.estadoDisco || ""); setVal("#fEstadoCaja", cd.estadoCaja || ""); setVal("#fEstadoFolleto", cd.estadoFolleto || ""); setVal("#fEstadoArte", cd.estadoArte || "");
    setVal("#fPrestadoA", upper(cd.prestadoA)); setVal("#fFechaPrestamo", cd.fechaPrestamo || ""); setVal("#fFechaDevolucion", cd.fechaDevolucion || ""); setVal("#fNotasPrestamo", upper(cd.notasPrestamo));
    if (cd.portada){ $("#fCoverUrl").value = cd.portada; renderCoverPreview(cd.portada, cd.portadaSource); }
    if (Loans.isLoaned(cd)){ loanBanner.style.display = "block"; loanBanner.innerHTML = `📚 <b>Prestado a:</b> ${esc(upper(cd.prestadoA))}${cd.fechaDevolucion ? ` · Devolución: ${esc(cd.fechaDevolucion)}` : ''}`; } else loanBanner.style.display = "none";
    CustomFields.renderInModal(cd.customFields || {});
  } else {
    const targetCat = sel.value || Store.catKeys()[0];
    const cds = Store.getCDs(targetCat) || [];
    const mx = cds.reduce((m, c) => Math.max(m, c.nro || 0), 0);
    setVal("#fNro", mx + 1); setVal("#fTitulo", ""); setVal("#fInterprete", App.artista ? upper(App.artista) : ""); setVal("#fAnio", ""); setVal("#fAnioEdicion", "");
    setVal("#fFormato", "CD"); setVal("#fEstado", "Excelente"); setVal("#fSello", ""); setVal("#fGenero", ""); setVal("#fCatalogo", "");
    setVal("#fCodigo", ""); setVal("#fISRC", ""); setVal("#fEdicion", ""); setVal("#fPais", "");
    setVal("#fUbicacion", ""); setVal("#fCantidad", 1); setVal("#fAdquisicion", new Date().toISOString().slice(0, 10));
    setVal("#fValor", ""); setVal("#fNotas", ""); setVal("#fMoneda", "ARS");
    setVal("#fEstadoDisco", ""); setVal("#fEstadoCaja", ""); setVal("#fEstadoFolleto", ""); setVal("#fEstadoArte", "");
    setVal("#fPrestadoA", ""); setVal("#fFechaPrestamo", ""); setVal("#fFechaDevolucion", ""); setVal("#fNotasPrestamo", "");
    loanBanner.style.display = "none";
    CustomFields.renderInModal({});
  }
  $("#modal").classList.add("open");
  setTimeout(() => $("#fTitulo").focus(), 80);
}
function cerrarModal(){
  if (_enrichTimer){ clearTimeout(_enrichTimer); _enrichTimer = null; }
  _enrichRequestId++;
  $("#modal").classList.remove("open");
  App.editing = null;
  _cdSaving = false;
  const sb = $("#btnSave"), sn = $("#btnSaveAndNew");
  if (sb) sb.disabled = false;
  if (sn) sn.disabled = false;
}
function validarForm(){
  clearValidation(); let ok = true, tt = null;
  const nro = parseInt(getVal("#fNro"), 10);
  const t = getVal("#fTitulo").trim(); const i = getVal("#fInterprete").trim();
  const a = getVal("#fAnio").trim(); const v = getVal("#fValor").trim(); const isr = getVal("#fISRC").trim().toUpperCase();
  if (!Number.isFinite(nro) || nro < 1){ $("#wrapNro").classList.add("invalid"); ok = false; }
  if (!t){ $("#wrapTitulo").classList.add("invalid"); ok = false; }
  if (!i){ $("#wrapInterprete").classList.add("invalid"); ok = false; }
  if (a !== ""){ const n = parseInt(a); if (isNaN(n) || n < 1900 || n > 2100){ $("#wrapAnio").classList.add("invalid"); ok = false; } }
  const aE = getVal("#fAnioEdicion").trim();
  if (aE !== ""){ const n = parseInt(aE); if (isNaN(n) || n < 1900 || n > 2100){ $("#wrapAnioEdicion").classList.add("invalid"); ok = false; tt = tt || "edicion"; } }
  if (v !== ""){ const n = Number(v); if (!Number.isFinite(n) || n < 0){ $("#wrapValor").classList.add("invalid"); ok = false; tt = "ubicacion"; } }
  if (isr !== "" && !ISRC_REGEX.test(isr)){ $("#wrapISRC").classList.add("invalid"); ok = false; tt = tt || "edicion"; }
  if (tt) switchModalTab(tt);
  return ok;
}
function guardarCD(e){
  if (e) e.preventDefault();
  if (_cdSaving) return false;
  if (!validarForm()){ Toast.show("Revisá los campos marcados", "err"); return false; }
  const cat = getVal("#fCat"); if (!Store.get(cat)){ Toast.show("Categoría inexistente", "err"); return false; }
  _cdSaving = true;
  const saveBtn = $("#btnSave"), saveNewBtn = $("#btnSaveAndNew");
  if (saveBtn){ saveBtn.disabled = true; }
  if (saveNewBtn){ saveNewBtn.disabled = true; }
  const unlockCD = () => {
    _cdSaving = false;
    if (saveBtn) saveBtn.disabled = false;
    if (saveNewBtn) saveNewBtn.disabled = false;
  };
  const nro = parseInt(getVal("#fNro"), 10);
  const aRaw = getVal("#fAnio").trim(); const vRaw = getVal("#fValor").trim(); const cov = $("#fCoverUrl").value.trim(); const isr = getVal("#fISRC").trim().toUpperCase();
  let valor = null; if (vRaw !== ""){ const n = Number(vRaw); if (Number.isFinite(n) && n >= 0) valor = n; }
  const data = {
    nro,
    titulo: upper(getVal("#fTitulo").trim()),
    interprete: upper(getVal("#fInterprete").trim()),
    anio: aRaw === "" ? null : parseInt(aRaw),
    anioEdicion: (() => { const e2 = getVal("#fAnioEdicion").trim(); if (e2 === "") return null; const n = parseInt(e2); return (Number.isFinite(n) && n >= 1900 && n <= 2100) ? n : null; })(),
    formato: getVal("#fFormato") || "CD", estado: getVal("#fEstado") || "Excelente",
    estadoDisco: getVal("#fEstadoDisco") || "", estadoCaja: getVal("#fEstadoCaja") || "",
    estadoFolleto: getVal("#fEstadoFolleto") || "", estadoArte: getVal("#fEstadoArte") || "",
    sello: upper(getVal("#fSello").trim()), genero: upper(getVal("#fGenero").trim()),
    catalogo: upper(getVal("#fCatalogo").trim()), codigo: upper(getVal("#fCodigo").trim()), isrc: isr,
    edicion: upper(getVal("#fEdicion").trim()), pais: upper(getVal("#fPais").trim()),
    ubicacion: upper(getVal("#fUbicacion").trim()), cantidad: Math.max(1, parseInt(getVal("#fCantidad")) || 1),
    adquisicion: getVal("#fAdquisicion") || "", valor, moneda: getVal("#fMoneda") || "ARS",
    notas: getVal("#fNotas").trim(), portada: cov || null,
    enrichmentSource: $("#fCoverUrl")?.dataset.enrichmentSource || null,
    enrichmentConfidence: $("#fCoverUrl")?.dataset.enrichmentConfidence ? Number($("#fCoverUrl").dataset.enrichmentConfidence) : null,
    enrichedAt: $("#fCoverUrl")?.dataset.enrichedAt || null,
    prestadoA: upper(getVal("#fPrestadoA").trim()), fechaPrestamo: getVal("#fFechaPrestamo") || "",
    fechaDevolucion: getVal("#fFechaDevolucion") || "", notasPrestamo: upper(getVal("#fNotasPrestamo").trim()),
    customFields: CustomFields.readFromModal(),
    subcat: getVal("#fSubcat") || null,
    links: (() => { try { const l = JSON.parse($("#fLinks").value || '{}'); return (l && typeof l === 'object' && !Array.isArray(l)) ? l : {}; } catch(e){ return {}; } })()
  };
  const wE = !!App.editing; const before = snapshotAll();
  if (wE){
    const oCat = App.editing.cat; const oList = Store.getCDs(oCat); const idx = oList.indexOf(App.editing.original);
    if (idx === -1){ Toast.show("No se encontró el original", "err"); cerrarModal(); unlockCD(); return false; }
    const oData = oList[idx];
    const cProv = { ...(oData.provenance || {}) };
    if (data.portada && data.enrichmentSource){ cProv.portada = makeProvenance(data.enrichmentSource, data.enrichmentConfidence); }
    const merged = { ...oData, ...data, provenance: cProv };
    if (oCat === cat){
      const dup = oList.findIndex((c, i2) => i2 !== idx && c.nro === nro);
      if (dup !== -1 && !confirm(`Ya existe Nº ${nro}. ¿Continuar?`)){ unlockCD(); return false; }
      oList[idx] = merged;
      HistoryLog.log('EDIT', `CD editado: ${data.titulo}`, data.interprete);
      Toast.show("CD actualizado", "ok");
    } else {
      const tList = Store.getCDs(cat); let fNro = nro;
      if (tList.some(c => c.nro === fNro)){ const mx = tList.reduce((m, c) => Math.max(m, c.nro || 0), 0); const sug = mx + 1; if (!confirm(`Nº ${fNro} ocupado. ¿Usar ${sug}?`)){ unlockCD(); return false; } fNro = sug; }
      merged.nro = fNro;
      const oKey = `${oCat}|${oData.id}`; const nKey = `${cat}|${merged.id}`;
      oList.splice(idx, 1); tList.push(merged);
      if (App.selected.has(oKey)){ App.selected.delete(oKey); App.selected.add(nKey); }
      if (App.focusedKey === oKey) App.focusedKey = nKey;
      if (App.cat !== ALL_CATS) App.cat = cat;
      App.artista = null;
      HistoryLog.log('EDIT', `CD movido: ${data.titulo}`, `${oCat} → ${cat}`);
      Toast.show(`Movido a "${Store.get(cat).label}" · Nº ${fNro}`, "ok", 3800);
    }
    Undo.push(oCat === cat ? "editar CD" : "mover CD", () => restoreAll(before));
  } else {
    const list = Store.getCDs(cat);
    if (list.some(c => c.nro === nro) && !confirm(`Ya existe Nº ${nro}. ¿Agregar?`)){ unlockCD(); return false; }
    const nuevo = Store.hydrate(data);
    if (data.portada && data.enrichmentSource){ nuevo.provenance = { portada: makeProvenance(data.enrichmentSource, data.enrichmentConfidence) }; }
    list.push(nuevo);
    Undo.push("agregar CD", () => restoreAll(before));
    HistoryLog.log('CREATE', `CD agregado: ${data.titulo}`, data.interprete);
    Toast.show("CD agregado a " + Store.get(cat).label, "ok");
  }
  Store.persist(); cerrarModal(); renderTabs(); renderAll();
  AutoBackup.markChange(wE ? "edición de CD" : "nuevo CD");
  return true;
}
function eliminarCD(cd){
  if (!confirm(`¿Eliminar?\n\nNº ${cd.nro}\n"${cd.titulo}"\n${cd.interprete}`)) return;
  const cat = (App.cat === ALL_CATS) ? findCategoryOfCD(cd) : App.cat;
  if (!cat){ Toast.show("No se pudo determinar la categoría", "err"); return; }
  const list = Store.getCDs(cat); const before = JSON.stringify(list);
  const idx = list.indexOf(cd); if (idx === -1) return;
  list.splice(idx, 1);
  Undo.push("eliminar CD", () => { const a = Store.getCDs(cat); a.length = 0; JSON.parse(before).forEach(x => a.push(x)); Store.persist(); renderTabs(); renderAll(); });
  Store.persist(); renderTabs(); renderAll();
  HistoryLog.log('DELETE', `CD eliminado: ${cd.titulo}`, cd.interprete);
  AutoBackup.markChange("eliminación CD");
  Toast.show("CD eliminado", "warn");
}

async function exportFullJSON(){
  const o = OwnerConfig.get();
  const pl = { version: 5, appVersion: APP_VERSION, exported: new Date().toISOString(), owner: o.name || DEFAULT_AUTHOR, contact: OwnerConfig.contactLine() || DEFAULT_PHONE, categories: {} };
  for (const k of Store.catKeys()){ const c = Store.get(k); pl.categories[k] = { label: c.label, icon: c.icon, subcategories: c.subcategories || [], cds: c.cds }; }
  await saveOrDownload(`discografia_v${APP_VERSION}_backup_${timestamp()}.json`, JSON.stringify(pl, null, 2));
  HistoryLog.log('EXPORT', `Backup JSON completo`, `${Store.total()} CDs`);
}
async function exportCatJSON(){
  if (!App.cat || App.cat === ALL_CATS){ Toast.show(App.cat === ALL_CATS ? "Elegí una categoría (no 'Todas')" : "Sin categoría activa", "warn"); return; }
  const c = Store.get(App.cat);
  await saveOrDownload(`discografia_${App.cat}_${timestamp()}.json`, JSON.stringify({ version: 5, appVersion: APP_VERSION, exported: new Date().toISOString(), category: App.cat, label: c.label, icon: c.icon, subcategories: c.subcategories || [], cds: c.cds }, null, 2));
}
async function exportCatCSV(){
  if (!App.cat){ Toast.show("Sin categoría activa", "warn"); return; }
  const sep = ";";
  const e = v => { const s = String(v ?? ""); return /[";\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
  const cfAll = CustomFields.getAll();
  const lkCols = STREAMING_SERVICES.map(s => s.key);
  const baseHeaders = ["ID","Nro","Título","Intérprete","Año","Año edición","Formato","Estado","EstadoDisco","EstadoCaja","EstadoFolleto","EstadoArte","Sello","Género","Nº catálogo","Código de barras","ISRC","Edición","País","Ubicación","Cantidad","Fecha ingreso","Valor","Moneda","Observaciones","Portada","Fuente enriquecimiento","Confianza","Fecha enriquecimiento","PrestadoA","FechaPrestamo","FechaDevolucion","NotasPrestamo","Subcategoría"];
  const headers = [...baseHeaders, ...lkCols, ...cfAll.map(f => f.name)];
  const rows = [headers.join(sep)];
  const source = getFiltered();
  const catObj = App.cat !== ALL_CATS ? Store.get(App.cat) : null;
  for (const cd of source){
    const cf = cd.customFields || {};
    const links = cd.links || {};
    const subLabel = cd.subcat && catObj ? (catObj.subcategories?.find(s => s.id === cd.subcat)?.label || "") : "";
    rows.push([cd.id ?? "", cd.nro, cd.titulo, cd.interprete, cd.anio ?? "", cd.anioEdicion ?? "", cd.formato ?? "CD", cd.estado ?? "Excelente", cd.estadoDisco ?? "", cd.estadoCaja ?? "", cd.estadoFolleto ?? "", cd.estadoArte ?? "", cd.sello ?? "", cd.genero ?? "", cd.catalogo ?? "", cd.codigo ?? "", cd.isrc ?? "", cd.edicion ?? "", cd.pais ?? "", cd.ubicacion ?? "", cd.cantidad ?? 1, cd.adquisicion ?? "", cd.valor ?? "", cd.moneda ?? "ARS", cd.notas ?? "", cd.portada ?? "", cd.enrichmentSource ?? "", cd.enrichmentConfidence ?? "", cd.enrichedAt ?? "", cd.prestadoA ?? "", cd.fechaPrestamo ?? "", cd.fechaDevolucion ?? "", cd.notasPrestamo ?? "", subLabel, ...lkCols.map(k => links[k] ?? ""), ...cfAll.map(f => cf[f.id] ?? "")].map(e).join(sep));
  }
  const nm = (App.cat === ALL_CATS) ? "todas_las_categorias" : App.cat;
  await saveOrDownload(`discografia_${nm}_${timestamp()}.csv`, "\uFEFF" + rows.join("\r\n"), "text/csv");
}
async function exportCatMarkdown(){
  if (!App.cat){ Toast.show("Sin categoría activa", "warn"); return; }
  const c = (App.cat === ALL_CATS) ? { label: "Todas las categorías", icon: "🗂️" } : Store.get(App.cat);
  const cds = getFiltered();
  const lines = [`# ${c.icon} ${c.label}`, ``, `Total: **${cds.length}**`, ``, `| Nº | Título | Intérprete | Año | Portada |`, `|---:|---|---|---:|---|`];
  for (const cd of cds){ const s = v => String(v ?? "").replace(/\|/g, "\\|"); lines.push(`| ${cd.nro} | ${s(cd.titulo)} | ${s(cd.interprete)} | ${cd.anio ?? "—"} | ${cd.portada ? "✅" : "—"} |`); }
  const nm = (App.cat === ALL_CATS) ? "todas" : App.cat;
  await saveOrDownload(`discografia_${nm}_${timestamp()}.md`, lines.join("\n"), "text/markdown");
}
async function exportCatPDF(){
  if (!App.cat){ Toast.show("Sin categoría activa", "warn"); return; }
  const c = (App.cat === ALL_CATS) ? { label: "Todas las categorías", icon: "🗂️" } : Store.get(App.cat);
  const cds = sortCDs(getFiltered());
  const o = OwnerConfig.get(); const now = new Date().toLocaleString('es-AR');
  const win = window.open('', '_blank');
  if (!win){ Toast.show('Permitir popups para PDF', 'warn', 5000); return; }
  const rows = cds.map(cd => `<tr><td>${cd.nro}</td><td>${cd.portada ? `<img src="${esc(cd.portada)}" style="width:50px;height:50px;object-fit:cover;border-radius:4px">` : ''}</td><td>${esc(cd.titulo)}</td><td>${esc(cd.interprete)}</td><td>${cd.anio ?? '—'}</td><td>${cd.anioEdicion ?? '—'}</td><td>${esc(cd.formato || 'CD')}</td><td>${esc(cd.sello || '—')}</td><td>${cd.valor != null ? `${cd.moneda || 'ARS'} ${Number(cd.valor).toLocaleString('es-AR')}` : '—'}</td></tr>`).join('');
  const tV = cds.reduce((s, cd) => { const cn = Math.max(1, parseInt(cd.cantidad) || 1); return s + (cd.valor != null ? Number(cd.valor) * cn : 0); }, 0);
  win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(c.icon)} ${esc(c.label)} — Discografía</title><style>*{box-sizing:border-box}body{font-family:'Segoe UI',Roboto,sans-serif;padding:24px;color:#1a2332}h1{margin:0 0 4px;font-size:1.6rem}h2{margin:0 0 20px;font-size:1.1rem;color:#666;font-weight:500}.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1976d2;padding-bottom:14px;margin-bottom:18px}.header .meta{text-align:right;font-size:.82rem;color:#666;line-height:1.6}.summary{display:flex;gap:20px;margin-bottom:18px;font-size:.85rem}.summary div{padding:8px 14px;background:#f5f7fa;border-radius:8px}.summary b{color:#1976d2}table{width:100%;border-collapse:collapse;font-size:.82rem}th{background:#f0f3f7;padding:9px 8px;text-align:left;border-bottom:1px solid #d5dde7;font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;color:#4a5568}td{padding:8px;border-bottom:1px solid #eee;vertical-align:middle}tr:nth-child(even) td{background:#fafbfc}.footer{margin-top:24px;padding-top:14px;border-top:1px solid #ddd;font-size:.75rem;color:#888;text-align:center}@media print{body{padding:0}thead{display:table-header-group}tr{page-break-inside:avoid}}</style></head><body><div class="header"><div><h1>${esc(c.icon)} ${esc(c.label)}</h1><h2>Discografía v${APP_VERSION} — ${esc(o.name || DEFAULT_AUTHOR)}</h2></div><div class="meta">${esc(OwnerConfig.contactLine() || DEFAULT_PHONE)}<br>Generado: ${esc(now)}</div></div><div class="summary"><div>Total: <b>${cds.length}</b> CDs</div>${tV > 0 ? `<div>Valor total: <b>$${tV.toLocaleString('es-AR', {maximumFractionDigits: 0})}</b></div>` : ''}</div><table><thead><tr><th style="width:50px">Nº</th><th style="width:60px">Portada</th><th>Título</th><th>Intérprete</th><th style="width:60px">Año</th><th style="width:60px">Año ed.</th><th style="width:70px">Formato</th><th>Sello</th><th style="width:90px">Valor</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">Discografía v${APP_VERSION} — ${esc(o.name || DEFAULT_AUTHOR)} — ${esc(COPYRIGHT_TEXT)}</div><script>setTimeout(()=>window.print(),400)<\/script></body></html>`);
  win.document.close();
  HistoryLog.log('EXPORT', `PDF: ${c.label}`, `${cds.length} CDs`);
}
function detectDelimiter(t){ const f = String(t).split(/\r?\n/)[0] || ""; return (f.match(/;/g) || []).length >= (f.match(/,/g) || []).length ? ";" : ","; }
function parseCSV(text, delim){
  const d = delim || detectDelimiter(text);
  const rows = []; let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i], n = text[i+1];
    if (inQ){ if (c === '"' && n === '"'){ cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
    else { if (c === '"') inQ = true; else if (c === d){ row.push(cur); cur = ""; } else if (c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ""; } else if (c === '\r'){} else cur += c; }
  }
  if (cur !== "" || row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}
function importCSV(file, text){
  if (!App.cat || App.cat === ALL_CATS){ Toast.show("Elegí una categoría primero (no 'Todas')", "warn"); return; }
  const rows = parseCSV(text);
  if (rows.length < 2){ Toast.show("CSV vacío o inválido", "err"); return; }
  const nh = h => String(h || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  const header = rows[0].map(nh);
  const find = (...a) => header.findIndex(h => a.some(x => h === x || h.includes(x)));
  const linkIdx = {};
  for (const svc of STREAMING_SERVICES){ linkIdx[svc.key] = find(svc.key, svc.name.toLowerCase()); }
  const subcatIdx = find("subcategoria", "subcategory");
  const idx = { id: find("id","uuid"), nro: find("nro","numero"), titulo: find("titulo","title","album"), interprete: find("interprete","artista","artist"), anio: find("ano","year"), anioEdicion: find("ano edicion","year edition","edition year"), formato: find("formato","format"), estado: find("estado","condition"), estadoDisco: find("estadodisco"), estadoCaja: find("estadocaja"), estadoFolleto: find("estadofolleto"), estadoArte: find("estadoarte"), sello: find("sello","label"), genero: find("genero","genre"), catalogo: find("catalogo","catno"), codigo: find("codigo","barcode"), isrc: find("isrc"), edicion: find("edicion"), pais: find("pais"), ubicacion: find("ubicacion"), cantidad: find("cantidad"), adquisicion: find("adquisicion"), valor: find("valor","value"), moneda: find("moneda","currency"), notas: find("notas"), portada: find("portada","cover"), prestadoA: find("prestadoa"), fechaPrestamo: find("fechaprestamo"), fechaDevolucion: find("fechadevolucion"), notasPrestamo: find("notasprestamo") };
  const catObj = Store.get(App.cat);
  function resolveSubId(label){
    if (!label || !catObj) return null;
    const clean = String(label).trim().toLowerCase();
    const sub = (catObj.subcategories || []).find(s => s.label.toLowerCase() === clean);
    return sub ? sub.id : null;
  }
  const nuevos = rows.slice(1).map(r => {
    const g = i => i >= 0 ? (r[i] || "").trim() : "";
    const aRaw = g(idx.anio); const eRaw = g(idx.anioEdicion); const vRaw = g(idx.valor); const rNro = parseInt(g(idx.nro), 10);
    let valor = null; if (vRaw !== ""){ const v = Number(vRaw); if (Number.isFinite(v) && v >= 0) valor = v; }
    const links = {};
    for (const svc of STREAMING_SERVICES){ const v = g(linkIdx[svc.key]); if (v) links[svc.key] = v; }
    const subcatId = resolveSubId(g(subcatIdx));
    return Store.hydrate({ id: g(idx.id) || undefined, links, subcat: subcatId, nro: Number.isFinite(rNro) && rNro >= 1 ? rNro : 0, titulo: upper(g(idx.titulo)), interprete: upper(g(idx.interprete)), anio: aRaw === "" ? null : parseInt(aRaw), anioEdicion: eRaw === "" ? null : parseInt(eRaw), formato: g(idx.formato) || "CD", estado: g(idx.estado) || "Excelente", estadoDisco: g(idx.estadoDisco), estadoCaja: g(idx.estadoCaja), estadoFolleto: g(idx.estadoFolleto), estadoArte: g(idx.estadoArte), sello: upper(g(idx.sello)), genero: upper(g(idx.genero)), catalogo: upper(g(idx.catalogo)), codigo: upper(g(idx.codigo)), isrc: g(idx.isrc), edicion: upper(g(idx.edicion)), pais: upper(g(idx.pais)), ubicacion: upper(g(idx.ubicacion)), cantidad: parseInt(g(idx.cantidad)) || 1, adquisicion: g(idx.adquisicion), valor, moneda: g(idx.moneda) || "ARS", notas: g(idx.notas), portada: g(idx.portada) || null, prestadoA: upper(g(idx.prestadoA)), fechaPrestamo: g(idx.fechaPrestamo), fechaDevolucion: g(idx.fechaDevolucion), notasPrestamo: upper(g(idx.notasPrestamo)) });
  }).filter(c => c.titulo || c.interprete);
  if (!nuevos.length){ Toast.show("No se encontraron CDs", "err"); return; }
  const modo = confirm(`CSV con ${nuevos.length} CDs.\n\n• Aceptar: REEMPLAZAR.\n• Cancelar: AGREGAR.`);
  const list = Store.getCDs(App.cat); const before = JSON.stringify(list);
  if (modo){ list.length = 0; nuevos.forEach(c => list.push(c)); }
  else { let mx = list.reduce((m, c) => Math.max(m, c.nro || 0), 0); for (const cd of nuevos){ if (!cd.nro || cd.nro <= mx) cd.nro = ++mx; else mx = cd.nro; list.push(cd); } }
  Undo.push("importar CSV", () => { const a = Store.getCDs(App.cat); a.length = 0; JSON.parse(before).forEach(x => a.push(x)); Store.persist(); renderTabs(); renderAll(); });
  Store.persist(); renderTabs(); renderAll();
  HistoryLog.log('IMPORT', `CSV importado`, `${nuevos.length} CDs`);
  AutoBackup.markChange("importación CSV");
  Toast.show(`Importados ${nuevos.length} CDs`, "ok");
}
function importFile(file){
  if (!file){ Toast.show("No se recibió archivo", "err"); return; }
  const ext = (file.name || "").toLowerCase().split(".").pop();
  if (ext !== "json" && ext !== "csv"){ if (!confirm(`"${file.name}" no es .json ni .csv. ¿Intentar como JSON?`)) return; }
  const reader = new FileReader();
  reader.onerror = () => Toast.show("No se pudo leer", "err", 9000);
  reader.onload = (e) => {
    const text = String(e.target.result || "");
    if (!text.trim()){ Toast.show("Archivo vacío", "err"); return; }
    if (ext === "csv"){ try { importCSV(file, text); } catch(err){ Toast.show("Error CSV: " + err.message, "err", 6000); } return; }
    const clean = text.replace(/^\uFEFF/, "");
    try { const data = JSON.parse(clean); procesarImportJSON(data); }
    catch(err){ Toast.show("JSON inválido: " + err.message, "err", 9000); }
  };
  try { reader.readAsText(file, "utf-8"); } catch(err){ Toast.show("Error: " + err.message, "err", 6000); }
}
function procesarImportJSON(data){
  if (data && data.categories && typeof data.categories === "object"){
    const cn = Object.keys(data.categories);
    const tc = Object.values(data.categories).reduce((s, c) => s + (c.cds?.length || 0), 0);
    if (!confirm(`Backup COMPLETO.\n\nCategorías: ${cn.length}\nCDs: ${tc}\n\n¿REEMPLAZAR toda la base?`)) return;
    const before = JSON.stringify(Store.categories());
    Store.replaceAll(data); NotFoundList.clear();
    Undo.push("importar backup", () => { Store.replaceAll({ categories: JSON.parse(before) }); ensureValidCat(); renderTabs(); renderAll(); });
    App.artista = null; App.q = ""; App.selected.clear(); App.focusedKey = null; App.subcat = null;
    $("#q").value = ""; $("#searchBox").classList.remove("has-value");
    ensureValidCat(); renderTabs(); renderAll();
    HistoryLog.log('IMPORT', 'Backup importado', `${tc} CDs en ${cn.length} categorías`);
    AutoBackup.markChange("importación backup");
    Toast.show(`Backup importado: ${tc} CDs`, "ok", 4000);
    return;
  }
  if (data && Array.isArray(data.cds)){
    let cat = data.category;
    if (!cat || !Store.get(cat)){ if (!confirm(`¿Crear categoría "${data.label || data.category || 'nueva'}"?`)) return; cat = Store.addCategory({ label: data.label || data.category || "Importada", icon: data.icon || "📀" }); App.cat = cat; }
    const modo = confirm(`Categoría: ${Store.get(cat).label}\nCDs: ${data.cds.length}\n\n• Aceptar: REEMPLAZAR.\n• Cancelar: AGREGAR.`);
    const list = Store.getCDs(cat); const before = JSON.stringify(list); const nuevos = data.cds.map(Store.hydrate);
    if (modo){ list.length = 0; nuevos.forEach(c => list.push(c)); }
    else { let mx = list.reduce((m, c) => Math.max(m, c.nro || 0), 0); for (const cd of nuevos){ if (!cd.nro || cd.nro <= mx) cd.nro = ++mx; else mx = cd.nro; list.push(cd); } }
    Undo.push("importar categoría", () => { const a = Store.getCDs(cat); a.length = 0; JSON.parse(before).forEach(x => a.push(x)); Store.persist(); renderTabs(); renderAll(); });
    Store.persist(); App.cat = cat; App.artista = null;
    ensureValidCat(); renderTabs(); renderAll();
    HistoryLog.log('IMPORT', `Categoría importada`, `${nuevos.length} CDs`);
    AutoBackup.markChange("importación categoría");
    Toast.show("Categoría importada", "ok");
    return;
  }
  if (Array.isArray(data)){
    if (!App.cat || App.cat === ALL_CATS){ Toast.show("Elegí una categoría primero", "warn"); return; }
    const modo = confirm(`Array de ${data.length} CDs.\n\n• Aceptar: REEMPLAZAR.\n• Cancelar: AGREGAR.`);
    const list = Store.getCDs(App.cat); const before = JSON.stringify(list); const nuevos = data.map(Store.hydrate);
    if (modo){ list.length = 0; nuevos.forEach(c => list.push(c)); }
    else { let mx = list.reduce((m, c) => Math.max(m, c.nro || 0), 0); for (const cd of nuevos){ if (!cd.nro || cd.nro <= mx) cd.nro = ++mx; else mx = cd.nro; list.push(cd); } }
    Undo.push("importar array", () => { const a = Store.getCDs(App.cat); a.length = 0; JSON.parse(before).forEach(x => a.push(x)); Store.persist(); renderTabs(); renderAll(); });
    Store.persist(); renderTabs(); renderAll();
    HistoryLog.log('IMPORT', `Array importado`, `${nuevos.length} CDs`);
    AutoBackup.markChange("importación array");
    Toast.show("Importación completada", "ok");
    return;
  }
  Toast.show("Formato no reconocido", "err", 6000);
}
function importarDesdeTexto(t){
  const clean = String(t || "").trim().replace(/^\uFEFF/, "");
  if (!clean){ Toast.show("Pegá el contenido primero", "warn"); return false; }
  try { const data = JSON.parse(clean); procesarImportJSON(data); return true; }
  catch(err){ Toast.show("JSON inválido: " + err.message, "err", 7000); return false; }
}
function snapshotAll(){ const s = {}; for (const k of Store.catKeys()) s[k] = JSON.stringify(Store.get(k).cds); return s; }
function restoreAll(snap){ for (const k in snap){ const a = Store.getCDs(k); a.length = 0; JSON.parse(snap[k]).forEach(x => a.push(x)); } Store.persist(); renderTabs(); renderAll(); }
function bulkDelete(){
  const keys = [...App.selected]; if (!keys.length) return;
  if (!confirm(`¿Eliminar ${keys.length} CDs?`)) return;
  const snap = snapshotAll(); let rem = 0;
  for (const k of keys){ const { cat, id } = parseCDKey(k); const l = Store.getCDs(cat); const i = l.findIndex(c => c.id === id); if (i !== -1){ l.splice(i, 1); rem++; } }
  App.selected.clear();
  Undo.push("eliminar seleccionados", () => restoreAll(snap));
  Store.persist(); renderTabs(); renderAll();
  HistoryLog.log('DELETE', `Eliminación masiva`, `${rem} CDs`);
  AutoBackup.markChange("eliminación masiva");
  Toast.show(`Eliminados ${rem} CDs`, "warn");
}
function bulkSetEstado(){
  const keys = [...App.selected]; if (!keys.length) return;
  const e = prompt("Nuevo estado:", "Excelente"); if (!e) return;
  const snap = snapshotAll();
  for (const k of keys){ const { cat, id } = parseCDKey(k); const cd = Store.getCDs(cat).find(c => c.id === id); if (cd) cd.estado = e; }
  Undo.push("estado masivo", () => restoreAll(snap));
  Store.persist(); renderAll();
  HistoryLog.log('EDIT', `Estado masivo`, `${keys.length} CDs → ${e}`);
  AutoBackup.markChange("actualización masiva estado");
  Toast.show(`Actualizado en ${keys.length} CDs`, "ok");
}
function bulkSetUbicacion(){
  const keys = [...App.selected]; if (!keys.length) return;
  const u = prompt("Nueva ubicación:"); if (u === null) return;
  const snap = snapshotAll();
  for (const k of keys){ const { cat, id } = parseCDKey(k); const cd = Store.getCDs(cat).find(c => c.id === id); if (cd) cd.ubicacion = upper(u); }
  Undo.push("ubicación masiva", () => restoreAll(snap));
  Store.persist(); renderAll();
  HistoryLog.log('EDIT', `Ubicación masiva`, `${keys.length} CDs → ${upper(u)}`);
  AutoBackup.markChange("actualización masiva ubicación");
  Toast.show(`Actualizado en ${keys.length} CDs`, "ok");
}
let _bulkMoveTarget = null;
function bulkMoveCategoria(){
  const keys = [...App.selected]; if (!keys.length){ Toast.show("Seleccioná al menos uno", "warn"); return; }
  const ck = Store.catKeys();
  if (ck.length < 2){ Toast.show("Necesitás al menos 2 categorías", "warn"); return; }
  _bulkMoveTarget = null;
  $("#bulkMoveCount").textContent = keys.length; $("#bulkMoveKeepNro").checked = false; $("#bulkMovePreview").style.display = "none"; $("#bulkMoveConfirm").disabled = true;
  const list = $("#bulkMoveCatList"); list.innerHTML = "";
  const current = new Set(keys.map(k => parseCDKey(k).cat));
  for (const k of ck){
    const cat = Store.get(k); const isCur = current.size === 1 && current.has(k);
    const it = document.createElement("button"); it.type = "button"; it.className = "bulk-move-item"; it.disabled = isCur;
    it.style.cssText = `display:flex;align-items:center;gap:12px;width:100%;padding:11px 14px;background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:10px;color:var(--txt);cursor:pointer;font-family:inherit;font-size:.85rem;text-align:left;transition:.15s${isCur ? ";opacity:.4;cursor:not-allowed" : ""}`;
    it.innerHTML = `<span style="font-size:1.3rem">${esc(cat.icon)}</span><span style="flex:1;min-width:0"><span style="display:block;font-weight:600">${esc(cat.label)}</span><span style="display:block;font-size:.7rem;color:var(--muted);margin-top:2px">${cat.cds.length} CD${cat.cds.length === 1 ? "" : "s"}${isCur ? " · (actual)" : ""}</span></span><span class="bulk-move-check" style="width:18px;height:18px;border-radius:50%;border:2px solid var(--line);flex:0 0 auto;transition:.15s"></span>`;
    if (!isCur){
      it.addEventListener("mouseenter", () => { if (_bulkMoveTarget !== k){ it.style.borderColor = "rgba(79,195,247,.5)"; it.style.background = "rgba(79,195,247,.05)"; } });
      it.addEventListener("mouseleave", () => { if (_bulkMoveTarget !== k){ it.style.borderColor = "var(--line)"; it.style.background = "rgba(255,255,255,.02)"; } });
      it.addEventListener("click", () => selectBulkMoveTarget(k));
    }
    list.appendChild(it);
  }
  $("#bulkMoveModal").classList.add("open");
}
function selectBulkMoveTarget(k){
  _bulkMoveTarget = k;
  const list = $("#bulkMoveCatList");
  const items = [...list.querySelectorAll(".bulk-move-item")];
  const ck = Store.catKeys();
  items.forEach((el, i) => {
    const kk = ck[i]; const sel = kk === k; if (el.disabled) return;
    el.style.borderColor = sel ? "var(--accent)" : "var(--line)";
    el.style.background = sel ? "rgba(79,195,247,.12)" : "rgba(255,255,255,.02)";
    el.style.color = sel ? "var(--accent)" : "var(--txt)";
    const c = el.querySelector(".bulk-move-check");
    if (c){ c.style.borderColor = sel ? "var(--accent)" : "var(--line)"; c.style.background = sel ? "var(--accent)" : "transparent"; c.style.boxShadow = sel ? "inset 0 0 0 3px var(--bg2)" : "none"; }
  });
  $("#bulkMoveConfirm").disabled = false;
  renderBulkMovePreview();
}
function renderBulkMovePreview(){
  const prev = $("#bulkMovePreview"); if (!_bulkMoveTarget){ prev.style.display = "none"; return; }
  const keys = [...App.selected]; const tc = Store.get(_bulkMoveTarget);
  const keepN = $("#bulkMoveKeepNro").checked;
  const tl = Store.getCDs(_bulkMoveTarget);
  const used = new Set(tl.map(c => c.nro));
  let mx = tl.reduce((m, c) => Math.max(m, c.nro || 0), 0);
  const asg = [];
  for (const k of keys){
    const { cat, id } = parseCDKey(k); if (cat === _bulkMoveTarget) continue;
    const cd = Store.getCDs(cat).find(c => c.id === id); if (!cd) continue;
    let nn; if (keepN){ nn = cd.nro; if (used.has(nn)) nn = ++mx; else mx = Math.max(mx, nn); } else nn = ++mx;
    used.add(nn); asg.push({ titulo: cd.titulo, oldNro: cd.nro, newNro: nn });
  }
  if (!asg.length){ prev.style.display = "none"; return; }
  const shown = asg.slice(0, 6); const more = asg.length - shown.length;
  prev.style.display = "block";
  prev.innerHTML = `<div style="font-weight:600;color:var(--txt);margin-bottom:8px">Se moverán <b style="color:var(--accent)">${asg.length}</b> CDs a <b style="color:var(--accent)">${esc(tc.icon)} ${esc(tc.label)}</b></div><div style="display:flex;flex-direction:column;gap:4px;font-size:.78rem">${shown.map(a => `<div style="display:flex;gap:8px;align-items:center"><span style="color:var(--muted);font-variant-numeric:tabular-nums">#${a.oldNro}</span><span style="color:var(--line)">→</span><span style="color:var(--accent);font-variant-numeric:tabular-nums;font-weight:700">#${a.newNro}</span><span style="overflow:hidden;text-overflow:ellipsis">${esc(a.titulo)}</span></div>`).join('')}${more > 0 ? `<div style="color:var(--muted);font-style:italic;padding-top:4px">…y ${more} más</div>` : ''}</div>`;
}
function closeBulkMoveModal(){ $("#bulkMoveModal").classList.remove("open"); _bulkMoveTarget = null; }
function confirmBulkMove(){
  if (!_bulkMoveTarget){ Toast.show("Elegí categoría destino", "warn"); return; }
  const keys = [...App.selected]; const tc = _bulkMoveTarget; const keepN = $("#bulkMoveKeepNro").checked;
  const tl = Store.getCDs(tc); const snap = snapshotAll();
  const used = new Set(tl.map(c => c.nro)); let mx = tl.reduce((m, c) => Math.max(m, c.nro || 0), 0); let moved = 0;
  for (const k of keys){
    const { cat, id } = parseCDKey(k); if (cat === tc) continue;
    const l = Store.getCDs(cat); const i = l.findIndex(c => c.id === id); if (i === -1) continue;
    const cd = l[i]; l.splice(i, 1);
    let nn; if (keepN){ nn = cd.nro; if (used.has(nn)) nn = ++mx; else mx = Math.max(mx, nn); } else nn = ++mx;
    used.add(nn); cd.nro = nn; tl.push(cd); moved++;
  }
  App.selected.clear();
  Undo.push("mover CDs", () => restoreAll(snap));
  Store.persist(); renderTabs(); renderAll();
  HistoryLog.log('EDIT', `Movimiento masivo`, `${moved} CDs → ${Store.get(tc).label}`);
  AutoBackup.markChange("movimiento masivo");
  closeBulkMoveModal();
  if (moved === 0) Toast.show("Ningún CD fue movido", "warn");
  else Toast.show(`Movidos ${moved} CDs a "${Store.get(tc).label}"`, "ok", 3800);
}
let _bulkCoversRunning = false;
async function bulkFetchCovers(){
  if (_bulkCoversRunning){ Toast.show("Ya hay una búsqueda en curso", "warn"); return; }
  const keys = [...App.selected]; if (!keys.length) return;
  if (!confirm(`¿Buscar portadas para ${keys.length} CDs?`)) return;
  _bulkCoversRunning = true; const snap = snapshotAll();
  const bar = $("#selectionBar"); const orig = bar.innerHTML;
  let found = 0, nf = 0, al = 0, idx = 0; const total = keys.length;
  bar.innerHTML = `<span style="flex:1;display:flex;align-items:center;gap:10px"><span class="disc-loader"></span><b>🖼️ Buscando…</b> <span id="bulkCoverProgress">0/${total}</span></span><div style="width:200px;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden"><div id="bulkCoverBar" style="height:100%;width:0%;background:linear-gradient(90deg,var(--accent),var(--purple));transition:width .2s"></div></div><button type="button" class="btn danger" id="bulkCoverCancel">⏹️ Detener</button>`;
  let cancelled = false;
  const cb = $("#bulkCoverCancel"); if (cb) cb.addEventListener("click", () => { cancelled = true; cb.disabled = true; cb.textContent = "Deteniendo…"; });
  try {
    for (const k of keys){
      if (cancelled) break; if (!$("#bulkCoverProgress")) break;
      idx++;
      const { cat, id } = parseCDKey(k); const cd = Store.getCDs(cat).find(c => c.id === id);
      const pe = $("#bulkCoverProgress"); if (pe) pe.textContent = `${idx}/${total}`;
      const be = $("#bulkCoverBar"); if (be) be.style.width = `${idx/total*100}%`;
      if (!cd) continue;
      if (cd.portada){ al++; continue; }
      const rk = cdKey(cat, cd); const row = findRowByKey(rk);
      if (row && (App.cat === ALL_CATS || cat === App.cat)) row.classList.add("enriching");
      try {
        const info = await enrichFromChain(cd.titulo, cd.interprete, { hints: { anio: cd.anio, pais: cd.pais, sello: cd.sello, catalogo: cd.catalogo, barcode: cd.codigo } });
        if (info && info.portada){ cd.portada = info.portada; cd.portadaSource = info.portadaSource; cd.provenance = cd.provenance || {}; cd.provenance.portada = makeProvenance(info.source, info.confidence); found++; }
        else nf++;
      } catch(e){ nf++; }
      if (row && (App.cat === ALL_CATS || cat === App.cat)) row.classList.remove("enriching");
      await new Promise(r => setTimeout(r, 800));
    }
  } finally {
    Store.persist();
    Undo.push("buscar portadas", () => restoreAll(snap));
    bar.innerHTML = orig; attachSelectionBarEvents();
    renderTabs(); renderAll();
    HistoryLog.log('ENRICH', `Portadas masivas`, `${found} encontradas`);
    AutoBackup.markChange(`búsqueda masiva portadas (${found})`);
    if (cancelled) Toast.show(`Cancelado. ${found} encontradas · ${al} ya tenían · ${nf} sin resultados`, "warn", 6000);
    else Toast.show(`Portadas: ${found} · ${al} ya tenían · ${nf} sin resultados`, "ok", 6000);
    _bulkCoversRunning = false;
  }
}
function abrirPasteModal(){ $("#pasteArea").value = ""; $("#pasteModal").classList.add("open"); }
function cerrarPasteModal(){ $("#pasteModal").classList.remove("open"); }
async function abrirSelectorModerno(){
  if (!window.showOpenFilePicker){ Toast.show("Navegador sin soporte", "warn", 6000); return; }
  try {
    const opts = { multiple: false, types: [{ description: "Backup JSON o CSV", accept: { "application/json": [".json"], "text/csv": [".csv"] } }] };
    if (FileSystemDefault.isSet() && FileSystemDefault.isSupported()){ try { opts.startIn = FileSystemDefault.getHandle(); } catch(e){} }
    const [h] = await window.showOpenFilePicker(opts);
    const f = await h.getFile(); importFile(f);
  } catch(err){ if (err.name === "AbortError") return; Toast.show("Error: " + err.message, "err", 6000); }
}
async function importFromDefaultFolder(){
  if (!FileSystemDefault.isSet()){ Toast.show("Configurá una carpeta primero", "warn"); openFolderConfig(); return; }
  if (FileSystemDefault.getMode() === 'tauri'){
    await openFolderBrowser();
    Toast.show("Elegí el archivo de la lista y tocá 'Restaurar'", "info", 4500);
    return;
  }
  if (!FileSystemDefault.isSupported() || !window.showOpenFilePicker){ Toast.show("Navegador sin soporte", "warn", 5000); abrirSelectorModerno(); return; }
  try {
    const [h] = await window.showOpenFilePicker({ multiple: false, startIn: FileSystemDefault.getHandle(), types: [{ description: "Backup JSON o CSV", accept: { "application/json": [".json"], "text/csv": [".csv"] } }] });
    const f = await h.getFile(); importFile(f);
  } catch(err){ if (err.name === "AbortError") return; Toast.show("Error: " + err.message, "err", 6000); }
}
function switchManualSection(s){ $$("#manualNav button").forEach(b => b.classList.toggle("active", b.dataset.sec === s)); $$(".manual-section").forEach(x => x.classList.toggle("active", x.dataset.sec === s)); const c = $("#manualContent"); if (c) c.scrollTop = 0; }
function openOwnerConfig(){ const m = $("#ownerConfigModal"); if (!m) return; const o = OwnerConfig.get(); $("#ownerNameInput").value = o.name || ""; $("#ownerContactInput").value = o.contact || ""; $("#ownerEmailInput").value = o.email || ""; m.classList.add("open"); }
function closeOwnerConfig(){ $("#ownerConfigModal")?.classList.remove("open"); }

function openExitModal(){
  const st = $("#stTotal")?.textContent || "0";
  $("#exitTotal").textContent = st;
  const lastSaved = $("#fModified")?.textContent?.replace("· ", "") || "Sin datos";
  $("#exitLastSaved").textContent = lastSaved;
  $("#exitExportCheck").checked = false;
  $("#exitConfirm").disabled = true;
  $("#exitModal").classList.add("open");
}
function closeExitModal(){ $("#exitModal").classList.remove("open"); }

function attachSelectionBarEvents(){
  $("#btnSelCancel")?.addEventListener("click", () => {
    App.selected.clear();
    $$("#tbodyCD tr").forEach(tr => { tr.classList.remove("selected"); const cb = tr.querySelector("td.check input"); if (cb) cb.checked = false; });
    $("#checkAll").checked = false; $("#checkAll").indeterminate = false; updateSelectionBar();
    if (GridView.isEnabled()) GridView.render();
  });
  $("#btnSelEliminar")?.addEventListener("click", bulkDelete);
  $("#btnSelEstado")?.addEventListener("click", bulkSetEstado);
  $("#btnSelUbicacion")?.addEventListener("click", bulkSetUbicacion);
  $("#btnSelMover")?.addEventListener("click", bulkMoveCategoria);
  $("#btnSelCover")?.addEventListener("click", bulkFetchCovers);
}

function bindEvents(){
  const q = $("#q"); const onS = debounce(() => { App.q = q.value; renderAll(); }, 140);
  q.addEventListener("input", () => {
    $("#searchBox").classList.toggle("has-value", q.value.length > 0);
    const badge = $("#advModeBadge");
    if (badge) badge.style.display = AdvancedSearch.isAdvanced(q.value) ? "" : "none";
    onS();
  });
  $("#clearQ").addEventListener("click", () => { q.value = ""; App.q = ""; $("#searchBox").classList.remove("has-value"); const b = $("#advModeBadge"); if (b) b.style.display = "none"; renderAll(); q.focus(); });
  $$("#tablaCD thead th[data-key]").forEach(th => { th.addEventListener("click", () => { const k = th.dataset.key; if (App.sortKey === k) App.sortDir *= -1; else { App.sortKey = k; App.sortDir = 1; } renderTabla(); }); });
  $("#btnNuevo").addEventListener("click", () => abrirModal("nuevo"));
  $("#btnNuevaCat").addEventListener("click", () => abrirModalCategoria("crear"));
  $("#btnNuevaCatEmpty")?.addEventListener("click", () => abrirModalCategoria("crear"));
  $("#btnVista").addEventListener("click", () => setView(App.view === "dashboard" ? "table" : "dashboard"));
  $("#btnUndo")?.addEventListener("click", () => Undo.pop());
  $("#btnGrid")?.addEventListener("click", () => GridView.setEnabled(!GridView.isEnabled()));
  $("#fabVerTodos")?.addEventListener("click", () => { App.artista = null; renderAll(); const t = $("#tableView"); if (t) t.scrollIntoView({behavior:"smooth",block:"start"}); Toast.show("Mostrando todos", "ok", 2000); });
  $("#artFilterClear")?.addEventListener("click", () => { App.artista = null; renderAll(); const t = $("#tableView"); if (t) t.scrollIntoView({behavior:"smooth",block:"start"}); Toast.show("Mostrando todos", "ok", 2000); });

  function updateArtSortBtn(){
    const btn = $("#btnArtSort"); if (!btn) return;
    const mode = Store.getPref('artSort', 'count');
    if (mode === 'alpha'){ btn.textContent = '🔤 A-Z'; btn.title = 'Clic para ordenar Z-A'; }
    else if (mode === 'alpha-desc'){ btn.textContent = '🔤 Z-A'; btn.title = 'Clic para ordenar por cantidad'; }
    else { btn.textContent = '🔢 Cantidad'; btn.title = 'Clic para ordenar A-Z'; }
  }
  updateArtSortBtn();
  $("#btnArtSort")?.addEventListener("click", () => {
    const cur = Store.getPref('artSort', 'count');
    const next = cur === 'count' ? 'alpha' : (cur === 'alpha' ? 'alpha-desc' : 'count');
    Store.setPref('artSort', next);
    updateArtSortBtn();
    renderArtistas();
    const msg = next === 'alpha' ? '🔤 Orden A → Z' : next === 'alpha-desc' ? '🔤 Orden Z → A' : '🔢 Orden por cantidad';
    Toast.show(msg, 'info', 1600);
  });

  let rt = null; window.addEventListener("resize", () => { if (rt) clearTimeout(rt); rt = setTimeout(() => renderAll(), 200); });
  $("#btnFiltros").addEventListener("click", () => { const p = $("#filtersPanel"); p.classList.toggle("open"); $("#btnFiltros").classList.toggle("active", p.classList.contains("open")); });
  const fI = { estado:"#fFiltroEstado", formato:"#fFiltroFormato", anioDesde:"#fFiltroAnioDesde", anioHasta:"#fFiltroAnioHasta", ubicacion:"#fFiltroUbicacion", portada:"#fFiltroPortada", prestamo:"#fFiltroPrestamo" };
  for (const k in fI){ $(fI[k]).addEventListener("input", debounce(() => { App.filters[k] = $(fI[k]).value; renderAll(); }, 200)); }
  $("#btnLimpiarFiltros").addEventListener("click", () => { for (const k in fI){ $(fI[k]).value = ""; App.filters[k] = ""; } renderAll(); });
  const di = $("#ddImport"), dim = $("#ddImportMenu");
  $("#btnImportarDropdown")?.addEventListener("click", e => { e.stopPropagation(); dim.style.display = dim.style.display === "none" ? "block" : "none"; di.classList.toggle("open"); });
  document.addEventListener("click", e => { if (!di.contains(e.target)){ dim.style.display = "none"; di.classList.remove("open"); } });
  dim.querySelectorAll("button, [data-act='import-file']").forEach(b => { b.addEventListener("click", () => {
    const a = b.dataset.act; dim.style.display = "none"; di.classList.remove("open");
    if (a === "import-file") $("#fileInput")?.click();
    else if (a === "import-folder") importFromDefaultFolder();
    else if (a === "import-modern") abrirSelectorModerno();
    else if (a === "import-paste") abrirPasteModal();
    else if (a === "folder-config") openFolderConfig();
  }); });
  const de = $("#ddExport"), dem = $("#ddExportMenu");
  $("#btnExportar").addEventListener("click", e => { e.stopPropagation(); dem.style.display = dem.style.display === "none" ? "block" : "none"; de.classList.toggle("open"); });
  document.addEventListener("click", e => { if (!de.contains(e.target)){ dem.style.display = "none"; de.classList.remove("open"); } });
  dem.querySelectorAll("button").forEach(b => { b.addEventListener("click", () => {
    const a = b.dataset.act; dem.style.display = "none"; de.classList.remove("open");
    if (a === "export-full-json") exportFullJSON();
    else if (a === "export-cat-json") exportCatJSON();
    else if (a === "export-cat-csv") exportCatCSV();
    else if (a === "export-cat-md") exportCatMarkdown();
    else if (a === "export-cat-pdf") exportCatPDF();
    else if (a === "folder-browser") openFolderBrowser();
    else if (a === "folder-config") openFolderConfig();
    else if (a === "print") window.print();
  }); });
  const dm = $("#ddMore"), dmm = $("#ddMoreMenu");
  $("#btnMore")?.addEventListener("click", e => { e.stopPropagation(); dmm.style.display = dmm.style.display === "none" ? "block" : "none"; dm.classList.toggle("open"); });
  document.addEventListener("click", e => { if (!dm.contains(e.target)){ dmm.style.display = "none"; dm.classList.remove("open"); } });
  dmm.querySelectorAll("button").forEach(b => { b.addEventListener("click", () => {
    const a = b.dataset.act; dmm.style.display = "none"; dm.classList.remove("open");
    if (a === "owner-config") openOwnerConfig();
    else if (a === "discogs-config") openDiscogsConfig();
    else if (a === "folder-config") openFolderConfig();
    else if (a === "clear-cache"){ if (confirm("¿Vaciar caché?")){ MetadataCache.clear(); ResolvedLinks.clear(); Toast.show("🧹 Caché vaciada", "ok", 3200); } }
    else if (a === "diag-network") openNetworkDiag();
    else if (a === "reload") location.reload();
    else if (a === "show-legal") openLegalModal();
    else if (a === "export-legal-pdf") exportLegalPDF();
    else if (a === "reset") $("#btnReset")?.click();
  }); });
  const hF = (e) => { const f = e.target.files?.[0]; if (!f) return; importFile(f); e.target.value = ""; };
  $("#fileInput")?.addEventListener("change", hF);
  $("#fileInputEmpty")?.addEventListener("change", hF);
  $("#btnImportarModernoEmpty")?.addEventListener("click", abrirSelectorModerno);
  $("#btnPegarEmpty")?.addEventListener("click", abrirPasteModal);
  $("#pasteClose")?.addEventListener("click", cerrarPasteModal);
  $("#pasteCancel")?.addEventListener("click", cerrarPasteModal);
  $("#pasteModal")?.addEventListener("click", e => { if (e.target.id === "pasteModal") cerrarPasteModal(); });
  $("#pasteImport")?.addEventListener("click", () => { if (importarDesdeTexto($("#pasteArea").value)) cerrarPasteModal(); });
  ["dragenter","dragover"].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
  document.addEventListener("drop", e => {
    if (e.target.closest?.("#dropZone")) return;
    e.preventDefault(); e.stopPropagation();
    const dt = e.dataTransfer; if (!dt) return;
    let f = dt.files?.[0]; if (!f && dt.items){ for (const it of dt.items){ if (it.kind === "file"){ f = it.getAsFile(); break; } } }
    if (!f){ Toast.show("No se detectó archivo", "warn"); return; } importFile(f);
  });
  const dz = $("#dropZone");
  if (dz){ dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("hover"); }); dz.addEventListener("dragleave", () => dz.classList.remove("hover")); dz.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove("hover"); const dt = e.dataTransfer; let f = dt?.files?.[0]; if (!f && dt?.items){ for (const it of dt.items){ if (it.kind === "file"){ f = it.getAsFile(); break; } } } if (!f){ Toast.show("No se detectó archivo", "warn"); return; } importFile(f); }); }
  $("#btnCapifSearch")?.addEventListener("click", async () => {
    const t = $("#fTitulo")?.value || '', i = $("#fInterprete")?.value || '', isr = $("#fISRC")?.value || '';
    const qc = [i, t, isr].filter(Boolean).join(' — ');
    window.open('https://repertorio.capif.org.ar/', '_blank', 'noopener');
    if (qc){
      try { await navigator.clipboard.writeText(qc); Toast.show(`🇦🇷 CAPIF abierto · Copiado: ${qc}`, 'ok', 4500); }
      catch(_){ Toast.show(`🇦🇷 CAPIF abierto: ${qc}`, 'ok', 3500); }
    } else {
      Toast.show('🇦🇷 CAPIF abierto (sin datos para buscar)', 'info', 3500);
    }
  });
  $("#ownerConfigClose")?.addEventListener("click", closeOwnerConfig);
  $("#ownerConfigCancel")?.addEventListener("click", closeOwnerConfig);
  $("#ownerConfigModal")?.addEventListener("click", e => { if (e.target.id === "ownerConfigModal") closeOwnerConfig(); });
  $("#ownerConfigSave")?.addEventListener("click", () => { OwnerConfig.set({ name: upper($("#ownerNameInput").value), contact: upper($("#ownerContactInput").value), email: $("#ownerEmailInput").value }); Toast.show("Datos guardados", "ok"); closeOwnerConfig(); });
  $("#ownerConfigClear")?.addEventListener("click", () => { if (!confirm("¿Limpiar datos?")) return; OwnerConfig.clear(); $("#ownerNameInput").value = ""; $("#ownerContactInput").value = ""; $("#ownerEmailInput").value = ""; Toast.show("Datos eliminados", "warn"); });
  $("#discogsConfigClose")?.addEventListener("click", closeDiscogsConfig);
  $("#discogsConfigCancel")?.addEventListener("click", closeDiscogsConfig);
  $("#discogsConfigModal")?.addEventListener("click", e => { if (e.target.id === "discogsConfigModal") closeDiscogsConfig(); });
  $("#discogsTokenToggle")?.addEventListener("click", () => { const i = $("#discogsTokenInput"); i.type = i.type === 'password' ? 'text' : 'password'; });
  $("#discogsSave")?.addEventListener("click", () => {
    const t = $("#discogsTokenInput").value.trim(); const p = $("#discogsProxyInput").value.trim();
    if (!t && !p){ clearDiscogsConfig(); updateDiscogsStatus('idle','Vacío.'); Toast.show('Configuración eliminada','warn'); updateDiscogsProtoHint(); return; }
    const ok = saveDiscogsConfig(t, p);
    if (ok){
      updateDiscogsStatus('ok', t ? '✅ Token guardado.' : 'Sin token.');
      Toast.show('✅ Token guardado','ok');
      updateDiscogsProtoHint();
    } else {
      updateDiscogsStatus('error', 'No se pudo escribir en localStorage (cuota llena). Exportá backup y vaciá caché en ⚙️.');
    }
  });
  $("#discogsTest")?.addEventListener("click", async () => {
    const t = $("#discogsTokenInput").value.trim();
    if (!t){ updateDiscogsStatus('error','Ingresá el token primero.'); return; }
    saveDiscogsConfig(t, $("#discogsProxyInput").value.trim());
    const b = $("#discogsTest");
    const orig = b.textContent;
    b.disabled = true;
    b.textContent = '⏳ Probando…';
    updateDiscogsStatus('warn', 'Conectando…');
    const stat = $("#discogsStatus");
    if (stat) stat.style.whiteSpace = 'pre-line';
    try {
      const me = await testDiscogsConnection(t);
      updateDiscogsStatus('ok', `✅ Token válido · Usuario: ${me.username || me.id || 'ok'}`);
      Toast.show(`✅ Discogs OK — ${me.username || 'token válido'}`, 'ok', 4000);
    } catch(err){
      updateDiscogsStatus('error', `🔴 ${err.message}`);
      Toast.show('❌ Ver detalle en el panel de estado', 'err', 5000);
    } finally {
      b.disabled = false;
      b.textContent = orig;
    }
  });
  $("#discogsTokenClear")?.addEventListener("click", () => { if (!getDiscogsToken() && !getDiscogsConfig().proxy) return; if (confirm('¿Eliminar token y proxy?')){ clearDiscogsConfig(); $("#discogsTokenInput").value = ''; $("#discogsProxyInput").value = ''; updateDiscogsStatus('idle','Eliminado.'); updateDiscogsProtoHint(); Toast.show('Eliminado','warn'); } });
  $("#discogsProxyInput")?.addEventListener("input", updateDiscogsProtoHint);
  $("#folderConfigClose")?.addEventListener("click", closeFolderConfig);
  $("#folderConfigCancel")?.addEventListener("click", closeFolderConfig);
  $("#folderConfigModal")?.addEventListener("click", e => { if (e.target.id === "folderConfigModal") closeFolderConfig(); });
  $("#folderPick")?.addEventListener("click", pickDefaultFolder);
  $("#folderChange")?.addEventListener("click", pickDefaultFolder);
  $("#folderRemove")?.addEventListener("click", removeDefaultFolder);
  $("#folderClearAll")?.addEventListener("click", async () => { if (!confirm("¿Eliminar configuración?")) return; await FileSystemDefault.clear(); FileSystemDefault.refreshBadge(); updateFolderSupportStatus(); Toast.show("Configuración eliminada", "warn"); });
  $("#folderSave")?.addEventListener("click", () => closeFolderConfig());
  $("#folderTestPermission")?.addEventListener("click", async () => { if (!FileSystemDefault.isSet()){ Toast.show("Sin carpeta", "warn"); return; } const ok = await FileSystemDefault.ensureReady("readwrite"); Toast.show(ok ? "✅ Acceso" : "🔐 Autorizá", ok ? "ok" : "warn", 3500); });
  $("#folderBrowserClose")?.addEventListener("click", closeFolderBrowser);
  $("#folderBrowserCancel")?.addEventListener("click", closeFolderBrowser);
  $("#folderBrowserModal")?.addEventListener("click", e => { if (e.target.id === "folderBrowserModal") closeFolderBrowser(); });
  $("#folderRefresh")?.addEventListener("click", refreshFolderList);
  $("#folderUploadNow")?.addEventListener("click", saveBackupToFolder);
  $("#folderChangeFromBrowser")?.addEventListener("click", () => { closeFolderBrowser(); openFolderConfig(); });
  $("#networkDiagClose")?.addEventListener("click", closeNetworkDiag);
  $("#networkDiagCancel")?.addEventListener("click", closeNetworkDiag);
  $("#networkDiagModal")?.addEventListener("click", e => { if (e.target.id === "networkDiagModal") closeNetworkDiag(); });
  $("#networkDiagRun")?.addEventListener("click", runNetworkDiagnostics);

  $("#btnExit")?.addEventListener("click", openExitModal);
  $("#exitClose")?.addEventListener("click", closeExitModal);
  $("#exitCancel")?.addEventListener("click", closeExitModal);
  $("#exitModal")?.addEventListener("click", e => { if (e.target.id === "exitModal") closeExitModal(); });
  $("#exitExportCheck")?.addEventListener("change", e => { $("#exitConfirm").disabled = !e.target.checked; });
  $("#exitConfirm")?.addEventListener("click", async () => {
    if (!$("#exitExportCheck").checked){ Toast.show("Marcá la casilla para exportar y salir","warn"); return; }
    try {
      await exportFullJSON();
      Toast.show("✅ Backup exportado · Ya podés cerrar la pestaña","ok",5500);
      closeExitModal();
      setTimeout(() => {
        try { window.open('', '_self'); window.close(); } catch(_){}
        setTimeout(() => { if (!window.closed){ Toast.show("El navegador no permite cerrar automáticamente.","info",8000); } }, 500);
      }, 800);
    } catch(err){ Toast.show("Error al exportar: "+err.message,"err",6000); }
  });
  $("#exitSkip")?.addEventListener("click", () => {
    if (!confirm("⚠️ Vas a salir SIN exportar.\n\n¿Estás seguro?")) return;
    if (!confirm("🛑 CONFIRMACIÓN FINAL:\n\n¿Salir realmente sin backup?")) return;
    closeExitModal();
    HistoryLog.log('INFO', 'Salida sin exportar', 'Usuario eligió salir sin backup');
    setTimeout(() => { try { window.open('', '_self'); window.close(); } catch(_){} }, 400);
  });

  $("#btnReset").addEventListener("click", () => {
    if (!confirm("⚠️ VACIAR TODO.\n\n¿Seguro?")) return;
    if (!confirm("¿Realmente?")) return;
    Store.resetAll(); NotFoundList.clear(); NotFoundList.persist();
    App.selected.clear(); App.artista = null; App.q = ""; App.focusedKey = null; App.subcat = null;
    $("#q").value = ""; $("#searchBox").classList.remove("has-value");
    Undo.clear(); ensureValidCat(); renderTabs(); renderAll(); AutoBackup.reset();
    HistoryLog.log('DELETE', 'Base vaciada');
    Toast.show("Base vaciada", "warn");
  });
  $("#modalClose").addEventListener("click", cerrarModal);
  $("#btnCancel").addEventListener("click", cerrarModal);
  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") cerrarModal(); });
  $$(".modal-tab").forEach(t => t.addEventListener("click", () => switchModalTab(t.dataset.tab)));
  $("#cdForm").addEventListener("submit", guardarCD);
  $("#btnSaveAndNew").addEventListener("click", () => { if (!validarForm()){ Toast.show("Revisá campos", "err"); return; } if (guardarCD()) setTimeout(() => abrirModal("nuevo"), 100); });
  $("#btnOpenCfFromModal")?.addEventListener("click", () => { CustomFields.render(); $("#customFieldsModal").classList.add("open"); });
  $("#viewClose")?.addEventListener("click", cerrarVista);
  $("#viewCloseBtn")?.addEventListener("click", cerrarVista);
  $("#viewModal")?.addEventListener("click", e => { if (e.target.id === "viewModal") cerrarVista(); });
  $("#viewEdit")?.addEventListener("click", () => { const k = $("#viewModal").dataset.editKey; if (!k) return; const { cat, id } = parseCDKey(k); const cd = Store.getCDs(cat).find(c => c.id === id); cerrarVista(); if (cd){ if (App.cat !== ALL_CATS) App.cat = cat; abrirModal("editar", cd); } });
  $("#fCat").addEventListener("change", e => {
    const tc = e.target.value;
    populateSubcatOptions(tc, "");
    if (App.editing && tc === App.editing.cat && App.editing.original){ $("#fNro").value = App.editing.original.nro; return; }
    const cds = Store.getCDs(tc); const mx = cds.reduce((m, c) => Math.max(m, c.nro || 0), 0); $("#fNro").value = mx + 1;
  });
  ["#fTitulo", "#fInterprete"].forEach(s => { const el = $(s); if (el) el.addEventListener("blur", () => scheduleEnrichment(750)); });
  $("#enrichToggle")?.addEventListener("change", e => Store.setPref("enrich", e.target.checked));
  $("#replaceToggle")?.addEventListener("change", e => { Store.setPref("replaceOnEnrich", e.target.checked); Toast.show(e.target.checked ? "🔄 Reemplazará datos" : "Solo completará vacíos", e.target.checked ? "info" : "ok", 3000); });
  $("#btnFetchCover")?.addEventListener("click", fetchCoverManually);
  $("#btnEditCoverUrl")?.addEventListener("click", () => { const w = $("#wrapCoverUrl"); w.style.display = w.style.display === "none" ? "" : "none"; if (w.style.display === "") $("#fCoverUrl").focus(); });
  $("#btnClearCover")?.addEventListener("click", () => { $("#fCoverUrl").value = ""; renderCoverPreview(null, null); });
  $("#fCoverUrl")?.addEventListener("input", e => { const u = e.target.value.trim(); renderCoverPreview(u || null, null); });
  $("#lbClose")?.addEventListener("click", Lightbox.close);
  $("#coverLightbox")?.addEventListener("click", e => { if (e.target.id === "coverLightbox") Lightbox.close(); });
  $("#lbPrev")?.addEventListener("click", e => { e.stopPropagation(); Lightbox.prev(); });
  $("#lbNext")?.addEventListener("click", e => { e.stopPropagation(); Lightbox.next(); });
  $("#projTasa")?.addEventListener("change", e => { $("#projCustomWrap").style.display = e.target.value === "custom" ? "" : "none"; renderProjection(computeDash().valorTotal); });
  ["#projAnios", "#projCustom", "#projBase", "#projManual"].forEach(s => { $(s)?.addEventListener("input", debounce(() => { $("#projManualWrap").style.display = $("#projBase").value === "manual" ? "" : "none"; renderProjection(computeDash().valorTotal); }, 200)); });
  $("#catModalClose").addEventListener("click", cerrarCatModal);
  $("#catCancel").addEventListener("click", cerrarCatModal);
  $("#catModal").addEventListener("click", e => { if (e.target.id === "catModal") cerrarCatModal(); });
  $("#catForm").addEventListener("submit", guardarCategoria);
  $("#catIcon").addEventListener("input", e => { $("#catIconPreview").textContent = e.target.value || "🎵"; });
  const mm = $("#manualModal");
  const am = () => { mm.classList.add("open"); setTimeout(() => $("#manualSearch").focus(), 80); };
  const cm = () => mm.classList.remove("open");
  $("#btnAyuda")?.addEventListener("click", am);
  $("#btnAyudaEmpty")?.addEventListener("click", am);
  $("#manualClose")?.addEventListener("click", cm);
  mm?.addEventListener("click", e => { if (e.target.id === "manualModal") cm(); });
  $$("#manualNav button").forEach(b => b.addEventListener("click", () => switchManualSection(b.dataset.sec)));
  $("#manualSearch")?.addEventListener("input", debounce((e) => {
    const q = norm(e.target.value.trim()); const s = document.querySelector(".manual-section.active"); if (!s) return;
    const bl = s.querySelectorAll("h3, h4, p, li, tr, .manual-step, .callout, pre, table");
    if (!q){ bl.forEach(x => x.style.display = ""); return; }
    bl.forEach(x => { x.style.display = norm(x.textContent).includes(q) ? "" : "none"; });
  }, 180));
  $("#btnEnrichAll")?.addEventListener("click", () => BulkEnrich.open());
  $("#bulkEnrichClose")?.addEventListener("click", () => BulkEnrich.close());
  $("#bulkEnrichCancel")?.addEventListener("click", () => BulkEnrich.close());
  $("#bulkEnrichModal")?.addEventListener("click", e => { if (e.target.id === "bulkEnrichModal") BulkEnrich.close(); });
  $("#bulkEnrichStart")?.addEventListener("click", () => BulkEnrich.run());
  $("#bulkEnrichStop")?.addEventListener("click", () => BulkEnrich.stop());
  $$("#bulkEnrichConfig input[type=checkbox], #bulkEnrichConfig input[type=radio]").forEach(i => i.addEventListener("change", () => BulkEnrich.updatePreview()));
  $("#btnViewNotFoundFromBulk")?.addEventListener("click", () => { BulkEnrich.close(); setTimeout(openNotFoundModal, 200); });
  $("#bulkMoveClose")?.addEventListener("click", closeBulkMoveModal);
  $("#bulkMoveCancel")?.addEventListener("click", closeBulkMoveModal);
  $("#bulkMoveModal")?.addEventListener("click", e => { if (e.target.id === "bulkMoveModal") closeBulkMoveModal(); });
  $("#bulkMoveConfirm")?.addEventListener("click", confirmBulkMove);
  $("#bulkMoveKeepNro")?.addEventListener("change", () => renderBulkMovePreview());
  $("#btnNotFound")?.addEventListener("click", openNotFoundModal);
  $("#notFoundClose")?.addEventListener("click", closeNotFoundModal);
  $("#notFoundCancel")?.addEventListener("click", closeNotFoundModal);
  $("#notFoundModal")?.addEventListener("click", e => { if (e.target.id === "notFoundModal") closeNotFoundModal(); });
  $("#btnPrintNotFound")?.addEventListener("click", printNotFoundList);
  $("#btnExportNotFoundCSV")?.addEventListener("click", exportNotFoundCSV);
  $("#btnExportNotFoundJSON")?.addEventListener("click", exportNotFoundJSON);
  $("#btnClearNotFound")?.addEventListener("click", clearNotFoundList);
  $("#notFoundSearch")?.addEventListener("input", debounce((e) => { App.notFoundFilter = e.target.value; renderNotFoundTable(); }, 180));
  $("#autoBackupClose")?.addEventListener("click", () => AutoBackup.later());
  $("#autoBackupLater")?.addEventListener("click", () => AutoBackup.later());
  $("#autoBackupDo")?.addEventListener("click", () => AutoBackup.doBackup());
  $("#autoBackupModal")?.addEventListener("click", e => { if (e.target.id === "autoBackupModal") AutoBackup.later(); });
  $("#autoBackupToggle")?.addEventListener("change", e => { AutoBackup.setEnabled(e.target.checked); Toast.show(e.target.checked ? "Backup activado" : "Backup desactivado", e.target.checked ? "ok" : "warn", 2500); });
  $("#autoBackupToggleLabel")?.addEventListener("click", e => e.stopPropagation());
  $("#checkAll").addEventListener("change", e => { const c = e.target.checked; $$("#tbodyCD tr").forEach(tr => { const k = tr.dataset.key; if (c) App.selected.add(k); else App.selected.delete(k); tr.classList.toggle("selected", c); const cb = tr.querySelector("td.check input"); if (cb) cb.checked = c; }); updateSelectionBar(); if (GridView.isEnabled()) GridView.render(); });
  $("#themeToggle")?.addEventListener("click", () => ThemeManager.toggle());
  $("#dupClose")?.addEventListener("click", () => $("#duplicatesModal").classList.remove("open"));
  $("#dupCloseBtn")?.addEventListener("click", () => $("#duplicatesModal").classList.remove("open"));
  $("#duplicatesModal")?.addEventListener("click", e => { if (e.target.id === "duplicatesModal") e.currentTarget.classList.remove("open"); });
  $("#dupExportCSV")?.addEventListener("click", () => Duplicates.exportCSV());
  $("#cfClose")?.addEventListener("click", () => $("#customFieldsModal").classList.remove("open"));
  $("#cfCloseBtn")?.addEventListener("click", () => $("#customFieldsModal").classList.remove("open"));
  $("#customFieldsModal")?.addEventListener("click", e => { if (e.target.id === "customFieldsModal") e.currentTarget.classList.remove("open"); });
  $("#cfType")?.addEventListener("change", e => { $("#cfOptionsWrap").style.display = e.target.value === "select" ? "" : "none"; });
  $("#cfAdd")?.addEventListener("click", () => { const n = upper($("#cfName").value); const t = $("#cfType").value; const o = $("#cfOptions").value; if (!n.trim()){ Toast.show("Ingresá nombre", "warn"); return; } if (CustomFields.add({ name: n, type: t, options: o })){ $("#cfName").value = ""; $("#cfOptions").value = ""; CustomFields.render(); Toast.show("Campo agregado", "ok"); HistoryLog.log('CREATE', `Campo personalizado: ${n}`, t); } });
  $("#btnHistory")?.addEventListener("click", () => { HistoryLog.render(); $("#historyModal").classList.add("open"); });
  $("#histClose")?.addEventListener("click", () => $("#historyModal").classList.remove("open"));
  $("#histCloseBtn")?.addEventListener("click", () => $("#historyModal").classList.remove("open"));
  $("#historyModal")?.addEventListener("click", e => { if (e.target.id === "historyModal") e.currentTarget.classList.remove("open"); });
  $("#histFilter")?.addEventListener("change", () => HistoryLog.render());
  $("#histSearch")?.addEventListener("input", debounce(() => HistoryLog.render(), 180));
  $("#histExport")?.addEventListener("click", () => HistoryLog.exportCSV());
  $("#histClear")?.addEventListener("click", () => { if (!confirm("¿Limpiar historial?")) return; HistoryLog.clear(); HistoryLog.render(); Toast.show("Historial limpiado", "warn"); });
  $("#btnScan")?.addEventListener("click", () => {
    $("#scannerModal").classList.add("open");
    $("#scanFallback").style.display = "none"; $("#scanWrap").style.display = "";
    $("#scanManual").value = ""; $("#scanStatus").textContent = "Iniciando cámara…"; $("#scanStatus").className = "scanner-status";
    BarcodeScanner.start((code) => { setTimeout(() => { $("#scannerModal").classList.remove("open"); BarcodeScanner.stop(); abrirModal("nuevo"); setTimeout(() => { $("#fCodigo").value = code; Toast.show(`Código ${code} cargado`, "ok", 4500); }, 200); }, 800); });
  });
  $("#scanClose")?.addEventListener("click", () => { BarcodeScanner.stop(); $("#scannerModal").classList.remove("open"); });
  $("#scanCloseBtn")?.addEventListener("click", () => { BarcodeScanner.stop(); $("#scannerModal").classList.remove("open"); });
  $("#scanStop")?.addEventListener("click", () => { BarcodeScanner.stop(); $("#scanStatus").textContent = "Detenido"; });
  $("#scannerModal")?.addEventListener("click", e => { if (e.target.id === "scannerModal"){ BarcodeScanner.stop(); e.currentTarget.classList.remove("open"); } });
  $("#scanManualSearch")?.addEventListener("click", () => { const c = upper($("#scanManual").value.trim()); if (!c) return; BarcodeScanner.stop(); $("#scannerModal").classList.remove("open"); abrirModal("nuevo"); setTimeout(() => { $("#fCodigo").value = c; Toast.show(`Código ${c} cargado`, "ok", 4500); }, 200); });
  $("#loanClose")?.addEventListener("click", () => $("#loansModal").classList.remove("open"));
  $("#loanCloseBtn")?.addEventListener("click", () => $("#loansModal").classList.remove("open"));
  $("#loansModal")?.addEventListener("click", e => { if (e.target.id === "loansModal") e.currentTarget.classList.remove("open"); });
  $("#loanExportCSV")?.addEventListener("click", () => Loans.exportCSV());

  $("#legalClose")?.addEventListener("click", closeLegalModal);
  $("#legalLater")?.addEventListener("click", closeLegalModal);
  $("#legalModal")?.addEventListener("click", e => { if (e.target.id === "legalModal") closeLegalModal(); });
  $("#legalAceptar")?.addEventListener("click", aceptarLegal);
  $("#legalPDF")?.addEventListener("click", exportLegalPDF);

  attachSelectionBarEvents();
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("beforeunload", (e) => { if (AutoBackup.hasPending()){ e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    if (!el.matches('[data-uppercase]')) return;
    const s = el.selectionStart; const en = el.selectionEnd;
    el.value = el.value.toUpperCase();
    if (typeof s === 'number' && typeof en === 'number'){ try { el.setSelectionRange(s, en); } catch(_){} }
  });
}

function handleKeydown(e){
  const ctrl = e.ctrlKey || e.metaKey;
  const modalOpen = $("#modal").classList.contains("open");
  const viewOpen = $("#viewModal")?.classList.contains("open");
  const pasteOpen = $("#pasteModal").classList.contains("open");
  const catOpen = $("#catModal").classList.contains("open");
  const manualOpen = $("#manualModal").classList.contains("open");
  const bulkOpen = $("#bulkEnrichModal").classList.contains("open");
  const abOpen = $("#autoBackupModal").classList.contains("open");
  const nfOpen = $("#notFoundModal").classList.contains("open");
  const diOpen = $("#discogsConfigModal")?.classList.contains("open");
  const owOpen = $("#ownerConfigModal")?.classList.contains("open");
  const fcOpen = $("#folderConfigModal")?.classList.contains("open");
  const fbOpen = $("#folderBrowserModal")?.classList.contains("open");
  const lbOpen = $("#coverLightbox").classList.contains("open");
  const bmOpen = $("#bulkMoveModal")?.classList.contains("open");
  const ndOpen = $("#networkDiagModal")?.classList.contains("open");
  const dpOpen = $("#duplicatesModal")?.classList.contains("open");
  const cfOpen = $("#customFieldsModal")?.classList.contains("open");
  const hiOpen = $("#historyModal")?.classList.contains("open");
  const scOpen = $("#scannerModal")?.classList.contains("open");
  const loOpen = $("#loansModal")?.classList.contains("open");
  const exOpen = $("#exitModal")?.classList.contains("open");
  const alOpen = $("#albumConfirmModal")?.classList.contains("open");
  const lgOpen = $("#legalModal")?.classList.contains("open");
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);

  if (lbOpen){ if (e.key === "Escape"){ e.preventDefault(); Lightbox.close(); return; } if (e.key === "ArrowLeft"){ e.preventDefault(); Lightbox.prev(); return; } if (e.key === "ArrowRight"){ e.preventDefault(); Lightbox.next(); return; } return; }
  if (e.key === "F1"){ e.preventDefault(); const m = $("#manualModal"); if (m.classList.contains("open")) m.classList.remove("open"); else m.classList.add("open"); return; }
  if (e.key === "Escape"){
    if (viewOpen){ cerrarVista(); return; }
    if (modalOpen){ cerrarModal(); return; }
    if (pasteOpen){ cerrarPasteModal(); return; }
    if (catOpen){ cerrarCatModal(); return; }
    if (manualOpen){ $("#manualModal").classList.remove("open"); return; }
    if (bulkOpen){ BulkEnrich.close(); return; }
    if (abOpen){ AutoBackup.later(); return; }
    if (nfOpen){ closeNotFoundModal(); return; }
    if (diOpen){ closeDiscogsConfig(); return; }
    if (owOpen){ closeOwnerConfig(); return; }
    if (fcOpen){ closeFolderConfig(); return; }
    if (fbOpen){ closeFolderBrowser(); return; }
    if (bmOpen){ closeBulkMoveModal(); return; }
    if (ndOpen){ closeNetworkDiag(); return; }
    if (dpOpen){ $("#duplicatesModal").classList.remove("open"); return; }
    if (cfOpen){ $("#customFieldsModal").classList.remove("open"); return; }
    if (hiOpen){ $("#historyModal").classList.remove("open"); return; }
    if (scOpen){ BarcodeScanner.stop(); $("#scannerModal").classList.remove("open"); return; }
    if (loOpen){ $("#loansModal").classList.remove("open"); return; }
    if (exOpen){ closeExitModal(); return; }
    if (alOpen){ $("#albumConfirmClose")?.click(); return; }
    if (lgOpen){ closeLegalModal(); return; }
    cerrarMenuCategoria(); cerrarMenuSubcategoria(); App.artista = null; App.q = ""; $("#q").value = ""; $("#searchBox").classList.remove("has-value"); renderAll(); return;
  }
  if (modalOpen){ if (ctrl && e.key === "Enter"){ e.preventDefault(); $("#btnSaveAndNew").click(); } return; }
  if (viewOpen || pasteOpen || catOpen || manualOpen || bulkOpen || abOpen || nfOpen || diOpen || owOpen || fcOpen || fbOpen || bmOpen || ndOpen || dpOpen || cfOpen || hiOpen || scOpen || loOpen || exOpen || alOpen || lgOpen) return;
  if (typing) return;
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "q"){ e.preventDefault(); openExitModal(); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "d"){ e.preventDefault(); Duplicates.render(); $("#duplicatesModal").classList.add("open"); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "l"){ e.preventDefault(); Loans.render(); $("#loansModal").classList.add("open"); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "h"){ e.preventDefault(); HistoryLog.render(); $("#historyModal").classList.add("open"); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "t"){ e.preventDefault(); ThemeManager.toggle(); return; }
  if (ctrl && e.key.toLowerCase() === "n"){ e.preventDefault(); abrirModal("nuevo"); return; }
  if (ctrl && e.key.toLowerCase() === "k"){ e.preventDefault(); abrirModalCategoria("crear"); return; }
  if (ctrl && e.key.toLowerCase() === "e"){ e.preventDefault(); BulkEnrich.open(); return; }
  if (ctrl && e.key.toLowerCase() === "s"){ e.preventDefault(); exportFullJSON(); return; }
  if (ctrl && e.key.toLowerCase() === "f"){ e.preventDefault(); $("#btnFiltros").click(); return; }
  if (ctrl && e.key.toLowerCase() === "z"){ e.preventDefault(); Undo.pop(); return; }
  if (ctrl && e.key.toLowerCase() === "d"){ e.preventDefault(); setView(App.view === "dashboard" ? "table" : "dashboard"); return; }
  if (ctrl && e.key.toLowerCase() === "g"){ e.preventDefault(); GridView.setEnabled(!GridView.isEnabled()); return; }
  const rows = $$("#tbodyCD tr"); if (!rows.length) return;
  let idx = rows.findIndex(r => r.dataset.key === App.focusedKey);
  if (e.key === "ArrowDown"){ e.preventDefault(); idx = Math.min(idx + 1, rows.length - 1); if (idx < 0) idx = 0; App.focusedKey = rows[idx].dataset.key; updateFocusedRow(); }
  else if (e.key === "ArrowUp"){ e.preventDefault(); idx = Math.max(idx - 1, 0); App.focusedKey = rows[idx].dataset.key; updateFocusedRow(); }
  else if (e.key === "Enter" && App.focusedKey){ e.preventDefault(); const { cat, id } = parseCDKey(App.focusedKey); const cd = Store.getCDs(cat).find(c => c.id === id); if (cd){ if (App.cat !== ALL_CATS) App.cat = cat; abrirModal("editar", cd); } }
  else if ((e.key === "Delete" || e.key === "Backspace") && App.focusedKey){ e.preventDefault(); const { cat, id } = parseCDKey(App.focusedKey); const cd = Store.getCDs(cat).find(c => c.id === id); if (cd) eliminarCD(cd); }
  else if (e.key === " " && App.focusedKey){ e.preventDefault(); const k = App.focusedKey; const c = !App.selected.has(k); toggleSelect(k, c); const tr = rows.find(r => r.dataset.key === k); if (tr) tr.querySelector("td.check input").checked = c; }
}

async function initV6(){
  ThemeManager.init();
  DuplicateChecker.invalidate();
  try {
    const manifest = { name: 'Discografía — Colección de CDs', short_name: 'Discografía', description: 'Gestor profesional de colección', start_url: './', display: 'standalone', background_color: '#0e1116', theme_color: '#4fc3f7', icons: [{ src: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4fc3f7"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs><circle cx="256" cy="256" r="240" fill="url(#g)"/><circle cx="256" cy="256" r="90" fill="#0e1116"/><circle cx="256" cy="256" r="30" fill="#4fc3f7"/></svg>`), sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }] };
    const mb = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    const mu = URL.createObjectURL(mb);
    const l = document.createElement('link'); l.rel = 'manifest'; l.href = mu; document.head.appendChild(l);
  } catch(e){}
  try {
    if ('serviceWorker' in navigator && location.protocol !== 'file:'){
      const sw = `const CACHE='discografia-v7010';self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./']).catch(()=>{})));self.skipWaiting();});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==location.origin)return;e.respondWith(caches.match(e.request).then(c=>{const f=fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(cc=>cc.put(e.request,r.clone()));return r;}).catch(()=>c);return c||f;}));});`;
      const sb = new Blob([sw], { type: 'application/javascript' }); const su = URL.createObjectURL(sb);
      navigator.serviceWorker.register(su).then(reg => {
        try { reg.update(); } catch(e){}
      }).catch(e => console.warn('SW:', e));
    }
  } catch(e){}
  HistoryLog.log('INFO', `App iniciada v${APP_VERSION}`, `${Store.total()} CDs · ${Store.catKeys().length} categorías`);
}

function runLegacyCorrector(){
  const TITULOS_RAW = {
    "MISTFITS":"Misfits","BREACK AWAY":"Break Away","JURCTION":"Junction",
    "ANOTHER TIME,ANOTHER PLEAC":"Another Time, Another Place","BITTERR-SWEET":"Bitter Sweet",
    "LANGHING DOWN CRYING":"Laughing Down Crying","UMPLUGGED deluxe":"Unplugged (Deluxe)",
    "SACRED SONG WITH ROBERT FRIP":"Sacred Song (with Robert Fripp)",
    "WOLD PEACE IS NONE OF YOUR BU":"World Peace Is None of Your Business",
    "KILL UNLE":"Kill Uncle","BUBBLE GOM MAMA CASS COPIA":"Bubble Gum (Mama Cass)",
    "BHOTHER WHERE YOU BOUND":"Brother Where You Bound","WINS OF CHANGE":"Winds of Change",
    "PHANTOM POWWER":"Phantom Power","EXTENDER VERSIONS":"Extended Versions",
    "TEH BIRDS,THE BEES y THE":"The Birds, The Bees & The Monkees","PEACEFUL WOLD":"Peaceful World",
    "WOLD FALLING DOWN":"World Falling Down","A NEW WOLD RECORDS":"A New World Record",
    "ROBIN´S REGN":"Robin's Reign","BRING ON THE NIGTH":"Bring on the Night",
    "COMO CONEGUIR CHICAS":"Cómo Conseguir Chicas","DEMACIADAS MANERAS DE NO…":"Demasiadas Maneras de No…",
    "STRAWWBERRIES MEAN LOVE":"Strawberries Mean Love","MEET THE SEARCHRES":"Meet the Searchers",
    "FIESTA MOUNSTRO":"Fiesta Monstruo","BOOBLEG S.VOL 2 KSAN 95 FM LIVE79":"Bootleg Series Vol. 2 KSAN 95 FM Live '79",
    "HOW DARE YUO !":"How Dare You!","THAT THING YUO DO!":"That Thing You Do!",
    "PAUL YUONG E Q-TIPS":"Paul Young & Q-Tips","PET SOUNDS 50 ANIVERSARY":"Pet Sounds 50th Anniversary",
    "LIVE IN LAS VEGAS 50 ANIVERSARIO":"Live in Las Vegas 50th Anniversary",
    "ON AIR LIVE AT THE BBC VOLUMEN 2":"On Air – Live at the BBC Volume 2",
    "THE TRA LA DAYS ARE OVER":"The Tra-La Days Are Over","EGIPT STATION":"Egypt Station",
    "LIVE AT QUEVEC":"Live at Quebec","LAS OTRAS CARAS DE LA ALTA SOC":"Las Otras Caras de la Alta Sociedad",
    "JUST AN OLD FASHIONED LOVE S":"Just an Old Fashioned Love Song","SO PARA CONTRARIAR":"Só Para Contrariar",
    "OGRANDE ENCONTRO DE":"O Grande Encontro de","LIVE AT THE PALAIS COPIA":"Live at the Palais",
    "LOOKING BACK WITH LOVE COPIA":"Looking Back with Love","AT THE MOVIES COPIA":"At the Movies",
    "SINGS COPIA":"Sings","LIVE COPIA":"Live","RARITIES VOL. 4 (COPIA)":"Rarities Vol. 4",
    "RARITIES VOL. 9 (COPIA)":"Rarities Vol. 9","RARITIES VOL. 10 (COPIA)":"Rarities Vol. 10",
    "FREEDOM WIND COPIA":"Freedom Wind","FOREVER CHANGES COPIA":"Forever Changes",
    "MONTAGE COPIA":"Montage","THE VERY BEST OF COPIA":"The Very Best Of",
    "THE RUTLES COPIA":"The Rutles","INCENSE AND PEPPERMINTS COPIA":"Incense and Peppermints",
    "SHADOWS COPIA":"Shadows","ALEXANDRE PIRES COPIA":"Alexandre Pires","ESTRELLA COPIA":"Estrella",
    "COPIA SIN NOMBRE":"Sin título"
  };
  const INTERPRETES_RAW = {
    "JOHNNY RIVRES":"Johnny Rivers","PAUL WILLIANS":"Paul Williams","ROY ORBINSON":"Roy Orbison",
    "MAMA CASS ELIOT":"Mama Cass Elliot","THE MONTION PICTURE":"The Motion Picture",
    "ENANANITOS VERDES":"Enanitos Verdes","LOS FABULSOS CADILLACS":"Los Fabulosos Cadillacs",
    "LEO MASIAH":"Leo Masliah","LUIS ALBERTO SPINETTTA":"Luis Alberto Spinetta",
    "GAL COSTA CANTA TOM JOBIN":"Gal Costa canta Tom Jobim",
    "JOBIN VINICIUS TOQUINHO MIUCHA":"Jobim, Vinicius, Toquinho & Miúcha",
    "TOM JOBIN":"Tom Jobim"
  };
  const ESTADOS_EN_ES = {
    "Mint (M)":"Como nuevo (M)","Near Mint (NM)":"Casi nuevo (NM)","Excellent (EX)":"Excelente (EX)",
    "Very Good (VG)":"Muy bueno (VG)","Good (G)":"Bueno (G)","Fair (F)":"Regular (F)","Poor (P)":"Malo (P)"
  };
  const _n = s => String(s || '').trim().toUpperCase();
  const TITULOS = {};     for (const k in TITULOS_RAW)     TITULOS[_n(k)]     = TITULOS_RAW[k];
  const INTERPRETES = {}; for (const k in INTERPRETES_RAW) INTERPRETES[_n(k)] = INTERPRETES_RAW[k];

  const cats = Store.categories();
  const snapshot = JSON.stringify(cats);
  let total = 0;

  for (const catKey in cats){
    const cds = cats[catKey]?.cds;
    if (!Array.isArray(cds)) continue;
    for (const cd of cds){
      const tN = _n(cd.titulo), iN = _n(cd.interprete);
      if (TITULOS[tN] && TITULOS[tN] !== cd.titulo){ cd.titulo = TITULOS[tN]; total++; }
      if (INTERPRETES[iN] && INTERPRETES[iN] !== cd.interprete){ cd.interprete = INTERPRETES[iN]; total++; }
      if (cd.titulo){
        const antes = cd.titulo;
        cd.titulo = cd.titulo.replace(/\s*\(COPIA\)\s*$/i,'').replace(/\s+COPIA\s*$/i,'').trim();
        if (cd.titulo !== antes) total++;
      }
      if (cd.titulo && /´/.test(cd.titulo)){ cd.titulo = cd.titulo.replace(/´/g,"'"); total++; }
      if (cd.interprete && /´/.test(cd.interprete)){ cd.interprete = cd.interprete.replace(/´/g,"'"); total++; }
      for (const campo of ['estadoDisco','estadoCaja','estadoFolleto','estadoArte']){
        const v = cd[campo];
        if (v && ESTADOS_EN_ES[v]){ cd[campo] = ESTADOS_EN_ES[v]; total++; }
      }
      if (cd.titulo && cd.titulo !== cd.titulo.toUpperCase()){ cd.titulo = cd.titulo.toUpperCase(); total++; }
      if (cd.interprete && cd.interprete !== cd.interprete.toUpperCase()){ cd.interprete = cd.interprete.toUpperCase(); total++; }
      if (cd.sello && cd.sello !== cd.sello.toUpperCase()){ cd.sello = cd.sello.toUpperCase(); total++; }
      if (cd.genero && cd.genero !== cd.genero.toUpperCase()){ cd.genero = cd.genero.toUpperCase(); total++; }
      if (cd.catalogo && cd.catalogo !== cd.catalogo.toUpperCase()){ cd.catalogo = cd.catalogo.toUpperCase(); total++; }
      if (cd.edicion && cd.edicion !== cd.edicion.toUpperCase()){ cd.edicion = cd.edicion.toUpperCase(); total++; }
      if (cd.pais && cd.pais !== cd.pais.toUpperCase()){ cd.pais = cd.pais.toUpperCase(); total++; }
      if (cd.ubicacion && cd.ubicacion !== cd.ubicacion.toUpperCase()){ cd.ubicacion = cd.ubicacion.toUpperCase(); total++; }
      if (cd.prestadoA && cd.prestadoA !== cd.prestadoA.toUpperCase()){ cd.prestadoA = cd.prestadoA.toUpperCase(); total++; }
      if (cd.notasPrestamo && cd.notasPrestamo !== cd.notasPrestamo.toUpperCase()){ cd.notasPrestamo = cd.notasPrestamo.toUpperCase(); total++; }
    }
  }

  if (total > 0){
    try { localStorage.setItem('discografia_db_v3_BACKUP_' + Date.now(), snapshot); } catch(e){}
    Store.persist();
    console.log(`%c✅ ${total} correcciones automáticas aplicadas`, "color:#5ddc9a;font-weight:bold;font-size:14px");
  } else {
    console.log('%cℹ️ Corrector: nada que cambiar.', "color:#8b97a8");
  }
  return total;
}

async function init(){
  App.q = ""; App.artista = null; App.subcat = null;
  App.filters = { estado: "", formato: "", anioDesde: "", anioHasta: "", ubicacion: "", portada: "", prestamo: "" };
  Store.load();

  const corrected = runLegacyCorrector();
  if (corrected > 0) setTimeout(() => Toast.show(`✅ ${corrected} correcciones aplicadas automáticamente`, "ok", 4000), 800);

  NotFoundList.load();
  OwnerConfig.load();
  MetadataCache.load();
  CustomFields.load();
  HistoryLog.load();
  OwnerConfig.render();
  MB_USER_AGENT = buildMBUserAgent();
  ensureValidCat();
  renderTabs(); renderAll(); bindEvents();
  Undo.updateBadge();
  AutoBackup.syncToggle(); AutoBackup.updateBadge();
  try { await FileSystemDefault.load(); FileSystemDefault.refreshBadge(); } catch(e){ console.warn("Folder load:", e); }
  console.log(`%c💿 Discografía v${APP_VERSION} — ${DEFAULT_AUTHOR} · ${DEFAULT_PHONE}`, "color:#4fc3f7;font-weight:bold;font-size:15px");
  console.log(`%c   Modo carpeta: ${FileSystemDefault.getMode()}`, "color:#8b97a8");
  if (!getDiscogsToken()) setTimeout(() => Toast.show("💡 Sin token de Discogs. Menú ⚙️ → 🎚️ Configurar Discogs.", "info", 8000), 1500);
  await initV6();
  if (Store.isEmpty) Toast.show("Base vacía. Creá tu primera categoría con Ctrl+K 📁", "warn", 6000);
  maybeShowLegalOnFirstRun();
}

init();