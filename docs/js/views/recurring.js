import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state, instrumentBySymbol } from '../store.js';
import * as api from '../api.js';
import { money, dateLabel, categoryInfo, sortCategories } from '../fmt.js';
import { openSheet, toast, errorText, withBusy, confirmDialog } from '../ui.js';
import { write, mergeRow, refreshInBackground, patchRow } from '../data.js';

const FREQS = ['每週', '每月', '每季', '每年', '每N天'];
const ANCHORS = { 固定: '固定：從起始日起每 N 天', 實際日期: '從實際付款日起算（晚付也沒關係）' };
const HOLIDAYS = ['順延', '提前', '不調整'];
const MODES = ['自動入帳', '提醒確認', '券商定期定額', '手動下單'];
const TYPES = ['收入', '支出', '轉帳', '換匯', '買入', '賣出', '股息', '貸款還款'];
const MODE_HINT = {
  自動入帳: '金額固定，到期直接入帳，不用你確認（例如房租、固定轉帳）。',
  提醒確認: '金額每次可能不同，到期產生「待確認」，你確認或修改金額後才入帳（例如電話費、水電費）。',
  券商定期定額: '券商在約定日直接扣款並成交，到期產生「待確認」，等券商成交後你回來填實際結果。交割日＝成交日（當天扣款）。',
  手動下單: '到期當天提醒你自己去下單，回來填實際成交結果；交割日依實際成交日＋證券帳戶設定自動算出，可手動改。',
};

function fieldHelpers() {
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
  const clearErr = () => { banner.style.display = 'none'; Object.values(msgs).forEach((m) => { m.wrap.classList.remove('err'); m.msg.style.display = 'none'; }); };
  return { banner, fld, showErr, clearErr };
}

// ==================== 首頁「N 筆待確認」====================
export function pendingCount() {
  const d = state.data;
  return d && d.pendingConfirmations ? d.pendingConfirmations.length : 0;
}

// ==================== 主畫面：定期範本（待確認移到「待辦」頁） ====================
export function renderRecurring(root) {
  const d = state.data;
  const pending = (d.pendingConfirmations || []).length;
  const pendingLink = pending
    ? h('a', { class: 'notice', href: '#/todo', 'data-testid': 'recurring-todo-link', style: { display: 'block', marginBottom: '12px', textDecoration: 'none' } }, `有 ${pending} 筆待確認，到「待辦」處理 →`)
    : null;

  const templates = (d.recurring || []).slice().sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));
  const tplCard = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, h('h2', null, '定期範本'),
      h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'add-recurring', onclick: () => openRecurringForm({}) }, icon('plus'), '新增')),
    templates.length
      ? h('ul', { class: 'list' }, templates.map((t) => h('li', null, templateRow(t))))
      : h('div', { class: 'muted', style: { padding: '8px 0' } }, '還沒有定期範本'));

  mount(root, h('div', { class: 'page-head' }, h('h1', null, '定期')), pendingLink, tplCard);
}

/** 立即檢查股息公告（平常每天早上 7 點自動檢查） */
export async function checkDividendsNow(btn) {
  await withBusy(btn, async () => {
    try {
      const r = await api.call('checkDividends', {});
      const coming = (r.waiting || []).filter((w) => w.exDate >= state.data.today);
      const parts = [];
      parts.push(r.created.length ? `新增 ${r.created.length} 筆待確認股息` : '沒有新的股息');
      if (coming.length) parts.push('即將除息：' + coming.map((w) => `${w.symbol}（${w.exDate.slice(5).replace('-', '/')}${w.cash ? '，每股 ' + w.cash : ''}）`).join('、'));
      if (r.errors && r.errors.length) parts.push('部分資料抓不到，明天會再試');
      toast(parts.join('；'));
      if (r.created.length) refreshInBackground();
    } catch (err) { toast(errorText(err), { kind: 'bad' }); }
  });
}

