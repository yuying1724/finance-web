import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state, accountById, balanceOf, instrumentBySymbol, brokerSettingsOf, suggestSettleDate } from '../store.js';
import * as api from '../api.js';
import { money, decimalsOf, categoryInfo } from '../fmt.js';
import { openSheet, toast } from '../ui.js';
import { refresh, write, applyTxLocal } from '../data.js';

const last = { type: '支出', acct: '', acct2: '' };
const PRIMARY = ['支出', '收入', '轉帳', '換匯'];
const EXTRA = ['退款', '調整', '買入', '賣出', '股息', '股數調整'];
const EXTRA_LABEL = { 調整: '餘額調整（對帳）', 股數調整: '拆股／併股' };
const INVEST_TYPES = ['買入', '賣出', '股息', '股數調整'];

function parseAmount(s) {
  const t = String(s === null || s === undefined ? '' : s).replace(/[,\s]/g, '');
  if (t === '') return { empty: true };
  const n = Number(t);
  return Number.isFinite(n) ? { n } : { bad: true };
}

/** 把後端回報的欄位名稱換成畫面上的欄位 */
function uiField(type, serverField) {
  const twoSided = type === '轉帳' || type === '換匯';
  if (type === '買入') {
    const m = { date: 'date', note: 'note', settleDate: 'settleDate', amount: 'gross', fee: 'fee', tax: 'tax',
      srcAccount: 'cashAcct', srcSymbol: 'cashSym', srcQty: 'cashQty', dstAccount: 'instAcct', dstSymbol: 'instSym', dstQty: 'instQty' };
    return m[serverField] || 'form';
  }
  if (type === '賣出') {
    const m = { date: 'date', note: 'note', settleDate: 'settleDate', amount: 'gross', fee: 'fee', tax: 'tax',
      srcAccount: 'instAcct', srcSymbol: 'instSym', srcQty: 'instQty', dstAccount: 'cashAcct', dstSymbol: 'cashSym', dstQty: 'cashQty' };
    return m[serverField] || 'form';
  }
  if (type === '股息') {
    const m = { date: 'date', note: 'note', amount: 'gross', fee: 'fee', tax: 'tax', relatedSymbol: 'relatedSymbol',
      dstAccount: 'cashAcct', dstSymbol: 'cashSym', dstQty: 'cashQty' };
    return m[serverField] || 'form';
  }
  if (type === '股數調整') {
    const m = { date: 'date', note: 'note', srcAccount: 'instAcct', srcSymbol: 'instSym', srcQty: 'instQty',
      dstAccount: 'instAcct', dstSymbol: 'instSym', dstQty: 'instQty' };
    return m[serverField] || 'form';
  }
  const map = {
    date: 'date', note: 'note', categoryId: 'cat', relatedTxId: 'related', type: 'type',
    srcAccount: 'acct', srcSymbol: 'sym', srcQty: 'amount',
    dstAccount: twoSided ? 'acct2' : 'acct', dstSymbol: twoSided ? (type === '換匯' ? 'sym2' : 'sym') : 'sym', dstQty: twoSided ? 'amount2' : 'amount',
  };
  return map[serverField] || 'form';
}

