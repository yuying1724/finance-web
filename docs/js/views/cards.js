import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state, accountById } from '../store.js';
import { money } from '../fmt.js';
import { openSheet } from '../ui.js';
import { openTxForm } from './txform.js';
import { openCardStatement, openCardSettingsForm } from './liability.js';

/**
 * 信用卡總覽：參考 MOZE 的「主帳戶／合併帳單」與麻布記帳「依銀行看帳單」的做法——
 * 同一額度群組（銀行合併帳單）的卡片只顯示一筆，單卡各一筆；依「逾期 → 待繳（繳款日近的在前）→ 已繳清 → 尚未設定」排序，
 * 每筆直接看到待繳金額、繳款日與剩餘天數、本期已刷、額度使用情況，並可一鍵記繳款、看明細，不用先點進某一張卡。
 */

const DUE_SOON_DAYS = 3;

/** 繳款日狀態標籤 */
function dueBadge(item) {
  if (!item.hasSettings) return h('span', { class: 'badge warn' }, '尚未設定');
  if (item.overdue) return h('span', { class: 'badge bad' }, `已逾期 ${-item.dueInDays} 天`);
  if (item.statementAmountDue > 0) {
    if (item.dueInDays === 0) return h('span', { class: 'badge bad' }, '今天到期');
    if (item.dueInDays <= DUE_SOON_DAYS) return h('span', { class: 'badge warn' }, `${item.dueInDays} 天後到期`);
    return h('span', { class: 'badge' }, `${item.dueInDays} 天後到期`);
  }
  if (item.paid) return h('span', { class: 'badge good' }, '本期已繳清');
  return h('span', { class: 'badge' }, '無待繳');
}

function mmdd(d) { return d ? d.slice(5).replace('-', '/') : '—'; }

/** 額度使用條 */
function meter(item) {
  if (!item.hasSettings || !item.limit) return null;
  const used = Math.min(1, Math.max(0, item.currentlyOwed / item.limit));
  return h('div', { class: 'meter', title: `已用 ${Math.round(used * 100)}%` },
    h('div', { class: 'meter-fill' + (used > 0.8 ? ' hot' : ''), style: { width: `${Math.round(used * 100)}%` } }));
}

/** 「繳款」：開記一筆（轉帳），目的帳戶預設為這張合併帳單的第一張卡，金額預設待繳金額，來源預設卡片設定的繳款帳戶 */
export function openPayForm(item) {
  const srcAcct = item.payAccountId && accountById(item.payAccountId) ? item.payAccountId : '';
  openTxForm({ preset: { type: '轉帳', acct: srcAcct, acct2: item.accountIds[0], amount: item.statementAmountDue > 0 ? item.statementAmountDue : '' } });
}

/** 群組／單卡詳情：成員清單（可點進各卡）、明細、繳款、設定 */
export function openCardGroupSheet(item) {
  const first = accountById(item.accountIds[0]);
  const members = item.members.map((m) => {
    const a = accountById(m.accountId);
    return h('li', null, h('button', { class: 'item', onclick: () => { sheet.close(); setTimeout(() => openCardStatement(a), 0); } },
      h('div', { class: 'ico' }, icon('card')),
      h('div', { class: 'grow' }, h('div', { class: 't' }, m.name), h('div', { class: 's' }, m.hasSettings ? (m.currentSpend === null ? '' : `本期刷了 ${money(m.currentSpend, item.symbol)}`) : '尚未設定結帳日／繳款日')),
      h('div', { class: 'amt muted' }, icon('right'))));
  });
  const kv = item.hasSettings ? h('dl', { class: 'kv' },
    h('dt', null, '待繳'), h('dd', null, h('b', null, money(item.statementAmountDue, item.symbol)), ' ', dueBadge(item)),
    h('dt', null, '繳款截止'), h('dd', null, item.dueDate || '—'),
    h('dt', null, '本期已刷'), h('dd', null, money(item.currentSpend, item.symbol), h('span', { class: 'muted small' }, `（${mmdd(item.currentPeriod.start)}～結帳日 ${item.statementDay} 號）`)),
    h('dt', null, '目前欠款'), h('dd', null, money(item.currentlyOwed, item.symbol)),
    h('dt', null, '可用額度'), h('dd', null, item.availableCredit === null ? '未設定額度' : `${money(item.availableCredit, item.symbol)} / ${money(item.limit, item.symbol)}`, meter(item))) : null;
  const sheet = openSheet({
    title: item.isGroup ? `${item.name}　合併帳單（${item.members.length} 張卡）` : item.name,
    body: h('div', null,
      item.hasSettings ? null : h('div', { class: 'notice', style: { marginBottom: '10px' } }, '這張卡還沒設定結帳日與繳款日，設定後才能算帳單'),
      item.groupDateMismatch ? h('div', { class: 'notice bad', style: { marginBottom: '10px' } }, '這個群組裡的卡片結帳日或繳款日填得不一樣，請把群組內每張卡改成一致') : null,
      item.groupLimitMismatch ? h('div', { class: 'notice bad', style: { marginBottom: '10px' } }, '這個群組裡的卡片額度填得不一樣，請把群組內每張卡的額度都改成同一個總額度') : null,
      kv,
      h('div', { class: 'row-flex wrap', style: { marginTop: '14px', marginBottom: '6px' } },
        item.hasSettings && item.statementAmountDue > 0 ? h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'card-pay', onclick: () => { sheet.close(); setTimeout(() => openPayForm(item), 0); } }, '記一筆繳款') : null,
        item.hasSettings ? h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openCardStatement(first), 0); } }, '帳單明細') : null,
        h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openCardSettingsForm({ account: first, card: state.data.cardSettings.find((c) => c.accountId === first.id) }), 0); } }, item.hasSettings ? '設定' : '設定信用卡')),
      h('div', { class: 'day-head' }, h('span', null, item.isGroup ? '這張帳單包含的卡片' : '卡片')),
      h('ul', { class: 'list' }, members)),
  });
  return sheet;
}

