(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tok = () => localStorage.getItem('adminToken') || '';
  async function api(p, method = 'GET', body) {
    const r = await fetch(p, { method, headers: { 'x-admin-token': tok(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Request failed'); return j;
  }
  async function load() {
    try {
      const s = await api('/api/admin/summary');
      $('#login').hidden = true; $('#panel').hidden = false;
      const lr = s.meta.lastRun;
      $('#summary').innerHTML = `Provider: <b>${esc(s.provider)}</b> · Leagues: ${esc(s.leagues.join(', '))}<br>
        Matches ${s.counts.matches} · Teams ${s.counts.teams} · Predictions ${s.counts.predictions}<br>
        Last run: ${lr ? new Date(lr.at).toLocaleString() + ` (${lr.ms} ms, ${lr.predicted} predicted, ${lr.settled} settled)` : 'not yet'}<br>
        ${s.state.running ? 'Update running now…' : 'Next scheduled run: ' + (s.state.nextRunAt ? new Date(s.state.nextRunAt).toLocaleString() : '–')}`;
      $('#logs').innerHTML = s.logs.map((l) => `<div class="hist-item"><span class="${l.level === 'error' ? 'neg' : l.level === 'warn' ? '' : 'muted'}">[${esc(l.level)}] ${esc(l.source)}: ${esc(l.message)}</span><span class="muted">${new Date(l.at).toLocaleTimeString()}</span></div>`).join('') || 'No logs.';
      const fx = await (await fetch('/api/fixtures?days=14')).json();
      $('#fx').innerHTML = fx.map((f) => `<option value="${esc(f.id)}">${esc(f.home.name)} vs ${esc(f.away.name)} – ${new Date(f.date).toLocaleDateString()}</option>`).join('');
    } catch (e) {
      $('#login').hidden = false; $('#panel').hidden = true;
      if (tok()) { $('#lerr').textContent = e.message; $('#lerr').hidden = false; }
    }
  }
  $('#go').onclick = () => { localStorage.setItem('adminToken', $('#token').value.trim()); load(); };
  $('#reload').onclick = load;
  $('#run').onclick = async () => { try { await api('/api/admin/run', 'POST'); $('#msg').textContent = 'Update started. Refresh in a minute.'; } catch (e) { $('#msg').textContent = e.message; } };
  $('#bt').onclick = async () => { try { const b = await api('/api/admin/backtest', 'POST'); $('#msg').textContent = `Backtest done on ${b.matches} matches. See the Accuracy page.`; } catch (e) { $('#msg').textContent = e.message; } };
  $('#saveOdds').onclick = async () => {
    const v = (id) => $(id).value;
    try { await api(`/api/admin/fixtures/${$('#fx').value}/odds`, 'POST', { odds1: v('#o1'), oddsX: v('#oX'), odds2: v('#o2'), oddsOver25: v('#oO'), oddsUnder25: v('#oU'), oddsBttsYes: v('#oY'), oddsBttsNo: v('#oN') }); $('#msg').textContent = 'Saved. Prediction updated.'; }
    catch (e) { $('#msg').textContent = e.message; }
  };
  load();
})();
