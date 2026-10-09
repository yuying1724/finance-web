import { h } from '../dom.js';
import { state, prefs, notify } from '../store.js';
import * as api from '../api.js';
import { money } from '../fmt.js';

/**
 * 首頁「淨資產走勢」卡：每日快照（後端每天早上與傍晚記一筆）＋今天的即時數字。
 * 單一數列的折線＋淡色面積，滑過／點按顯示當天金額（十字線＋提示），範圍可切 3 個月／1 年／全部。
 * 資料只在記憶體快取：首頁資料重新整理後（state.loadedAt 變了）才重新抓，避免每次重畫都打後端。
 */
const RANGES = [['3m', '3 個月', 92], ['1y', '1 年', 366], ['all', '全部', 0]];
let cache = { rows: null, stamp: null, inflight: false, error: null };
let range = '3m';

function stampNow() { return state.loadedAt ? state.loadedAt.getTime() : 0; }

function ensureData() {
  const stamp = stampNow();
  if (cache.inflight || (cache.rows && cache.stamp === stamp)) return;
  cache.inflight = true;
  api.call('getNetWorthHistory').then((r) => {
    cache = { rows: (r && r.rows) || [], stamp, inflight: false, error: null };
    notify();
  }).catch((e) => {
    cache = { rows: cache.rows, stamp, inflight: false, error: e };
    notify();
  });
}

function addDays(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function mmdd(d) { return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`; }

const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs) { const el = document.createElementNS(SVG, tag); Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v))); return el; }

export function netWorthTrendCard() {
  ensureData();
  const base = state.data.base;
  const rows = cache.rows;
  const chips = h('div', { class: 'chips', style: { gap: '6px' } }, RANGES.map(([key, label]) =>
    h('button', { type: 'button', class: 'chip chip-sm' + (range === key ? ' on' : ''), onclick: () => { range = key; notify(); } }, label)));
  const head = h('div', { class: 'card-title' }, h('h2', null, '淨資產走勢'), chips);

  if (!rows) return h('div', { class: 'card', 'data-testid': 'nw-trend' }, head, h('div', { class: 'muted small' }, cache.error ? '走勢暫時載入失敗，稍後會再試' : '載入中…'));

  const days = RANGES.find((r) => r[0] === range)[2];
  const today = rows.length ? rows[rows.length - 1].date : '';
  const from = days ? addDays(today, -days) : '';
  const pts = rows.filter((r) => !from || r.date >= from);

  if (pts.length < 2) {
    return h('div', { class: 'card', 'data-testid': 'nw-trend' }, head,
      h('div', { class: 'muted small' }, '從今天開始每天記錄淨資產，明天起就能看到走勢。'));
  }

  const first = pts[0], last = pts[pts.length - 1];
  const diff = last.netWorth - first.netWorth;
  const diffText = h('div', { class: 'small', 'data-testid': 'nw-trend-diff' },
    h('span', { class: 'muted' }, `比 ${mmdd(first.date)} `),
    h('span', { class: diff > 0 ? 'amt-pos' : diff < 0 ? 'amt-neg' : 'muted', style: { fontWeight: 600 } }, money(diff, base, { sign: true, whole: true })));

  // ---- 圖：viewBox 固定 320×120，寬度隨卡片伸縮 ----
  const W = 320, H = 120, PL = 4, PR = 4, PT = 8, PB = 18;
  const vals = pts.map((p) => p.netWorth);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const t0 = Date.parse(first.date), t1 = Date.parse(last.date);
  const x = (p) => PL + (t1 === t0 ? 0.5 : (Date.parse(p.date) - t0) / (t1 - t0)) * (W - PL - PR);
  const y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(' ');
  const area = `${line} L${x(last).toFixed(1)},${H - PB} L${x(first).toFixed(1)},${H - PB} Z`;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'nw-chart', role: 'img', 'aria-label': `淨資產走勢，${first.date} 到 ${last.date}` });
  svg.appendChild(s('line', { x1: PL, x2: W - PR, y1: H - PB, y2: H - PB, class: 'nw-axis' }));
  svg.appendChild(s('path', { d: area, class: 'nw-area' }));
  svg.appendChild(s('path', { d: line, class: 'nw-line' }));
  const startLbl = s('text', { x: PL, y: H - 4, class: 'nw-tick' }); startLbl.textContent = mmdd(first.date); svg.appendChild(startLbl);
  const endLbl = s('text', { x: W - PR, y: H - 4, class: 'nw-tick', 'text-anchor': 'end' }); endLbl.textContent = last.live ? '今天' : mmdd(last.date); svg.appendChild(endLbl);
  const endDot = s('circle', { cx: x(last), cy: y(last.netWorth), r: 3.5, class: 'nw-dot' }); svg.appendChild(endDot);
  // 十字線與提示（滑過或點按）
  const cross = s('line', { x1: 0, x2: 0, y1: PT, y2: H - PB, class: 'nw-cross', visibility: 'hidden' });
  const hoverDot = s('circle', { cx: 0, cy: 0, r: 4, class: 'nw-dot', visibility: 'hidden' });
  svg.appendChild(cross); svg.appendChild(hoverDot);
  const tip = h('div', { class: 'nw-tip muted small', 'aria-live': 'polite' }, `${last.live ? '今天' : last.date}　${money(last.netWorth, base, { whole: true })}`);
  const showAt = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W;
    let best = pts[0], bd = Infinity;
    pts.forEach((p) => { const d = Math.abs(x(p) - vx); if (d < bd) { bd = d; best = p; } });
    cross.setAttribute('x1', x(best)); cross.setAttribute('x2', x(best)); cross.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('cx', x(best)); hoverDot.setAttribute('cy', y(best.netWorth)); hoverDot.setAttribute('visibility', 'visible');
    tip.textContent = `${best.live ? '今天' : best.date}　淨資產 ${money(best.netWorth, base, { whole: true })}\n資產 ${money(best.assets, base, { whole: true })}　負債 ${money(best.liabilities, base, { whole: true })}`;
  };
  svg.addEventListener('pointermove', (e) => showAt(e.clientX));
  svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hoverDot.setAttribute('visibility', 'hidden'); });

  return h('div', { class: 'card', 'data-testid': 'nw-trend' }, head, diffText, svg, tip,
    prefs.mask ? null : h('div', { class: 'muted small', style: { marginTop: '2px' } }, `共 ${pts.length} 天的紀錄（每天早上與傍晚自動記錄）`));
}
