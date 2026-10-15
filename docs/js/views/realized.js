import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state, prefs } from '../store.js';
import { money as rawMoney, shares, amountClass, MASK } from '../fmt.js';
import { errorText, loading, toast } from '../ui.js';
import { cachedRead } from '../readcache.js';

/**
 * 投資頁「已實現」：賣過的交易做統計——筆數、勝率、合計損益、平均報酬率、平均持有天數、最賺／最賠，
 * 依標的、每月，以及每一筆賣出（損益、報酬率、持有幾天）。後端 realizedReport，損益算法跟持倉頁、券商一致（平均成本）。
 */
const money = (n, sym) => rawMoney(n, sym || state.data.base, { whole: true });
const signed = (n) => rawMoney(n, state.data.base, { whole: true, sign: n !== 0 });
const pct = (r) => (r === null || r === undefined ? '—' : prefs.mask ? MASK : `${r > 0 ? '+' : ''}${(r * 100).toFixed(2)}%`);
const cls = (n) => amountClass(n > 0 ? 'pos' : n < 0 ? 'neg' : 'mute');
const MODES = [['year', '今年'], ['12m', '近 12 個月'], ['all', '全部'], ['custom', '自訂']];
const LS = 'fin.rz.mode';
const S = { mode: null, from: '', to: '' };
function loadMode() {
  if (S.mode) return;
  try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); if (v && MODES.some(([k]) => k === v.mode)) Object.assign(S, { mode: v.mode, from: v.from || '', to: v.to || '' }); } catch (e) { /* 忽略 */ }
  if (!S.mode) S.mode = 'all';
}
function saveMode() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { /* 忽略 */ } }
function rangeOf(mode) {
  const today = state.data.today;
  if (mode === 'year') return { from: today.slice(0, 4) + '-01-01', to: today };
  if (mode === '12m') return { from: FinDates.addMonths(today.slice(0, 7), -11) + '-01', to: today };
  if (mode === 'custom') return { from: S.from, to: S.to };
  return { from: '', to: '' };
}
function ymd(d) { return d ? d.replace(/-/g, '/') : '—'; }
function days(n, approx) { return n === null || n === undefined ? '—' : `${approx ? '至少 ' : ''}${n} 天`; }

