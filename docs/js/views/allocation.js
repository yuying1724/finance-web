import { h } from '../dom.js';
import { state, notify } from '../store.js';
import { money } from '../fmt.js';

/**
 * 首頁「資產配置」卡：總資產依「類別」或「幣別」的占比。
 * 圖是一條 100% 堆疊橫條（片與片之間留 2px），下面是清單（同色圓點＋名稱＋金額＋百分比），點一列展開明細。
 * 顏色跟著類別／幣別走、不跟著排名：類別固定順序 台幣現金→台股→海外股票→加密貨幣→外幣現金 用 --sp-c1～c5，
 * 應收與其他用中性色；橫條也依這個固定順序排，相鄰色已用 validate_palette 驗證（淺色／深色都過）。
 * 資料來自 bootstrap.allocation（後端依目前餘額與價格算好）。
 */
const CLASS_SLOT = { twdCash: 1, twStock: 2, usStock: 3, crypto: 4, fxCash: 5 };
const UI = { mode: 'class', open: '', tip: '' };
try { const m = localStorage.getItem('fin.alloc.mode'); if (m === 'class' || m === 'currency') UI.mode = m; } catch (e) { /* 沒有 localStorage 就用預設 */ }

function colorVar(slot) { return slot ? `var(--sp-c${slot})` : 'var(--sp-other)'; }
function pctText(v, total) { return total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—'; }

function slotsFor(al, mode) {
  const map = {};
  if (mode === 'class') { al.byClass.forEach((g) => { map[g.key] = CLASS_SLOT[g.key] || 0; }); return map; }
  // 幣別：基準幣別、美金、日圓、加密貨幣固定 1～4，第一個其他外幣用 5，再多的用中性色
  const fixed = { [al.base]: 1, USD: 2, JPY: 3, CRYPTO: 4 };
  let fifth = false;
  al.byCurrency.forEach((g) => {
    if (fixed[g.key]) map[g.key] = fixed[g.key];
    else if (!fifth) { map[g.key] = 5; fifth = true; } else map[g.key] = 0;
  });
  return map;
}

export function allocationCard() {
  const d = state.data;
  const al = d.allocation;
  if (!al || !(al.assets > 0)) return null;
  const base = d.base;
  const total = al.assets;
  const groups = UI.mode === 'currency' ? al.byCurrency : al.byClass;
  const slots = slotsFor(al, UI.mode);

  const setMode = (m) => { UI.mode = m; UI.open = ''; UI.tip = ''; try { localStorage.setItem('fin.alloc.mode', m); } catch (e) { /* ignore */ } notify(); };
  const chips = h('div', { class: 'chips', style: { gap: '6px' } }, [['class', '類別'], ['currency', '幣別']].map(([k, label]) =>
    h('button', { type: 'button', class: 'chip chip-sm' + (UI.mode === k ? ' on' : ''), 'data-testid': 'alloc-mode-' + k, onclick: () => setMode(k) }, label)));
  const head = h('div', { class: 'card-title' }, h('h2', null, '資產配置'), chips);

  const tipDefault = `總資產 ${money(total, base, { whole: true })}`;
  const tip = h('div', { class: 'al-tip small', 'aria-live': 'polite' }, UI.tip || tipDefault);
  const showTip = (g) => { tip.textContent = `${g.label}　${money(g.value, base, { whole: true })}（${pctText(g.value, total)}）`; };

  // 堆疊橫條（依固定色票順序排；太小的片至少留 3px 看得到）
  const ordered = groups.slice().sort((a, b) => (slots[a.key] || 9) - (slots[b.key] || 9));
  const bar = h('div', { class: 'al-bar', role: 'img', 'data-testid': 'alloc-bar',
    'aria-label': '資產配置：' + ordered.map((g) => `${g.label} ${pctText(g.value, total)}`).join('、') },
  ordered.map((g) => {
    const seg = h('div', { class: 'al-seg' + (UI.open && UI.open !== g.key ? ' dim' : ''), 'data-seg': g.key,
      style: { flexGrow: String(g.value), background: colorVar(slots[g.key]) } });
    seg.addEventListener('pointerenter', () => showTip(g));
    seg.addEventListener('click', () => { UI.open = UI.open === g.key ? '' : g.key; UI.tip = ''; notify(); });
    return seg;
  }));
  bar.addEventListener('pointerleave', () => { tip.textContent = tipDefault; });

  // 清單：依金額大到小
  const rows = groups.slice().sort((a, b) => b.value - a.value).map((g) => {
    const isOpen = UI.open === g.key;
    const row = h('button', { type: 'button', class: 'item al-row' + (isOpen ? ' on' : ''), 'data-testid': 'alloc-row', 'data-key': g.key,
      onclick: () => { UI.open = isOpen ? '' : g.key; notify(); } },
    h('div', { class: 'grow' }, h('div', { class: 't' }, h('span', { class: 'sp-dot', style: { background: colorVar(slots[g.key]) } }), g.label,
      h('span', { class: 'muted small', style: { marginLeft: '6px', fontWeight: 400 } }, `${g.items.length} 項 ${isOpen ? '▾' : '▸'}`))),
    h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amt' }, money(g.value, base, { whole: true })), h('div', { class: 'muted small', 'data-testid': 'alloc-pct' }, pctText(g.value, total))));
    const items = isOpen ? h('ul', { class: 'list al-items', 'data-testid': 'alloc-items' }, g.items.map((x) =>
      h('li', null, h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 's', style: { color: 'var(--text)' } }, x.label)),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amt small' }, money(x.value, base, { whole: true })), h('div', { class: 'muted small' }, pctText(x.value, total))))))) : null;
    return h('li', null, row, items);
  });

  // 負債與集中度
  const notes = [];
  if (al.liabilities > 0) {
    notes.push(h('div', { 'data-testid': 'alloc-debt' }, `負債 ${money(al.liabilities, base, { whole: true })}（${al.byLiability.map((g) => `${g.label} ${money(g.value, base, { whole: true })}`).join('、')}），負債比 ${pctText(al.liabilities, total)}`));
  }
  if (al.top && al.top.value > 0) {
    const share = al.top.value / total;
    notes.push(h('div', { 'data-testid': 'alloc-top', class: share >= 0.2 ? 'al-warn' : '' },
      `單一標的最大：${al.top.label}，占總資產 ${pctText(al.top.value, total)}${share >= 0.2 ? '（超過兩成，比較集中）' : ''}`));
  }
  if (al.missing && al.missing.length) notes.push(h('div', null, `${al.missing.join('、')} 沒有價格，沒有算進來。`));

  return h('div', { class: 'card', 'data-testid': 'allocation' }, head, bar, tip,
    h('ul', { class: 'list' }, rows),
    notes.length ? h('div', { class: 'muted small al-notes' }, notes) : null);
}