export function groupPending(list) {
  const byGroup = new Map();
  const out = [];
  list.forEach((t) => {
    if (t.groupId) {
      if (!byGroup.has(t.groupId)) { const arr = []; byGroup.set(t.groupId, arr); out.push(arr); }
      byGroup.get(t.groupId).push(t);
    } else out.push([t]);
  });
  return out;
}

function legLabel(t) {
  if (t.type === '買入' || t.type === '賣出') {
    const sym = t.type === '買入' ? t.dstSymbol : t.srcSymbol;
    return `${t.type}　${sym}　預計 ${money(t.srcQty ?? t.dstQty, t.srcSymbol || t.dstSymbol)}`;
  }
  if (t.type === '股息') return t.dstQty === null || t.dstQty === undefined || t.dstQty === '' ? `股息　${t.relatedSymbol || ''}　金額待填` : `股息　${t.relatedSymbol || ''}　預估實收 ${money(t.dstQty, t.dstSymbol)}`;
  if (t.type === '轉帳' || t.type === '換匯') return `${t.type}　${money(t.srcQty, t.srcSymbol)} → ${money(t.dstQty, t.dstSymbol)}`;
  if (t.dstAccount) return `${t.type}　${money(t.dstQty, t.dstSymbol)}`;
  return `${t.type}　${money(t.srcQty, t.srcSymbol)}`;
}

export function pendingRow(group) {
  const first = group[0];
  const d = state.data;
  return h('div', { class: 'item pending-item', 'data-testid': 'pending-item' },
    h('div', { class: 'ico' }, icon('refresh')),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, first.templateName || '定期交易', h('span', { class: 'badge', style: { marginLeft: '6px' } }, first.mode || '')),
      h('div', { class: 's' }, (first.type === '股息' ? '預估發放 ' : '') + dateLabel(first.date, d.today) + '　' + group.map(legLabel).join('；')),
      first.autoDividend && first.plannedDate ? h('div', { class: 's' }, `除息日 ${first.plannedDate}　稅前 ${money(first.amount, first.dstSymbol)}${first.fee ? '－匯費 ' + money(first.fee, first.dstSymbol) : ''}${first.tax ? '－二代健保 ' + money(first.tax, first.dstSymbol) : ''}`) : null,
      first.suggested && first.suggested.reason ? h('div', { class: 's', style: { color: 'var(--accent, #b3852c)' } }, `建議金額 ${money(first.suggested.amount, first.srcSymbol)}　${first.suggested.reason}`) : null),
    h('div', { class: 'row-flex', style: { gap: '6px' } },
      (group.length === 1 && (isManualOrder(first) || first.anchor === '實際日期')) ? h('button', { class: 'btn btn-sm', 'data-testid': 'postpone-pending', onclick: () => openPostponeDialog(first) }, '延後') : null,
      h('button', { class: 'btn btn-sm', onclick: () => skipGroup(group) }, '略過'),
      h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'confirm-pending', onclick: () => openConfirmDialog(group) }, '確認')));
}

function isManualOrder(t) { return t.mode === '手動下單'; }

async function skipGroup(group) {
  const ok = await confirmDialog({ title: '略過', message: `確定要略過「${group[0].templateName || '這筆定期交易'}」嗎？這期就不會入帳，也不會再重新產生。`, danger: true });
  if (!ok) return;
  // 樂觀更新：先從本機的待確認清單拿掉這一組，背景送出，失敗自動還原
  const r = await write('skipPending', { id: group[0].id }, { optimistic: () => removePendingLocal(group), failPrefix: '略過失敗，已還原：' });
  if (r) toast('已略過');
}

/** 把一組待確認交易從本機清單移除，回傳還原函式 */
function removePendingLocal(group) {
  const d = state.data;
  const ids = group.map((t) => t.id);
  const snap = d.pendingConfirmations.slice();
  d.pendingConfirmations = d.pendingConfirmations.filter((t) => !ids.includes(t.id));
  return () => { d.pendingConfirmations = snap; };
}

