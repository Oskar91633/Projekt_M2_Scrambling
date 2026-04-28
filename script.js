/**
 * Projekt M-II — Chaotyczne przekształcanie obrazu cyfrowego
 * script.js
 *
 * Etap 1 — Naiwny scrambling (przesunięcie wierszy/kolumn)
 * Etap 2 — Czysta permutacja Fisher-Yates sterowana seedem
 * Etap 3 — Hybryda: substytucja XOR (mapa logistyczna) + permutacja
 */

'use strict';

// ============================================================
// GLOBAL STATE
// ============================================================
const IMG_W = 128;
const IMG_H = 128;

let origData = null;          // ImageData oryginału
const wrongKey = { 1: false, 2: false, 3: false };
const metrics  = {};          // wyniki metryk do analizy


// ============================================================
// NAVIGATION
// ============================================================
function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById('nav-' + id).classList.add('active');
}

function toggleWrong(stage) {
  wrongKey[stage] = !wrongKey[stage];
  const el = document.getElementById('e' + stage + 'wrongToggle');
  el.classList.toggle('on', wrongKey[stage]);
}


// ============================================================
// SEEDED PRNG — Mulberry32
// Deterministyczny PRNG; te same seedy → te same wyniki.
// ============================================================
function seededRng(seed) {
  let s = (seed >>> 0) + 1;
  return function () {
    s |= 0;
    s  = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


// ============================================================
// FISHER-YATES PERMUTATION
// Generuje bijekcję P : {0…n-1} → {0…n-1}
// ============================================================
function fisherYates(n, rng) {
  const p = new Int32Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  return p;
}

// Funkcja odwrotna P⁻¹ : inv[P[i]] = i
function inversePerm(p) {
  const inv = new Int32Array(p.length);
  for (let i = 0; i < p.length; i++) inv[p[i]] = i;
  return inv;
}


// ============================================================
// LOGISTIC MAP  x_{n+1} = r * x_n * (1 - x_n)
// Obszar chaosu: r ∈ (3.57, 4.0]
// Burn-in: 500 iteracji (eliminacja efektu warunków startowych)
// ============================================================
function logisticSeq(r, x0, n) {
  const seq = new Float64Array(n);
  let x = x0;
  for (let i = 0; i < 500; i++) x = r * x * (1 - x);   // burn-in
  for (let i = 0; i < n;   i++) { x = r * x * (1 - x); seq[i] = x; }
  return seq;
}


// ============================================================
// XOR SUBSTITUTION  f(p, k)
// Funkcja odwrotna: f⁻¹ = f (XOR jest własną odwrotnością)
// ============================================================
function applyXOR(data, logSeq, N) {
  for (let i = 0; i < N; i++) {
    const idx = i * 4;
    const key = Math.floor(logSeq[i] * 256) & 0xFF;
    data[idx]     = data[idx]     ^ key;
    data[idx + 1] = data[idx + 1] ^ ((key * 131 + 17) & 0xFF);
    data[idx + 2] = data[idx + 2] ^ ((key *  67 + 53) & 0xFF);
  }
}


// ============================================================
// METRICS
// ============================================================

/** Korelacja sąsiednich pikseli (pozioma) */
function correlation(d, w, h) {
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4, j = i + 4;
      const xi = (d[i] + d[i + 1] + d[i + 2]) / 3;
      const yi = (d[j] + d[j + 1] + d[j + 2]) / 3;
      sx += xi; sy += yi; sxy += xi * yi; sx2 += xi * xi; sy2 += yi * yi; n++;
    }
  }
  const cov = sxy / n - (sx / n) * (sy / n);
  const vx  = sx2 / n - (sx / n) ** 2;
  const vy  = sy2 / n - (sy / n) ** 2;
  if (vx <= 0 || vy <= 0) return 0;
  return Math.max(-1, Math.min(1, cov / Math.sqrt(vx * vy)));
}

