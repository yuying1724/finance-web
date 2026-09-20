import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { prefs, state, notify } from '../store.js';
import * as api from '../api.js';
import { money } from '../fmt.js';
import { openSheet, toast, errorText, withBusy } from '../ui.js';
import { lock } from '../app.js';

export function renderSettings(root) {
  const d = state.data;
  const seg = (options, current, onPick) => h('div', { class: 'seg' }, options.map(([v, t]) => h('button', { type: 'button', class: current === v ? 'on' : '', onclick: () => onPick(v) }, t)));

  const prices = Object.keys(d.prices).map((sym) => {
    const p = d.prices[sym];
    return h('li', null, h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, sym), h('div', { class: 's' }, p.updatedAt ? '更新於 ' + p.updatedAt : '尚未更新')),
      h('span', { class: 'badge' + (p.status === '正常' ? '' : ' warn') }, p.status), h('div', { class: 'amt', style: { minWidth: '70px' } }, p.price === null ? '—' : FinMoney.format(p.price, 4, { trim: true }))));
  });

  const issues = d.issues.items.map((i) => h('li', null, h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, `${i.table} 第 ${i.row} 列`), h('div', { class: 's', style: { whiteSpace: 'normal' } }, i.problems.join('；'))))))
    .concat(d.issues.ledger.map((i) => h('li', null, h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, i.txId || '交易'), h('div', { class: 's', style: { whiteSpace: 'normal' } }, i.message))))));

  mount(root,
    h('div', { class: 'page-head' }, h('h1', null, '設定')),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h2', null, '顯示'),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, '外觀'), seg([['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']], prefs.theme, (v) => { prefs.theme = v; notify(); })),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, '漲跌與收入的顏色'), seg([['tw', '紅漲綠跌（台灣）'], ['us', '綠漲紅跌']], prefs.updown, (v) => { prefs.updown = v; notify(); })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prefs.mask, onchange: (e) => { prefs.mask = e.target.checked; notify(); } }), '隱藏所有金額（只在這台裝置生效，首頁右上角的眼睛也能切換）')),
      h('div', { class: 'card' }, h('h2', null, '安全'),
        h('div', { class: 'row-flex wrap' },
          h('button', { class: 'btn btn-sm', onclick: openChangePin }, icon('lock'), '變更 PIN'),
          h('button', { class: 'btn btn-sm', onclick: () => lock('已鎖定') }, icon('logout'), '鎖定並登出')),
        h('p', { class: 'muted small', style: { marginBottom: 0 } }, `這台裝置：${d.device || '（未命名）'}。要新增或撤銷裝置，請在試算表的「財務系統」選單操作。`)),
      h('div', { class: 'card' }, h('h2', null, '資料'),
        d.sheetUrl ? h('a', { class: 'btn btn-sm', href: d.sheetUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), '開啟試算表') : null,
        h('h3', { style: { fontSize: '14px', margin: '14px 0 4px' } }, '匯率與價格'),
        prices.length ? h('ul', { class: 'list' }, prices) : h('div', { class: 'muted small' }, '沒有價格資料'),
        h('h3', { style: { fontSize: '14px', margin: '14px 0 4px' } }, '資料檢查'),
        issues.length ? h('ul', { class: 'list' }, issues) : h('div', { class: 'muted small' }, '沒有發現問題 ✓')),
      h('div', { class: 'card' }, h('h2', null, '關於'),
        h('dl', { class: 'kv' },
          h('dt', null, '版本'), h('dd', null, d.version),
          h('dt', null, '後端'), h('dd', { class: 'mono' }, prefs.apiUrl.replace(/^https?:\/\//, '').slice(0, 60) + (prefs.apiUrl.length > 68 ? '…' : ''))),
        h('button', { class: 'btn btn-sm', style: { marginTop: '12px' }, onclick: reloadApp }, icon('refresh'), '清除快取並重新載入'))));
}

async function reloadApp() {
  try {
    if ('serviceWorker' in navigator) (await navigator.serviceWorker.getRegistrations()).forEach((r) => r.unregister());
    if (window.caches) (await caches.keys()).forEach((k) => caches.delete(k));
  } catch (e) { /* 忽略 */ }
  location.reload();
}

function openChangePin() {
  const f = { oldPin: '', newPin: '', again: '' };
  const banner = h('div', { class: 'notice bad', role: 'alert', style: { display: 'none', marginBottom: '10px' } });
  const inp = (label, key) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type: 'password', autocomplete: 'off', oninput: (e) => { f[key] = e.target.value; } }));
  const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
    banner.style.display = 'none';
    if (f.newPin !== f.again) { banner.style.display = ''; mount(banner, '兩次輸入的新 PIN 不一致'); return; }
    await withBusy(e.currentTarget, async () => {
      try { await api.call('changePin', { oldPin: f.oldPin, newPin: f.newPin }); sheet.close(); toast('PIN 已變更'); }
      catch (err) { banner.style.display = ''; mount(banner, errorText(err)); }
    });
  } }, '變更');
  const sheet = openSheet({ title: '變更 PIN', dismissable: false, body: h('div', null, banner, inp('目前的 PIN', 'oldPin'), inp('新的 PIN（至少 6 碼）', 'newPin'), inp('再輸入一次新的 PIN', 'again')),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save] });
}