export function renderRealizedBody(root) {
  loadMode();
  const sumBox = h('div', { class: 'card' });
  const symBox = h('div', { class: 'card', style: { marginTop: '12px' } });
  const listBox = h('div', { class: 'card', style: { marginTop: '12px' } });
  mount(root, sumBox, symBox, listBox);

  function chips() {
    const row = h('div', { class: 'chips', 'data-testid': 'rz-modes' }, MODES.map(([k, label]) => h('button', {
      type: 'button', class: 'chip chip-sm' + (S.mode === k ? ' on' : ''), 'data-mode': k,
      onclick: () => { if (k === 'custom' && !S.from) { const r = rangeOf('year'); S.from = r.from; S.to = r.to; } S.mode = k; saveMode(); load(); },
    }, label)));
    if (S.mode !== 'custom') return row;
    const fromIn = h('input', { type: 'date', value: S.from, 'aria-label': '開始日期' });
    const toIn = h('input', { type: 'date', value: S.to, 'aria-label': '結束日期' });
    const apply = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
      if (!fromIn.value || !toIn.value || fromIn.value > toIn.value) { toast('請選擇正確的開始與結束日期', { kind: 'bad' }); return; }
      S.from = fromIn.value; S.to = toIn.value; saveMode(); load();
    } }, '套用');
    return h('div', null, row, h('div', { class: 'ir-custom' }, fromIn, h('span', { class: 'muted' }, '～'), toIn, apply));
  }

  function stat(label, value, testid, extraClass) {
    return h('div', { class: 'rz-stat' }, h('div', { class: 'muted small' }, label), h('div', { class: 'rz-val ' + (extraClass || ''), 'data-testid': testid }, value));
  }

  function drawSummary(r) {
    const s = r.summary;
    const notes = [];
    if (s.approx) notes.push('有些賣掉的持股是補登／開帳進來的，買進日只能算到補登那天，持有天數會寫「至少」。');
    if (s.estimated) notes.push('有外幣交易找不到當天匯率，先用目前匯率換算。');
    const bw = (s.best || s.worst) ? h('div', { class: 'rz-bw' },
      s.best ? h('div', null, h('span', { class: 'muted small' }, '最賺'), h('div', null, `${s.best.symbol} ${s.best.name}`, h('span', { class: 'muted small' }, `　${ymd(s.best.date)}`)), h('b', { class: cls(s.best.realized), 'data-testid': 'rz-best' }, signed(s.best.realized), h('span', { class: 'small' }, `（${pct(s.best.returnPct)}）`))) : null,
      s.worst ? h('div', null, h('span', { class: 'muted small' }, '最賠'), h('div', null, `${s.worst.symbol} ${s.worst.name}`, h('span', { class: 'muted small' }, `　${ymd(s.worst.date)}`)), h('b', { class: cls(s.worst.realized), 'data-testid': 'rz-worst' }, signed(s.worst.realized), h('span', { class: 'small' }, `（${pct(s.worst.returnPct)}）`))) : null) : null;
    mount(sumBox,
      h('div', { class: 'card-title' }, h('h2', null, '已實現損益'), h('span', { class: 'muted small' }, r.totalTrades ? `共賣出 ${r.totalTrades} 筆` : '')),
      chips(),
      s.count ? h('div', null,
        h('div', { class: 'ir-hero' },
          h('div', { class: 'ir-total ' + cls(s.realized), 'data-testid': 'rz-total' }, signed(s.realized)),
          h('div', { class: 'ir-pct ' + cls(s.returnPct || 0), 'data-testid': 'rz-pct' }, '報酬率 ' + pct(s.returnPct))),
        h('div', { class: 'rz-stats' },
          stat('勝率', s.winRate === null ? '—' : `${Math.round(s.winRate * 100)}%`, 'rz-winrate'),
          stat('勝／敗', `${s.wins} 勝 ${s.losses} 敗${s.flat ? ` ${s.flat} 平` : ''}`, 'rz-wl'),
          stat('平均持有', days(s.avgHoldingDays, s.approx), 'rz-days'),
          stat('賣出成本', money(s.cost), 'rz-cost')),
        bw)
        : h('div', { class: 'empty', 'data-testid': 'rz-empty' }, '這段期間沒有賣出'),
      notes.length ? h('div', { class: 'notice', style: { marginTop: '10px' } }, notes.map((n) => h('div', null, n))) : null,
      h('p', { class: 'muted small', style: { margin: '10px 2px 0' } }, '已實現損益＝賣出淨收入（扣手續費、證交稅）－賣掉那些股的平均成本，跟持倉頁、券商 App 一致。報酬率＝損益 ÷ 賣出成本。勝率不算平手。'));
  }

  function drawSymbols(r) {
    mount(symBox,
      h('div', { class: 'card-title' }, h('h2', null, '依標的')),
      r.bySymbol.length ? h('ul', { class: 'list ir-syms', 'data-testid': 'rz-syms' }, r.bySymbol.map((s) => h('li', null, h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, `${s.symbol} ${s.name}`), h('div', { class: 's' }, `${s.count} 筆・${s.wins} 勝 ${s.count - s.wins} 敗・賣出 ${shares(s.qty, { symbol: s.symbol })}`)),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: cls(s.realized), 'data-testid': 'rz-sym-total', 'data-symbol': s.symbol }, signed(s.realized)), h('div', { class: 'small ' + cls(s.returnPct || 0) }, pct(s.returnPct)))))))
        : h('div', { class: 'empty' }, '—'),
      r.months.length > 1 ? h('details', { class: 'ir-table' }, h('summary', { class: 'muted small' }, '每月'),
        h('table', null, h('thead', null, h('tr', null, ['月份', '筆數', '損益'].map((t) => h('th', null, t)))),
          h('tbody', null, r.months.slice().reverse().map((m) => h('tr', null, h('td', null, `${m.ym.slice(0, 4)}/${Number(m.ym.slice(5))}`), h('td', null, String(m.count)), h('td', { class: cls(m.realized) }, signed(m.realized))))))) : null);
  }

  function tradeRow(x) {
    const sub = [`${ymd(x.date)}・${x.accountName}`, `${shares(x.qty, { symbol: x.symbol })}${x.price ? ` @ ${x.price.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}` : ''}`, `持有 ${days(x.holdingDays, x.approx)}`];
    return h('li', { 'data-testid': 'rz-trade', 'data-symbol': x.symbol }, h('div', { class: 'item' },
      h('div', { class: 'ico' }, icon('graphUp')),
      h('div', { class: 'grow' }, h('div', { class: 't' }, `${x.symbol} ${x.name}`), h('div', { class: 's' }, sub.join('　'))),
      h('div', { style: { textAlign: 'right' } },
        h('div', { class: cls(x.realized === null ? 0 : x.realized) }, x.realized === null ? '—' : signed(x.realized)),
        h('div', { class: 'small ' + cls(x.returnPct || 0) }, pct(x.returnPct)))));
  }

  function drawList(r) {
    mount(listBox,
      h('div', { class: 'card-title' }, h('h2', null, '每一筆賣出'), h('span', { class: 'muted small' }, '新的在上')),
      r.trades.length ? h('ul', { class: 'list ir-syms', 'data-testid': 'rz-list' }, r.trades.map(tradeRow)) : h('div', { class: 'empty' }, '—'));
  }

  function load() {
    const rg = rangeOf(S.mode);
    const params = {}; if (rg.from) params.from = rg.from; if (rg.to) params.to = rg.to;
    let drawn = false;
    cachedRead('realizedReport', params, {
      onData: (data, meta) => { if (!sumBox.isConnected) return; drawn = true; [sumBox, symBox, listBox].forEach((b) => b.classList.toggle('is-stale', !!meta.stale)); drawSummary(data); drawSymbols(data); drawList(data); },
      onError: (e, meta) => { if (!sumBox.isConnected || meta.hadData) return; mount(sumBox, h('div', { class: 'notice bad' }, errorText(e))); },
    });
    if (!drawn) { mount(sumBox, h('div', { class: 'card-title' }, h('h2', null, '已實現損益')), chips(), loading()); mount(symBox, ''); mount(listBox, ''); }
  }
  load();
}
