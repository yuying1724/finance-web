import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { money, ACCOUNT_ICON, holdingText, isShareSymbol, shares } from '../fmt.js';
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
        if (byInst.size > 1 || inst !== '其他') {
          // 同一家機構有兩個以上帳戶時，標題右邊顯示各幣別的合計（例如「NT$10,232 · ¥65,031」），不同幣別不換算、不混加
          const totals = sec.key === 'cash' && arr.length > 1 ? currencyTotals(arr) : '';
          content.appendChild(h('div', { class: 'day-head', style: { paddingTop: '8px' } }, h('span', null, inst),
            totals ? h('span', { 'data-testid': 'inst-total', 'data-inst': inst }, totals) : null));
        }
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
    } }, chevron, h('h2', null, sec.label, h('span', { class: 'muted small', style: { marginLeft: '6px', fontWeight: 400 } }, `${items.length}`)), h('span', { class: 'amt' + (subtotal < 0 ? ' amt-due' : '') }, money(subtotal, d.base, { whole: d.balances.some((b) => b.symbol !== d.base && items.some((x) => x.id === b.accountId)) })));
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

/** 一組帳戶各幣別餘額的合計，基準幣別排第一、其餘依出現順序；合計為 0 的幣別不顯示 */
function currencyTotals(accounts) {
  const d = state.data;
  const ids = new Set(accounts.map((a) => a.id));
  const sums = new Map();
  if (d.base) sums.set(d.base, 0);
  d.balances.forEach((b) => { if (ids.has(b.accountId)) sums.set(b.symbol, (sums.get(b.symbol) || 0) + Number(b.qty || 0)); });
  const parts = [];
  sums.forEach((qty, sym) => { if (Math.abs(qty) > 1e-9) parts.push(money(qty, sym)); });
  return parts.length ? '合計 ' + parts.join(' · ') : '';
}

function accountItem(a) {
  const d = state.data;
  const holdings = d.balances.filter((b) => b.accountId === a.id);
  const total = d.netWorth.byAccount[a.id];
  // 證券帳戶持股很多時只顯示「N 檔持股」，避免副標題擠成一長串；現金部位照常顯示金額
  const stockHoldings = holdings.filter((b) => isShareSymbol(b.symbol));
  const cashParts = holdings.filter((b) => !isShareSymbol(b.symbol)).map((b) => money(b.qty, b.symbol));
  const stockParts = stockHoldings.length > 2 ? [`${stockHoldings.length} 檔持股`] : stockHoldings.map((b) => holdingText(b.qty, b.symbol));
  const sub = holdings.length ? cashParts.concat(stockParts).join('　') : '無餘額';
  return h('button', { class: 'item', onclick: () => openAccountDetail(a), 'data-account': a.name },
    h('div', { class: 'ico' }, icon(ACCOUNT_ICON[a.type] || 'briefcase')),
    h('div', { class: 'grow' }, h('div', { class: 't' }, a.name, a.active ? '' : h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, '已停用')), h('div', { class: 's' }, `${a.type} · ${sub}`)),
    h('div', { class: 'amt' }, total === undefined ? '' : money(total, d.base, { whole: holdings.some((b) => b.symbol !== d.base) })));
}

/** 收回代墊：開一筆轉帳，轉出＝應收帳戶，轉入選錢實際進到哪裡；金額依對方還多少填（可以一個人一個人收） */
export function openCollect(a) {
  openTxForm({ preset: { type: '轉帳', acct: a.id, note: '收回代墊' } });
}

function openAccountDetail(a) {
  const d = state.data;
  const holdings = d.balances.filter((b) => b.accountId === a.id);
  const liabilityBtns = [];
  if (a.type === '信用卡') liabilityBtns.push(h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openCardStatement(a), 0); } }, '信用卡帳單'));
  if (a.type === '貸款') liabilityBtns.push(h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openLoanDetail(a), 0); } }, '還款明細'));
  // 應收（例如「代墊-同事」）：對方還錢時按「收回」，記一筆從這個帳戶轉到收錢帳戶（LINE Pay、現金、銀行）的轉帳
  if (a.type === '應收' && holdings.some((b) => b.qty > 0)) liabilityBtns.push(h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'collect-btn', onclick: () => { sheet.close(); setTimeout(() => openCollect(a), 0); } }, '收回（對方還錢）'));
  const sheet = openSheet({
    title: a.name,
    body: h('div', null,
      h('div', { class: 'muted small', style: { marginBottom: '8px' } }, `${a.type}${a.institution ? ' · ' + a.institution : ''}${a.note ? ' · ' + a.note : ''}`),
      holdings.length ? h('ul', { class: 'list' }, holdings.map((b) => { const inst = state.data.instruments.find((i) => i.symbol === b.symbol); const isShare = isShareSymbol(b.symbol); return h('li', null, h('div', { class: 'item' }, h('div', { class: 'grow' }, isShare && inst ? `${b.symbol}　${inst.name}` : b.symbol), h('div', { class: 'amt' }, isShare ? shares(b.qty, { mask: true, symbol: b.symbol }) : money(b.qty, b.symbol)))); })) : h('div', { class: 'muted' }, '目前沒有餘額'),
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
