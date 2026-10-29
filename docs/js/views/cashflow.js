import { h, mount, clear } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { money } from '../fmt.js';
import { openSheet, errorText, loading } from '../ui.js';
import { cachedRead } from '../readcache.js';
import { openTxForm } from './txform.js';
import { RECONCILE_TYPES, RECONCILE_STALE_DAYS, reconcileAge, reconcileText, openReconcile } from './accounts.js';

/**
 * 未來扣款日曆：未來 N 天每個帳戶會被扣（或入帳）多少、餘額夠不夠。
 * 資料來自後端 getCashflow（見 server/api.js cashflow()）：定期扣款、信用卡上期帳單與本期預估、貸款、交割款、還沒確認的收入／支出／股息。
 * 兩種看法：依帳戶（每個帳戶從今天的餘額往下累計，不足的標紅）／依日期（全部排成一條時間軸）。
 */
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function md(d) { const t = new Date(d + 'T00:00:00Z'); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEK[t.getUTCDay()]}）`; }

const KIND_ICON = { 定期: 'refresh', 信用卡: 'card', 貸款: 'percent', 交割: 'graphUp', 待確認: 'coin' };

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

/**
 * 補足用的轉出帳戶：同幣別的銀行／電子錢包（不含自己），以「這段期間最低點還剩多少」最多的那個；
 * 沒出現在日曆裡的帳戶就用目前餘額。都不夠也還是挑剩最多的（表單裡可以改）。
 */
export function suggestSource(short, cf) {
  const byId = {};
  (cf.accounts || []).forEach((g) => { if (g.symbol === short.symbol) byId[g.accountId] = g; });
  const cands = (state.data.accounts || []).filter((a) => a.active !== false && a.id !== short.accountId && ['銀行', '數位錢包'].includes(a.type)
    && (!a.defaultSymbol || a.defaultSymbol === short.symbol));
  let best = null;
  cands.forEach((a) => {
    const g = byId[a.id];
    const bal = (state.data.balances || []).find((b) => b.accountId === a.id && b.symbol === short.symbol);
    const spare = g ? Math.min(g.minBalance, g.balance) : (bal ? Number(bal.qty) || 0 : 0);
    if (spare > 0 && (!best || spare > best.spare)) best = { id: a.id, name: a.name, spare };
  });
  return best;
}

/** 不足的帳戶：「轉帳補足」帶好轉出（剩最多的帳戶）、轉入（不足的帳戶）、金額（最多還差多少）；很久沒對帳的提醒先對帳 */
function shortActions(a, cf, close, reopen) {
  const src = suggestSource(a, cf);
  const first = a.items.find((r) => r.date === a.shortDate);
  const btns = [h('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-testid': 'cf-topup', onclick: () => {
    close();
    setTimeout(() => openTxForm({ preset: { type: '轉帳', acct: src ? src.id : '', acct2: a.accountId, amount: Math.ceil(a.shortfall), note: '補足扣款' + (first ? '：' + first.name : '') }, onDone: reopen }), 0);
  } }, '轉帳補足 ' + money(Math.ceil(a.shortfall), a.symbol))];
  const age = RECONCILE_TYPES.includes(a.type) ? reconcileAge(a.accountId) : 0;
  const stale = age === null || age > RECONCILE_STALE_DAYS;
  if (stale) btns.push(h('button', { type: 'button', class: 'btn btn-sm', 'data-testid': 'cf-reconcile', onclick: () => {
    close();
    const acct = (state.data.accounts || []).find((x) => x.id === a.accountId);
    setTimeout(() => openReconcile(acct, reopen), 0);
  } }, '先對帳'));
  return h('div', null,
    src ? h('div', { class: 'small muted', style: { marginTop: '4px' } }, `建議從「${src.name}」轉（這段期間最少還有 ${money(src.spare, a.symbol)}）`) : null,
    stale ? h('div', { class: 'small', style: { marginTop: '4px' } }, reconcileText(a.accountId) + '。如果實際餘額比較多，對帳後這個提醒可能就不見了。') : null,
    h('div', { class: 'row-flex wrap', style: { gap: '6px', marginTop: '6px' } }, btns));
}

function accountBlock(a) {
  if (a.liability) {
    // 信用卡／應付：刷卡不用卡裡有錢，只會加進帳單，所以不算「不足」，改寫成這段期間會刷多少
    const isCard = a.type === '信用卡';
    return h('div', { class: 'card', style: { padding: '12px', marginBottom: '10px' }, 'data-testid': 'cf-account', 'data-account': a.name, 'data-liability': '1' },
      h('div', { class: 'card-title' },
        h('h2', { style: { fontSize: '15px' } }, a.name),
        h('span', { class: 'badge' }, isCard ? '刷卡' : '記在負債')),
      h('div', { class: 'muted small', style: { marginBottom: '6px' } },
        isCard ? `這段期間會再刷 ${money(a.totalOut, a.symbol)}，會算進之後的卡費帳單（由繳款帳戶付）`
          : `這段期間會再增加 ${money(a.totalOut, a.symbol)} 的負債`),
      h('ul', { class: 'list' }, a.items.map((r) => itemRow(r))));
  }
  const short = a.shortfall > 0;
  return h('div', { class: 'card', style: { padding: '12px', marginBottom: '10px' }, 'data-testid': 'cf-account', 'data-account': a.name },
    h('div', { class: 'card-title' },
      h('h2', { style: { fontSize: '15px' } }, a.name),
      short ? h('span', { class: 'badge bad' }, `${md(a.shortDate)} 起不足`) : h('span', { class: 'badge good' }, '餘額足夠')),
    h('div', { class: 'muted small', style: { marginBottom: '6px' } },
      `目前 ${money(a.balance, a.symbol)}　→　期末 ${money(a.endBalance, a.symbol)}` + (short ? `　最多還差 ${money(a.shortfall, a.symbol)}` : '')),
    !short && RECONCILE_TYPES.includes(a.type) ? h('div', { class: 'muted small', style: { marginBottom: '6px' } }, reconcileText(a.accountId)) : null,
    h('ul', { class: 'list' }, a.items.map((r) => itemRow(r, { showBalance: true }))));
}

let view = 'account';

export function openCashflow() {
  let days = 30; // 每次打開都從 30 天開始（首頁提醒也是看 30 天）
  const body = h('div', null, loading());
  const sheet = openSheet({ title: '未來扣款日曆', body });
  let data = null, seq = 0;
  const load = () => {
    const my = ++seq, want = days;
    // 本機快取先畫，背景再更新（記了新交易或超過 5 分鐘才會重抓）
    const r = cachedRead('getCashflow', { days: want }, {
      onData: (d) => { if (my !== seq || !body.isConnected) return; data = d; draw(); },
      onError: (e, meta) => { if (my !== seq || meta.hadData) return; clear(body); mount(body, h('div', { class: 'notice bad' }, errorText(e))); },
    });
    if (r.data === null) { clear(body); mount(body, loading()); }
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
        h('div', { class: 'grow' }, `${a.name} 在 ${md(a.shortDate)} 可能不夠扣款${first ? `（${first.name}）` : ''}，最多還差 ${money(a.shortfall, a.symbol)}，記得提早轉帳進去。`,
          shortActions(a, data, () => sheet.close(), () => openCashflow()))));
    });
    if (data.unassigned.length) {
      notices.push(h('div', { class: 'notice', style: { marginBottom: '8px' }, 'data-testid': 'cf-unassigned' }, icon('alert'),
        h('div', null, `有 ${data.unassigned.length} 筆不知道從哪個帳戶扣款，沒有算進各帳戶的餘額。`,
          h('div', { class: 'small muted' }, '信用卡請到「帳戶 → 信用卡 → 設定」指定「預設繳款帳戶」；貸款請到貸款設定指定扣款帳戶。'))));
    }
    const empty = !data.items.length ? h('div', { class: 'empty' }, `未來 ${data.days} 天沒有預計的扣款或入帳`) : null;
    let main;
    if (view === 'account') {
      main = h('div', null, data.accounts.map((a) => accountBlock(a)),
        data.unassigned.length ? h('div', { class: 'card', style: { padding: '12px' } },
          h('div', { class: 'card-title' }, h('h2', { style: { fontSize: '15px' } }, '未指定扣款帳戶')),
          h('ul', { class: 'list' }, data.unassigned.map((r) => itemRow(r)))) : null);
    } else {
      main = h('ul', { class: 'list' }, data.items.map((r) => itemRow(r, { showAccount: true, showBalance: !!r.fundingAccountId && !r.onLiability })));
    }
    mount(body, controls, notices, empty, main,
      h('p', { class: 'muted small', style: { marginTop: '10px' } },
        '「預估」：信用卡本期是到今天為止刷的金額，之後再刷還會增加；提醒確認／手動下單的定期以範本金額估算。外幣帳戶以原幣計算。'));
  };
  load();
  return sheet;
}

/**
 * 待辦頁的「轉帳補足」：用未來 30 天扣款日曆（有快取就用快取）挑轉出帳戶，再開記一筆轉帳。
 * short：bootstrap 的 cashAlert.short 其中一筆 { accountId, name, symbol, shortDate, shortfall, reason }
 */
export async function topupShort(short, onDone) {
  let cf = null;
  try { const r = cachedRead('getCashflow', { days: 30 }); cf = r.data || await r.promise; } catch (e) { cf = null; }
  const src = suggestSource(short, cf || { accounts: [] });
  openTxForm({ preset: { type: '轉帳', acct: src ? src.id : '', acct2: short.accountId, amount: Math.ceil(short.shortfall), note: '補足扣款' + (short.reason ? '：' + short.reason : '') }, onDone });
}

/** 首頁「待辦」卡用：未來 30 天有帳戶可能不足時的提醒列（沒有就回傳 null） */
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