function openPostponeDialog(item) {
  const input = h('input', { type: 'date', value: item.date });
  const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        const r = await api.call('postponePending', { id: item.id, date: input.value });
        sheet.close();
        if (r && r.tx) Object.assign(item, r.tx); // 先把新日期套到本機，背景再重新整理
        refreshInBackground(); toast('已延後');
      } catch (err) { toast(errorText(err), { kind: 'bad' }); }
    });
  } }, '儲存');
  const sheet = openSheet({
    title: '延後到哪一天',
    body: h('div', null, h('p', { class: 'muted small', style: { marginTop: 0 } }, item.anchor === '實際日期' ? '仍是同一筆待確認，只是改成預計哪天付款；實際付款後按確認，下一次會從那天起算。' : '仍是同一筆待確認，只是改成別天再下單，不會多產生一筆。'),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, item.anchor === '實際日期' ? '預計哪天付款' : '新的預計日期'), input)),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save],
  });
}

// ---------- 確認 ----------
function openConfirmDialog(group) {
  const first = group[0];
  if (group.length === 1 && (first.type === '買入' || first.type === '賣出')) return openTradeConfirm(first);
  if (group.length === 1 && first.type === '股息') return openDividendConfirm(first);
  return openSimpleConfirm(group); // 一組多筆（貸款還款）或非投資類型：用簡單確認
}

/** 貸款還款這類「一組多筆、金額已由排程算好」：或非投資類型的簡單確認（可調整日期與金額） */
function openSimpleConfirm(group) {
  const first = group[0];
  const isGroup = group.length > 1;
  const f = { date: first.date, srcQty: first.srcQty !== null && first.srcQty !== undefined ? String(first.srcQty) : '', dstQty: first.dstQty !== null && first.dstQty !== undefined ? String(first.dstQty) : '' };
  const { banner, fld, showErr, clearErr } = fieldHelpers();
  const body = h('div');
  if (isGroup) {
    mount(body, banner, h('div', { class: 'notice', style: { marginBottom: '12px' } }, '這是一組交易（例如貸款還款的本金＋利息），金額已由攤還表算好，確認即可。'),
      h('ul', { class: 'list' }, group.map((t) => h('li', null, h('div', { class: 'item' }, h('div', { class: 'grow' }, legLabel(t)))))));
  } else {
    const dateInput = h('input', { type: 'date', value: f.date, onchange: (e) => { f.date = e.target.value; } });
    const parts = [fld('date', first.anchor === '實際日期' ? '實際付款日' : '日期', dateInput,
      first.anchor === '實際日期' ? `下一次會從這天起算 ${first.intervalDays || 'N'} 天` : null)];
    if (first.type === '收入' || first.type === '支出') {
      // 可以換成這次實際付款（入帳）的帳戶，預設是範本設定的帳戶
      const key = first.type === '支出' ? 'srcAccount' : 'dstAccount';
      const sym = first.type === '支出' ? first.srcSymbol : first.dstSymbol;
      f[key] = first[key];
      const opts = (state.data.accounts || []).filter((a) => a.active !== false && (a.id === first[key] || (['銀行', '數位錢包', '現金', '信用卡', '點數'].includes(a.type) && (!a.defaultSymbol || a.defaultSymbol === sym))));
      parts.push(fld(key, first.type === '支出' ? '付款帳戶' : '入帳帳戶', h('select', { 'data-testid': 'confirm-account', onchange: (e) => { f[key] = e.target.value; } },
        opts.map((a) => h('option', { value: a.id, selected: a.id === first[key] }, a.name)))));
    }
    if (first.srcAccount) parts.push(fld('srcQty', `金額（${first.srcSymbol}）`, h('input', { type: 'text', inputmode: 'decimal', value: f.srcQty, oninput: (e) => { f.srcQty = e.target.value; } })));
    if (first.dstAccount) parts.push(fld('dstQty', `金額（${first.dstSymbol}）`, h('input', { type: 'text', inputmode: 'decimal', value: f.dstQty, oninput: (e) => { f.dstQty = e.target.value; } })));
    mount(body, banner, ...parts);
  }
  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'confirm-save', onclick: async (e) => {
    clearErr();
    await withBusy(e.currentTarget, async () => {
      try {
        const params = { id: first.id, requestId: api.newRequestId() };
        if (!isGroup) params.trade = { date: f.date, srcQty: f.srcQty === '' ? undefined : f.srcQty, dstQty: f.dstQty === '' ? undefined : f.dstQty, srcAccount: f.srcAccount, dstAccount: f.dstAccount };
        await api.call('confirmPending', params);
        sheet.close(); removePendingLocal(group); refreshInBackground(); toast('已確認入帳');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details && err.details.errors) err.details.errors.forEach((x) => showErr(x.field, x.message));
        else { banner.style.display = ''; mount(banner, errorText(err)); }
      }
    });
  } }, '確認入帳');
  const sheet = openSheet({ title: '確認' + (first.templateName || ''), dismissable: false, body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save] });
}