/** Entropia Shannona (bit/piksel) */
function entropy(d, n) {
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) {
    hist[Math.floor((d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3)]++;
  }
  let H = 0;
  for (let v = 0; v < 256; v++) {
    if (hist[v] > 0) { const p = hist[v] / n; H -= p * Math.log2(p); }
  }
  return H;
}

/** Mean Absolute Error między dwoma obrazami */
function mae(a, b, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += Math.abs(a[i * 4]     - b[i * 4])
       + Math.abs(a[i * 4 + 1] - b[i * 4 + 1])
       + Math.abs(a[i * 4 + 2] - b[i * 4 + 2]);
  }
  return s / (n * 3);
}


// ============================================================
// CANVAS HELPERS
// ============================================================
function putImage(id, imgData, phId) {
  const cv = document.getElementById(id);
  cv.width  = imgData.width;
  cv.height = imgData.height;
  cv.getContext('2d').putImageData(imgData, 0, 0);
  cv.style.display = 'block';
  if (phId) {
    const ph = document.getElementById(phId);
    if (ph) ph.style.display = 'none';
  }
}

function getImage(id) {
  const cv = document.getElementById(id);
  if (!cv || !cv.width) return null;
  return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
}

function saveCanvas(id) {
  const cv = document.getElementById(id);
  if (!cv || !cv.width) return;
  const a = document.createElement('a');
  a.download = id + '_' + Date.now() + '.png';
  a.href = cv.toDataURL('image/png');
  a.click();
}

function newImg(w, h) { return new ImageData(w, h); }


// ============================================================
// LOG
// ============================================================
function log(logId, msg, type = 'info') {
  const el = document.getElementById(logId);
  if (!el) return;
  const d = document.createElement('div');
  d.className  = 'log-entry log-' + type;
  d.textContent = '[' + new Date().toLocaleTimeString('pl') + '] ' + msg;
  el.insertBefore(d, el.firstChild);
}


// ============================================================
// METRIC DISPLAY
// ============================================================
function setMetric(id, val, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.className   = 'metric-val' + (cls ? ' ' + cls : '');
}


// ============================================================
// IMAGE LOADING & SYNC
// ============================================================
function syncOrig() {
  if (!origData) return;
  ['e1Orig', 'e2Orig', 'e3Orig'].forEach((cvId, i) => {
    putImage(cvId, origData, ['e1OrigPh', 'e2OrigPh', 'e3OrigPh'][i]);
  });
  const N    = IMG_W * IMG_H;
  const corr = correlation(origData.data, IMG_W, IMG_H);
  const ent  = entropy(origData.data, N);
  document.getElementById('stat-size').textContent    = IMG_W + '×' + IMG_H;
  document.getElementById('stat-pixels').textContent  = N.toLocaleString();
  document.getElementById('stat-entropy').textContent = ent.toFixed(3) + ' bit';
  document.getElementById('stat-corr').textContent    = corr.toFixed(3);
  metrics.origCorr = corr;
  metrics.origEnt  = ent;
}

function loadImageFromSrc(src) {
  const img = new Image();
  img.onload = () => {
    const c   = document.createElement('canvas');
    c.width   = IMG_W;
    c.height  = IMG_H;
    c.getContext('2d').drawImage(img, 0, 0, IMG_W, IMG_H);
    origData  = c.getContext('2d').getImageData(0, 0, IMG_W, IMG_H);
    syncOrig();
    document.getElementById('uploadSub').textContent = 'Załadowano ✓';
    document.getElementById('uploadZone').classList.add('has-image');
    log('e1log', 'Obraz załadowany: ' + IMG_W + '×' + IMG_H, 'ok');
  };
  img.src = src;
}

// File input
document.getElementById('fileInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => loadImageFromSrc(ev.target.result);
  r.readAsDataURL(f);
});

// Drag & drop
document.getElementById('uploadZone').addEventListener('dragover', e => e.preventDefault());
document.getElementById('uploadZone').addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => loadImageFromSrc(ev.target.result);
  r.readAsDataURL(f);
});


