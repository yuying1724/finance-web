import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { prefs, state, notify } from '../store.js';
import { money, monthLabel, ACCOUNT_ICON, amountClass } from '../fmt.js';
import { txRow, groupRows } from './transactions.js';
import { openAccountForm } from './accountform.js';
import { refresh } from '../data.js';
import { todoCard } from './cards.js';
import { toast, errorText } from '../ui.js';

export function renderHome(root) {
  const d = state.data;
  const base = d.base;
  const nw = d.netWorth;
  const children = [];

  const eye = h('button', { class: 'icon-btn', 'aria-label': prefs.mask ? '顯示金額' : '隱藏金額', onclick: () => { prefs.mask = !prefs.mask; notify(); } }, icon(prefs.mask ? 'eyeOff' : 'eye'));
  const reload = h('button', { class: 'icon-btn', 'aria-label': '重新整理', onclick: async () => { try { await refresh(); toast('已更新'); } catch (e) { toast(errorText(e), { kind: 'bad' }); } } }, icon('refresh'));

  children.push(h('div', { class: 'page-head' }, h('h1', null, '首頁'), reload, eye));
  if (state.loadedAt || state.refreshing) {
    children.push(h('p', { class: 'muted small', style: { marginTop: '-6px' } },
      (state.loadedAt ? '更新於 ' + state.loadedAt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '') +
      (state.refreshing ? '　·　更新中…' : '')));
  }

  if (!d.accounts.length) {
    children.push(h('div', { class: 'card empty' },
      h('div', { class: 'big' }, icon('wallet')),
      h('h2', { style: { marginBottom: '6px' } }, '歡迎使用'),
      h('p', null, '先建立第一個帳戶（例如銀行活存或現金），再按右下角的「＋」記第一筆。'),
      h('button', { class: 'btn btn-primary', onclick: () => openAccountForm({}) }, '新增第一個帳戶')));
  }

  children.push(h('div', { class: 'card hero' },
    h('div', { class: 'label' }, '淨資產'),
    h('div', { class: 'big', 'data-testid': 'networth' }, money(nw.total, base)),
    h('div', { class: 'muted small' }, `資產 ${money(nw.assets, base)}　負債 ${money(nw.liabilities, base)}`)));

  if (nw.missing.length) {
    children.push(h('div', { class: 'notice' }, icon('alert'), h('div', null,
      `${nw.missing.join('、')} 目前沒有匯率或價格，這些餘額暫時沒有計入淨值。`,
      h('div', { class: 'small muted' }, '匯率由試算表的 GOOGLEFINANCE 公式提供，通常隔天排程執行後就會出現；也可以到「價格」分頁手動填數字。'))));
  }
  if (d.issues.count) {
    children.push(h('div', { class: 'notice bad' }, icon('alert'), h('div', null,
      `有 ${d.issues.count} 筆資料有問題（多半是在試算表手動修改造成的），這些資料沒有計入。`,
      h('div', null, h('a', { href: '#/settings' }, '到設定查看細節')))));
  }

  // 待辦與未來 30 天（待確認、信用卡待繳、定期扣款、貸款還款整合成一張卡）
  const todo = todoCard();
  if (todo) children.push(todo);

  const m = d.month;
  children.push(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, h('h2', null, monthLabel(m.ym)), h('a', { class: 'link-btn', href: '#/tx' }, '看明細')),
    h('div', { class: 'stats' },
      stat('收入', money(m.income, base), 'pos'),
      stat('支出', money(m.expense, base)),
      stat('結餘', money(m.net, base, { sign: true }), m.net > 0 ? 'pos' : ''))));

  // 帳戶
  const active = d.accounts.filter((a) => a.active || d.netWorth.byAccount[a.id]);
  if (active.length) {
    const groups = [['資產', active.filter((a) => (nw.byAccount[a.id] || 0) >= 0)], ['負債', active.filter((a) => (nw.byAccount[a.id] || 0) < 0)]];
    const card = h('div', { class: 'card' }, h('div', { class: 'card-title' }, h('h2', null, '帳戶'), h('a', { class: 'link-btn', href: '#/accounts' }, '全部')));
    for (const [label, list] of groups) {
      if (!list.length) continue;
      if (groups[1][1].length) card.appendChild(h('div', { class: 'muted small', style: { marginTop: '6px' } }, label));
      card.appendChild(h('ul', { class: 'list' }, list.slice(0, 8).map((a) => accountRow(a, d))));
    }
    children.push(card);
  }

  if (d.recent.length) {
    const card = h('div', { class: 'card' }, h('div', { class: 'card-title' }, h('h2', null, '最近交易'), h('a', { class: 'link-btn', href: '#/tx' }, '全部')));
    for (const g of groupRows(d.recent)) {
      card.appendChild(h('div', { class: 'day-head' }, h('span', null, g.label)));
      card.appendChild(h('ul', { class: 'list' }, g.items.map((t) => h('li', null, txRow(t)))));
    }
    children.push(card);
  }

  mount(root, ...children);
}

function stat(k, v, kind) {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (kind === 'pos' ? 'amt-pos' : '') }, v));
}

export function accountRow(a, d) {
  const holdings = d.balances.filter((b) => b.accountId === a.id);
  const total = d.netWorth.byAccount[a.id] || 0;
  const foreign = holdings.filter((b) => b.symbol !== d.base);
  const sub = [a.institution && a.institution !== a.name ? a.institution : '', ...foreign.map((b) => money(b.qty, b.symbol))].filter(Boolean).join(' · ');
  return h('li', null, h('a', { class: 'item', href: '#/tx?acct=' + a.id, style: { textDecoration: 'none', color: 'inherit' } },
    h('div', { class: 'ico' }, icon(ACCOUNT_ICON[a.type] || 'briefcase')),
    h('div', { class: 'grow' }, h('div', { class: 't' }, a.name, a.active ? '' : h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, '已停用')), sub ? h('div', { class: 's' }, sub) : null),
    h('div', { class: amountClass('') }, money(total, d.base))));
}