/** 總覽列（帳戶頁的信用卡區與信用卡總覽頁共用）：第一行名稱，第二行狀態標籤＋繳款日（總覽頁再加本期已刷與額度條） */
export function cardRow(item, compact) {
  const sub = h('div', { class: 's' }, dueBadge(item), ' ',
    !item.hasSettings ? '請先設定結帳日與繳款日'
      : item.statementAmountDue > 0 ? `繳款日 ${mmdd(item.dueDate)}`
        : `可用 ${item.availableCredit === null ? '未設定額度' : money(item.availableCredit, item.symbol)}`);
  return h('button', { class: 'item', 'data-card-group': item.name, onclick: () => openCardGroupSheet(item) },
    h('div', { class: 'ico' }, icon('card')),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, item.name, item.isGroup ? h('span', { class: 'muted small', style: { marginLeft: '6px', fontWeight: 400 } }, `${item.members.length} 張卡`) : null),
      sub,
      compact ? null : meter(item)),
    h('div', { class: 'amt' + (item.overdue ? ' amt-due' : '') }, item.hasSettings && item.statementAmountDue > 0 ? money(item.statementAmountDue, item.symbol) : ''));
}

/** 信用卡總覽頁（帳戶 → 信用卡 子分頁） */
export function renderCards(root, { subtabs }) {
  const d = state.data;
  const ov = d.cardOverview || { items: [], totalDue: 0, nearest: null };
  const items = ov.items;
  const head = h('div', { class: 'card hero' },
    h('div', { class: 'label' }, '信用卡待繳合計'),
    h('div', { class: 'big', 'data-testid': 'card-total-due' }, money(ov.totalDue, d.base)),
    h('div', { class: 'muted small' }, ov.nearest ? `最近繳款日 ${mmdd(ov.nearest.dueDate)}（${ov.nearest.name}）${ov.nearest.dueInDays < 0 ? '，已逾期' : ov.nearest.dueInDays === 0 ? '，今天' : `，${ov.nearest.dueInDays} 天後`}` : '目前沒有待繳的帳單'));
  const list = items.length
    ? h('div', { class: 'card' }, h('ul', { class: 'list' }, items.map((it) => h('li', null, cardRow(it, false)))))
    : h('div', { class: 'card empty' }, h('div', { class: 'big' }, icon('card')), '還沒有信用卡帳戶。到「帳戶」新增類型為「信用卡」的帳戶，再設定結帳日與繳款日。');
  mount(root,
    h('div', { class: 'page-head' }, h('h1', null, '信用卡')),
    subtabs('cards'),
    h('div', { class: 'stack' }, head, list,
      h('p', { class: 'muted small' }, '同一家銀行合併寄帳單的卡片（同「額度群組」）只顯示一筆，金額是整組加總；點進去可以看各卡明細與記繳款。')));
}

/** 首頁提醒卡（有待繳才顯示） */
export function cardDueNotice() {
  const ov = state.data.cardOverview;
  if (!ov || !ov.nearest || ov.totalDue <= 0) return null;
  const n = ov.nearest;
  const urgent = n.dueInDays <= DUE_SOON_DAYS;
  const when = n.dueInDays < 0 ? `已逾期 ${-n.dueInDays} 天` : n.dueInDays === 0 ? '今天到期' : `${n.dueInDays} 天後到期`;
  return h('div', { class: 'notice' + (urgent ? ' bad' : ''), 'data-testid': 'card-due-notice' }, icon('card'), h('div', null,
    `信用卡待繳 ${money(ov.totalDue, state.data.base)}`,
    h('div', { class: 'small muted' }, `最近一筆：${n.name} ${money(n.amount, n.symbol)}，${mmdd(n.dueDate)} ${when}`),
    h('div', null, h('a', { href: '#/accounts/cards' }, '看信用卡總覽'))));
}

// 記住帳戶頁各分區的收合狀態（純本機偏好）
export function sectionCollapsed(key) { try { return (JSON.parse(localStorage.getItem('fin.acctCollapsed') || '{}'))[key] === true; } catch (e) { return false; } }
export function setSectionCollapsed(key, v) {
  try { const o = JSON.parse(localStorage.getItem('fin.acctCollapsed') || '{}'); if (v) o[key] = true; else delete o[key]; localStorage.setItem('fin.acctCollapsed', JSON.stringify(o)); } catch (e) { /* 忽略 */ }
}