// ============================================================
// SAMPLE IMAGE GENERATORS
// ============================================================
function applyRaw(fn) {
  const id = new ImageData(IMG_W, IMG_H);
  fn(id.data, IMG_W, IMG_H);
  origData = id;
  syncOrig();
  document.getElementById('uploadZone').classList.add('has-image');
  document.getElementById('uploadSub').textContent = 'Próbka załadowana ✓';
}

function genChessboard() {
  applyRaw((d, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 255;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
  });
  log('e1log', 'Załadowano: szachownica 8×8 (silna struktura periodyczna)', 'ok');
}

function genGradient() {
  applyRaw((d, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i]     = Math.floor(x * 2);
      d[i + 1] = Math.floor(y * 2);
      d[i + 2] = Math.floor(128 + 127 * Math.sin(x * 0.15));
      d[i + 3] = 255;
    }
  });
  log('e1log', 'Załadowano: gradient kolorowy (gładkie przejścia, wysoka korelacja)', 'ok');
}

function genText() {
  applyRaw((d, w, h) => {
    const c   = document.createElement('canvas');
    c.width   = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000'; ctx.font = 'bold 11px monospace';
    ['KLUCZ:', 'K1=47', 'K2=83', 'ETAP1', 'SHIFT', 'CYCL'].forEach((t, i) => {
      ctx.fillText(t, 4, 14 + i * 14);
    });
    ctx.fillStyle = '#222'; ctx.font = '9px monospace';
    for (let i = 0; i < 10; i++) ctx.fillText('█░█░█░█░█░█░█░', 0, 90 + i * 5);
    const id2 = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.length; i++) d[i] = id2.data[i];
  });
  log('e1log', 'Załadowano: obraz tekstowy (silna struktura pozioma/pionowa)', 'ok');
}

function genNatural() {
  applyRaw((d, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i  = (y * w + x) * 4;
      const nx = x / w, ny = y / h;
      d[i]     = Math.floor(100 + 80 * Math.sin(nx * 7.3)  * Math.cos(ny * 5.1) + 40 * Math.sin((nx + ny) * 11));
      d[i + 1] = Math.floor(80  + 60 * Math.cos(nx * 4.7 + 1.2) * Math.sin(ny * 8.3));
      d[i + 2] = Math.floor(160 - 70 * Math.sin(ny * 9.1 + nx * 3.4));
      d[i + 3] = 255;
    }
  });
  log('e1log', 'Załadowano: obraz naturalny (gładkie przejścia, wysoka korelacja przestrzenna)', 'ok');
}


// ============================================================
// STAGE 1 — NAIWNY SCRAMBLING
// Scrambling:   dst[(y+k1)%H][(x+k2)%W] = src[y][x]
// Unscrambling: dst[(y-k1+H)%H][(x-k2+W)%W] = scrambled[y][x]
// ============================================================
function e1Scramble() {
  if (!origData) { log('e1log', 'Błąd: Wczytaj obraz!', 'err'); return; }
  let k1 = parseInt(document.getElementById('e1k1').value);
  let k2 = parseInt(document.getElementById('e1k2').value);
  if (wrongKey[1]) { k1++; k2++; }

  const src = origData.data;
  const out = newImg(IMG_W, IMG_H);
  const d   = out.data;
  const W   = IMG_W, H = IMG_H;

  for (let y = 0; y < H; y++) {
    const ny = ((y + k1) % H + H) % H;
    for (let x = 0; x < W; x++) {
      const nx = ((x + k2) % W + W) % W;
      const si = (y * W + x) * 4;
      const di = (ny * W + nx) * 4;
      d[di] = src[si]; d[di + 1] = src[si + 1]; d[di + 2] = src[si + 2]; d[di + 3] = 255;
    }
  }

  putImage('e1Scrambled', out, 'e1ScrPh');
  const corr = correlation(d, W, H);
  const ent  = entropy(d, W * H);
  metrics.e1Corr = corr; metrics.e1Ent = ent;

  setMetric('e1mCorr',   corr.toFixed(3), corr > 0.3 ? 'warn' : 'good');
  setMetric('e1mEnt',    ent.toFixed(2) + ' bit');
  setMetric('e1mDiff',   '—');
  setMetric('e1mPerfect','—');
  log('e1log', `Scramble | k1=${k1}, k2=${k2} | corr=${corr.toFixed(3)} | ent=${ent.toFixed(2)}`, 'ok');
}

