import { h, mount } from '../dom.js';
import { state, accountById } from '../store.js';
import * as api from '../api.js';
import { money, categoryInfo } from '../fmt.js';
import { openSheet, toast, errorText, confirmDialog, withBusy } from '../ui.js';

/**
 * 常用交易：記帳表單最上面一排「常用」按鈕，按一下就帶好類型、帳戶、分類、商家（金額可存可不存）。
 *  - 新增：在記一筆表單填好後按「存成常用交易」
 *  - 管理：設定 › 常用交易（改名、刪除）
 * 資料存在後端「設定」分頁 quickTx（見 server/api.js saveQuickTx／deleteQuickTx），bootstrap 的 quickTx 帶下來。
 */
export const QUICK_TYPES = ['支出', '收入', '轉帳'];

export function quickItems() { return (state.data && state.data.quickTx) || []; }

/** 一個常用交易的說明文字：支出 · 午餐 · 富邦-J卡 · NT$60 */
export function quickSummary(q) {
  const parts = [q.type];
  if (q.categoryId) parts.push(categoryInfo(q.categoryId).name);
  if (q.merchant) parts.push(q.merchant);
  const a = q.acct && accountById(q.acct), b = q.acct2 && accountById(q.acct2);
  if (q.type === '轉帳') parts.push(`${a ? a.name : '？'} → ${b ? b.name : '？'}`); else if (a) parts.push(a.name);
  if (q.amount) parts.push(money(q.amount, (a && a.defaultSymbol) || state.data.base));
  return parts.join(' · ');
}

/** 「存成常用交易」：輸入名稱、要不要連金額一起存 */
export function openSaveQuick(draft, onSaved) {
  const defName = draft.merchant || (draft.categoryId ? categoryInfo(draft.categoryId).name : '') || draft.type;
  const name = h('input', { type: 'text', maxlength: 20, value: defName.slice(0, 20), 'aria-label': '常用交易名稱', 'data-testid': 'quick-name' });
  const withAmt = h('input', { type: 'checkbox', checked: !!draft.amount, disabled: !draft.amount, 'data-testid': 'quick-with-amount' });
  const msg = h('div', { class: 'notice bad', style: { display: 'none', marginTop: '8px' } });
  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'quick-save', onclick: async (e) => {
    msg.style.display = 'none';
    const item = Object.assign({}, draft, { name: name.value.trim(), amount: withAmt.checked ? draft.amount : '' });
    try {
      const r = await withBusy(e.currentTarget, () => api.call('saveQuickTx', { item }));
      state.data.quickTx = r.items;
      sheet.close();
      toast(`已存成常用交易「${r.item.name}」，下次記帳時在最上面按一下就好`);
      if (onSaved) onSaved(r.item);
    } catch (err) { msg.style.display = ''; mount(msg, errorText(err)); }
  } }, '存起來');
  const sheet = openSheet({ title: '存成常用交易', body: h('div', null,
    h('p', { class: 'muted small', style: { marginTop: 0 } }, '會記住：' + quickSummary(Object.assign({}, draft, { amount: '' }))),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, '名稱（按鈕上顯示的字）'), name),
    h('label', { class: 'check' }, withAmt, draft.amount ? `連金額（${draft.amount}）一起存，例如每次都一樣的月票` : '這次沒有填金額，所以不存金額'),
    msg),
  footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save] });
  setTimeout(() => name.focus(), 60);
}

/** 設定 › 常用交易：列出來，可以改名、刪除 */
export function openQuickManager() {
  const box = h('div', { 'data-testid': 'quick-list' });
  const paint = () => {
    const items = quickItems();
    if (!items.length) { mount(box, h('div', { class: 'muted', style: { padding: '12px 0' } }, '還沒有常用交易。記一筆時填好類型、帳戶、分類（和商家），按表單下方的「存成常用交易」就會出現在這裡。')); return; }
    mount(box, h('ul', { class: 'list' }, items.map((q) => h('li', { 'data-testid': 'quick-item', 'data-name': q.name }, h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, q.name), h('div', { class: 's' }, quickSummary(q))),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => rename(q) }, '改名'),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', 'data-testid': 'quick-delete', onclick: async (e) => {
        const btn = e.currentTarget;
        if (!(await confirmDialog({ title: '刪除常用交易？', message: `「${q.name}」會從記帳表單的常用按鈕拿掉（以前記的交易不受影響）。`, confirmText: '刪除', danger: true }))) return;
        try { const r = await withBusy(btn, () => api.call('deleteQuickTx', { id: q.id })); state.data.quickTx = r.items; paint(); toast('已刪除'); }
        catch (err) { toast('刪除失敗：' + errorText(err), { kind: 'bad' }); }
      } }, '刪除'))))));
  };
  const rename = (q) => {
    const input = h('input', { type: 'text', maxlength: 20, value: q.name, 'aria-label': '新名稱' });
    const ok = h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
      try { const r = await withBusy(e.currentTarget, () => api.call('saveQuickTx', { item: Object.assign({}, q, { name: input.value.trim() }) })); state.data.quickTx = r.items; s2.close(); paint(); }
      catch (err) { toast('改名失敗：' + errorText(err), { kind: 'bad' }); }
    } }, '儲存');
    const s2 = openSheet({ title: '改名', body: h('label', { class: 'field' }, h('span', { class: 'lbl' }, '名稱'), input), footer: [h('button', { class: 'btn', type: 'button', onclick: () => s2.close() }, '取消'), ok] });
  };
  openSheet({ title: '常用交易', body: h('div', null,
    h('p', { class: 'muted small', style: { marginTop: 0 } }, '記一筆時，表單最上面會有這些按鈕，按一下就帶好類型、帳戶、分類和商家，只要填金額。'), box) });
  paint();
}

