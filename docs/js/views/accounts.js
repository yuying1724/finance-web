import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { money, ACCOUNT_ICON } from '../fmt.js';
import { openSheet, toast } from '../ui.js';
import { openAccountForm } from './accountform.js';
import { openTxForm } from './txform.js';
import { openCardStatement, openLoanDetail } from './liability.js';
import { renderCategories } from './categories.js';
import { renderCards, cardRow, sectionCollapsed, setSectionCollapsed } from './cards.js';
import { write } from '../data.js';

const LIABILITY = ['信用卡', '貸款', '應付'];
// 帳戶頁依類型分區（可收合、有小計），像 MOZE 的帳戶群組；信用卡區改成「每家銀行（合併帳單）一列」，不再把十幾張卡全部攤開
const SECTIONS = [
  { key: 'cash', label: '現金與銀行', types: ['銀行', '數位錢包', '現金'] },
  { key: 'invest', label: '投資', types: ['證券', '加密交易所'] },
  { key: 'cards', label: '信用卡', types: ['信用卡'] },
  { key: 'loan', label: '貸款', types: ['貸款'] },
  { key: 'other', label: '應收／應付／點數', types: ['應收', '應付', '點數'] },
];
let showInactive = false;

export function renderAccounts(root, route) {
  if (route.sub === 'categories') return renderCategories(root, { subtabs });
  if (route.sub === 'cards') return renderCards(root, { subtabs });
  const d = state.data;
  const list = d.accounts.filter((a) => showInactive || a.active);
  const inactiveCount = d.accounts.filter((a) => !a.active).length;

  const body = [];
  for (const sec of SECTIONS) {
    const items = list.filter((a) => sec.types.includes(a.type));
    if (!items.length) continue;
    const subtotal = items.reduce((sum, a) => sum + (d.netWorth.byAccount[a.id] || 0), 0);
    const collapsed = sectionCollapsed(sec.key);
    const content = h('div', { class: 'sec-body', style: { display: collapsed ? 'none' : '' } });
    if (sec.key === 'cards') {
      const ov = (d.cardOverview && d.cardOverview.items) || [];
      if (ov.length) content.appendChild(h('ul', { class: 'list' }, ov.map((it) => h('li', null, cardRow(it, true)))));
      const inactiveCards = items.filter((a) => !a.active);
      if (inactiveCards.length) {
        content.appendChild(h('div', { class: 'day-head', style: { paddingTop: '8px' } }, h('span', null, '已停用')));
        content.appendChild(h('ul', { class: 'list' }, inactiveCards.map((a) => h('li', null, accountItem(a)))));
      }
      content.appendChild(h('div', { class: 'small', style: { padding: '6px 2px 0' } }, h('a', { href: '#/accounts/cards' }, '看信用卡總覽（待繳、繳款日、額度）')));
    } else {
      // 依機構分組顯示
      const byInst = new Map();
      items.forEach((a) => { const k = a.institution || '其他'; if (!byInst.has(k)) byInst.set(k, []); byInst.get(k).push(a); });
      for (const [inst, arr] of byInst) {
        if (byInst.size > 1 || inst !== '其他') content.appendChild(h('div', { class: 'day-head', style: { paddingTop: '8px' } }, h('span', null, inst)));
        content.appendChild(h('ul', { class: 'list' }, arr.map((a) => h('li', null, accountItem(a)))));
      }
    }
    const chevron = h('span', { class: 'sec-chevron' + (collapsed ? ' closed' : '') }, icon('right'));
    const head = h('button', { class: 'sec-head', 'data-section': sec.key, 'aria-expanded': String(!collapsed), onclick: () => {
      const now = content.style.display !== 'none';
      content.style.display = now ? 'none' : '';
      chevron.classList.toggle('closed', now);
      head.setAttribute('aria-expanded', String(!now));
      setSectionCollapsed(sec.key, now);
    } }, chevron, h('h2', null, sec.label, h('span', { class: 'muted small', style: { marginLeft: '6px', fontWeight: 400 } }, `${items.length}`)), h('span', { class: 'amt' + (subtotal < 0 ? ' amt-due' : '') }, money(subtotal, d.base)));
    body.push(h('div', { class: 'card' }, head, content));
  }
  if (!list.length) body.push(h('div', { class: 'card empty' }, h('div', { class: 'big' }, icon('wallet')), '還沒有帳戶。按右上角「＋」新增。'));

  mount(root,
    h('div', { class: 'page-head' }, h('h1', null, '帳戶'), h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'add-account', onclick: () => openAccountForm({}) }, icon('plus'), '新增')),
    subtabs('accounts'),
    h('div', { class: 'stack' }, body),
    inactiveCount ? h('label', { class: 'check small muted', style: { marginTop: '12px' } }, h('input', { type: 'checkbox', checked: showInactive, onchange: (e) => { showInactive = e.target.checked; renderAccounts(root, route); } }), `顯示已停用的帳戶（${inactiveCount}）`) : null);
}

export function subtabs(active) {
  return h('div', { class: 'subtabs' },
    h('button', { class: active === 'accounts' ? 'on' : '', onclick: () => { location.hash = '#/accounts'; } }, '帳戶'),
    h('button', { class: active === 'cards' ? 'on' : '', 'data-testid': 'subtab-cards', onclick: () => { location.hash = '#/accounts/cards'; } }, '信用卡'),
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
  const liabilityBtns = [];
  if (a.type === '信用卡') liabilityBtns.push(h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openCardStatement(a), 0); } }, '信用卡帳單'));
  if (a.type === '貸款') liabilityBtns.push(h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openLoanDetail(a), 0); } }, '還款明細'));
  const sheet = openSheet({
    title: a.name,
    body: h('div', null,
      h('div', { class: 'muted small', style: { marginBottom: '8px' } }, `${a.type}${a.institution ? ' · ' + a.institution : ''}${a.note ? ' · ' + a.note : ''}`),
      holdings.length ? h('ul', { class: 'list' }, holdings.map((b) => h('li', null, h('div', { class: 'item' }, h('div', { class: 'grow' }, b.symbol), h('div', { class: 'amt' }, money(b.qty, b.symbol)))))) : h('div', { class: 'muted' }, '目前沒有餘額'),
      h('div', { class: 'row-flex wrap', style: { marginTop: '16px' } },
        ...liabilityBtns,
        h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); location.hash = '#/tx?acct=' + a.id; } }, '看交易'),
        h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openTxForm({ preset: { type: '調整', acct: a.id } }), 0); } }, '對帳（輸入實際餘額）'),
        h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openAccountForm({ account: a }), 0); } }, '編輯'),
        h('button', { class: 'btn btn-sm ' + (a.active ? 'btn-danger' : ''), onclick: async () => {
          sheet.close(); // 樂觀更新：先在本機切換，背景送出，失敗自動還原
          const r = await write('setAccountActive', { id: a.id, active: !a.active }, {
            optimistic: () => { const prev = a.active; a.active = !a.active; return () => { a.active = prev; }; },
            failPrefix: '操作失敗，已還原：',
          });
          if (r) toast(a.active ? '已停用' + (r.warnings && r.warnings.length ? '。' + r.warnings[0] : '') : '已啟用');
        } }, a.active ? '停用' : '重新啟用'))),
  });
}
