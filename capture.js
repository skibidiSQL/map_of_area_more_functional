/* Съёмка панорамы камерой телефона. Датчики ориентации ведут пользователя точкой:
   совместил красную точку с белым кружком → снимок. Потом кадры сшиваются (Pano.stitch). */
const Capture = (() => {
  const RAD = Math.PI / 180, el = () => $('#cap');
  const dir = (y, p) => [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return a.map(x => x / l); };
  const wrap = a => ((a + 540) % 360) - 180;
  const TOL = 3.5, ROLL = 7;
  let S = null;

  const plan = mode => {
    const t = []; for (let i = 0; i < 12; i++) t.push({ y: i * 30, p: 0, l: 'Горизонт' });
    if (mode == 'full') {
      for (let i = 0; i < 6; i++) t.push({ y: i * 60, p: 50, l: 'Вверх' });
      t.push({ y: 0, p: 90, l: 'Потолок' });
      for (let i = 5; i >= 0; i--) t.push({ y: i * 60, p: -50, l: 'Вниз' });
      t.push({ y: 0, p: -90, l: 'Пол' });
    }
    return t;
  };

  function open(id) { S = { id, mode: 'full', fov: 68, shots: [], i: 0, cur: null, y0: 0, hold: 0, sp: 99 }; el().hidden = false; intro(); }
  function stop() { if (!S) return; cancelAnimationFrame(S.raf); removeEventListener('deviceorientation', onOri); if (S.stream) S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
  function close() { stop(); el().hidden = true; S = null; }

  function intro() {
    el().innerHTML = `<div class="cp"><h2>📱 Съёмка панорамы</h2><ol>
      <li>Встаньте туда, где стоит маркер 📷, и держите телефон <b>вертикально</b>.</li>
      <li>Вращайтесь <b>на месте</b>, держа телефон перед собой на вытянутых руках. Не ходите по кругу — иначе кадры не сойдутся.</li>
      <li><b>Красная точка</b> — куда нужно направить камеру. Поворачивайте телефон, пока она не окажется внутри белого кружка в центре. Подержите ровно — снимок сделается сам (или нажмите кнопку, когда она загорится).</li>
      <li>Сначала круг по горизонту, затем потолок и пол. Зелёные точки — уже снятые направления.</li>
      <li>Снимайте при хорошем свете и подождите, пока уйдут люди из кадра.</li></ol>
      <label>Режим</label><select id="cm"><option value="full">Полная сфера — 26 кадров (≈2 мин)</option><option value="quick">Быстро: только по горизонту — 12 кадров</option></select>
      <div class="btns"><button class="pri" data-c="go">Начать</button><button data-c="x">Отмена</button></div><p class="note" id="ce" hidden></p></div>`;
  }

  async function begin() {
    S.mode = $('#cm').value; S.tg = plan(S.mode);
    const err = m => { const e = $('#ce'); e.hidden = false; e.textContent = m; };
    if (!navigator.mediaDevices || !window.DeviceOrientationEvent) return err('Камера или датчики недоступны в этом браузере. Загрузите готовую панораму файлом.');
    // iOS: разрешение на датчики можно запросить только прямо в обработчике нажатия — поэтому первым делом
    try { if (DeviceOrientationEvent.requestPermission && (await DeviceOrientationEvent.requestPermission()) != 'granted') return err('Нужен доступ к датчикам движения (Safari → Настройки сайта).'); }
    catch { return err('Нет доступа к датчикам движения.'); }
    try { S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false }); }
    catch { return err('Нет доступа к камере. Разрешите её в настройках браузера (нужен https).'); }
    el().innerHTML = `<video id="capv" playsinline muted autoplay></video><canvas id="capc"></canvas>
      <div class="capt"><button data-c="x">✕</button><span id="ct"></span></div><div id="caph"></div>
      <div class="capb"><button data-c="undo">↶</button><button id="cs" data-c="shot" aria-label="Снять" disabled></button><button data-c="skip" id="ck" hidden>Пропустить</button><button data-c="done">Готово</button></div>`;
    const v = $('#capv'); v.srcObject = S.stream; v.play().catch(() => {});
    addEventListener('deviceorientation', onOri);
    S.t0 = performance.now(); S.raf = requestAnimationFrame(tick);
  }

  // оси камеры из датчиков, со сглаживанием дрожания
  function onOri(e) {
    if (!S || e.alpha == null || e.beta == null) return;
    const b = Pano.basis(e.alpha, e.beta, e.gamma || 0);
    if (!S.cur) { S.cur = b; return; }
    const k = .45, c = S.cur, f = nrm(c.f.map((x, i) => x + (b.f[i] - x) * k)), r0 = c.r.map((x, i) => x + (b.r[i] - x) * k),
          d = dot(r0, f), r = nrm(r0.map((x, i) => x - f[i] * d));
    S.cur = { f, r, u: cross(r, f) };
  }

  const hint = m => { const h = $('#caph'); if (h && h.textContent != m) h.textContent = m; };

  function tick(now) {
    S.raf = requestAnimationFrame(tick);
    const c = $('#capc'), v = $('#capv'), W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (c.width != Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (W > H) return hint('Поверните телефон вертикально');
    if (!S.cur) return hint(now - S.t0 > 2500 ? 'Датчики ориентации не отвечают. Откройте страницу на телефоне по https.' : 'Запуск датчиков…');
    const { f, r, u } = S.cur, t = S.tg[S.i], polar = Math.abs(t.p) > 80;
    if (!S.shots.length) S.y0 = Math.atan2(f[0], -f[2]); // первый кадр задаёт «север» панорамы: центр картинки
    const abs = Pano.rotY(dir(t.y * RAD, t.p * RAD), -S.y0),
          vw = v.videoWidth || 3, vh = v.videoHeight || 4, fs = Math.max(vw, vh) / 2 / Math.tan(S.fov * RAD / 2) * Math.max(W / vw, H / vh);
    const ang = Math.acos(Math.min(1, dot(f, abs))) / RAD, roll = polar ? 0 : Math.asin(Math.max(-1, Math.min(1, r[1]))) / RAD;
    if (S.pf) { const s = Math.acos(Math.min(1, dot(f, S.pf))) / RAD / Math.max(.016, (now - S.pt) / 1000); S.sp = S.sp * .8 + s * .2; }
    S.pf = f.slice(); S.pt = now;
    const near = ang < TOL && Math.abs(roll) < ROLL, ok = near && S.sp < 20;
    $('#cs').disabled = !near; $('#ck').hidden = !polar; $('#ct').textContent = (S.i + 1) + ' / ' + S.tg.length + ' · ' + t.l;
    if (ok) { if (!S.hold) S.hold = now; if (now - S.hold > 600) { S.hold = 0; return shoot(); } } else S.hold = 0;

    // уже снятые направления
    g.fillStyle = 'rgba(80,220,120,.9)';
    for (const s of S.shots) { const z = dot(s.f, f); if (z > .1) { const x = W / 2 + fs * dot(s.f, r) / z, y = H / 2 - fs * dot(s.f, u) / z; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); } }
    // цель
    const zc = dot(abs, f), xc = dot(abs, r), yc = dot(abs, u), col = near ? '#4be07a' : '#e2231a';
    const tx = zc > .1 ? W / 2 + fs * xc / zc : -1e4, ty = zc > .1 ? H / 2 - fs * yc / zc : -1e4;
    g.lineWidth = 4;
    if (tx > 20 && tx < W - 20 && ty > 60 && ty < H - 120) {
      g.fillStyle = col; g.strokeStyle = '#fff'; g.beginPath(); g.arc(tx, ty, 13, 0, 7); g.fill(); g.stroke();
    } else { // цель за экраном — стрелка к краю
      const l = Math.hypot(xc, yc) || 1, vx = xc / l, vy = -yc / l, ex = W / 2 + vx * (W / 2 - 34), ey = H / 2 + vy * (H / 2 - 150), a = Math.atan2(vy, vx);
      g.save(); g.translate(ex, ey); g.rotate(a); g.fillStyle = col; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(18, 0); g.lineTo(-12, -14); g.lineTo(-12, 14); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
    // прицел в центре + прогресс удержания + горизонт
    g.strokeStyle = near ? '#4be07a' : '#fff'; g.beginPath(); g.arc(W / 2, H / 2, 26, 0, 7); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2 - 8, H / 2); g.lineTo(W / 2 + 8, H / 2); g.moveTo(W / 2, H / 2 - 8); g.lineTo(W / 2, H / 2 + 8); g.stroke();
    if (S.hold) { g.strokeStyle = '#4be07a'; g.lineWidth = 6; g.beginPath(); g.arc(W / 2, H / 2, 35, -Math.PI / 2, -Math.PI / 2 + Math.min(1, (now - S.hold) / 600) * 2 * Math.PI); g.stroke(); }
    if (!polar) { g.save(); g.translate(W / 2, H / 2); g.rotate(-roll * RAD); g.strokeStyle = Math.abs(roll) < 3 ? '#4be07a' : 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-95, 0); g.lineTo(-45, 0); g.moveTo(45, 0); g.lineTo(95, 0); g.stroke(); g.restore(); }

    // подсказка
    const cy = Math.atan2(f[0], -f[2]) / RAD - S.y0 / RAD, dy = wrap(t.y - cy), dp = t.p - Math.asin(Math.max(-1, Math.min(1, f[1]))) / RAD;
    let m;
    if (ang >= TOL) m = polar || Math.abs(dp) > Math.abs(dy) ? (dp > 0 ? 'Наклоните камеру выше ↑' : 'Наклоните камеру ниже ↓') : (dy > 0 ? 'Поверните камеру вправо →' : '← Поверните камеру влево');
    else if (Math.abs(roll) >= ROLL) m = 'Выровняйте телефон по горизонту';
    else m = ok ? 'Держите ровно…' : 'Почти! Не двигайте телефон';
    hint(m);
  }

  function shoot() {
    const v = $('#capv'), k = Math.min(1, 1152 / Math.max(v.videoWidth, v.videoHeight)), c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0, c.width, c.height);
    const { f, r, u } = S.cur;
    S.shots.push({ w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data, f: f.slice(), r: r.slice(), u: u.slice(), i: S.i });
    S.i++; if (navigator.vibrate) navigator.vibrate(25);
    el().classList.remove('flash'); void el().offsetWidth; el().classList.add('flash');
    if (S.i >= S.tg.length) review();
  }

  // кадры в системе, где yaw 0 — направление первого снимка (центр картинки)
  const rel = () => S.shots.map(s => ({ ...s, f: Pano.rotY(s.f, S.y0), r: Pano.rotY(s.r, S.y0), u: Pano.rotY(s.u, S.y0) }));

  async function review() {
    stop();
    el().innerHTML = `<div class="cp"><h2>Склейка панорамы</h2><canvas id="cpv"></canvas>
      <label>Угол обзора камеры: <b id="fv">${S.fov}</b>° — если швы «ломаются», подвиньте ползунок</label>
      <input type="range" id="cf" min="50" max="90" value="${S.fov}" style="width:100%">
      <p><small>Кадров: ${S.shots.length}. Тёмные участки — то, что не снято (например, потолок в быстром режиме).</small></p>
      <div class="btns"><button class="pri" data-c="apply">Применить</button><button data-c="redo">Переснять</button><button data-c="x">Отмена</button></div></div>`;
    await preview();
  }
  async function preview() {
    if (S.busy) return; S.busy = true;
    try { const W = 1024, px = await Pano.stitch(rel(), W, S.fov), c = $('#cpv'); if (c) { c.width = W; c.height = W / 2; c.getContext('2d').putImageData(new ImageData(px, W, W / 2), 0, 0); } }
    finally { S.busy = false; }
  }

  async function apply() {
    if (S.busy) return; S.busy = true;
    try {
      toast('Склеиваем панораму…');
      const W = 4096, px = await Pano.stitch(rel(), W, S.fov, p => { if (p < 1) toast('Склейка ' + Math.round(p * 100) + '%'); }),
            c = document.createElement('canvas'); c.width = W; c.height = W / 2; c.getContext('2d').putImageData(new ImageData(px, W, W / 2), 0, 0);
      const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', .9));
      toast('Загружаем панораму…');
      let url = window.uploadBlob ? await window.uploadBlob(blob) : null;
      if (!url) { // облако недоступно (например, нет интернета на площадке) — сохраняем на устройстве
        const s = document.createElement('canvas'); s.width = 3072; s.height = 1536; s.getContext('2d').drawImage(c, 0, 0, 3072, 1536);
        url = s.toDataURL('image/jpeg', .8); toast('Облако недоступно — панорама сохранена на этом устройстве');
      }
      const n = N(S.id), id = S.id;
      if (n) { n.src = url; n.demo = null; dropTex(id); save(); plan(); }
      close(); if (n) openPano(id);
    } catch (e) { console.error(e); toast('Не удалось собрать панораму'); }
    finally { if (S) S.busy = false; }
  }

  el().onclick = e => {
    const b = e.target.closest('[data-c]'); if (!b || !S) return; const a = b.dataset.c;
    if (a == 'go') begin();
    if (a == 'x') close();
    if (a == 'shot' && S.cur && !b.disabled) shoot();
    if (a == 'undo') { const s = S.shots.pop(); if (s) S.i = s.i; S.hold = 0; }
    if (a == 'skip') { S.i++; if (S.i >= S.tg.length) review(); }
    if (a == 'done') { if (S.shots.length < 8) toast('Нужно хотя бы 8 кадров'); else review(); }
    if (a == 'redo') { const m = S.mode; open(S.id); S.mode = m; }
    if (a == 'apply') apply();
  };
  el().addEventListener('input', e => { if (e.target.id == 'cf' && S) { S.fov = +e.target.value; $('#fv').textContent = S.fov; clearTimeout(S.dt); S.dt = setTimeout(preview, 250); } });
  return { open };
})();
