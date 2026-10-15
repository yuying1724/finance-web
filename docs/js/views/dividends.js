import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state, prefs } from '../store.js';
import { money as rawMoney, shares, amountClass, MASK } from '../fmt.js';
import { errorText, loading } from '../ui.js';
import { cachedRead } from '../readcache.js';

/**
 * 投資頁「股息」：某一年收到多少股息（合計、每月長條）、依標的（每檔收到多少、成本殖利率、市值殖利率，點開看每一筆），
 * 以及股息行事曆（待確認的、已公告還沒除息的、預告還沒公布金額的、股息定期範本的下一次）。後端 dividendReport。
 */
const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs) { const el = document.createElementNS(SVG, tag); Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v))); return el; }
const money = (n, sym) => rawMoney(n, sym || state.data.base, { whole: true });
const pct = (r) => (r === null || r === undefined ? '—' : prefs.mask ? MASK : `${(r * 100).toFixed(2)}%`);
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function md(d) { if (!d) return ''; const t = new Date(d + 'T00:00:00Z'); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEK[t.getUTCDay()]}）`; }
function ymd(d) { return d ? d.replace(/-/g, '/') : '—'; }

const S = { year: '' };

export function renderDividendsBody(root) {
  const topBox = h('div', { class: 'card' });
  const calBox = h('div', { class: 'card', style: { marginTop: '12px' } });
  const symBox = h('div', { class: 'card', style: { marginTop: '12px' } });
  mount(root, topBox, calBox, symBox);
  const opened = new Set();

  function yearChips(r) {
    const years = r.years.slice();
    if (!years.includes(r.year)) years.push(r.year);
    const thisYear = state.data.today.slice(0, 4);
    if (!years.includes(thisYear)) years.push(thisYear);
    years.sort().reverse();
    return h('div', { class: 'chips', 'data-testid': 'dv-years' }, years.map((y) => h('button', {
      type: 'button', class: 'chip chip-sm' + (r.year === y ? ' on' : ''), 'data-year': y,
      onclick: () => { S.year = y; load(); },
    }, y === thisYear ? '今年' : y + ' 年')));
  }

  function drawTop(r) {
    const t = r.total;
    const months = r.months;
    const W = 320, H = 130, PL = 4, PR = 4, PT = 18, PB = 18;
    const max = Math.max(1, ...months.map((m) => m.net));
    const y = (v) => PT + ((max - v) / max) * (H - PT - PB);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sp-chart', role: 'img', 'aria-label': '每月股息長條圖', 'data-testid': 'dv-chart' });
    const slot = (W - PL - PR) / 12, bw = Math.min(slot - 6, 22);
    const tip = h('div', { class: 'muted small sp-tip', 'data-testid': 'dv-tip' }, '點長條看那個月收到多少');
    const cur = state.data.today.slice(0, 7);
    months.forEach((m, i) => {
      const x0 = PL + i * slot + (slot - bw) / 2;
      if (m.net > 0) {
        const top = y(m.net), bottom = y(0);
        const rect = s('rect', { x: x0, y: top, width: bw, height: Math.max(bottom - top, 1), rx: 3, class: 'dv-bar' + (m.ym === cur ? ' on' : ''), 'data-ym': m.ym });
        svg.appendChild(rect);
      }
      const tick = s('text', { x: x0 + bw / 2, y: H - 5, class: 'nw-tick', 'text-anchor': 'middle' });
      tick.textContent = `${i + 1}`;
      svg.appendChild(tick);
      const hit = s('rect', { x: PL + i * slot, y: 0, width: slot, height: H, fill: 'transparent', class: 'sp-hit', 'data-ym': m.ym });
      const show = () => { tip.textContent = `${i + 1} 月　${money(m.net)}${m.count ? `（${m.count} 筆）` : ''}`; };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('click', show);
      svg.appendChild(hit);
    });
    svg.appendChild(s('line', { x1: PL, x2: W - PR, y1: y(0), y2: y(0), class: 'nw-axis' }));
    const notes = [];
    if (r.dataStart && r.dataStart.slice(0, 4) === r.year && r.dataStart > r.year + '-01-01') notes.push(`投資紀錄從 ${ymd(r.dataStart)} 開始，之前的股息沒有記進來，殖利率是用這段期間收到的算。`);
    if (r.estimated) notes.push('有外幣股息找不到當天匯率，先用目前匯率換算。');
    mount(topBox,
      h('div', { class: 'card-title' }, h('h2', null, '股息'), h('span', { class: 'muted small' }, '實收（扣掉匯費、二代健保）')),
      yearChips(r),
      h('div', { class: 'ir-hero' },
        h('div', { class: 'ir-total ' + amountClass('pos'), 'data-testid': 'dv-total' }, money(t.net)),
        h('div', { class: 'muted small', 'data-testid': 'dv-count' }, t.count ? `${t.count} 筆　稅前 ${money(t.gross)}${t.tax ? `・二代健保 ${money(t.tax)}` : ''}${t.fee ? `・匯費 ${money(t.fee)}` : ''}` : '這一年還沒收到股息')),
      t.count ? svg : null, t.count ? tip : null,
      notes.length ? h('div', { class: 'notice', style: { marginTop: '8px' } }, notes.map((n) => h('div', null, n))) : null);
  }

  function calRow(u) {
    const badge = { 待確認: h('span', { class: 'badge warn' }, '待確認'), 已公告: h('span', { class: 'badge' }, '已公告'), 預告: h('span', { class: 'badge st-done' }, '金額未定'), 定期: h('span', { class: 'badge' }, '定期') }[u.kind];
    const sub = [];
    if (u.exDate) sub.push('除息 ' + md(u.exDate));
    sub.push((u.kind === '待確認' ? '入帳 ' : '預計入帳 ') + md(u.payDate));
    if (u.cash) sub.push(`每股 ${u.cash} × ${shares(u.shares)}`);
    if (u.accountName) sub.push('入 ' + u.accountName);
    if (u.templateName) sub.push(u.templateName);
    const amt = u.net === null || u.net === undefined ? '金額未定' : money(u.net, u.symbolCash);
    const inner = [
      h('div', { class: 'ico' }, icon('coin')),
      h('div', { class: 'grow' }, h('div', { class: 't' }, `${u.symbol ? u.symbol + ' ' : ''}${u.name}`), h('div', { class: 's' }, badge, ' ', sub.join('・'))),
      h('div', { class: u.net ? amountClass('pos') : 'amt amt-mute', 'data-testid': 'dv-cal-amt' }, amt),
    ];
    return h('li', { class: 'dv-cal', 'data-testid': 'dv-cal', 'data-kind': u.kind, 'data-symbol': u.symbol },
      u.kind === '待確認' ? h('a', { class: 'item', href: '#/todo' }, inner) : h('div', { class: 'item' }, inner));
  }

  function drawCalendar(r) {
    const list = r.upcoming;
    mount(calBox,
      h('div', { class: 'card-title' }, h('h2', null, '股息行事曆'), h('span', { class: 'muted small' }, '還沒入帳的')),
      list.length ? h('ul', { class: 'list' }, list.map(calRow)) : h('div', { class: 'empty', 'data-testid': 'dv-cal-empty' }, '目前沒有已公告或待確認的股息'),
      h('p', { class: 'muted small', style: { margin: '8px 2px 0' } }, '台股／ETF 的除息公告每天早上自動從證交所、櫃買中心抓；到了除息日會用前一天的持股估一筆「待確認」，實際入帳後到待辦確認金額。'));
  }

  function symRow(sy) {
    const key = sy.symbol;
    const isOpen = opened.has(key);
    const items = h('ul', { class: 'list st-items', style: { display: isOpen ? '' : 'none' } }, sy.items.map((it) => h('li', null, h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, ymd(it.date)), h('div', { class: 's' }, [it.gross ? `稅前 ${money(it.gross)}` : '', it.tax ? `健保 ${money(it.tax)}` : '', it.fee ? `匯費 ${money(it.fee)}` : '', it.symbol && it.symbol !== state.data.base ? `實收 ${rawMoney(it.netNative, it.symbol)}` : ''].filter(Boolean).join('・'))),
      h('div', { class: amountClass('pos') }, money(it.net))))));
    const chev = icon('right', 'st-chev' + (isOpen ? ' open' : ''));
    const yieldText = sy.held
      ? `成本殖利率 ${pct(sy.yieldOnCost)}${sy.yieldOnMv !== null ? `・市值殖利率 ${pct(sy.yieldOnMv)}` : ''}`
      : '已沒有持股';
    const head = h('button', { type: 'button', class: 'item st-head', 'data-testid': 'dv-sym', 'data-symbol': sy.symbol, 'aria-expanded': String(isOpen), onclick: () => {
      const now = !opened.has(key); if (now) opened.add(key); else opened.delete(key);
      items.style.display = now ? '' : 'none'; chev.classList.toggle('open', now); head.setAttribute('aria-expanded', String(now));
    } },
      chev,
      h('div', { class: 'grow' }, h('div', { class: 't' }, `${sy.symbol} ${sy.name}`), h('div', { class: 's' }, `${sy.count} 筆・${yieldText}`)),
      h('div', { style: { textAlign: 'right' } },
        h('div', { class: amountClass('pos'), 'data-testid': 'dv-sym-net' }, money(sy.net)),
        sy.held ? h('div', { class: 'small muted' }, `成本 ${money(sy.costBase)}`) : null));
    return h('li', null, head, items);
  }

  function drawSymbols(r) {
    mount(symBox,
      h('div', { class: 'card-title' }, h('h2', null, '依標的'), h('span', { class: 'muted small' }, `${r.year} 年`)),
      r.bySymbol.length ? h('ul', { class: 'list ir-syms', 'data-testid': 'dv-syms' }, r.bySymbol.map(symRow)) : h('div', { class: 'empty' }, '這一年沒有股息'),
      r.bySymbol.length ? h('p', { class: 'muted small', style: { margin: '8px 2px 0' } }, '成本殖利率＝這一年實收股息 ÷ 現在的持有成本；市值殖利率＝÷ 現在的市值。年初就持有、整年都有記的標的才準。') : null);
  }

  function draw(r, stale) {
    [topBox, calBox, symBox].forEach((b) => b.classList.toggle('is-stale', !!stale));
    drawTop(r); drawCalendar(r); drawSymbols(r);
  }

  function load() {
    const params = S.year ? { year: S.year } : {};
    let drawn = false;
    cachedRead('dividendReport', params, {
      onData: (data, meta) => { if (!topBox.isConnected) return; drawn = true; draw(data, meta.stale); },
      onError: (e, meta) => { if (!topBox.isConnected || meta.hadData) return; mount(topBox, h('div', { class: 'notice bad' }, errorText(e))); },
    });
    if (!drawn) { mount(topBox, loading()); mount(calBox, ''); mount(symBox, ''); }
  }
  load();
}
