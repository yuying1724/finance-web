import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import * as api from '../api.js';
import { categoryInfo } from '../fmt.js';
import { openSheet, toast, errorText, confirmDialog, withBusy } from '../ui.js';
import { refresh } from '../data.js';

/**
 * 商家管理（設定 › 商家管理）：記帳表單「商家」的建議清單來自過去交易的商家欄位。
 *  - 隱藏：不再出現在建議清單，舊交易不動（之後想用還是可以自己打）
 *  - 改名／合併：所有用這個名稱的交易一起改；改成已經有的名稱就等於合併
 *  - 清除：所有用這個名稱的交易清空商家欄位，可以把名稱移到備註（適合「電話費」這種其實是說明的文字）
 */
export function openMerchants() {
  let items = null, error = null, q = '';
  const listBox = h('div', { 'data-testid': 'merchant-list' });
  const search = h('input', { type: 'search', placeholder: '搜尋商家', 'aria-label': '搜尋商家', oninput: (e) => { q = e.target.value.trim(); paint(); } });
  const paint = () => {
    if (error) { mount(listBox, h('div', { class: 'notice bad' }, '讀取失敗：' + errorText(error))); return; }
    if (!items) { mount(listBox, h('div', { class: 'muted', style: { padding: '12px 0' } }, '載入中…')); return; }
    const shown = items.filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
    if (!shown.length) { mount(listBox, h('div', { class: 'muted', style: { padding: '12px 0' } }, items.length ? '找不到符合的商家' : '還沒有任何交易填過商家')); return; }
    mount(listBox, h('ul', { class: 'list' }, shown.map((x) => h('li', null, h('button', { class: 'item', 'data-testid': 'merchant-item', 'data-name': x.name, onclick: () => openMerchant(x, items, reload) },
      h('div', { class: 'grow' },
        h('div', { class: 't' }, x.name, x.hidden ? h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, '已隱藏') : null),
        h('div', { class: 's' }, [`${x.count} 筆`, x.lastDate ? '最近 ' + x.lastDate : '', x.categoryId ? categoryInfo(x.categoryId).name : ''].filter(Boolean).join(' · '))),
      icon('right'))))));
  };
  const reload = () => {
    items = null; error = null; paint();
    api.call('listMerchants').then((r) => { items = r.items || []; paint(); }).catch((e) => { error = e; paint(); });
  };
  openSheet({ title: '商家管理', body: h('div', { 'data-testid': 'merchants' },
    h('p', { class: 'muted small', style: { marginTop: 0 } }, '記帳時「商家」欄的建議，是從過去交易自動整理出來的。點一個商家可以隱藏、改名（合併）或清除。'),
    search, h('div', { style: { marginTop: '8px' } }, listBox)) });
  reload();
}

function openMerchant(x, all, reload) {
  const others = all.filter((y) => y.name !== x.name).map((y) => y.name);
  const listId = 'merchant-names-' + Math.random().toString(36).slice(2);
  const nameInput = h('input', { type: 'text', value: x.name, maxlength: 40, list: listId, 'aria-label': '新的商家名稱', 'data-testid': 'merchant-newname' });
  const moveNote = h('input', { type: 'checkbox', checked: true, 'data-testid': 'merchant-move-note' });
  const run = async (btn, params, okText) => {
    try {
      const r = await withBusy(btn, () => api.call('updateMerchant', Object.assign({ name: x.name }, params)));
      sheet.close();
      toast(okText(r));
      reload();
      refresh().catch(() => { /* 稍後會自動更新 */ });
    } catch (e) { toast('操作失敗：' + errorText(e), { kind: 'bad' }); }
  };
  const hideBtn = h('button', { class: 'btn btn-sm', 'data-testid': x.hidden ? 'merchant-show' : 'merchant-hide', onclick: (e) => run(e.currentTarget, { action: x.hidden ? 'show' : 'hide' }, () => (x.hidden ? `「${x.name}」會再出現在建議裡` : `已隱藏「${x.name}」，記帳時不會再出現在建議裡`)) },
    icon(x.hidden ? 'eye' : 'eyeOff'), x.hidden ? '恢復顯示在建議' : '不要顯示在建議');
  const renameBtn = h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'merchant-rename', onclick: async (e) => {
    const btn = e.currentTarget;
    const nn = nameInput.value.trim();
    if (!nn || nn === x.name) { toast('請輸入不一樣的名稱', { kind: 'bad' }); return; }
    const merge = others.includes(nn);
    if (!(await confirmDialog({ title: merge ? '合併商家？' : '改名？', message: `${x.count + (x.voided || 0)} 筆交易的商家會從「${x.name}」改成「${nn}」${merge ? '（合併到已經有的商家）' : ''}。`, confirmText: merge ? '合併' : '改名' }))) return;
    run(btn, { action: 'rename', newName: nn }, (r) => `已改成「${nn}」（${r.changed} 筆）`);
  } }, '套用');
  const clearBtn = h('button', { class: 'btn btn-sm btn-danger', 'data-testid': 'merchant-clear', onclick: async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmDialog({ title: '清除商家？', message: `${x.count + (x.voided || 0)} 筆交易的商家欄位會清空${moveNote.checked ? `，「${x.name}」這幾個字會加到備註前面` : ''}。`, confirmText: '清除', danger: true }))) return;
    run(btn, { action: 'clear', moveToNote: moveNote.checked }, (r) => `已清除「${x.name}」（${r.changed} 筆）`);
  } }, '清除');
  const sheet = openSheet({ title: x.name, body: h('div', { 'data-testid': 'merchant-detail' },
    h('div', { class: 'muted small' }, `${x.count} 筆交易${x.voided ? `（另有 ${x.voided} 筆已作廢）` : ''}${x.lastDate ? ' · 最近 ' + x.lastDate : ''}`),
    h('h3', { style: { fontSize: '14px', margin: '16px 0 4px' } }, '建議清單'),
    h('div', { class: 'muted small', style: { marginBottom: '6px' } }, '隱藏只是記帳時不出現在建議裡，舊交易的商家不會改。'),
    hideBtn,
    h('h3', { style: { fontSize: '14px', margin: '18px 0 4px' } }, '改名或合併'),
    h('div', { class: 'muted small', style: { marginBottom: '6px' } }, '所有用這個名稱的交易會一起改。改成已經有的商家名稱（例如「好市多」），就會合併成同一個。'),
    h('div', { class: 'row-flex', style: { gap: '6px', alignItems: 'center' } }, h('div', { class: 'grow' }, nameInput), renameBtn),
    h('datalist', { id: listId }, others.map((n) => h('option', { value: n }))),
    h('h3', { style: { fontSize: '14px', margin: '18px 0 4px' } }, '清除'),
    h('div', { class: 'muted small', style: { marginBottom: '6px' } }, '適合不是商家的文字（例如「電話費」）：清空這些交易的商家欄位。'),
    h('label', { class: 'check' }, moveNote, '把這幾個字移到備註，不會不見'),
    h('div', { style: { marginTop: '8px' } }, clearBtn)) });
}