export function openTxForm({ tx = null, preset = {}, onDone, draft = null, serverErrors = null } = {}) {
  const d = state.data;
  const editing = !!tx;
  const today = d.today;
  const requestId = api.newRequestId();
  const usedAccounts = editing ? [tx.srcAccount, tx.dstAccount].filter(Boolean) : [];
  const usedSymbols = editing ? [tx.srcSymbol, tx.dstSymbol].filter(Boolean) : [];
  const accounts = d.accounts.filter((a) => a.active || usedAccounts.includes(a.id));
  const symbols = d.instruments.filter((i) => i.active || usedSymbols.includes(i.symbol)).sort((a, b) => (a.type === '法幣' ? 0 : 1) - (b.type === '法幣' ? 0 : 1));
  const currencies = symbols.filter((i) => i.type === '法幣');
  const investSymbols = symbols.filter((i) => i.type !== '法幣');

  if (!accounts.length) { toast('請先到「帳戶」新增至少一個帳戶', { kind: 'bad' }); return; }

  let type = editing ? tx.type : preset.type || (d.enabledTxTypes.includes(last.type) ? last.type : '支出');
  const f = {
    date: editing ? tx.date : today, note: editing ? tx.note : '', categoryId: editing ? tx.categoryId : '',
    acct: '', sym: '', amount: '', acct2: '', sym2: '', amount2: '', side: 'dst', actual: '', related: preset.related || null,
    instAcct: '', instSym: '', instQty: '', cashAcct: '', cashSym: '', cashQty: '', gross: '', fee: '', tax: '',
    settleDate: '', settleTouched: false, relatedSymbol: '', adjSide: 'dst',
  };

  const fmtNum = (n) => String(n);
  if (editing) {
    if (type === '支出') Object.assign(f, { acct: tx.srcAccount, sym: tx.srcSymbol, amount: fmtNum(tx.srcQty) });
    else if (type === '收入' || type === '退款') Object.assign(f, { acct: tx.dstAccount, sym: tx.dstSymbol, amount: fmtNum(tx.dstQty) });
    else if (type === '轉帳' || type === '換匯') Object.assign(f, { acct: tx.srcAccount, sym: tx.srcSymbol, amount: fmtNum(tx.srcQty), acct2: tx.dstAccount, sym2: tx.dstSymbol, amount2: fmtNum(tx.dstQty) });
    else if (type === '調整') Object.assign(f, { acct: tx.dstAccount || tx.srcAccount, sym: tx.dstSymbol || tx.srcSymbol, side: tx.dstAccount ? 'dst' : 'src', amount: fmtNum(tx.dstQty !== null && tx.dstAccount ? tx.dstQty : tx.srcQty) });
    else if (type === '買入') Object.assign(f, { cashAcct: tx.srcAccount, cashSym: tx.srcSymbol, cashQty: fmtNum(tx.srcQty), instAcct: tx.dstAccount, instSym: tx.dstSymbol, instQty: fmtNum(tx.dstQty), gross: fmtNum(tx.amount), fee: fmtNum(tx.fee || 0), tax: fmtNum(tx.tax || 0), settleDate: tx.settleDate || tx.date, settleTouched: true });
    else if (type === '賣出') Object.assign(f, { instAcct: tx.srcAccount, instSym: tx.srcSymbol, instQty: fmtNum(tx.srcQty), cashAcct: tx.dstAccount, cashSym: tx.dstSymbol, cashQty: fmtNum(tx.dstQty), gross: fmtNum(tx.amount), fee: fmtNum(tx.fee || 0), tax: fmtNum(tx.tax || 0), settleDate: tx.settleDate || tx.date, settleTouched: true });
    else if (type === '股息') Object.assign(f, { cashAcct: tx.dstAccount, cashSym: tx.dstSymbol, cashQty: fmtNum(tx.dstQty), gross: fmtNum(tx.amount || 0), fee: fmtNum(tx.fee || 0), tax: fmtNum(tx.tax || 0), relatedSymbol: tx.relatedSymbol });
    else if (type === '股數調整') Object.assign(f, { instAcct: tx.dstAccount || tx.srcAccount, instSym: tx.dstSymbol || tx.srcSymbol, adjSide: tx.dstAccount ? 'dst' : 'src', instQty: fmtNum(tx.dstAccount ? tx.dstQty : tx.srcQty) });
    f.related = null;
  } else if (preset.related) {
    const r = preset.related;
    Object.assign(f, { acct: r.srcAccount, sym: r.srcSymbol, amount: fmtNum(r.srcQty), categoryId: r.categoryId });
  }
  if (!editing && preset.acct && accounts.some((a) => a.id === preset.acct)) { f.acct = preset.acct; f.sym = accountById(preset.acct).defaultSymbol; }
  if (!f.acct) {
    const remembered = accounts.find((a) => a.id === last.acct);
    const a = remembered || accounts[0];
    f.acct = a.id; f.sym = a.defaultSymbol;
  }
  if (!f.acct2) { const other = accounts.find((a) => a.id !== f.acct && a.id === last.acct2) || accounts.find((a) => a.id !== f.acct) || accounts[0]; f.acct2 = other.id; }
  if (!f.sym) f.sym = (accountById(f.acct) || {}).defaultSymbol || 'TWD';
  if (!f.sym2) f.sym2 = (currencies.find((c) => c.symbol !== f.sym) || currencies[0] || { symbol: 'TWD' }).symbol;
  if (!f.instAcct) { const a = accounts.find((a2) => a2.type === '證券' || a2.type === '加密交易所') || accounts[0]; f.instAcct = a.id; }
  if (!f.cashAcct) { const a = accounts.find((a2) => a2.id !== f.instAcct && (a2.type === '銀行' || a2.type === '數位錢包')) || accounts.find((a2) => a2.id !== f.instAcct) || accounts[0]; f.cashAcct = a.id; }
  if (!f.instSym && investSymbols.length) f.instSym = investSymbols[0].symbol;
  if (!f.cashSym) f.cashSym = (accountById(f.cashAcct) || {}).defaultSymbol || 'TWD';
  if (draft) { type = draft.type; Object.assign(f, draft.f); } // 儲存失敗後「重新編輯」：帶回剛才輸入的內容

  const bodyBox = h('div');
  const banner = h('div', { class: 'notice bad', role: 'alert', style: { display: 'none', marginBottom: '10px' } });
  const fieldEls = {};

  // ---------- 欄位元件 ----------
  function field(key, label, ...content) {
    const el = h('div', { class: 'field', dataset: { field: key } }, label ? h('span', { class: 'lbl' }, label) : null, ...content, h('div', { class: 'msg', style: { display: 'none' } }));
    fieldEls[key] = el;
    return el;
  }
  function setError(key, message) {
    const el = fieldEls[key] || fieldEls.form;
    if (!el) { banner.style.display = ''; mount(banner, message); return; }
    el.classList.add('err');
    const msg = el.querySelector('.msg');
    if (msg) { msg.style.display = ''; msg.textContent = message; }
    if (!el.__scrolled) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.__scrolled = true; }
  }
  function clearErrors() {
    banner.style.display = 'none';
    Object.values(fieldEls).forEach((el) => { el.classList.remove('err'); el.__scrolled = false; const m = el.querySelector('.msg'); if (m) m.style.display = 'none'; });
  }

  let wantFocus = true;
  function accountSelect(key, label, accKey, symKey, changesSym = true, list) {
    const hint = h('div', { class: 'muted small', style: { marginTop: '3px' } });
    const paint = () => {
      if (type === '調整' && !editing) { hint.textContent = ''; return; }
      const bal = balanceOf(f[accKey], f[symKey]);
      hint.textContent = f[accKey] ? `目前餘額 ${money(bal, f[symKey], { noMask: false })}` : '';
    };
    const opts = list || accounts;
    const sel = h('select', { 'aria-label': label, onchange: (e) => {
      f[accKey] = e.target.value;
      const a = accountById(f[accKey]);
      if (a && symKey && changesSym && !f[symKey + 'Touched']) { f[symKey] = a.defaultSymbol; }
      draw();
    } }, opts.map((a) => h('option', { value: a.id, selected: a.id === f[accKey] }, a.name + (a.active ? '' : '（已停用）'))));
    paint();
    return field(key, label, sel, hint);
  }

  function symbolSelect(symKey, list) {
    return h('select', { 'aria-label': '幣別', onchange: (e) => { f[symKey] = e.target.value; f[symKey + 'Touched'] = true; draw(); } },
      (list || symbols).map((i) => h('option', { value: i.symbol, selected: i.symbol === f[symKey] }, i.symbol)));
  }

  function amountField(key, label, amtKey, symKey, list, autofocus) {
    const input = h('input', { type: 'text', inputmode: 'decimal', class: 'amount-input', autocomplete: 'off', placeholder: '0', value: f[amtKey], 'aria-label': label,
      oninput: (e) => { f[amtKey] = e.target.value; paintRate(); } });
    if (autofocus && wantFocus && !editing) { wantFocus = false; setTimeout(() => input.focus(), 60); }
    const dec = decimalsOf(f[symKey]);
    return field(key, label, h('div', { class: 'two' }, input, symbolSelect(symKey, list)),
      h('div', { class: 'muted small', style: { marginTop: '3px' } }, dec === 0 ? `${f[symKey]} 不含小數` : `${f[symKey]} 最多 ${dec} 位小數`));
  }

  /** 投資用：一個純數字輸入（不含幣別選單，幣別/股數位數已經由旁邊的標的或帳戶選單決定） */
  function plainAmountField(key, label, valKey, decSym, placeholder, autofocus) {
    const dec = decimalsOf(decSym);
    const input = h('input', { type: 'text', inputmode: 'decimal', class: 'amount-input', autocomplete: 'off', placeholder: placeholder || '0', value: f[valKey], 'aria-label': label,
      oninput: (e) => { f[valKey] = e.target.value; paintImplied(); } });
    if (autofocus && wantFocus && !editing) { wantFocus = false; setTimeout(() => input.focus(), 60); }
    return field(key, label, input, h('div', { class: 'muted small', style: { marginTop: '3px' } }, dec === 0 ? `${decSym} 不含小數` : `${decSym} 最多 ${dec} 位小數`));
  }

  function dateField() {
    const input = h('input', { type: 'date', value: f.date, 'aria-label': '日期', onchange: (e) => { f.date = e.target.value; autoSettleDate(); } });
    const quick = h('div', { class: 'chips', style: { marginTop: '6px' } },
      [['今天', today], ['昨天', FinDates.addDays(today, -1)], ['前天', FinDates.addDays(today, -2)]].map(([t, v]) =>
        h('button', { type: 'button', class: 'chip', onclick: () => { f.date = v; input.value = v; autoSettleDate(); } }, t)));
    return field('date', '日期', input, quick);
  }
  const noteField = () => field('note', '備註（選填）', h('input', { type: 'text', maxlength: 500, value: f.note, placeholder: '例如：和同事聚餐', oninput: (e) => { f.note = e.target.value; } }));

  /** 交割日：依證券帳戶設定與休市日自動帶出，除非使用者手動改過就不再自動覆蓋 */
  const settleHint = h('div', { class: 'muted small', style: { marginTop: '3px' } });
  function autoSettleDate() {
    if (f.settleTouched) return;
    f.settleDate = suggestSettleDate(f.instAcct, f.date, type === '買入' ? 'buy' : 'sell');
    if (settleInputRef) settleInputRef.value = f.settleDate;
    settleHint.textContent = '已依證券帳戶設定與休市日自動帶出，可手動修改';
  }
  let settleInputRef = null;
  function settleDateField() {
    settleInputRef = h('input', { type: 'date', value: f.settleDate, 'aria-label': '交割日', onchange: (e) => { f.settleDate = e.target.value; f.settleTouched = true; } });
    autoSettleDate();
    return field('settleDate', '交割日', settleInputRef, settleHint);
  }

  function categoryField(catType) {
    const box = h('div');
    const paint = () => {
      const sel = f.categoryId ? d.categories.find((c) => c.id === f.categoryId) : null;
      const selParent = sel ? (sel.parentId || sel.id) : '';
      const parents = d.categories.filter((c) => !c.parentId && c.type === catType && (c.active || c.id === selParent));
      const kids = selParent ? d.categories.filter((c) => c.parentId === selParent && (c.active || c.id === f.categoryId)) : [];
      mount(box,
        h('div', { class: 'cat-grid' }, parents.map((p) => h('button', { type: 'button', class: p.id === selParent ? 'on' : '', 'data-cat': p.name, onclick: () => { f.categoryId = p.id; paint(); } },
          icon(p.icon || 'dots', 'e'), h('span', null, p.name)))),
        kids.length ? h('div', { class: 'chips', style: { marginTop: '10px' } },
          h('button', { type: 'button', class: 'chip' + (f.categoryId === selParent ? ' on' : ''), onclick: () => { f.categoryId = selParent; paint(); } }, '不細分'),
          kids.map((k) => h('button', { type: 'button', class: 'chip' + (k.id === f.categoryId ? ' on' : ''), 'data-cat': k.name, onclick: () => { f.categoryId = k.id; paint(); } }, k.name))) : null);
    };
    paint();
    return field('cat', '分類', box);
  }

  const rateBox = h('div', { class: 'muted small', style: { marginTop: '-4px', marginBottom: '10px' } });
  function paintRate() {
    if (type !== '換匯') return;
    const a = parseAmount(f.amount), b = parseAmount(f.amount2);
    if (!a.n || !b.n) { rateBox.textContent = ''; return; }
    const twd = f.sym === 'TWD' ? a.n : f.sym2 === 'TWD' ? b.n : null;
    if (twd !== null) {
      const fx = f.sym === 'TWD' ? b.n : a.n, fxSym = f.sym === 'TWD' ? f.sym2 : f.sym;
      rateBox.textContent = `匯率：1 ${fxSym} ≈ ${FinMoney.format(twd / fx, 3, { trim: true })} TWD`;
    } else rateBox.textContent = `匯率：1 ${f.sym} ≈ ${FinMoney.format(b.n / a.n, 4, { trim: true })} ${f.sym2}`;
  }

  const impliedBox = h('div', { class: 'muted small', style: { marginTop: '-4px', marginBottom: '10px' } });
  /** 買入／賣出：實付／實收金額 vs（成交金額+手續費+稅款）換算出的隱含匯率，只是給使用者參考，真正的合理性檢查在後端 */
  function paintImplied() {
    if (type !== '買入' && type !== '賣出') { impliedBox.textContent = ''; return; }
    const inst = instrumentBySymbol(f.instSym);
    if (!inst || inst.quote === f.cashSym) { impliedBox.textContent = ''; return; }
    const g = parseAmount(f.gross), fee = parseAmount(f.fee), cash = parseAmount(f.cashQty);
    if (!g.n || !cash.n) { impliedBox.textContent = ''; return; }
    const total = g.n + (fee.n || 0) + (parseAmount(f.tax).n || 0);
    if (!total) { impliedBox.textContent = ''; return; }
    impliedBox.textContent = `隱含匯率：1 ${inst.quote} ≈ ${FinMoney.format(cash.n / total, 4, { trim: true })} ${f.cashSym}`;
  }

  // ---------- 依類型畫出欄位 ----------
  function draw() {
    for (const k of Object.keys(fieldEls)) delete fieldEls[k];
    const parts = [];
    if (type === '支出') {
      parts.push(amountField('amount', '金額', 'amount', 'sym', null, true), accountSelect('acct', '付款帳戶', 'acct', 'sym'), categoryField('支出'), dateField(), noteField());
    } else if (type === '收入') {
      parts.push(amountField('amount', '金額', 'amount', 'sym', null, true), accountSelect('acct', '入帳帳戶', 'acct', 'sym'), categoryField('收入'), dateField(), noteField());
    } else if (type === '退款') {
      parts.push(f.related ? h('div', { class: 'notice', style: { marginBottom: '12px' } }, `退款給：${categoryInfo(f.related.categoryId).name} ${money(f.related.srcQty, f.related.srcSymbol, { noMask: true })}（${f.related.date}）`) : null,
        amountField('amount', '退款金額', 'amount', 'sym', null, true), accountSelect('acct', '退回到哪個帳戶', 'acct', 'sym'), categoryField('支出'), dateField(), noteField());
    } else if (type === '轉帳') {
      parts.push(amountField('amount', '金額', 'amount', 'sym', null, true), accountSelect('acct', '轉出帳戶', 'acct', 'sym'), accountSelect('acct2', '轉入帳戶', 'acct2', 'sym', false), dateField(), noteField());
    } else if (type === '換匯') {
      parts.push(amountField('amount', '賣出（付出）', 'amount', 'sym', currencies, true), accountSelect('acct', '付款帳戶', 'acct', 'sym'),
        amountField('amount2', '買入（收到）', 'amount2', 'sym2', currencies), accountSelect('acct2', '入帳帳戶', 'acct2', 'sym2'), rateBox, dateField(), noteField());
    } else if (type === '調整') {
      if (editing) {
        parts.push(field('side', '方向', h('div', { class: 'seg' }, [['dst', '調多（增加）'], ['src', '調少（減少）']].map(([v, t]) =>
          h('button', { type: 'button', class: f.side === v ? 'on' : '', onclick: () => { f.side = v; draw(); } }, t)))),
        amountField('amount', '調整金額', 'amount', 'sym'), accountSelect('acct', '帳戶', 'acct', 'sym'), dateField(), noteField());
      } else {
        const diffBox = h('div', { class: 'muted small', style: { marginTop: '3px' } });
        const paintDiff = () => {
          const a = parseAmount(f.actual);
          if (a.empty || a.bad) { diffBox.textContent = `目前系統餘額 ${money(balanceOf(f.acct, f.sym), f.sym, { noMask: false })}`; return; }
          const dec = decimalsOf(f.sym);
          const diff = FinMoney.toUnits(a.n, dec) - FinMoney.toUnits(balanceOf(f.acct, f.sym), dec);
          diffBox.textContent = `目前系統餘額 ${money(balanceOf(f.acct, f.sym), f.sym)}，` + (diff === 0 ? '與輸入相同，不需要調整' : `將調整 ${diff > 0 ? '+' : '-'}${FinMoney.format(FinMoney.fromUnits(Math.abs(diff), dec), dec, { trim: dec > 2 })} ${f.sym}`);
        };
        const input = h('input', { type: 'text', inputmode: 'decimal', class: 'amount-input', autocomplete: 'off', placeholder: '0', value: f.actual, 'aria-label': '實際餘額', oninput: (e) => { f.actual = e.target.value; paintDiff(); } });
        if (wantFocus) { wantFocus = false; setTimeout(() => input.focus(), 60); }
        paintDiff();
        parts.push(h('div', { class: 'notice', style: { marginBottom: '12px' } }, '對帳用：輸入帳戶「實際的餘額」，系統會自動補上差額。差額會記為「餘額調整」，不計入收入或支出。'),
          accountSelect('acct', '帳戶', 'acct', 'sym'),
          field('actual', '實際餘額', h('div', { class: 'two' }, input, symbolSelect('sym')), diffBox), dateField(), noteField());
      }
    } else if (type === '買入' || type === '賣出') {
      const isBuy = type === '買入';
      const instSel = h('select', { 'aria-label': '標的', onchange: (e) => { f.instSym = e.target.value; f.settleTouched = false; autoSettleDate(); draw(); } },
        investSymbols.map((i) => h('option', { value: i.symbol, selected: i.symbol === f.instSym }, `${i.symbol}　${i.name}`)));
      const quote = (instrumentBySymbol(f.instSym) || {}).quote || 'TWD';
      if (!f.cashSymTouched && f.cashSym !== quote && !editing) f.cashSym = quote;
      parts.push(
        field('instSym', '標的', instSel, investSymbols.length ? null : h('div', { class: 'notice bad', style: { marginTop: '6px' } }, '請先到「標的」新增股票／ETF／加密貨幣等投資標的')),
        accountSelect('instAcct', isBuy ? '證券帳戶（存入股票）' : '證券帳戶（賣出股票）', 'instAcct', null, false),
        plainAmountField('instQty', isBuy ? '成交股數' : '賣出股數', 'instQty', f.instSym, '0', true),
        plainAmountField('gross', '成交金額（' + quote + '）', 'gross', quote),
        plainAmountField('fee', '手續費（' + quote + '，選填）', 'fee', quote),
        plainAmountField('tax', '稅款（' + quote + '，選填）', 'tax', quote),
        accountSelect('cashAcct', isBuy ? '付款帳戶' : '收款帳戶', 'cashAcct', 'cashSym'),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, isBuy ? '實付幣別' : '實收幣別'), symbolSelect('cashSym', currencies)),
        plainAmountField('cashQty', isBuy ? '實付金額' : '實收金額', 'cashQty', f.cashSym),
        impliedBox,
        settleDateField(),
        dateField(), noteField(),
      );
    } else if (type === '股息') {
      const relSel = h('select', { 'aria-label': '關聯標的', onchange: (e) => { f.relatedSymbol = e.target.value; draw(); } },
        [h('option', { value: '' }, '請選擇')].concat(investSymbols.map((i) => h('option', { value: i.symbol, selected: i.symbol === f.relatedSymbol }, `${i.symbol}　${i.name}`))));
      if (!f.relatedSymbol && investSymbols.length) f.relatedSymbol = investSymbols[0].symbol;
      parts.push(
        field('relatedSymbol', '這筆股息屬於哪個標的', relSel),
        accountSelect('cashAcct', '入帳帳戶', 'cashAcct', 'cashSym'),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, '入帳幣別'), symbolSelect('cashSym', currencies)),
        plainAmountField('cashQty', '實收金額', 'cashQty', f.cashSym, '0', true),
        plainAmountField('gross', '稅前股息（選填）', 'gross', f.cashSym),
        plainAmountField('tax', '預扣稅（選填）', 'tax', f.cashSym),
        plainAmountField('fee', '手續費（選填）', 'fee', f.cashSym),
        dateField(), noteField(),
      );
    } else if (type === '股數調整') {
      parts.push(
        h('div', { class: 'notice', style: { marginBottom: '12px' } }, '用於拆股、併股、股票更名：只改變股數，投資成本不變。'),
        field('adjSide', '方向', h('div', { class: 'seg' }, [['dst', '增加（拆股、配股）'], ['src', '減少（併股）']].map(([v, t]) =>
          h('button', { type: 'button', class: f.adjSide === v ? 'on' : '', onclick: () => { f.adjSide = v; draw(); } }, t)))),
        field('instSym', '標的', h('select', { 'aria-label': '標的', onchange: (e) => { f.instSym = e.target.value; draw(); } },
          investSymbols.map((i) => h('option', { value: i.symbol, selected: i.symbol === f.instSym }, `${i.symbol}　${i.name}`)))),
        accountSelect('instAcct', '帳戶', 'instAcct', null, false),
        plainAmountField('instQty', f.adjSide === 'dst' ? '增加的股數' : '減少的股數', 'instQty', f.instSym, '0', true),
        dateField(), noteField(),
      );
    }
    mount(bodyBox, ...parts);
    paintRate(); paintImplied();
  }

  // ---------- 送出 ----------
  function buildTx() {
    const base = { type, date: f.date, note: f.note.trim() };
    const amt = (key, label) => {
      const a = parseAmount(f[key]);
      if (a.empty) return { error: { field: key, message: `請輸入${label}` } };
      if (a.bad) return { error: { field: key, message: `${label}不是有效的數字` } };
      if (!(a.n > 0)) return { error: { field: key, message: `${label}必須大於 0` } };
      const symKey = key === 'amount2' ? 'sym2' : 'sym';
      if (!FinMoney.fitsDecimals(a.n, decimalsOf(f[symKey]))) return { error: { field: key, message: `${f[symKey]} 最多 ${decimalsOf(f[symKey])} 位小數` } };
      return { n: a.n };
    };
    const invAmt = (key, label, decSym) => {
      const a = parseAmount(f[key]);
      if (a.empty) return { error: { field: key, message: `請輸入${label}` } };
      if (a.bad) return { error: { field: key, message: `${label}不是有效的數字` } };
      if (!(a.n > 0)) return { error: { field: key, message: `${label}必須大於 0` } };
      if (!FinMoney.fitsDecimals(a.n, decimalsOf(decSym))) return { error: { field: key, message: `${decSym} 最多 ${decimalsOf(decSym)} 位小數` } };
      return { n: a.n };
    };
    const invAmtOpt = (key, label, decSym) => {
      if (String(f[key]).trim() === '') return { n: undefined };
      return invAmt(key, label, decSym);
    };
    if (!FinDates.isValid(f.date)) return { error: { field: 'date', message: '請選擇日期' } };
    if (type === '支出' || type === '收入' || type === '退款') {
      const a = amt('amount', type === '退款' ? '退款金額' : '金額'); if (a.error) return a;
      if (!f.categoryId) return { error: { field: 'cat', message: '請選擇分類' } };
      const t = { ...base, categoryId: f.categoryId };
      if (type === '支出') Object.assign(t, { srcAccount: f.acct, srcSymbol: f.sym, srcQty: a.n });
      else Object.assign(t, { dstAccount: f.acct, dstSymbol: f.sym, dstQty: a.n });
      if (type === '退款' && f.related) t.relatedTxId = f.related.id;
      return { tx: t };
    }
    if (type === '轉帳') {
      const a = amt('amount', '金額'); if (a.error) return a;
      if (f.acct === f.acct2) return { error: { field: 'acct2', message: '轉出與轉入不能是同一個帳戶' } };
      return { tx: { ...base, srcAccount: f.acct, srcSymbol: f.sym, srcQty: a.n, dstAccount: f.acct2, dstSymbol: f.sym, dstQty: a.n } };
    }
    if (type === '換匯') {
      const a = amt('amount', '賣出金額'); if (a.error) return a;
      const b = amt('amount2', '買入金額'); if (b.error) return b;
      if (f.sym === f.sym2) return { error: { field: 'sym2', message: '兩邊的幣別不能相同' } };
      return { tx: { ...base, srcAccount: f.acct, srcSymbol: f.sym, srcQty: a.n, dstAccount: f.acct2, dstSymbol: f.sym2, dstQty: b.n } };
    }
    if (type === '調整') {
      if (editing) {
        const a = amt('amount', '調整金額'); if (a.error) return a;
        return { tx: { ...base, ...(f.side === 'dst' ? { dstAccount: f.acct, dstSymbol: f.sym, dstQty: a.n } : { srcAccount: f.acct, srcSymbol: f.sym, srcQty: a.n }) } };
      }
      const a = parseAmount(f.actual);
      if (a.empty) return { error: { field: 'actual', message: '請輸入帳戶實際的餘額' } };
      if (a.bad) return { error: { field: 'actual', message: '實際餘額不是有效的數字' } };
      const dec = decimalsOf(f.sym);
      if (!FinMoney.fitsDecimals(a.n, dec)) return { error: { field: 'actual', message: `${f.sym} 最多 ${dec} 位小數` } };
      const diff = FinMoney.toUnits(a.n, dec) - FinMoney.toUnits(balanceOf(f.acct, f.sym), dec);
      if (diff === 0) return { error: { field: 'actual', message: '和系統餘額相同，不需要調整' } };
      const qty = FinMoney.fromUnits(Math.abs(diff), dec);
      return { tx: { ...base, ...(diff > 0 ? { dstAccount: f.acct, dstSymbol: f.sym, dstQty: qty } : { srcAccount: f.acct, srcSymbol: f.sym, srcQty: qty }) } };
    }
    if (type === '買入' || type === '賣出') {
      if (!f.instSym) return { error: { field: 'instSym', message: '請先新增投資標的' } };
      const qty = invAmt('instQty', '股數', f.instSym); if (qty.error) return qty;
      const gross = invAmt('gross', '成交金額', (instrumentBySymbol(f.instSym) || {}).quote || 'TWD'); if (gross.error) return gross;
      const fee = invAmtOpt('fee', '手續費', (instrumentBySymbol(f.instSym) || {}).quote || 'TWD'); if (fee.error) return fee;
      const tax = invAmtOpt('tax', '稅款', (instrumentBySymbol(f.instSym) || {}).quote || 'TWD'); if (tax.error) return tax;
      const cash = invAmt('cashQty', type === '買入' ? '實付金額' : '實收金額', f.cashSym); if (cash.error) return cash;
      const t = { ...base, settleDate: f.settleDate, amount: gross.n, fee: fee.n || 0, tax: tax.n || 0 };
      if (type === '買入') Object.assign(t, { srcAccount: f.cashAcct, srcSymbol: f.cashSym, srcQty: cash.n, dstAccount: f.instAcct, dstSymbol: f.instSym, dstQty: qty.n });
      else Object.assign(t, { srcAccount: f.instAcct, srcSymbol: f.instSym, srcQty: qty.n, dstAccount: f.cashAcct, dstSymbol: f.cashSym, dstQty: cash.n });
      return { tx: t };
    }
    if (type === '股息') {
      if (!f.relatedSymbol) return { error: { field: 'relatedSymbol', message: '請選擇這筆股息屬於哪個標的' } };
      const cash = invAmt('cashQty', '實收金額', f.cashSym); if (cash.error) return cash;
      const gross = invAmtOpt('gross', '稅前股息', f.cashSym); if (gross.error) return gross;
      const tax = invAmtOpt('tax', '預扣稅', f.cashSym); if (tax.error) return tax;
      const fee = invAmtOpt('fee', '手續費', f.cashSym); if (fee.error) return fee;
      return { tx: { ...base, dstAccount: f.cashAcct, dstSymbol: f.cashSym, dstQty: cash.n, amount: gross.n || 0, tax: tax.n || 0, fee: fee.n || 0, relatedSymbol: f.relatedSymbol } };
    }
    if (type === '股數調整') {
      if (!f.instSym) return { error: { field: 'instSym', message: '請先新增投資標的' } };
      const qty = invAmt('instQty', '股數', f.instSym); if (qty.error) return qty;
      return { tx: { ...base, ...(f.adjSide === 'dst' ? { dstAccount: f.instAcct, dstSymbol: f.instSym, dstQty: qty.n } : { srcAccount: f.instAcct, srcSymbol: f.instSym, srcQty: qty.n }) } };
    }
    return { error: { field: 'form', message: '不支援的類型' } };
  }

  const submitBtn = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'tx-save', onclick: submit }, editing ? '儲存修改' : '儲存');
  const cancelBtn = h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消');

  // 樂觀更新：按下儲存就關視窗，先把這筆交易套到本機（首頁最近交易、帳戶餘額、淨值），背景送出；
  // 後端回覆失敗就還原並提示；驗證不過的話可以按「重新編輯」把剛才的內容帶回表單。
  async function submit() {
    clearErrors();
    const built = buildTx();
    if (built.error) { setError(built.error.field, built.error.message); return; }
    last.type = type; last.acct = f.acct; if (type === '轉帳' || type === '換匯') last.acct2 = f.acct2;
    const localTx = Object.assign({}, editing ? tx : { status: '有效', createdAt: '', updatedAt: '' }, built.tx, { id: editing ? tx.id : 'tmp-' + Date.now().toString(36) });
    const params = editing ? { id: tx.id, expectedUpdatedAt: tx.updatedAt, tx: built.tx } : { tx: built.tx, requestId };
    const action = editing ? 'updateTransaction' : 'addTransaction';
    const reopen = (errors) => openTxForm({ tx, preset, onDone, draft: { type, f: Object.assign({}, f) }, serverErrors: errors || null });
    sheet.close();
    const res = await write(action, params, {
      optimistic: () => applyTxLocal(localTx, editing ? tx : null),
      onResult: (r) => { if (r && r.tx) { const i = state.data.recent.findIndex((t) => t.id === localTx.id); if (i >= 0) state.data.recent[i] = r.tx; } },
      retry: () => reopen(null),
      onError: (e) => {
        if (e.code === 'VALIDATION' && e.details && e.details.errors && e.details.errors.length) setTimeout(() => reopen(e.details.errors), 0);
      },
    });
    if (!res) return;
    if (onDone && onDone !== refresh) { try { await onDone(); } catch (e) { /* 資料稍後會自動更新 */ } }
    const saved = res.tx;
    const msgs = [editing ? '已儲存修改' : '已新增'].concat(res.warnings || []);
    toast(msgs.join('　'), editing ? {} : { action: { label: '復原', fn: async () => {
      const r = await write('voidTransaction', { id: saved.id, expectedUpdatedAt: saved.updatedAt }, { optimistic: () => applyTxLocal(Object.assign({}, saved, { status: '作廢' }), saved), failPrefix: '復原失敗：' });
      if (r) toast('已復原');
    } } });
  }

  // ---------- 視窗 ----------
  const typeSeg = h('div', { class: 'seg', role: 'tablist' });
  const extraRow = h('div', { class: 'chips', style: { margin: '8px 0 12px' } });
  function drawTypes() {
    const enabled = d.enabledTxTypes;
    mount(typeSeg, PRIMARY.filter((t) => enabled.includes(t)).map((t) => h('button', { type: 'button', role: 'tab', 'aria-selected': type === t, 'data-type': t, class: (type === t ? 'on ' : '') + (t === '收入' ? 't-inc' : ''), onclick: () => { type = t; wantFocus = true; drawTypes(); draw(); } }, t)));
    mount(extraRow, EXTRA.filter((t) => enabled.includes(t)).map((t) => h('button', { type: 'button', 'data-type': t, class: 'chip' + (type === t ? ' on' : '') + (INVEST_TYPES.includes(t) ? ' chip-invest' : ''), onclick: () => { type = t; wantFocus = true; f.settleTouched = false; drawTypes(); draw(); } }, EXTRA_LABEL[t] || t)));
  }
  drawTypes(); draw();
  if (serverErrors) { banner.style.display = ''; mount(banner, '剛才儲存失敗，請修正後再送出'); serverErrors.forEach((er) => setError(uiField(type, er.field), er.message)); }

  const sheet = openSheet({
    title: editing ? `編輯${type}` : '記一筆',
    body: h('div', null, banner, editing ? null : [typeSeg, extraRow], bodyBox),
    footer: [cancelBtn, submitBtn],
    dismissable: false,
  });
  return sheet;
}