function e1Unscramble() {
  const scrData = getImage('e1Scrambled');
  if (!scrData) { log('e1log', 'Błąd: Najpierw wykonaj Scramble!', 'err'); return; }
  const k1 = parseInt(document.getElementById('e1k1').value);
  const k2 = parseInt(document.getElementById('e1k2').value);

  const src = scrData.data;
  const out = newImg(IMG_W, IMG_H);
  const d   = out.data;
  const W   = IMG_W, H = IMG_H;

  for (let y = 0; y < H; y++) {
    const oy = ((y - k1) % H + H) % H;
    for (let x = 0; x < W; x++) {
      const ox = ((x - k2) % W + W) % W;
      const si = (y * W + x) * 4;
      const di = (oy * W + ox) * 4;
      d[di] = src[si]; d[di + 1] = src[si + 1]; d[di + 2] = src[si + 2]; d[di + 3] = 255;
    }
  }

  putImage('e1Restored', out, 'e1ResPh');
  const diff    = mae(origData.data, d, W * H);
  const perfect = diff < 0.5;
  metrics.e1Diff = diff;

  setMetric('e1mDiff',    diff.toFixed(2),                   perfect ? 'good' : 'bad');
  setMetric('e1mPerfect', perfect ? 'IDEALNE ✓' : 'BŁĄD ✗', perfect ? 'good' : 'bad');
  log('e1log', `Unscramble | MAE=${diff.toFixed(3)} | ${perfect ? 'Odtworzono idealnie' : 'BŁĘDNY KLUCZ'}`, perfect ? 'ok' : 'err');
}


// ============================================================
// STAGE 2 — FISHER-YATES PERMUTATION
// P : {0…N-1} → {0…N-1}  (bijekcja sterowana seedem)
// P⁻¹ : inv[P[i]] = i     (jawna funkcja odwrotna)
// ============================================================
function _e2applyPerm(src, mode, seed) {
  const W = IMG_W, H = IMG_H, N = W * H;
  const out = new Uint8ClampedArray(src);
  const rng = seededRng(seed);

  if (mode === 'pixels') {
    const perm = fisherYates(N, rng);
    const tmp  = new Uint8ClampedArray(src);
    for (let i = 0; i < N; i++) {
      const si = i * 4, di = perm[i] * 4;
      out[di] = tmp[si]; out[di + 1] = tmp[si + 1]; out[di + 2] = tmp[si + 2]; out[di + 3] = 255;
    }
  } else if (mode === 'rows') {
    const perm = fisherYates(H, rng);
    const tmp  = new Uint8ClampedArray(src);
    for (let y = 0; y < H; y++) {
      const ny = perm[y];
      for (let x = 0; x < W; x++) {
        const si = (y * W + x) * 4, di = (ny * W + x) * 4;
        out[di] = tmp[si]; out[di + 1] = tmp[si + 1]; out[di + 2] = tmp[si + 2]; out[di + 3] = 255;
      }
    }
  } else if (mode === 'cols') {
    const perm = fisherYates(W, rng);
    const tmp  = new Uint8ClampedArray(src);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4, di = (y * W + perm[x]) * 4;
      out[di] = tmp[si]; out[di + 1] = tmp[si + 1]; out[di + 2] = tmp[si + 2]; out[di + 3] = 255;
    }
  } else { // blocks 8×8
    const bs = 8, bw = Math.floor(W / bs), bh = Math.floor(H / bs);
    const NB = bw * bh, perm = fisherYates(NB, rng);
    const tmp = new Uint8ClampedArray(src);
    for (let b = 0; b < NB; b++) {
      const by = Math.floor(b / bw),    bx = b % bw;
      const ny = Math.floor(perm[b] / bw), nx = perm[b] % bw;
      for (let dy = 0; dy < bs; dy++) for (let dx = 0; dx < bs; dx++) {
        const si = ((by * bs + dy) * W + (bx * bs + dx)) * 4;
        const di = ((ny * bs + dy) * W + (nx * bs + dx)) * 4;
        out[di] = tmp[si]; out[di + 1] = tmp[si + 1]; out[di + 2] = tmp[si + 2]; out[di + 3] = 255;
      }
    }
    // copy leftover pixels (outside full-block area)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x >= bw * bs || y >= bh * bs) {
        const i = (y * W + x) * 4;
        out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; out[i + 3] = 255;
      }
    }
  }
  return out;
}

