/* Авто-план: из изображения (чертёж, скан, фото плана) получаем залы и коридоры на сетке карты. */
const AutoPlan = (() => {
  const PPC = 24; // пикселей рабочего изображения на клетку

  // квадратное расширение маски на r пикселей (разделимое, через префиксные суммы)
  function dil(m, w, h, r) {
    const t = new Uint8Array(w * h), o = new Uint8Array(w * h), cs = new Int32Array(Math.max(w, h) + 1);
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) cs[x + 1] = cs[x] + m[y * w + x]; for (let x = 0; x < w; x++) t[y * w + x] = cs[Math.min(w, x + r + 1)] - cs[Math.max(0, x - r)] > 0 ? 1 : 0; }
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) cs[y + 1] = cs[y] + t[y * w + x]; for (let y = 0; y < h; y++) o[y * w + x] = cs[Math.min(h, y + r + 1)] - cs[Math.max(0, y - r)] > 0 ? 1 : 0; }
    return o;
  }
  const inv = m => m.map(v => v ? 0 : 1);

  // заливка из всех граничных пикселей маски open (1 = можно идти)
  function floodBorder(open, w, h) {
    const seen = new Uint8Array(w * h), q = new Int32Array(w * h); let a = 0, b = 0;
    const push = i => { if (open[i] && !seen[i]) { seen[i] = 1; q[b++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (a < b) { const i = q[a++], x = i % w, y = (i / w) | 0; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w); }
    return seen;
  }

  // gray: Uint8 W*H (сетка GW×GH клеток по PPC пикселей); inner: прямоугольник изображения (остальное — белые поля)
  function run(gray, W, H, GW, GH) {
    const n = W * H, hist = new Float64Array(256);
    for (let i = 0; i < n; i++) hist[gray[i]]++;
    // фон: тёмный (светлые линии на синьке) — инвертируем
    let ring = 0, rc = 0; for (let x = 0; x < W; x++) { ring += gray[x] + gray[(H - 1) * W + x]; rc += 2; }
    for (let y = 0; y < H; y++) { ring += gray[y * W] + gray[y * W + W - 1]; rc += 2; }
    const g = ring / rc < 110 ? gray.map(v => 255 - v) : gray;
    const hh = new Float64Array(256); for (let i = 0; i < n; i++) hh[g[i]]++;
    // Оцу + «уровень фона» (медиана), чтобы тонкие бледные линии тоже считались стенами
    let tot = 0, sum = 0; for (let i = 0; i < 256; i++) { tot += hh[i]; sum += i * hh[i]; }
    let wB = 0, sB = 0, best = 0, otsu = 128;
    for (let t = 0; t < 256; t++) { wB += hh[t]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += t * hh[t]; const d = sB / wB - (sum - sB) / wF, v = wB * wF * d * d; if (v > best) { best = v; otsu = t; } }
    let acc = 0, bg = 255; for (let i = 0; i < 256; i++) { acc += hh[i]; if (acc >= tot / 2) { bg = i; break; } }
    const thr = Math.max(40, bg - Math.max(35, (bg - otsu) * .6));
    const wall = new Uint8Array(n); let wc = 0; for (let i = 0; i < n; i++) if (g[i] < thr) { wall[i] = 1; wc++; }
    if (wc < n * .002) return { cor: [], rooms: [], note: 'стены не найдены' };

    // контур здания: закрываем проёмы расширением стен и отсекаем внешнюю область
    const ext = floodBorder(inv(dil(wall, W, H, Math.round(PPC * .5))), W, H), free = new Uint8Array(n);
    let fc = 0; for (let i = 0; i < n; i++) if (!ext[i] && !wall[i]) { free[i] = 1; fc++; }
    if (fc < n * .01) return { cor: [], rooms: [], note: 'контур здания не замкнут' };

    // «ядра» помещений: свободное место, из которого можно выбрать круг ≈ 0,55 клетки → двери разделяют комнаты
    const core = inv(dil(inv(free), W, H, Math.round(PPC * .55))), lab = new Int32Array(n), q = new Int32Array(n);
    let L = 0;
    for (let s = 0; s < n; s++) {
      if (!core[s] || lab[s]) continue;
      let a = 0, b = 0, area = 0; q[b++] = s; lab[s] = -1;
      const mem = [];
      while (a < b) { const i = q[a++], x = i % W; mem.push(i); area++;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < n - W ? i + W : -1]) if (j >= 0 && core[j] && !lab[j]) { lab[j] = -1; q[b++] = j; } }
      if (area < PPC * PPC * .3) { mem.forEach(i => lab[i] = 0); core[s] = 0; mem.forEach(i => core[i] = 0); continue; }
      L++; mem.forEach(i => lab[i] = L);
    }
    let note = '';
    if (!L) { // нет отдельных помещений: всё внутри контура — один проходимый объём
      for (let i = 0; i < n; i++) if (free[i]) lab[i] = 1; L = 1; note = 'отдельные помещения не выделились — проверьте и поправьте вручную';
    } else { // растим ядра по свободным пикселям (волной), пока не заполним всё
      let a = 0, b = 0; for (let i = 0; i < n; i++) if (lab[i] > 0) q[b++] = i;
      while (a < b) { const i = q[a++], x = i % W, l = lab[i];
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < n - W ? i + W : -1]) if (j >= 0 && free[j] && !lab[j]) { lab[j] = l; q[b++] = j; } }
    }

    // клетки сетки: проходимая, если большая часть клетки — свободное место; метка — преобладающее помещение
    const cells = [], per = {};
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      const cnt = {}; let f = 0;
      for (let y = cy * PPC; y < (cy + 1) * PPC; y++) for (let x = cx * PPC; x < (cx + 1) * PPC; x++) { const l = lab[y * W + x]; if (l > 0) { f++; cnt[l] = (cnt[l] || 0) + 1; } }
      if (f < PPC * PPC * .45) continue;
      let bl = 0, bn = 0; for (const l in cnt) if (cnt[l] > bn) { bn = cnt[l]; bl = +l; }
      (per[bl] = per[bl] || []).push([cx, cy]); cells.push([cx, cy]);
    }
    // прямоугольные помещения → «залы», всё остальное (коридоры, сложные формы) → коридорные клетки
    const rooms = [], cor = []; let k = 0;
    Object.values(per).sort((p, q2) => Math.min(...p.map(c => c[1])) - Math.min(...q2.map(c => c[1])) || Math.min(...p.map(c => c[0])) - Math.min(...q2.map(c => c[0]))).forEach(cs => {
      const x0 = Math.min(...cs.map(c => c[0])), x1 = Math.max(...cs.map(c => c[0])), y0 = Math.min(...cs.map(c => c[1])), y1 = Math.max(...cs.map(c => c[1])),
            bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (Math.min(bw, bh) >= 3 && cs.length / (bw * bh) >= .85) rooms.push({ id: 'r' + Math.random().toString(36).slice(2, 8), x: x0, y: y0, w: bw, h: bh, name: 'Помещение ' + (++k) });
      else cs.forEach(c => cor.push(c[0] + ',' + c[1]));
    });
    return { cor, rooms, note };
  }

  async function fromFile(file, GW, GH) {
    const src = window.createImageBitmap ? await createImageBitmap(file).catch(() => null) : null;
    const img = src || await new Promise((ok, no) => { const u = URL.createObjectURL(file), i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; });
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.min(GW / iw, GH / ih), gw = iw * k, gh = ih * k,
          W = GW * PPC, H = GH * PPC, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.imageSmoothingQuality = 'high';
    g.drawImage(img, (GW - gw) / 2 * PPC, (GH - gh) / 2 * PPC, gw * PPC, gh * PPC); // так же, как рисуется подложка: meet по центру
    const d = g.getImageData(0, 0, W, H).data, gray = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
    if (src && src.close) src.close();
    return run(gray, W, H, GW, GH);
  }
  return { run, fromFile, PPC };
})();
