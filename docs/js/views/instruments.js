import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { money } from '../fmt.js';
import { openSheet, toast } from '../ui.js';
import { openInstrumentForm } from './instrumentform.js';
import { patchRow } from '../data.js';

let showInactive = false;

function instItem(i) {
  const d = state.data;
  const price = d.prices[i.symbol];
  const sub = `${i.type} · 計價 ${i.quote}` + (price && price.price !== null ? ` · 現價 ${money(price.price, i.quote, { noMask: false })}` : '');
  return h('button', { class: 'item', onclick: () => openDetail(i), 'data-symbol': i.symbol },
    h('div', { class: 'ico' }, icon('graphUp')),
    h('div', { class: 'grow' }, h('div', { class: 't' }, `${i.symbol}　${i.name}`, i.active ? '' : h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, '已停用')), h('div', { class: 's' }, sub)),
    h('div', { class: 'muted small' }, `小數 ${i.decimals} 位`));
}

function openDetail(i) {
  const sheet = openSheet({
    title: `${i.symbol}　${i.name}`,
    body: h('div', null,
      h('dl', { class: 'kv' },
        h('dt', null, '類型'), h('dd', null, i.type),
        h('dt', null, '計價幣別'), h('dd', null, i.quote),
        h('dt', null, '小數位數'), h('dd', null, String(i.decimals)),
        h('dt', null, '價格來源'), h('dd', null, i.priceSource),
        h('dt', null, '行情代碼'), h('dd', null, i.quoteCode || '（未設定）'),
        i.note ? h('dt', null, '備註') : null, i.note ? h('dd', null, i.note) : null),
      h('div', { class: 'row-flex wrap', style: { marginTop: '16px' } },
        h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openInstrumentForm({ instrument: i }), 0); } }, '編輯'),
        h('button', { class: 'btn btn-sm ' + (i.active ? 'btn-danger' : ''), onclick: () => {
          sheet.close(); // 樂觀更新：先在本機切換，背景送出，失敗自動還原
          patchRow('setInstrumentActive', { symbol: i.symbol, active: !i.active }, { list: 'instruments', idField: 'symbol', id: i.symbol, patch: { active: !i.active }, toast: i.active ? '已停用' : '已啟用' });
        } }, i.active ? '停用' : '重新啟用'))),
  });
}

/** 只畫「標的」分頁的內容（不含頁首與分頁切換，那些由 invest.js 統一處理） */
export function renderInstrumentsBody(root) {
  const d = state.data;
  const list = d.instruments.filter((i) => i.type !== '法幣' && (showInactive || i.active));
  const inactiveCount = d.instruments.filter((i) => i.type !== '法幣' && !i.active).length;

  const body = list.length
    ? h('div', { class: 'card' }, h('ul', { class: 'list' }, list.map((i) => h('li', null, instItem(i)))))
    : h('div', { class: 'card empty' }, h('div', { class: 'big' }, icon('graphUp')), '還沒有投資標的。按右上角「＋」新增股票、ETF 或加密貨幣。');

  mount(root,
    h('div', { class: 'row-flex between', style: { marginBottom: '12px' } }, h('div', null),
      h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'add-instrument', onclick: () => openInstrumentForm({}) }, icon('plus'), '新增標的')),
    body,
    inactiveCount ? h('label', { class: 'check small muted', style: { marginTop: '12px' } }, h('input', { type: 'checkbox', checked: showInactive, onchange: (e) => { showInactive = e.target.checked; renderInstrumentsBody(root); } }), `顯示已停用的標的（${inactiveCount}）`) : null);
}
