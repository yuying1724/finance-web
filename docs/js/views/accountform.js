import { h } from '../dom.js';
import { state } from '../store.js';
import * as api from '../api.js';
import { openSheet, toast, errorText, withBusy } from '../ui.js';
import { mount } from '../dom.js';

/** 新增／編輯帳戶 */
export function openAccountForm({ account = null, onDone } = {}) {
  const d = state.data;
  const editing = !!account;
  const f = { name: account ? account.name : '', type: account ? account.type : '銀行', institution: account ? account.institution : '', defaultSymbol: account ? account.defaultSymbol : 'TWD', note: account ? account.note : '' };
  const currencies = d.instruments.filter((i) => i.type === '法幣' && (i.active || i.symbol === f.defaultSymbol));
  const types = d.options['帳戶類型'];
  const msgs = {};
  const banner = h('div', { class: 'notice bad', role: 'alert', style: { display: 'none', marginBottom: '10px' } });

  const fld = (key, label, control, hint) => {
    const msg = h('div', { class: 'msg', style: { display: 'none' } });
    msgs[key] = { msg, wrap: null };
    const wrap = h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), control, hint ? h('div', { class: 'muted small', style: { marginTop: '3px' } }, hint) : null, msg);
    msgs[key].wrap = wrap;
    return wrap;
  };
  const showErr = (key, text) => {
    const m = msgs[key];
    if (!m) { banner.style.display = ''; mount(banner, text); return; }
    m.wrap.classList.add('err'); m.msg.style.display = ''; m.msg.textContent = text;
  };

  const nameInput = h('input', { type: 'text', maxlength: 40, value: f.name, placeholder: '例如：玉山活存', oninput: (e) => { f.name = e.target.value; } });
  const typeSel = h('select', { onchange: (e) => { f.type = e.target.value; } }, types.map((t) => h('option', { value: t, selected: t === f.type }, t)));
  const instInput = h('input', { type: 'text', maxlength: 40, value: f.institution, placeholder: '例如：玉山銀行（同機構的帳戶會放在一起）', oninput: (e) => { f.institution = e.target.value; } });
  const symSel = h('select', { onchange: (e) => { f.defaultSymbol = e.target.value; } }, currencies.map((c) => h('option', { value: c.symbol, selected: c.symbol === f.defaultSymbol }, `${c.symbol} ${c.name}`)));
  const noteInput = h('input', { type: 'text', maxlength: 200, value: f.note, oninput: (e) => { f.note = e.target.value; } });

  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'account-save', onclick: async (e) => {
    banner.style.display = 'none';
    Object.values(msgs).forEach((m) => { m.wrap.classList.remove('err'); m.msg.style.display = 'none'; });
    if (!f.name.trim()) { showErr('name', '請輸入帳戶名稱'); return; }
    await withBusy(e.currentTarget, async () => {
      try {
        await api.call('upsertAccount', { account: { id: account ? account.id : undefined, ...f, name: f.name.trim() }, expectedUpdatedAt: account ? account.updatedAt : undefined });
        sheet.close();
        if (onDone) await onDone();
        toast(editing ? '已儲存' : '已新增帳戶');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details && err.details.errors) err.details.errors.forEach((x) => showErr(x.field, x.message));
        else { banner.style.display = ''; mount(banner, errorText(err)); }
      }
    });
  } }, editing ? '儲存' : '新增');

  const sheet = openSheet({
    title: editing ? '編輯帳戶' : '新增帳戶', dismissable: false,
    body: h('div', null, banner,
      fld('name', '帳戶名稱', nameInput), fld('type', '類型', typeSel, '信用卡、貸款、應付款的餘額為負數代表欠款；淨值會自動扣除。'),
      fld('institution', '機構（選填）', instInput), fld('defaultSymbol', '預設幣別', symSel, '這個帳戶也可以持有其他幣別，這裡只是記帳時的預設值。'), fld('note', '備註（選填）', noteInput)),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save],
  });
  return sheet;
}
