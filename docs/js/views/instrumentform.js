import { h, mount } from '../dom.js';
import { state } from '../store.js';
import * as api from '../api.js';
import { openSheet, toast, errorText, withBusy } from '../ui.js';

/** 新增／編輯投資標的（股票、ETF、加密貨幣等）。法幣標的（TWD、USD…）在種子資料就有了，這裡不處理法幣。 */
export function openInstrumentForm({ instrument = null, onDone } = {}) {
  const d = state.data;
  const editing = !!instrument;
  const types = d.options['標的類型'].filter((t) => t !== '法幣');
  const sources = d.options['價格來源'];
  const currencies = d.instruments.filter((i) => i.type === '法幣');
  const f = {
    symbol: instrument ? instrument.symbol : '', name: instrument ? instrument.name : '',
    type: instrument ? instrument.type : (types[0] || '台股'), quote: instrument ? instrument.quote : 'TWD',
    decimals: instrument ? String(instrument.decimals) : '0', priceSource: instrument ? instrument.priceSource : '手動',
    quoteCode: instrument ? instrument.quoteCode : '', note: instrument ? instrument.note : '',
  };
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

  const symbolInput = h('input', { type: 'text', maxlength: 20, value: f.symbol, placeholder: '例如：0050、VOO、BTC', disabled: editing,
    oninput: (e) => { f.symbol = e.target.value.toUpperCase(); e.target.value = f.symbol; } });
  const nameInput = h('input', { type: 'text', maxlength: 60, value: f.name, placeholder: '例如：元大台灣50', oninput: (e) => { f.name = e.target.value; } });
  const typeSel = h('select', { onchange: (e) => { f.type = e.target.value; draw(); } }, types.map((t) => h('option', { value: t, selected: t === f.type }, t)));
  const quoteBox = h('div');
  function drawQuote() {
    mount(quoteBox, h('select', { onchange: (e) => { f.quote = e.target.value; } },
      currencies.map((c) => h('option', { value: c.symbol, selected: c.symbol === f.quote }, `${c.symbol} ${c.name}`))));
  }
  const decInput = h('input', { type: 'number', min: 0, max: 8, step: 1, value: f.decimals, oninput: (e) => { f.decimals = e.target.value; } });
  const sourceSel = h('select', { onchange: (e) => { f.priceSource = e.target.value; } }, sources.map((s) => h('option', { value: s, selected: s === f.priceSource }, s)));
  const quoteCodeInput = h('input', { type: 'text', maxlength: 60, value: f.quoteCode, placeholder: '例如：TPE:0050、NASDAQ:VOO（GOOGLEFINANCE 用）', oninput: (e) => { f.quoteCode = e.target.value; } });
  const noteInput = h('input', { type: 'text', maxlength: 200, value: f.note, oninput: (e) => { f.note = e.target.value; } });

  const body = h('div');
  function draw() {
    drawQuote();
    mount(body, banner,
      fld('symbol', '代號', symbolInput, editing ? '代號建立後不能修改' : '英數字，會自動轉大寫'),
      fld('name', '名稱', nameInput),
      fld('type', '類型', typeSel),
      fld('quote', '計價幣別', quoteBox, '這個標的的價格、成交金額是用哪個幣別計算'),
      fld('decimals', '股數／單位小數位數', decInput, '股票通常是 0；部分加密貨幣可能要到小數點以下好幾位'),
      fld('priceSource', '價格來源', sourceSel),
      fld('quoteCode', '行情代碼（選填）', quoteCodeInput),
      fld('note', '備註（選填）', noteInput));
  }
  draw();

  const save = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'instrument-save', onclick: async (e) => {
    banner.style.display = 'none';
    Object.values(msgs).forEach((m) => { m.wrap.classList.remove('err'); m.msg.style.display = 'none'; });
    if (!f.symbol.trim()) { showErr('symbol', '請輸入標的代號'); return; }
    if (!f.name.trim()) { showErr('name', '請輸入標的名稱'); return; }
    await withBusy(e.currentTarget, async () => {
      try {
        await api.call('upsertInstrument', {
          instrument: { symbol: f.symbol.trim(), name: f.name.trim(), type: f.type, quote: f.quote, decimals: Number(f.decimals) || 0, priceSource: f.priceSource, quoteCode: f.quoteCode, note: f.note, isNew: !editing },
          expectedUpdatedAt: editing ? instrument.updatedAt : undefined,
        });
        sheet.close();
        if (onDone) await onDone();
        toast(editing ? '已儲存' : '已新增標的');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details && err.details.errors) err.details.errors.forEach((x) => showErr(x.field, x.message));
        else { banner.style.display = ''; mount(banner, errorText(err)); }
      }
    });
  } }, editing ? '儲存' : '新增');

  const sheet = openSheet({
    title: editing ? '編輯標的' : '新增標的', dismissable: false,
    body,
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save],
  });
  return sheet;
}