/** 股息：預估的稅前／匯費／二代健保都可以改；改了前三個會自動重算實收，也可以直接改實收（以實收為準入帳） */
function openDividendConfirm(item) {
  const sym = item.dstSymbol || 'TWD';
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  const f = { date: item.date, amount: str(item.amount), fee: str(item.fee || (item.amount ? 0 : '')), tax: str(item.tax || (item.amount ? 0 : '')), dstQty: str(item.dstQty) };
  const { banner, fld, showErr, clearErr } = fieldHelpers();
  const netInput = h('input', { type: 'text', inputmode: 'decimal', value: f.dstQty, 'data-testid': 'div-net', oninput: (e) => { f.dstQty = e.target.value; } });
  const recalc = () => {
    const g = Number(f.amount), fe = Number(f.fee || 0), tx = Number(f.tax || 0);
    if (f.amount !== '' && isFinite(g) && isFinite(fe) && isFinite(tx)) { f.dstQty = String(Math.round((g - fe - tx) * 100) / 100); netInput.value = f.dstQty; }
  };
  const num = (key) => h('input', { type: 'text', inputmode: 'decimal', value: f[key], oninput: (e) => { f[key] = e.target.value; recalc(); } });
  const intro = item.autoDividend
    ? `系統依除息日（${item.plannedDate}）前一天的持股估算。等股息實際入帳後，把金額改成存摺／App 上實際收到的就好。`
    : '把實際收到的股息金額填進來。稅前股息、手續費、預扣稅不知道可以留空。';
  const body = h('div', null, banner,
    h('div', { class: 'notice', style: { marginBottom: '12px' } }, intro),
    fld('date', '入帳日', h('input', { type: 'date', value: f.date, onchange: (e) => { f.date = e.target.value; } })),
    fld('amount', `稅前股息（${sym}，選填）`, num('amount')),
    fld('fee', `匯費／手續費（${sym}，選填）`, num('fee')),
    fld('tax', `二代健保／預扣稅（${sym}，選填）`, num('tax')),
    fld('dstQty', `實收金額（${sym}）`, netInput, '入帳金額以這個為準'));
  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'confirm-save', onclick: async (e) => {
    clearErr();
    if (f.dstQty === '' || !(Number(f.dstQty) > 0)) { showErr('dstQty', '請輸入實際收到的金額'); return; }
    await withBusy(e.currentTarget, async () => {
      try {
        const trade = { date: f.date, dstQty: f.dstQty, amount: f.amount, fee: f.fee, tax: f.tax };
        await api.call('confirmPending', { id: item.id, trade, requestId: api.newRequestId() });
        sheet.close(); removePendingLocal([item]); refreshInBackground(); toast('已確認入帳');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details && err.details.errors) err.details.errors.forEach((x) => showErr(x.field, x.message));
        else { banner.style.display = ''; mount(banner, errorText(err)); }
      }
    });
  } }, '確認入帳');
  const sheet = openSheet({ title: '確認' + (item.templateName || '股息'), dismissable: false, body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save] });
}