function _e2applyInvPerm(src, mode, seed) {
  const W = IMG_W, H = IMG_H, N = W * H;
  const out = new Uint8ClampedArray(src);
  const rng = seededRng(seed);

  if (mode === 'pixels') {
    const perm = fisherYates(N, rng);
    const inv  = inversePerm(perm);
    const tmp  = new Uint8ClampedArray(src);
    for (let i = 0; i < N; i++) {
      const si = i * 4, di = inv[i] * 4;
      out[di] = tmp[si]; out[di + 1] = tmp[si + 1]; out[di + 2] = tmp[si + 2]; out[di + 3] = 255;
    }
  } else if (mode === 'rows') {
    const perm = fisherYates(H, rng);
    const inv  = inversePerm(perm);
    const tmp  = new Uint8ClampedArray(src);
    for (let y = 0; y < H; y++) {
      const oy = inv[y];
      for (let x = 0; x < W; x++) {
        const si = (y * W + x) * 4, di = (oy * W + x) * 4;
        out[di] = tmp[si]; out[di + 1] = tmp[si + 1]; out[di + 2] = tmp[si + 2]; out[di + 3] = 255;
      }
    }
  } else if (mode === 'cols') {
    const perm = fisherYates(W, rng);
    const inv  = inversePerm(perm);
    const tmp  = new Uint8ClampedArray(src);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4, di = (y * W + inv[x]) * 4;
      out[di] = tmp[si]; out[di + 1] = tmp[si + 1]; out[di + 2] = tmp[si + 2]; out[di + 3] = 255;
    }
  } else {
    const bs = 8, bw = Math.floor(W / bs), bh = Math.floor(H / bs);
    const NB = bw * bh, perm = fisherYates(NB, rng), inv = inversePerm(perm);
    const tmp = new Uint8ClampedArray(src);
    for (let b = 0; b < NB; b++) {
      const by = Math.floor(b / bw),    bx = b % bw;
      const oy = Math.floor(inv[b] / bw), ox = inv[b] % bw;
      for (let dy = 0; dy < bs; dy++) for (let dx = 0; dx < bs; dx++) {
        const si = ((by * bs + dy) * W + (bx * bs + dx)) * 4;
        const di = ((oy * bs + dy) * W + (ox * bs + dx)) * 4;
        out[di] = tmp[si]; out[di + 1] = tmp[si + 1]; out[di + 2] = tmp[si + 2]; out[di + 3] = 255;
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x >= bw * bs || y >= bh * bs) {
        const i = (y * W + x) * 4;
        out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; out[i + 3] = 255;
      }
    }
  }
  return out;
}

function e2Scramble() {
  if (!origData) { log('e2log', 'Błąd: Wczytaj obraz!', 'err'); return; }
  let seed = parseInt(document.getElementById('e2seed').value);
  if (wrongKey[2]) seed++;
  const mode = document.getElementById('e2mode').value;

  const result = _e2applyPerm(origData.data, mode, seed);
  const imgOut = new ImageData(result, IMG_W, IMG_H);
  putImage('e2Scrambled', imgOut, 'e2ScrPh');

  const corr = correlation(result, IMG_W, IMG_H);
  const ent  = entropy(result, IMG_W * IMG_H);
  metrics.e2Corr = corr; metrics.e2Ent = ent;

  setMetric('e2mCorr',    corr.toFixed(3), Math.abs(corr) < 0.05 ? 'good' : 'warn');
  setMetric('e2mEnt',     ent.toFixed(2) + ' bit');
  setMetric('e2mDiff',    '—');
  setMetric('e2mPerfect', '—');
  log('e2log', `Permutacja | seed=${seed}, tryb=${mode} | corr=${corr.toFixed(3)} | ent=${ent.toFixed(2)}`, 'ok');
}

