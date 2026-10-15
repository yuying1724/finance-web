import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { money, shares, amountClass } from '../fmt.js';
import { errorText, loading } from '../ui.js';
import { cachedRead } from '../readcache.js';
import { openTxForm } from './txform.js';

/**
 * 投資頁「交割」：跟券商 App 的「交割款項」一樣，依交割日列出每天要扣（或入帳）多少，點開看是哪幾筆買賣。
 * 上方是各交割帳戶的「目前餘額 → 待交割 → 交割後」，不夠就提醒最晚哪天前要轉多少，並可以直接開轉帳表單。
 * 券商定期定額另外標示、不算進交割金額（券商的交割款項也不會列）。資料來自後端 getSettlements。
 */
const MODES = [['0', '未交割'], ['7', '近 7 天'], ['30', '近 30 天']];
const LS = 'fin.st.mode';
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function md(d) { const t = new Date(d + 'T00:00:00Z'); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEK[t.getUTCDay()]}）`; }
function loadMode() { try { const v = localStorage.getItem(LS); if (MODES.some(([k]) => k === v)) return v; } catch (e) { /* 忽略 */ } return '0'; }
function saveMode(v) { try { localStorage.setItem(LS, v); } catch (e) { /* 忽略 */ } }
/** 應收付：付款顯示負號、收款正號（跟券商一樣） */
function signed(n, sym) { return n === 0 ? money(0, sym) : (n > 0 ? '+' : '-') + money(Math.abs(n), sym); }
/** 交割日的前一個營業日（跳過週末與台股休市日），轉帳要在這天前完成 */
function prevBusinessDay(d) {
  const closed = new Set(((state.data && state.data.holidays) || []).filter((x) => x.market === '台灣' && x.settling === false).map((x) => x.date));
  const t = new Date(d + 'T00:00:00Z');
  for (let i = 0; i < 15; i++) {
    t.setUTCDate(t.getUTCDate() - 1);
    const iso = t.toISOString().slice(0, 10);
    if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6 && !closed.has(iso)) break;
  }
  return md(t.toISOString().slice(0, 10));
}

export function renderSettlementsBody(root) {
  let mode = loadMode();
  const opened = new Set();
  const chipsBox = h('div');
  const body = h('div');
  mount(root, chipsBox, body);

  function chips() {
    mount(chipsBox, h('div', { class: 'chips', 'data-testid': 'st-modes', style: { marginBottom: '10px' } }, MODES.map(([k, label]) => h('button', {
      type: 'button', class: 'chip chip-sm' + (mode === k ? ' on' : ''), 'data-mode': k,
      onclick: () => { mode = k; saveMode(k); chips(); load(); },
    }, label))));
  }

  function accountCard(a) {
    const short = a.shortfall > 0;
    return h('div', { class: 'card st-acct' + (short ? ' st-short' : ''), 'data-testid': 'st-account', 'data-account': a.name },
      h('div', { class: 'card-title' }, h('h2', { style: { fontSize: '15px' } }, a.name), short ? h('span', { class: 'badge bad' }, '不足') : h('span', { class: 'badge' }, '足夠')),
      h('dl', { class: 'kv st-kv' },
        h('dt', null, '目前餘額'), h('dd', { class: 'amt' }, money(a.balance, a.symbol)),
        h('dt', null, '待交割'), h('dd', { class: a.pending < 0 ? 'amt' : amountClass('pos'), 'data-testid': 'st-pending' }, signed(a.pending, a.symbol)),
        h('dt', null, '交割後'), h('dd', { class: 'amt' + (a.after < 0 ? ' amt-due' : ''), 'data-testid': 'st-after' }, money(a.after, a.symbol))),
      short ? h('div', null,
        h('div', { class: 'small', style: { marginTop: '6px' }, 'data-testid': 'st-short' },
          `${md(a.shortDate)}交割前還差 ${money(a.shortfall, a.symbol)}，最好在 ${prevBusinessDay(a.shortDate)}前轉入（交割日當天早上扣款）`),
        h('div', { class: 'row-flex wrap', style: { gap: '6px', marginTop: '6px' } },
          h('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-testid': 'st-topup', onclick: () => openTxForm({
            preset: { type: '轉帳', acct2: a.accountId, amount: Math.ceil(a.shortfall), note: '補足交割款' },
            onDone: () => load(true),
          }) }, '轉帳補足 ' + money(Math.ceil(a.shortfall), a.symbol))))
        : null,
      h('div', { class: 'muted small', style: { marginTop: '6px' } }, '只算交割款；其他定期扣款、卡費請看首頁的「未來扣款日曆」'));
  }

  function itemRow(it, sym) {
    const what = `${it.type === '買入' ? '買進' : '賣出'} ${it.name}`;
    const sub = [it.tradeDate.slice(5).replace('-', '/') + ' 成交'];
    if (it.qty) sub.push(shares(it.qty, { symbol: it.symbol }) + (it.price ? ` @ ${it.price.toLocaleString('zh-TW', { maximumFractionDigits: 4 })}` : ''));
    return h('li', { 'data-testid': 'st-item' }, h('div', { class: 'item' },
      h('div', { class: 'grow' },
        h('div', { class: 't' }, what, it.regular ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, '定期定額') : null),
        h('div', { class: 's' }, sub.join('　'))),
      h('div', { class: it.direction === 'in' ? amountClass('pos') : 'amt' }, signed(it.direction === 'in' ? it.cash : -it.cash, sym))));
  }

  function groupRow(g) {
    const key = g.date + '|' + g.accountId + '|' + g.symbol;
    const isOpen = opened.has(key);
    const list = h('ul', { class: 'list st-items', style: { display: isOpen ? '' : 'none' } }, g.items.map((it) => itemRow(it, g.symbol)));
    const chev = icon('right', 'st-chev' + (isOpen ? ' open' : ''));
    const badge = g.status === '已交割' ? h('span', { class: 'badge st-done' }, '已交割') : g.status === '今日' ? h('span', { class: 'badge warn' }, '今日') : h('span', { class: 'badge' }, '未交割');
    const sub = [g.accountName, `${g.count} 筆`];
    if (g.regular.count) sub.push(`另有定期定額 ${g.regular.count} 筆 ${signed(g.regular.amount, g.symbol)}`);
    const head = h('button', { type: 'button', class: 'item st-head', 'data-testid': 'st-group', 'data-date': g.date, 'aria-expanded': String(isOpen),
      onclick: () => {
        const now = !opened.has(key);
        if (now) opened.add(key); else opened.delete(key);
        list.style.display = now ? '' : 'none';
        chev.classList.toggle('open', now);
        head.setAttribute('aria-expanded', String(now));
      } },
      chev,
      h('div', { class: 'grow' }, h('div', { class: 't' }, md(g.date), ' ', badge), h('div', { class: 's' }, sub.join('・'))),
      h('div', { style: { textAlign: 'right' } },
        h('div', { class: g.net > 0 ? amountClass('pos') : 'amt', 'data-testid': 'st-net' }, g.count ? signed(g.net, g.symbol) : '—'),
        g.balanceAfter !== undefined ? h('div', { class: 'small ' + (g.balanceAfter < 0 ? 'amt-due' : 'muted') }, '交割後 ' + money(g.balanceAfter, g.symbol)) : null));
    return h('li', null, head, list);
  }

  function draw(data, stale) {
    const out = [];
    const accts = data.accounts.filter((a) => a.pending !== 0 || a.shortfall > 0);
    accts.forEach((a) => out.push(accountCard(a)));
    const groups = data.groups.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // 新的在上（跟券商一樣）
    out.push(h('div', { class: 'card' + (stale ? ' is-stale' : ''), style: { marginTop: accts.length ? '12px' : 0 } },
      h('div', { class: 'card-title' }, h('h2', null, '交割款項'), h('span', { class: 'muted small' }, '負數＝要付、正數＝會收')),
      groups.length ? h('ul', { class: 'list', 'data-testid': 'st-list' }, groups.map(groupRow))
        : h('div', { class: 'empty', 'data-testid': 'st-empty' }, mode === '0' ? '目前沒有還沒交割的買賣' : '這段期間沒有交割款')));
    mount(body, ...out);
  }

  function load(force) {
    const params = { days: Number(mode) };
    let drawn = false;
    cachedRead('getSettlements', params, {
      force,
      onData: (data, meta) => { if (!body.isConnected || String(params.days) !== mode) return; drawn = true; draw(data, meta.stale); },
      onError: (e, meta) => { if (!body.isConnected || meta.hadData) return; mount(body, h('div', { class: 'notice bad' }, errorText(e))); },
    });
    if (!drawn) mount(body, loading());
  }

  chips();
  load();
}

/** 首頁「待辦與未來 30 天」用：7 天內還要交割的（依交割帳戶＋日期合計） */
export function settleSoonRows(list, mmdd) {
  return (list || []).map((s) => h('li', null, h('a', { class: 'item', href: '#/invest/settle', 'data-testid': 'settle-soon' },
    h('div', { class: 'ico' }, icon('graphUp')),
    h('div', { class: 'grow' }, h('div', { class: 't' }, `交割款（${s.accountName}）`),
      h('div', { class: 's' }, `${mmdd(s.date)}　${s.count} 筆買賣${s.balanceAfter !== undefined && s.balanceAfter < 0 ? '・餘額不足' : ''}`)),
    h('div', { class: s.net > 0 ? amountClass('pos') : 'amt' + (s.balanceAfter !== undefined && s.balanceAfter < 0 ? ' amt-due' : '') }, signed(s.net, s.symbol)))));
}

