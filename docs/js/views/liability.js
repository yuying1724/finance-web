import { h, mount, clear } from '../dom.js';
import { state, accountById } from '../store.js';
import * as api from '../api.js';
import { money } from '../fmt.js';
import { openSheet, toast, errorText, withBusy, confirmDialog } from '../ui.js';
import { refresh } from '../data.js';

const LOAN_METHODS = ['本息平均攤還', '本金平均攤還', '只繳息'];

function cashAccounts(exceptId) {
  return state.data.accounts.filter((a) => a.id !== exceptId && ['銀行', '數位錢包', '現金'].includes(a.type));
}

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

// ---------- 信用卡設定 ----------
export function openCardSettingsForm({ account, card, onDone } = {}) {
  const f = card ? { ...card } : { statementDay: '5', dueDay: '20', limit: '', payAccountId: '', note: '' };
  Object.keys(f).forEach((k) => { if (f[k] === null || f[k] === undefined) f[k] = ''; else f[k] = String(f[k]); });
  const { banner, fld, showErr, clearErr } = fieldHelpers();

  const numInput = (key, placeholder) => h('input', { type: 'text', inputmode: 'numeric', value: f[key], placeholder, oninput: (e) => { f[key] = e.target.value; } });
  const payAcctSel = h('select', { onchange: (e) => { f.payAccountId = e.target.value; } },
    [h('option', { value: '' }, '（不指定）')].concat(cashAccounts(account.id).map((a) => h('option', { value: a.id, selected: a.id === f.payAccountId }, a.name))));
  const noteInput = h('input', { type: 'text', maxlength: 200, value: f.note, oninput: (e) => { f.note = e.target.value; } });

  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'card-save', onclick: async (e) => {
    clearErr();
    await withBusy(e.currentTarget, async () => {
      try {
        await api.call('upsertCardSettings', { card: { accountId: account.id, statementDay: f.statementDay, dueDay: f.dueDay, limit: f.limit, payAccountId: f.payAccountId, note: f.note } });
        sheet.close();
        if (onDone) await onDone();
        toast('已儲存信用卡設定');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details && err.details.errors) err.details.errors.forEach((x) => showErr(x.field, x.message));
        else { banner.style.display = ''; mount(banner, errorText(err)); }
      }
    });
  } }, '儲存');

  const sheet = openSheet({
    title: '信用卡設定', dismissable: false,
    body: h('div', null, banner,
      h('div', { class: 'notice', style: { marginBottom: '12px' } }, `帳戶：${account.name}`),
      fld('statementDay', '結帳日', numInput('statementDay', '1～31'), '每個月幾號結算這一期帳單'),
      fld('dueDay', '繳款截止日', numInput('dueDay', '1～31'), '結帳日之後，帳單最晚繳款日'),
      fld('limit', '額度（選填）', numInput('limit'), '留空或填 0 表示不限制'),
      fld('payAccountId', '預設繳款帳戶（選填）', payAcctSel),
      fld('note', '備註（選填）', noteInput)),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save],
  });
  return sheet;
}

// ---------- 貸款設定 ----------
export function openLoanSettingsForm({ account, loan, onDone } = {}) {
  const editing = !!loan;
  const f = loan ? { ...loan } : { principal: '', rate: '', terms: '', startDate: new Date().toISOString().slice(0, 10), payDay: '15', method: LOAN_METHODS[0], payAccountId: '' };
  Object.keys(f).forEach((k) => { if (f[k] === null || f[k] === undefined) f[k] = ''; else f[k] = String(f[k]); });
  const { banner, fld, showErr, clearErr } = fieldHelpers();

  const numInput = (key, placeholder) => h('input', { type: 'text', inputmode: 'decimal', value: f[key], placeholder, oninput: (e) => { f[key] = e.target.value; } });
  const dateInput = h('input', { type: 'date', value: f.startDate, onchange: (e) => { f.startDate = e.target.value; } });
  const methodSel = h('select', { onchange: (e) => { f.method = e.target.value; } }, LOAN_METHODS.map((m) => h('option', { value: m, selected: m === f.method }, m)));
  const payAcctSel = h('select', { onchange: (e) => { f.payAccountId = e.target.value; } },
    [h('option', { value: '' }, '（不指定）')].concat(cashAccounts(account.id).map((a) => h('option', { value: a.id, selected: a.id === f.payAccountId }, a.name))));

  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'loan-save', onclick: async (e) => {
    clearErr();
    if (editing) {
      const ok = await confirmDialog({ title: '修改貸款設定', message: '修改貸款金額、利率、期數或起貸日會重新計算整份攤還表，之前記錄的還款交易不會自動調整，請自行確認。', confirmText: '仍要儲存' });
      if (!ok) return;
    }
    await withBusy(e.currentTarget, async () => {
      try {
        await api.call('upsertLoanSettings', { loan: { accountId: account.id, principal: f.principal, rate: f.rate, terms: f.terms, startDate: f.startDate, payDay: f.payDay, method: f.method, payAccountId: f.payAccountId } });
        sheet.close();
        if (onDone) await onDone();
        toast('已儲存貸款設定');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details && err.details.errors) err.details.errors.forEach((x) => showErr(x.field, x.message));
        else { banner.style.display = ''; mount(banner, errorText(err)); }
      }
    });
  } }, '儲存');

  const sheet = openSheet({
    title: '貸款設定', dismissable: false,
    body: h('div', null, banner,
      h('div', { class: 'notice', style: { marginBottom: '12px' } }, `帳戶：${account.name}`),
      fld('principal', '貸款金額', numInput('principal')),
      fld('rate', '年利率（%）', numInput('rate', '例如 2.1')),
      fld('terms', '期數（月）', numInput('terms', '例如 240')),
      fld('startDate', '起貸日', dateInput),
      fld('payDay', '每月還款日', numInput('payDay', '1～31')),
      fld('method', '還款方式', methodSel),
      fld('payAccountId', '預設扣款帳戶（選填）', payAcctSel)),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save],
  });
  return sheet;
}