function e2Unscramble() {
  const scrData = getImage('e2Scrambled');
  if (!scrData) { log('e2log', 'Błąd: Najpierw wykonaj Scramble!', 'err'); return; }
  let seed = parseInt(document.getElementById('e2seed').value);
  if (wrongKey[2]) seed++;
  const mode = document.getElementById('e2mode').value;

  const result = _e2applyInvPerm(scrData.data, mode, seed);
  const imgOut = new ImageData(result, IMG_W, IMG_H);
  putImage('e2Restored', imgOut, 'e2ResPh');

  const diff    = mae(origData.data, result, IMG_W * IMG_H);
  const perfect = diff < 0.5;
  metrics.e2Diff = diff;

  setMetric('e2mDiff',    diff.toFixed(2),                              perfect ? 'good' : 'bad');
  setMetric('e2mPerfect', perfect ? 'P⁻¹(P(i))=i ✓' : 'BŁĄD ✗',       perfect ? 'good' : 'bad');
  log('e2log', `Unscramble | MAE=${diff.toFixed(3)} | ${perfect ? 'P⁻¹(P(i))=i potwierdzone' : 'BŁĘDNY SEED'}`, perfect ? 'ok' : 'err');
}


// ============================================================
// STAGE 3 — HYBRID: SUBSTYTUCJA XOR + PERMUTACJA
// Scramble:   f(p,k)  → P
// Unscramble: P⁻¹     → f⁻¹(p,k) = f(p,k)  (XOR odwracalny)
// ============================================================
function e3Scramble() {
  if (!origData) { log('e3log', 'Błąd: Wczytaj obraz!', 'err'); return; }
  let seed = parseInt(document.getElementById('e3seed').value);
  const r  = parseFloat(document.getElementById('e3r').value);
  let x0   = parseFloat(document.getElementById('e3x0').value);
  if (wrongKey[3]) { seed++; x0 = Math.min(0.999, x0 + 0.001); }
  const mode = document.getElementById('e3mode').value;
  const N    = IMG_W * IMG_H;

  let buf = new Uint8ClampedArray(origData.data);

  // Krok 1: substytucja XOR sekwencją logistyczną
  if (mode === 'hybrid' || mode === 'subst_only') {
    const seq = logisticSeq(r, x0, N);
    applyXOR(buf, seq, N);
  }

  // Krok 2: permutacja Fisher-Yates
  if (mode === 'hybrid' || mode === 'perm_only') {
    const perm = fisherYates(N, seededRng(seed));
    const tmp  = new Uint8ClampedArray(buf);
    for (let i = 0; i < N; i++) {
      const si = i * 4, di = perm[i] * 4;
      buf[di] = tmp[si]; buf[di + 1] = tmp[si + 1]; buf[di + 2] = tmp[si + 2]; buf[di + 3] = 255;
    }
  } else {
    for (let i = 0; i < N; i++) buf[i * 4 + 3] = 255;
  }

  const imgOut = new ImageData(buf, IMG_W, IMG_H);
  putImage('e3Scrambled', imgOut, 'e3ScrPh');

  const corr = correlation(buf, IMG_W, IMG_H);
  const ent  = entropy(buf, N);
  metrics.e3Corr = corr; metrics.e3Ent = ent;

  setMetric('e3mCorr',    corr.toFixed(3), Math.abs(corr) < 0.05 ? 'good' : 'warn');
  setMetric('e3mEnt',     ent.toFixed(2) + ' bit', ent > 7.5 ? 'good' : 'warn');
  setMetric('e3mDiff',    '—');
  setMetric('e3mPerfect', '—');
  log('e3log', `Scramble | r=${r}, x0=${x0.toFixed(4)}, seed=${seed} | corr=${corr.toFixed(3)} | ent=${ent.toFixed(2)}`, 'ok');
}

