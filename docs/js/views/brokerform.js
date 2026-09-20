import { h, mount } from '../dom.js';
import { state } from '../store.js';
import * as api from '../api.js';
import { openSheet, toast, errorText, withBusy } from '../ui.js';

/** 證券帳戶設定：手續費率、證交稅率、交割天數與日曆等，帳戶專屬，不寫死在程式裡。 */
export function openBrokerForm({ account, broker = null, onDone } = {}) {
  const d = state.data;
  const editing = !!broker;
  const cashAccounts = d.accounts.filter((a) => a.id !== account.id && (a.type === '銀行' || a.type === '數位錢包' || a.type === '現金'));
  const f = broker ? { ...broker } : {
    market: account.type === '加密交易所' ? '' : '台股', feeRate: '', feeDiscount: '1', feeCurrency: 'TWD', minFee: '', oddLotMinFee: '',
    sipFixedFee: '', sipFeeRate: '', sipFeeCap: '', sipMinAmount: '', taxRateStock: '', taxRateEtf: '',
    buySettleDays: '2', sellSettleDays: '2', calendar: '台灣', settleAccountId: '', note: '',
  };
  Object.keys(f).forEach((k) => { if (f[k] === null || f[k] === undefined) f[k] = ''; else f[k] = String(f[k]); });
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
  const numInput = (key, step, placeholder) => h('input', { type: 'text', inputmode: 'decimal', value: f[key], placeholder: placeholder || '0', oninput: (e) => { f[key] = e.target.value; } });

  const marketSel = h('select', { onchange: (e) => { f.market = e.target.value; if (!broker) { f.calendar = e.target.value === '複委託' ? '台灣+美國' : '台灣'; f.buySettleDays = e.target.value === '複委託' ? '1' : '2'; draw(); } } },
    ['台股', '複委託'].map((m) => h('option', { value: m, selected: m === f.market }, m)));
  const calendarSel = h('select', { onchange: (e) => { f.calendar = e.target.value; } }, ['台灣', '台灣+美國'].map((c) => h('option', { value: c, selected: c === f.calendar }, c)));
  const feeCurSel = h('select', { onchange: (e) => { f.feeCurrency = e.target.value; } },
    d.instruments.filter((i) => i.type === '法幣').map((c) => h('option', { value: c.symbol, selected: c.symbol === f.feeCurrency }, c.symbol)));
  const settleAcctSel = h('select', { onchange: (e) => { f.settleAccountId = e.target.value; } },
    [h('option', { value: '' }, '（不指定）')].concat(cashAccounts.map((a) => h('option', { value: a.id, selected: a.id === f.settleAccountId }, a.name))));

  const body = h('div');
  function draw() {
    mount(body, banner,
      h('div', { class: 'notice', style: { marginBottom: '12px' } }, `帳戶：${account.name}`),
      fld('market', '市場', marketSel),
      fld('calendar', '交割日曆', calendarSel, '複委託要台灣與美國當天都有開市才算一個營業日'),
      fld('buySettleDays', '買入交割天數（T+N）', numInput('buySettleDays')),
      fld('sellSettleDays', '賣出交割天數（T+N）', numInput('sellSettleDays')),
      fld('settleAccountId', '預設交割帳戶（選填）', settleAcctSel),
      fld('feeRate', '手續費率', numInput('feeRate', null, '例如 0.001425')),
      fld('feeDiscount', '手續費折扣', numInput('feeDiscount', null, '例如 0.6（六折），不打折填 1'), '成交金額 × 手續費率 × 折扣'),
      fld('feeCurrency', '手續費幣別', feeCurSel),
      fld('minFee', '最低手續費', numInput('minFee')),
      fld('oddLotMinFee', '零股最低手續費', numInput('oddLotMinFee')),
      fld('taxRateStock', '證交稅率（股票）', numInput('taxRateStock', null, '台股現股賣出約 0.003')),
      fld('taxRateEtf', '證交稅率（ETF）', numInput('taxRateEtf', null, '台股 ETF 賣出約 0.001')),
      fld('sipFixedFee', '定期定額固定手續費（選填）', numInput('sipFixedFee')),
      fld('sipFeeRate', '定期定額手續費率（選填）', numInput('sipFeeRate')),
      fld('sipFeeCap', '定期定額每筆上限（選填）', numInput('sipFeeCap')),
      fld('sipMinAmount', '定期定額最低單筆投入（選填）', numInput('sipMinAmount')),
      fld('note', '備註（選填）', h('input', { type: 'text', maxlength: 200, value: f.note, oninput: (e) => { f.note = e.target.value; } })));
  }
  draw();

  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'broker-save', onclick: async (e) => {
    banner.style.display = 'none';
    Object.values(msgs).forEach((m) => { m.wrap.classList.remove('err'); m.msg.style.display = 'none'; });
    if (!f.market) { showErr('market', '請選擇市場'); return; }
    await withBusy(e.currentTarget, async () => {
      try {
        await api.call('upsertBrokerSettings', { broker: { accountId: account.id, ...f } });
        sheet.close();
        if (onDone) await onDone();
        toast('已儲存證券帳戶設定');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details && err.details.errors) err.details.errors.forEach((x) => showErr(x.field, x.message));
        else { banner.style.display = ''; mount(banner, errorText(err)); }
      }
    });
  } }, '儲存');

  const sheet = openSheet({
    title: '證券帳戶設定', dismissable: false,
    body,
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save],
  });
  return sheet;
}