/** 買入／賣出：填實際成交結果（成交日、股數、成交金額、手續費、稅款、實付／實收金額），交割日自動算出可覆寫 */
function openTradeConfirm(item) {
  const isBuy = item.type === '買入';
  const quote = (instrumentBySymbol(isBuy ? item.dstSymbol : item.srcSymbol) || {}).quote || 'TWD';
  const cashSym = isBuy ? item.srcSymbol : item.dstSymbol;
  const f = {
    date: item.date, qty: '', amount: '', fee: '', tax: '',
    cashQty: item.suggested ? String(item.suggested.amount) : (item.srcQty !== null && item.srcQty !== undefined ? String(item.srcQty) : ''),
    settleDate: '', settleTouched: false,
  };
  const { banner, fld, showErr, clearErr } = fieldHelpers();
  const num = (key) => h('input', { type: 'text', inputmode: 'decimal', value: f[key], oninput: (e) => { f[key] = e.target.value; } });
  const dateInput = h('input', { type: 'date', value: f.date, onchange: (e) => { f.date = e.target.value; } });
  const settleInput = h('input', { type: 'date', value: f.settleDate, onchange: (e) => { f.settleDate = e.target.value; f.settleTouched = true; } });

  const body = h('div', null, banner,
    item.suggested && item.suggested.reason ? h('div', { class: 'notice', style: { marginBottom: '12px' } }, `建議金額：${money(item.suggested.amount, item.srcSymbol)}（${item.suggested.reason}，你仍可以自行輸入其他金額）`) : null,
    fld('date', '實際成交日', dateInput),
    fld('qty', isBuy ? '成交股數' : '賣出股數', num('qty')),
    fld('amount', `成交金額（${quote}）`, num('amount')),
    fld('fee', `手續費（${quote}，選填）`, num('fee')),
    fld('tax', `稅款（${quote}，選填）`, num('tax')),
    fld('cashQty', isBuy ? `實付金額（${cashSym}）` : `實收金額（${cashSym}）`, num('cashQty')),
    fld('settleDate', '交割日（選填，留空自動算）', settleInput, '留空會依實際成交日＋證券帳戶設定自動算出'));

  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'confirm-save', onclick: async (e) => {
    clearErr();
    await withBusy(e.currentTarget, async () => {
      try {
        const trade = { date: f.date, qty: f.qty, amount: f.amount, fee: f.fee || 0, tax: f.tax || 0, cashQty: f.cashQty };
        if (f.settleTouched && f.settleDate) trade.settleDate = f.settleDate;
        await api.call('confirmPending', { id: item.id, trade, requestId: api.newRequestId() });
        sheet.close(); removePendingLocal([item]); refreshInBackground(); toast('已確認入帳');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details && err.details.errors) err.details.errors.forEach((x) => showErr(x.field, x.message));
        else { banner.style.display = ''; mount(banner, errorText(err)); }
      }
    });
  } }, '確認入帳');
  const sheet = openSheet({ title: '確認' + (item.templateName || ''), dismissable: false, body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save] });
}

function freqLabel(t) {
  if (t.freq === '每N天') return `每 ${t.days} 天${t.anchor === '實際日期' ? '（從實際付款日起算）' : ''}`;
  return `${t.freq}・${t.days}號`;
}

// ==================== 範本列表 ====================
function templateRow(t) {
  return h('div', { class: 'item', 'data-testid': 'recurring-item' },
    h('div', { class: 'ico' }, icon('refresh')),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, t.name, t.active ? '' : h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, '已停用')),
      h('div', { class: 's' }, `${freqLabel(t)}　${t.type}／${t.mode}`)),
    h('div', { class: 'row-flex', style: { gap: '6px' } },
      h('button', { class: 'btn btn-sm', onclick: () => openRecurringForm({ recurring: t }) }, '編輯'),
      h('button', { class: 'btn btn-sm ' + (t.active ? 'btn-danger' : ''), onclick: () => {
        // 樂觀更新：先在本機切換，背景送出，失敗自動還原
        patchRow('setRecurringActive', { id: t.id, active: !t.active }, { list: 'recurring', idField: 'id', id: t.id, patch: { active: !t.active }, toast: t.active ? '已停用' : '已啟用' });
      } }, t.active ? '停用' : '啟用')));
}