function e3Unscramble() {
  const scrData = getImage('e3Scrambled');
  if (!scrData) { log('e3log', 'Błąd: Najpierw wykonaj Scramble!', 'err'); return; }
  let seed = parseInt(document.getElementById('e3seed').value);
  const r  = parseFloat(document.getElementById('e3r').value);
  let x0   = parseFloat(document.getElementById('e3x0').value);
  if (wrongKey[3]) { seed++; x0 = Math.min(0.999, x0 + 0.001); }
  const mode = document.getElementById('e3mode').value;
  const N    = IMG_W * IMG_H;

  let buf = new Uint8ClampedArray(scrData.data);

  // Krok 1: odwrotna permutacja P⁻¹
  if (mode === 'hybrid' || mode === 'perm_only') {
    const perm = fisherYates(N, seededRng(seed));
    const inv  = inversePerm(perm);
    const tmp  = new Uint8ClampedArray(buf);
    for (let i = 0; i < N; i++) {
      const si = i * 4, di = inv[i] * 4;
      buf[di] = tmp[si]; buf[di + 1] = tmp[si + 1]; buf[di + 2] = tmp[si + 2]; buf[di + 3] = 255;
    }
  }

  // Krok 2: odwrotna substytucja f⁻¹ = f (XOR jest własną odwrotnością)
  if (mode === 'hybrid' || mode === 'subst_only') {
    const seq = logisticSeq(r, x0, N);
    applyXOR(buf, seq, N);
  }

  for (let i = 0; i < N; i++) buf[i * 4 + 3] = 255;

  const imgOut = new ImageData(buf, IMG_W, IMG_H);
  putImage('e3Restored', imgOut, 'e3ResPh');

  const diff    = mae(origData.data, buf, N);
  const perfect = diff < 0.5;
  metrics.e3Diff = diff;

  setMetric('e3mDiff',    diff.toFixed(2),                   perfect ? 'good' : 'bad');
  setMetric('e3mPerfect', perfect ? 'IDEALNE ✓' : 'BŁĄD ✗', perfect ? 'good' : 'bad');
  log('e3log', `Unscramble | MAE=${diff.toFixed(3)} | ${perfect ? 'Odtworzono idealnie' : 'BŁĘDNY KLUCZ — chaos rozbieżny'}`, perfect ? 'ok' : 'err');
}


