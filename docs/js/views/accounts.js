import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import * as api from '../api.js';
import { money, ACCOUNT_ICON } from '../fmt.js';
import { openSheet, toast, errorText, withBusy } from '../ui.js';
import { openAccountForm } from './accountform.js';
import { openTxForm } from './txform.js';
import { renderCategories } from './categories.js';
import { refresh } from '../data.js';

const LIABILITY = ['信用卡', '貸款', '應付'];
let showInactive = false;

export function renderAccounts(root, route) {
  if (route.sub === 'categories') return renderCategories(root, { subtabs });
  const d = state.data;
  const list = d.accounts.filter((a) => showInactive || a.active);
  const inactiveCount = d.accounts.filter((a) => !a.active).length;

  const groups = [['資產類', list.filter((a) => !LIABILITY.includes(a.type))], ['負債類', list.filter((a) => LIABILITY.includes(a.type))]];
  const body = [];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    // 依機構分組顯示
    const byInst = new Map();
    items.forEach((a) => { const k = a.institution || '其他'; if (!byInst.has(k)) byInst.set(k, []); byInst.get(k).push(a); });
    const card = h('div', { class: 'card' }, h('div', { class: 'card-title' }, h('h2', null, label)));
    for (const [inst, arr] of byInst) {
      if (byInst.size > 1 || inst !== '其他') card.appendChild(h('div', { class: 'day-head', style: { paddingTop: '8px' } }, h('span', null, inst)));
      card.appendChild(h('ul', { class: 'list' }, arr.map((a) => h('li', null, accountItem(a)))));
    }
    body.push(card);
  }
  if (!list.length) body.push(h('div', { class: 'card empty' }, h('div', { class: 'big' }, icon('wallet')), '還沒有帳戶。按右上角「＋」新增。'));

  mount(root,
    h('div', { class: 'page-head' }, h('h1', null, '帳戶'), h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'add-account', onclick: () => openAccountForm({ onDone: refresh }) }, icon('plus'), '新增')),
    subtabs('accounts'),
    h('div', { class: 'stack' }, body),
    inactiveCount ? h('label', { class: 'check small muted', style: { marginTop: '12px' } }, h('input', { type: 'checkbox', checked: showInactive, onchange: (e) => { showInactive = e.target.checked; renderAccounts(root, route); } }), `顯示已停用的帳戶（${inactiveCount}）`) : null);
}

export function subtabs(active) {
  return h('div', { class: 'subtabs' },
    h('button', { class: active === 'accounts' ? 'on' : '', onclick: () => { location.hash = '#/accounts'; } }, '帳戶'),
    h('button', { class: active === 'categories' ? 'on' : '', 'data-testid': 'subtab-categories', onclick: () => { location.hash = '#/accounts/categories'; } }, '分類'));
}

function accountItem(a) {
  const d = state.data;
  const holdings = d.balances.filter((b) => b.accountId === a.id);
  const total = d.netWorth.byAccount[a.id];
  const sub = holdings.length ? holdings.map((b) => money(b.qty, b.symbol)).join('　') : '無餘額';
  return h('button', { class: 'item', onclick: () => openAccountDetail(a), 'data-account': a.name },
    h('div', { class: 'ico' }, icon(ACCOUNT_ICON[a.type] || 'briefcase')),
    h('div', { class: 'grow' }, h('div', { class: 't' }, a.name, a.active ? '' : h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, '已停用')), h('div', { class: 's' }, `${a.type} · ${sub}`)),
    h('div', { class: 'amt' }, total === undefined ? '' : money(total, d.base)));
}

function openAccountDetail(a) {
  const d = state.data;
  const holdings = d.balances.filter((b) => b.accountId === a.id);
  const sheet = openSheet({
    title: a.name,
    body: h('div', null,
      h('div', { class: 'muted small', style: { marginBottom: '8px' } }, `${a.type}${a.institution ? ' · ' + a.institution : ''}${a.note ? ' · ' + a.note : ''}`),
      holdings.length ? h('ul', { class: 'list' }, holdings.map((b) => h('li', null, h('div', { class: 'item' }, h('div', { class: 'grow' }, b.symbol), h('div', { class: 'amt' }, money(b.qty, b.symbol)))))) : h('div', { class: 'muted' }, '目前沒有餘額'),
      h('div', { class: 'row-flex wrap', style: { marginTop: '16px' } },
        h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); location.hash = '#/tx?acct=' + a.id; } }, '看交易'),
        h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openTxForm({ preset: { type: '調整', acct: a.id }, onDone: refresh }), 0); } }, '對帳（輸入實際餘額）'),
        h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openAccountForm({ account: a, onDone: refresh }), 0); } }, '編輯'),
        h('button', { class: 'btn btn-sm ' + (a.active ? 'btn-danger' : ''), onclick: async (e) => {
          await withBusy(e.currentTarget, async () => {
            try {
              const r = await api.call('setAccountActive', { id: a.id, active: !a.active });
              sheet.close(); await refresh();
              toast(a.active ? '已停用' + (r.warnings && r.warnings.length ? '。' + r.warnings[0] : '') : '已啟用');
            } catch (err) { toast(errorText(err), { kind: 'bad' }); }
          });
        } }, a.active ? '停用' : '重新啟用'))),
  });
}