// ---------- 信用卡帳單 ----------
export function openCardStatement(account) {
  const body = h('div', null, h('div', { class: 'empty' }, '載入中…'));
  const sheet = openSheet({ title: `${account.name}　帳單`, body });
  api.call('getCardStatement', { accountId: account.id }).then((s) => {
    clear(body);
    const rows = [
      ['本期消費', money(s.currentSpend, s.symbol)],
      ['目前總欠款', money(s.currentlyOwed, s.symbol)],
      ['上期帳單待繳', money(s.statementAmountDue, s.symbol)],
      ['繳款截止日', s.dueDate || '—'],
      ['可用額度', s.availableCredit === null ? '未設定額度' : money(s.availableCredit, s.symbol)],
    ];
    mount(body,
      s.overdue ? h('div', { class: 'notice bad', style: { marginBottom: '12px' } }, '這期帳單已逾期，請盡快繳款') : null,
      h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      h('div', { class: 'row-flex wrap', style: { marginTop: '16px' } },
        h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openCardSettingsForm({ account, card: s.cardSettings, onDone: refresh }), 0); } }, '設定信用卡')));
  }).catch((e) => { clear(body); mount(body, h('div', { class: 'notice bad' }, errorText(e)),
    h('div', { class: 'row-flex wrap', style: { marginTop: '16px' } },
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => { sheet.close(); setTimeout(() => openCardSettingsForm({ account, onDone: refresh }), 0); } }, '設定信用卡'))); });
}

// ---------- 貸款排程與還款 ----------
function scheduleRow(r, currentPeriod) {
  const isCurrent = currentPeriod && r.period === currentPeriod.period;
  return h('li', null, h('div', { class: 'item' },
    h('div', { class: 'grow' }, h('div', { class: 't' }, `第 ${r.period} 期　${r.date}`, isCurrent ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, '本期') : null),
      h('div', { class: 's' }, `本金 ${money(r.principal, r.symbol)}　利息 ${money(r.interest, r.symbol)}`)),
    h('div', { class: 'amt' }, money(r.payment, r.symbol))));
}

export function openLoanDetail(account) {
  const body = h('div', null, h('div', { class: 'empty' }, '載入中…'));
  const sheet = openSheet({ title: `${account.name}　還款明細`, body });
  load();
  function load() {
    clear(body); mount(body, h('div', { class: 'empty' }, '載入中…'));
    api.call('getLoanSchedule', { accountId: account.id }).then((r) => {
      clear(body);
      const sym = r.symbol;
      r.schedule.forEach((row) => { row.symbol = sym; });
      const sum = r.summary;
      const rows = [
        ['還款方式', r.loanSettings.method],
        ['已繳期數', `${sum.paidCount} / ${sum.terms}`],
        ['預估總利息', money(sum.totalInterest, sym)],
      ];
      if (!sum.settled) {
        rows.splice(2, 0, ['本期應繳', `第 ${sum.currentPeriod.period} 期　${sum.currentPeriod.date}　${money(sum.currentPeriod.payment, sym)}`]);
      }
      mount(body,
        sum.settled ? h('div', { class: 'notice', style: { marginBottom: '12px' } }, '這筆貸款已經繳清') : null,
        h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
        h('div', { class: 'row-flex wrap', style: { margin: '16px 0' } },
          !sum.settled ? h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'loan-pay', onclick: (e) => payCurrent(e, r, sum) }, '記一筆還款') : null,
          h('button', { class: 'btn btn-sm', onclick: () => { sheet.close(); setTimeout(() => openLoanSettingsForm({ account, loan: r.loanSettings, onDone: refresh }), 0); } }, '設定貸款')),
        h('div', { class: 'day-head' }, h('span', null, '攤還表')),
        h('ul', { class: 'list' }, r.schedule.map((row) => scheduleRow(row, sum.settled ? null : sum.currentPeriod))));
    }).catch((e) => { clear(body); mount(body, h('div', { class: 'notice bad' }, errorText(e)),
      h('div', { class: 'row-flex wrap', style: { marginTop: '16px' } },
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => { sheet.close(); setTimeout(() => openLoanSettingsForm({ account, onDone: refresh }), 0); } }, '設定貸款'))); });
  }
  async function payCurrent(e, r, sum) {
    const fromAccount = r.loanSettings.payAccountId || (cashAccounts(account.id)[0] && cashAccounts(account.id)[0].id);
    if (!fromAccount) { toast('請先在貸款設定裡指定扣款帳戶，或至少要有一個銀行／現金帳戶', { kind: 'bad' }); return; }
    const ok = await confirmDialog({ title: '記一筆還款', message: `第 ${sum.currentPeriod.period} 期，${money(sum.currentPeriod.payment, r.symbol)}，從「${(accountById(fromAccount) || {}).name || fromAccount}」扣款。` });
    if (!ok) return;
    await withBusy(e.currentTarget, async () => {
      try {
        await api.call('addLoanPayment', { accountId: account.id, fromAccount, requestId: api.newRequestId() });
        await refresh();
        toast('已記錄還款');
        load();
      } catch (err) { toast(errorText(err), { kind: 'bad' }); }
    });
  }
}
