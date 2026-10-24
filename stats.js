/* Статистика просмотров для организатора: графики по дням, времени суток, дням недели и топ мест. */
(() => {
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  let ev = [], err = null, rec = null, cfg = { days: 30, own: false };
  const key = d => d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(), p2 = n => String(n).padStart(2, '0');

  function bars(vals, labels, tick, h = 110) {
    const n = vals.length, W = 600, bw = W / n, mx = Math.max(1, ...vals);
    let s = `<svg viewBox="0 0 ${W} ${h + 20}" class="ch" role="img">`;
    vals.forEach((v, i) => {
      const bh = v / mx * h;
      s += `<rect x="${i * bw + bw * .12}" y="${h - bh}" width="${bw * .76}" height="${v ? Math.max(bh, 2) : 0}" rx="2" fill="var(--red)"><title>${esc(labels[i])}: ${v}</title></rect>`;
      if (i % tick == 0) s += `<text x="${i * bw + bw / 2}" y="${h + 14}" text-anchor="middle" font-size="11" fill="var(--mut)">${esc(labels[i])}</text>`;
    });
    return s + `<line x1="0" x2="${W}" y1="${h}" y2="${h}" stroke="var(--line)"/></svg>`;
  }
  function top(arr, nm, k = 6) {
    const c = {}; arr.forEach(e => c[e.target] = (c[e.target] || 0) + 1);
    const rows = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, k), mx = rows.length ? rows[0][1] : 1;
    return rows.length ? rows.map(([id, n]) => `<div class="tr"><span>${esc(nm[id] || 'удалено')}</span><b>${n}</b><i style="width:${n / mx * 100}%"></i></div>`).join('') : '<small>Пока нет данных</small>';
  }
  function names(r) {
    const m = {}; (r.data.floors || []).forEach((f, _, a) => { const s = a.length > 1 ? ' · ' + f.name : ''; f.pois.forEach(p => m[p.id] = p.name + s); f.panos.forEach(p => m[p.id] = '📷 ' + p.name + s); });
    return m;
  }

  function render() {
    const since = Date.now() - cfg.days * 864e5, all = ev.filter(e => e.ts >= since && (cfg.own || !e.own)), nm = names(rec),
          by = k => all.filter(e => e.kind == k), maps = by('map'), uniq = new Set(all.map(e => e.vid)).size;
    const days = [...Array(cfg.days)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (cfg.days - 1 - i)); return d; }),
          per = {}; maps.forEach(e => { const k = key(new Date(e.ts)); per[k] = (per[k] || 0) + 1; });
    const dv = days.map(d => per[key(d)] || 0), dl = days.map(d => d.getDate() + '.' + p2(d.getMonth() + 1)),
          hv = Array(24).fill(0), wv = Array(7).fill(0);
    all.forEach(e => hv[new Date(e.ts).getHours()]++); maps.forEach(e => wv[(new Date(e.ts).getDay() + 6) % 7]++);
    const mxH = Math.max(...hv), peak = mxH ? hv.indexOf(mxH) : -1;
    const kp = (n, t) => `<div><b>${n.toLocaleString('ru-RU')}</b><small>${t}</small></div>`;
    $('#dlg').firstElementChild.innerHTML = `<h3>📊 Статистика</h3>
      <div class="per">${[7, 30, 90].map(d => `<button class="hbtn${cfg.days == d ? ' on' : ''}" data-s="${d}">${d} дн.</button>`).join('')}
        <label class="chk"><input type="checkbox" data-so ${cfg.own ? 'checked' : ''}> учитывать мои просмотры</label></div>
      ${err ? `<div class="note">Облачная статистика недоступна (${esc(err)}). Показаны данные только этого устройства. Создайте таблицу events — см. supabase_stats.sql.</div>` : ''}
      <div class="kp">${kp(maps.length, 'просмотров карты')}${kp(uniq, 'посетителей')}${kp(by('poi').length, 'просмотров мест')}${kp(by('pano').length, 'просмотров панорам')}${kp(by('route').length, 'маршрутов')}</div>
      ${all.length ? '' : '<p><small>За выбранный период данных нет. Просмотры посетителей по ссылке считаются автоматически; ваши собственные по умолчанию скрыты.</small></p>'}
      <h4>Просмотры карты по дням</h4>${bars(dv, dl, cfg.days > 30 ? 7 : cfg.days > 7 ? 3 : 1)}
      <div class="cg"><div><h4>Активность по времени суток${peak >= 0 ? ' · пик ' + p2(peak) + ':00–' + p2((peak + 1) % 24) + ':00' : ''}</h4>${bars(hv, hv.map((_, i) => p2(i)), 3, 90)}</div>
        <div><h4>Просмотры карты по дням недели</h4>${bars(wv, WD, 1, 90)}</div>
        <div><h4>Популярные места</h4>${top(by('poi'), nm)}</div><div><h4>Популярные панорамы</h4>${top(by('pano'), nm)}</div>
        <div><h4>Куда строят маршруты</h4>${top(by('route'), nm)}</div></div>
      <div class="btns"><button class="pri" data-d="cancel">Закрыть</button></div>`;
  }

  Core.showStats = async r => {
    rec = r; const d = $('#dlg'); d.firstElementChild.className = 'wide'; d.firstElementChild.innerHTML = '<h3>📊 Статистика</h3><p><small>Загружаем…</small></p>'; d.hidden = false;
    const x = await Core.fetchEvents(90); ev = x.ev; err = x.err; render();
  };
  $('#dlg').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b && rec) { cfg.days = +b.dataset.s; render(); } });
  $('#dlg').addEventListener('change', e => { if (e.target.hasAttribute('data-so')) { cfg.own = e.target.checked; render(); } });
})();