// ============================================================
// FULL ANALYSIS
// ============================================================
function runFullAnalysis() {
  if (!origData) { log('analysisLog', 'Błąd: Wczytaj obraz!', 'err'); return; }
  log('analysisLog', 'Uruchamiam pełną analizę...', 'info');

  // --- Correct-key pass ---
  const savedWrong = { ...wrongKey };
  wrongKey[1] = false; wrongKey[2] = false; wrongKey[3] = false;
  e1Scramble(); e2Scramble(); e3Scramble();

  setTimeout(() => {
    const corrOrig = metrics.origCorr || 0;
    const corrE1   = metrics.e1Corr   || 0;
    const corrE2   = metrics.e2Corr   || 0;
    const corrE3   = metrics.e3Corr   || 0;
    const maxCorr  = Math.max(Math.abs(corrOrig), 0.01);

    function setBar(valId, fillId, val, max) {
      const el = document.getElementById(valId);
      const bf = document.getElementById(fillId);
      if (el) el.textContent = val.toFixed(3);
      if (bf) bf.style.width = Math.min(100, Math.abs(val) / max * 100).toFixed(1) + '%';
    }
    setBar('bc_orig', 'bf_orig', corrOrig, maxCorr);
    setBar('bc_e1',   'bf_e1',   corrE1,   maxCorr);
    setBar('bc_e2',   'bf_e2',   corrE2,   maxCorr);
    setBar('bc_e3',   'bf_e3',   corrE3,   maxCorr);

    function setTd(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
    setTd('ct_e1_corr', corrE1.toFixed(3));
    setTd('ct_e1_ent',  (metrics.e1Ent || 0).toFixed(2) + ' bit');
    setTd('ct_e2_corr', corrE2.toFixed(3));
    setTd('ct_e2_ent',  (metrics.e2Ent || 0).toFixed(2) + ' bit');
    setTd('ct_e3_corr', corrE3.toFixed(3));
    setTd('ct_e3_ent',  (metrics.e3Ent || 0).toFixed(2) + ' bit');

    // --- Wrong-key pass ---
    wrongKey[1] = true; wrongKey[2] = true; wrongKey[3] = true;
    e1Scramble(); e2Scramble(); e3Scramble();

    setTimeout(() => {
      e1Unscramble(); e2Unscramble(); e3Unscramble();

      setTimeout(() => {
        const errE1 = metrics.e1Diff || 0;
        const errE2 = metrics.e2Diff || 0;
        const errE3 = metrics.e3Diff || 0;
        const maxErr = Math.max(errE1, errE2, errE3, 1);

        function setErrBar(valId, fillId, val, max) {
          const el = document.getElementById(valId);
          const bf = document.getElementById(fillId);
          if (el) el.textContent = val.toFixed(2);
          if (bf) bf.style.width = Math.min(100, val / max * 100).toFixed(1) + '%';
        }
        setErrBar('be_e1', 'bef_e1', errE1, maxErr);
        setErrBar('be_e2', 'bef_e2', errE2, maxErr);
        setErrBar('be_e3', 'bef_e3', errE3, maxErr);

        setTd('ct_e1_err', errE1.toFixed(2));
        setTd('ct_e2_err', errE2.toFixed(2));
        setTd('ct_e3_err', errE3.toFixed(2));

        // Draw visual diff canvases
        drawDiffCanvas('e1Restored', 'diffE1');
        drawDiffCanvas('e3Restored', 'diffE3');

        // Restore correct keys
        wrongKey[1] = false; wrongKey[2] = false; wrongKey[3] = false;
        ['e1wrongToggle', 'e2wrongToggle', 'e3wrongToggle'].forEach(id => {
          document.getElementById(id).classList.remove('on');
        });
        e1Scramble(); e2Scramble(); e3Scramble();
        e1Unscramble(); e2Unscramble(); e3Unscramble();

        log('analysisLog',
          `Analiza zakończona | orig_corr=${corrOrig.toFixed(3)} | E1=${corrE1.toFixed(3)} | E2=${corrE2.toFixed(3)} | E3=${corrE3.toFixed(3)}`,
          'ok');
      }, 50);
    }, 50);
  }, 50);
}

/** Rysuje mapę różnic (piksel po pikselu) między oryginałem a odtworzonym obrazem */
function drawDiffCanvas(srcId, dstId) {
  if (!origData) return;
  const srcCv = document.getElementById(srcId);
  if (!srcCv || !srcCv.width) return;

  const srcD  = srcCv.getContext('2d').getImageData(0, 0, IMG_W, IMG_H);
  const dstCv = document.getElementById(dstId);
  dstCv.width = IMG_W; dstCv.height = IMG_H;

  const ctx = dstCv.getContext('2d');
  const out = ctx.createImageData(IMG_W, IMG_H);

  for (let i = 0; i < IMG_W * IMG_H; i++) {
    const diff = Math.abs(origData.data[i * 4] - srcD.data[i * 4]) * 3;
    out.data[i * 4]     = Math.min(255, diff);
    out.data[i * 4 + 1] = Math.min(255, diff / 2);
    out.data[i * 4 + 2] = 0;
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  dstCv.style.width = '100%';
}


// ============================================================
// INIT — załaduj domyślny obraz
// ============================================================
genNatural();
