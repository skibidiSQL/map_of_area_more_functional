/* Панорамы: подготовка файла (пропорции, GPano, качество) и сшивка кадров камеры в сферу. */
const Pano = (() => {
  const RAD = Math.PI / 180, MAXA = 16e6; // 16 Мпикс — безопасный предел canvas на iOS

  // Photo Sphere / Street View кладут в JPEG метаданные GPano: где в полной сфере лежит снимок
  async function gpano(file) {
    try {
      const t = new TextDecoder('latin1').decode(new Uint8Array(await file.slice(0, 262144).arrayBuffer()));
      const g = k => { const m = t.match(new RegExp('GPano:' + k + '(?:="|>)\\s*([\\d.]+)')); return m ? +m[1] : 0; };
      const fw = g('FullPanoWidthPixels'), fh = g('FullPanoHeightPixels');
      return fw && fh ? { fw, fh, cw: g('CroppedAreaImageWidthPixels') || fw, cl: g('CroppedAreaLeftPixels'), ct: g('CroppedAreaTopPixels') } : null;
    } catch { return null; }
  }
  const viaImg = f => new Promise((ok, no) => { const u = URL.createObjectURL(f), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => no(new Error('bad image')); i.src = u; });
  const bmp = f => window.createImageBitmap ? createImageBitmap(f).catch(() => viaImg(f)) : viaImg(f);
  const dims = o => [o.naturalWidth || o.width, o.naturalHeight || o.height];

  // ступенчатое уменьшение вдвое: без алиасинга и «лесенки» на линиях
  function down(src, sw, sh, tw, th) {
    let c = src, w = sw, h = sh;
    while (w / 2 >= tw && h / 2 >= th) {
      const n = document.createElement('canvas'); n.width = w = Math.ceil(w / 2); n.height = h = Math.ceil(h / 2);
      const g = n.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, w, h); c = n;
    }
    return [c, w, h];
  }

  // Приводит файл к equirectangular 2:1 в безопасном размере. Возвращает { blob, w, h } или null.
  async function prepare(file) {
    let src; try { src = await bmp(file); } catch { toast('Не удалось открыть изображение'); return null; }
    const [iw, ih] = dims(src), gp = await gpano(file), r = iw / ih, notes = [];
    let FW, FH, dx = 0, dy = 0;
    if (gp && Math.abs(gp.fw / gp.fh - 2) < .05) {
      const s = iw / gp.cw; FW = gp.fw * s; FH = gp.fh * s; dx = gp.cl * s; dy = gp.ct * s;
      if (ih < FH - 2) notes.push('сфера неполная — сверху и снизу пустое место');
    } else if (r >= 1.9 && r <= 2.1) { FW = iw; FH = ih; }
    else if (r > 2.1) { FW = iw; FH = iw / 2; dy = (FH - ih) / 2; notes.push('снимок шире 2:1 — добавлены поля сверху и снизу'); }
    else {
      if (!confirm('Это не панорама 360°: у снимка пропорции ' + r.toFixed(2) + ':1, а нужно 2:1. В просмотрщике он будет искажён. Загрузить всё равно?')) return null;
      FH = ih; FW = ih * 2; dx = (FW - iw) / 2;
    }
    const k = Math.min(1, 8192 / FW, Math.sqrt(MAXA / (FW * FH))), W = Math.round(FW * k) & ~1, H = W / 2,
          c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#2a2a2e'); gr.addColorStop(1, '#161618'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const tw = Math.round(iw * W / FW), th = Math.round(ih * H / FH), [s2, w2, h2] = down(src, iw, ih, tw, th);
    g.imageSmoothingQuality = 'high';
    g.drawImage(s2, 0, 0, w2, h2, Math.round(dx * W / FW), Math.round(dy * H / FH), tw, th);
    if (src.close) src.close();
    if (W < 3000) notes.push('низкое разрешение (' + W + ' px) — при увеличении будет мутно');
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', .9));
    if (!blob) { toast('Не удалось подготовить панораму'); return null; }
    if (notes.length) toast('Панорама: ' + notes.join('; '));
    return { blob, w: W, h: H, notes };
  }

  /* ---- геометрия камеры ---- */
  // (E,N,U) → система просмотрщика: x вправо/на восток, y вверх, −z — на север
  const conv = v => [v[0], v[2], -v[1]];
  // Углы deviceorientation (градусы, W3C: R = Rz(α)·Rx(β)·Ry(γ)) → оси камеры: вперёд, вправо, вверх
  function basis(alpha, beta, gamma) {
    const a = alpha * RAD, b = beta * RAD, g = gamma * RAD, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    const R = [[ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg], [sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg], [-cb * sg, sb, cb * cg]];
    return { f: conv([-R[0][2], -R[1][2], -R[2][2]]), r: conv([R[0][0], R[1][0], R[2][0]]), u: conv([R[0][1], R[1][1], R[2][1]]) };
  }
  const rotY = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], v[2] * Math.cos(a) - v[0] * Math.sin(a)];

  /* Сшивка: для каждого пикселя сферы берём кадры, в которые он попадает, и смешиваем с весом,
     который падает к краям кадра (мягкие швы). Идём полосами — мало памяти на телефоне.
     shots: [{ w, h, data(RGBA), f, r, u }] в системе, где yaw 0 = центр картинки. Возвращает RGBA W×W/2. */
  async function stitch(shots, W, fovLong, prog) {
    const H = W >> 1, out = new Uint8ClampedArray(W * H * 4), T = Math.tan(fovLong * RAD / 2);
    const S = shots.map(s => { const m = Math.max(s.w, s.h), tx = T * s.w / m, ty = T * s.h / m;
      return { ...s, tx, ty, hd: Math.atan(Math.hypot(tx, ty)), p: Math.asin(Math.max(-1, Math.min(1, s.f[1]))), y: Math.atan2(s.f[0], -s.f[2]) }; });
    const sT = new Float32Array(W), cT = new Float32Array(W);
    for (let x = 0; x < W; x++) { const t = ((x + .5) / W - .5) * 2 * Math.PI; sT[x] = Math.sin(t); cT[x] = Math.cos(t); }
    const BAND = 32;
    for (let y0 = 0; y0 < H; y0 += BAND) {
      const y1 = Math.min(H, y0 + BAND), acc = new Float32Array(W * (y1 - y0) * 4), pa = (.5 - y0 / H) * Math.PI, pb = (.5 - y1 / H) * Math.PI;
      for (const s of S) {
        if (s.p - s.hd > pa || s.p + s.hd < pb) continue;
        let xlo = 0, xhi = W - 1;
        if (Math.abs(s.p) + s.hd < Math.PI / 2 - .02) {
          const dth = Math.asin(Math.min(1, Math.sin(s.hd) / Math.cos(s.p)));
          xlo = Math.floor(((s.y - dth) / (2 * Math.PI) + .5) * W); xhi = Math.ceil(((s.y + dth) / (2 * Math.PI) + .5) * W);
          if (xhi - xlo >= W) { xlo = 0; xhi = W - 1; }
        }
        const [f0, f1, f2] = s.f, [r0, r1, r2] = s.r, [u0, u1, u2] = s.u, d = s.data, sw = s.w, sh = s.h;
        for (let y = y0; y < y1; y++) {
          const phi = (.5 - (y + .5) / H) * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
          for (let xi = xlo; xi <= xhi; xi++) {
            const x = ((xi % W) + W) % W, dx = sT[x] * cp, dz = -cT[x] * cp, zc = dx * f0 + sp * f1 + dz * f2;
            if (zc < .05) continue;
            const a = (dx * r0 + sp * r1 + dz * r2) / zc / s.tx, b = (dx * u0 + sp * u1 + dz * u2) / zc / s.ty;
            if (a < -1 || a > 1 || b < -1 || b > 1) continue;
            const wt = ((1 - Math.abs(a)) * (1 - Math.abs(b))) ** 2 + 1e-6,
                  px = (a + 1) / 2 * (sw - 1), py = (1 - b) / 2 * (sh - 1), ix = px | 0, iy = py | 0, fx = px - ix, fy = py - iy,
                  i0 = (iy * sw + ix) * 4, ox = ix + 1 < sw ? 4 : 0, oy = iy + 1 < sh ? sw * 4 : 0, o = ((y - y0) * W + x) * 4;
            for (let c = 0; c < 3; c++)
              acc[o + c] += ((d[i0 + c] * (1 - fx) + d[i0 + ox + c] * fx) * (1 - fy) + (d[i0 + oy + c] * (1 - fx) + d[i0 + oy + ox + c] * fx) * fy) * wt;
            acc[o + 3] += wt;
          }
        }
      }
      for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
        const o = ((y - y0) * W + x) * 4, q = (y * W + x) * 4, w = acc[o + 3];
        if (w > 0) { out[q] = acc[o] / w; out[q + 1] = acc[o + 1] / w; out[q + 2] = acc[o + 2] / w; }
        else { const t = y / H; out[q] = 42 - 20 * t; out[q + 1] = 42 - 20 * t; out[q + 2] = 46 - 22 * t; } // не снято — тёмный фон
        out[q + 3] = 255;
      }
      if (prog) prog(y1 / H);
      await new Promise(r => setTimeout(r));
    }
    return out;
  }

  return { prepare, stitch, basis, rotY };
})();
