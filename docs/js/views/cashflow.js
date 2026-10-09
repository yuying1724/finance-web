import { h, mount, clear } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import * as api from '../api.js';
import { money } from '../fmt.js';
import { openSheet, errorText } from '../ui.js';

/**
 * 未來扣款日曆：未來 N 天每個帳戶會被扣（或入帳）多少、餘額夠不夠。
 * 資料來自後端 getCashflow（見 server/api.js cashflow()）：定期扣款、信用卡上期帳單與本期預估、貸款、交割款。
 * 兩種看法：依帳戶（每個帳戶從今天的餘額往下累計，不足的標紅）／依日期（全部排成一條時間軸）。
 */
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function md(d) { const t = new Date(d + 'T00:00:00Z'); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEK[t.getUTCDay()]}）`; }

const KIND_ICON = { 定期: 'refresh', 信用卡: 'card', 貸款: 'percent', 交割: 'graphUp' };

function itemRow(r, opts = {}) {
  const sign = r.direction === 'in' ? '+' : '-';
  const amt = r.amount === null || r.amount === undefined ? '金額未定' : sign + money(r.amount, r.symbol);
  const subParts = [md(r.date), r.kind];
  if (opts.showAccount) subParts.push(r.fundingName || '未指定扣款帳戶');
  return h('li', { 'data-testid': 'cf-item' }, h('div', { class: 'item' },
    h('div', { class: 'ico' }, icon(KIND_ICON[r.kind] || 'refresh')),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, r.name, r.estimated ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, '預估') : null,
        r.overdue ? h('span', { class: 'badge bad', style: { marginLeft: '6px' } }, '已逾期') : null),
      h('div', { class: 's' }, subParts.join('　'))),
    h('div', { style: { textAlign: 'right' } },
      h('div', { class: 'amt' + (r.direction === 'in' ? ' amt-pos' : '') }, amt),
      opts.showBalance && r.balanceAfter !== undefined ? h('div', { class: 'small ' + (r.balanceAfter < 0 ? 'amt-due' : 'muted') }, '餘額 ' + money(r.balanceAfter, r.symbol)) : null)));
}

function accountBlock(a) {
  const short = a.shortfall > 0;
  return h('div', { class: 'card', style: { padding: '12px', marginBottom: '10px' }, 'data-testid': 'cf-account', 'data-account': a.name },
    h('div', { class: 'card-title' },
      h('h2', { style: { fontSize: '15px' } }, a.name),
      short ? h('span', { class: 'badge bad' }, `${md(a.shortDate)} 起不足`) : h('span', { class: 'badge good' }, '餘額足夠')),
    h('div', { class: 'muted small', style: { marginBottom: '6px' } },
      `目前 ${money(a.balance, a.symbol)}　→　期末 ${money(a.endBalance, a.symbol)}` + (short ? `　最多還差 ${money(a.shortfall, a.symbol)}` : '')),
    h('ul', { class: 'list' }, a.items.map((r) => itemRow(r, { showBalance: true }))));
}

let view = 'account', days = 60;

export function openCashflow() {
  const body = h('div', null, h('div', { class: 'empty' }, '載入中…'));
  const sheet = openSheet({ title: '未來扣款日曆', body });
  let data = null;
  const load = () => {
    clear(body); mount(body, h('div', { class: 'empty' }, '載入中…'));
    api.call('getCashflow', { days }).then((r) => { data = r; draw(); })
      .catch((e) => { clear(body); mount(body, h('div', { class: 'notice bad' }, errorText(e))); });
  };
  const draw = () => {
    clear(body);
    const nameOf = (id) => { const a = (state.data.accounts || []).find((x) => x.id === id); return a ? a.name : ''; };
    data.items.forEach((r) => { r.fundingName = nameOf(r.fundingAccountId); });
    const chip = (on, label, fn) => h('button', { type: 'button', class: 'chip chip-sm' + (on ? ' on' : ''), onclick: fn }, label);
    const controls = h('div', { class: 'row-flex wrap', style: { justifyContent: 'space-between', marginBottom: '10px' } },
      h('div', { class: 'chips', style: { gap: '6px' } }, [30, 60, 90].map((n) => chip(days === n, `${n} 天`, () => { days = n; load(); }))),
      h('div', { class: 'chips', style: { gap: '6px' } }, chip(view === 'account', '依帳戶', () => { view = 'account'; draw(); }), chip(view === 'date', '依日期', () => { view = 'date'; draw(); })));
    const notices = [];
    data.accounts.filter((a) => a.shortfall > 0).forEach((a) => {
      const first = a.items.find((r) => r.date === a.shortDate);
      notices.push(h('div', { class: 'notice bad', style: { marginBottom: '8px' }, 'data-testid': 'cf-short' }, icon('alert'),
        h('div', null, `${a.name} 在 ${md(a.shortDate)} 可能不夠扣款${first ? `（${first.name}）` : ''}，最多還差 ${money(a.shortfall, a.symbol)}，記得提早轉帳進去。`)));
    });
    if (data.unassigned.length) {
      notices.push(h('div', { class: 'notice', style: { marginBottom: '8px' }, 'data-testid': 'cf-unassigned' }, icon('alert'),
        h('div', null, `有 ${data.unassigned.length} 筆不知道從哪個帳戶扣款，沒有算進各帳戶的餘額。`,
          h('div', { class: 'small muted' }, '信用卡請到「帳戶 → 信用卡 → 設定」指定「預設繳款帳戶」；貸款請到貸款設定指定扣款帳戶。'))));
    }
    const empty = !data.items.length ? h('div', { class: 'empty' }, `未來 ${data.days} 天沒有預計的扣款或入帳`) : null;
    let main;
    if (view === 'account') {
      main = h('div', null, data.accounts.map(accountBlock),
        data.unassigned.length ? h('div', { class: 'card', style: { padding: '12px' } },
          h('div', { class: 'card-title' }, h('h2', { style: { fontSize: '15px' } }, '未指定扣款帳戶')),
          h('ul', { class: 'list' }, data.unassigned.map((r) => itemRow(r)))) : null);
    } else {
      main = h('ul', { class: 'list' }, data.items.map((r) => itemRow(r, { showAccount: true, showBalance: !!r.fundingAccountId })));
    }
    mount(body, controls, notices, empty, main,
      h('p', { class: 'muted small', style: { marginTop: '10px' } },
        '「預估」：信用卡本期是到今天為止刷的金額，之後再刷還會增加；提醒確認／手動下單的定期以範本金額估算。外幣帳戶以原幣計算。'));
  };
  load();
  return sheet;
}

/** 首頁「待辦」卡用：未來 60 天有帳戶可能不足時的提醒列（沒有就回傳 null） */
export function cashAlertRow() {
  const ca = state.data && state.data.cashAlert;
  if (!ca || !ca.short || !ca.short.length) return null;
  const first = ca.short.slice().sort((a, b) => (a.shortDate < b.shortDate ? -1 : 1))[0];
  return h('li', null, h('button', { class: 'item', type: 'button', 'data-testid': 'cash-alert', onclick: () => openCashflow() },
    h('div', { class: 'ico', style: { color: 'var(--bad)' } }, icon('alert')),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, `${ca.short.length} 個帳戶餘額可能不夠扣款`),
      h('div', { class: 's' }, `最近：${first.name} ${md(first.shortDate)} 起，還差 ${money(first.shortfall, first.symbol)}`)),
    h('div', { class: 'amt muted' }, icon('right'))));
}