// ==================== 新增／編輯範本 ====================
export function openRecurringForm({ recurring = null, onDone } = {}) {
  const d = state.data;
  const editing = !!recurring;
  const f = recurring ? {
    name: recurring.name, freq: recurring.freq, days: recurring.days, holiday: recurring.holiday || '順延',
    startDate: recurring.startDate, endDate: recurring.endDate || '', type: recurring.type, mode: recurring.mode,
    srcAccount: recurring.srcAccount || '', srcSymbol: recurring.srcSymbol || '', srcQty: recurring.srcQty !== null && recurring.srcQty !== undefined ? String(recurring.srcQty) : '',
    dstAccount: recurring.dstAccount || '', dstSymbol: recurring.dstSymbol || '', dstQty: recurring.dstQty !== null && recurring.dstQty !== undefined ? String(recurring.dstQty) : '',
    categoryId: recurring.categoryId || '', remindDays: String(recurring.remindDays ?? 1), settleDays: recurring.settleDays !== null && recurring.settleDays !== undefined ? String(recurring.settleDays) : '',
    note: recurring.note || '', anchor: recurring.anchor || '固定',
  } : {
    name: '', freq: '每月', days: '', holiday: '順延', startDate: d.today, endDate: '', type: '支出', mode: '自動入帳',
    srcAccount: '', srcSymbol: 'TWD', srcQty: '', dstAccount: '', dstSymbol: 'TWD', dstQty: '',
    categoryId: '', remindDays: '1', settleDays: '', note: '', anchor: '固定',
  };
  const { banner, fld, showErr, clearErr } = fieldHelpers();
  const accounts = d.accounts.filter((a) => a.active);
  const currencies = d.instruments.filter((i) => i.type === '法幣' && i.active);
  const investSymbols = d.instruments.filter((i) => i.type !== '法幣' && i.active);
  const loanAccounts = accounts.filter((a) => a.type === '貸款');

  const body = h('div');
  function accountSel(key, list, placeholder) {
    return h('select', { onchange: (e) => { f[key] = e.target.value; } },
      [placeholder ? h('option', { value: '' }, placeholder) : null].concat((list || accounts).map((a) => h('option', { value: a.id, selected: a.id === f[key] }, a.name))));
  }
  function symbolSel(key, list) {
    return h('select', { onchange: (e) => { f[key] = e.target.value; } }, (list || currencies).map((i) => h('option', { value: i.symbol, selected: i.symbol === f[key] }, i.symbol)));
  }
  function categorySel() {
    const wantType = f.type === '收入' ? '收入' : '支出';
    // 父分類在前、子分類跟在自己的父分類後面，「其他」一律最後
    const parents = sortCategories(d.categories.filter((c) => c.type === wantType && !c.parentId));
    const cats = [].concat(...parents.map((p) => [p].concat(sortCategories(d.categories.filter((c) => c.parentId === p.id)))));
    return h('select', { onchange: (e) => { f.categoryId = e.target.value; } },
      [h('option', { value: '' }, '請選擇')].concat(cats.map((c) => h('option', { value: c.id, selected: c.id === f.categoryId }, categoryInfo(c.id).name))));
  }

  function draw() {
    const parts = [
      fld('name', '名稱', h('input', { type: 'text', maxlength: 40, value: f.name, oninput: (e) => { f.name = e.target.value; } })),
      fld('type', '類型', h('select', { onchange: (e) => { f.type = e.target.value; draw(); } }, TYPES.map((t) => h('option', { value: t, selected: t === f.type }, t)))),
      fld('mode', '執行方式', h('select', { onchange: (e) => { f.mode = e.target.value; draw(); } }, MODES.map((m) => h('option', { value: m, selected: m === f.mode }, m))), MODE_HINT[f.mode]),
      fld('freq', '頻率', h('select', { 'data-testid': 'recurring-freq', onchange: (e) => { f.freq = e.target.value; draw(); } }, FREQS.map((fr) => h('option', { value: fr, selected: fr === f.freq }, fr)))),
      fld('days', f.freq === '每週' ? '星期幾（0＝週日，可填多個，用逗號分隔）' : f.freq === '每N天' ? '每幾天一次（例如 31）' : '執行日（可填多個，用逗號分隔，例如 6,16,26）', h('input', { type: 'text', inputmode: f.freq === '每N天' ? 'numeric' : 'text', value: f.days, oninput: (e) => { f.days = e.target.value; } }),
        f.freq === '每N天' ? '第一次是「起始日」，之後每隔這麼多天一次，不管大小月' : null),
      f.freq === '每N天' ? fld('anchor', '下一次怎麼算', h('select', { 'data-testid': 'recurring-anchor', onchange: (e) => { f.anchor = e.target.value; if (f.anchor === '實際日期') f.mode = '提醒確認'; draw(); } },
        Object.keys(ANCHORS).map((k) => h('option', { value: k, selected: k === (f.anchor || '固定') }, ANCHORS[k]))),
        (f.anchor || '固定') === '實際日期' ? '到期產生「待確認」；還沒付就按「延後」，付了按確認並填實際日期，下一次從那天再算；這次不買就按「略過」，從略過那天再算。' : '例如 App 每 31 天扣款一次') : null,
      fld('holiday', '假日處理', h('select', { onchange: (e) => { f.holiday = e.target.value; } }, HOLIDAYS.map((hh) => h('option', { value: hh, selected: hh === f.holiday }, hh)))),
      fld('startDate', '起始日', h('input', { type: 'date', value: f.startDate, onchange: (e) => { f.startDate = e.target.value; } })),
      fld('endDate', '結束日（選填）', h('input', { type: 'date', value: f.endDate, onchange: (e) => { f.endDate = e.target.value; } })),
    ];

    if (f.type === '貸款還款') {
      parts.push(
        fld('dstAccount', '貸款帳戶', accountSel('dstAccount', loanAccounts, '請選擇')),
        fld('srcAccount', '扣款帳戶（選填，沒填就用貸款設定裡的預設扣款帳戶）', accountSel('srcAccount', accounts.filter((a) => ['銀行', '數位錢包', '現金'].includes(a.type)), '（不指定）')));
    } else if (f.type === '收入' || f.type === '支出' || f.type === '股息') {
      const isIncome = f.type === '收入' || f.type === '股息';
      parts.push(fld(isIncome ? 'dstAccount' : 'srcAccount', isIncome ? '入帳帳戶' : '付款帳戶', accountSel(isIncome ? 'dstAccount' : 'srcAccount', accounts, '請選擇')));
      parts.push(fld(isIncome ? 'dstSymbol' : 'srcSymbol', '幣別', symbolSel(isIncome ? 'dstSymbol' : 'srcSymbol')));
      if (f.type === '股息') {
        if (!investSymbols.some((i) => i.symbol === f.srcSymbol)) f.srcSymbol = '';
        parts.push(fld('srcSymbol', '這筆股息屬於哪個標的', h('select', { onchange: (e) => { f.srcSymbol = e.target.value; } },
          [h('option', { value: '' }, '請選擇')].concat(investSymbols.map((i) => h('option', { value: i.symbol, selected: i.symbol === f.srcSymbol }, `${i.symbol} ${i.name || ''}`)))),
          '台股／ETF 的現金股息系統會在除息日自動產生，不用設定範本；美股（複委託）這類沒有公開資料的才需要'));
      }
      parts.push(fld(isIncome ? 'dstQty' : 'srcQty', f.type === '股息' ? '預計金額（選填，留空等入帳時再填）' : '預計金額', h('input', { type: 'text', inputmode: 'decimal', value: isIncome ? f.dstQty : f.srcQty, oninput: (e) => { f[isIncome ? 'dstQty' : 'srcQty'] = e.target.value; } })));
      if (f.type === '收入' || f.type === '支出') parts.push(fld('categoryId', '分類', categorySel()));
    } else if (f.type === '轉帳' || f.type === '換匯') {
      parts.push(
        fld('srcAccount', '轉出／付款帳戶', accountSel('srcAccount', accounts, '請選擇')),
        fld('srcSymbol', '幣別', symbolSel('srcSymbol')),
        fld('srcQty', '金額', h('input', { type: 'text', inputmode: 'decimal', value: f.srcQty, oninput: (e) => { f.srcQty = e.target.value; } })),
        fld('dstAccount', '轉入／收款帳戶', accountSel('dstAccount', accounts.filter((a) => a.id !== f.srcAccount), '請選擇')),
        fld('dstSymbol', '幣別', symbolSel('dstSymbol')),
        fld('dstQty', '金額', h('input', { type: 'text', inputmode: 'decimal', value: f.dstQty, oninput: (e) => { f.dstQty = e.target.value; } })));
    } else if (f.type === '買入' || f.type === '賣出') {
      const isBuy = f.type === '買入';
      parts.push(
        fld(isBuy ? 'srcAccount' : 'dstAccount', isBuy ? '付款帳戶' : '收款帳戶', accountSel(isBuy ? 'srcAccount' : 'dstAccount', accounts, '請選擇')),
        fld(isBuy ? 'srcSymbol' : 'dstSymbol', '幣別', symbolSel(isBuy ? 'srcSymbol' : 'dstSymbol')),
        fld(isBuy ? 'dstAccount' : 'srcAccount', '證券帳戶', accountSel(isBuy ? 'dstAccount' : 'srcAccount', accounts.filter((a) => a.type === '證券' || a.type === '加密交易所'), '請選擇')),
        fld(isBuy ? 'dstSymbol' : 'srcSymbol', '標的', symbolSel(isBuy ? 'dstSymbol' : 'srcSymbol', investSymbols)),
        fld(isBuy ? 'srcQty' : 'dstQty', '預計投入金額', h('input', { type: 'text', inputmode: 'decimal', value: isBuy ? f.srcQty : f.dstQty, oninput: (e) => { f[isBuy ? 'srcQty' : 'dstQty'] = e.target.value; } })));
      if (f.mode === '券商定期定額' || f.mode === '手動下單') {
        parts.push(fld('remindDays', '資金備妥提醒（到期日前幾個營業日寄信）', h('input', { type: 'text', inputmode: 'numeric', value: f.remindDays, oninput: (e) => { f.remindDays = e.target.value; } })));
      }
      parts.push(fld('settleDays', '交割天數（選填，留空用預設值：券商定期定額＝0、手動下單＝證券帳戶設定）', h('input', { type: 'text', inputmode: 'numeric', value: f.settleDays, oninput: (e) => { f.settleDays = e.target.value; } })));
    }
    parts.push(fld('note', '備註（選填）', h('input', { type: 'text', maxlength: 200, value: f.note, oninput: (e) => { f.note = e.target.value; } })));
    mount(body, banner, ...parts);
  }
  draw();

  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'recurring-save', onclick: async (e) => {
    clearErr();
    await withBusy(e.currentTarget, async () => {
      try {
        const payload = { ...f, days: f.days.split(',').map((s) => s.trim()).filter(Boolean).map(Number) };
        if (recurring) payload.id = recurring.id;
        const r = await api.call('upsertRecurring', { recurring: payload, expectedUpdatedAt: recurring ? recurring.updatedAt : undefined });
        sheet.close();
        mergeRow('recurring', 'id', r.recurring); refreshInBackground();
        if (onDone) await onDone();
        toast(editing ? '已儲存修改' : '已新增定期範本');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details && err.details.errors) err.details.errors.forEach((x) => showErr(x.field, x.message));
        else { banner.style.display = ''; mount(banner, errorText(err)); }
      }
    });
  } }, editing ? '儲存修改' : '新增');

  const sheet = openSheet({
    title: editing ? '編輯定期範本' : '新增定期範本', dismissable: false,
    body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save],
  });
  return sheet;
}
