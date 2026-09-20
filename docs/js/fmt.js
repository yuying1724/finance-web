import { prefs, instrumentBySymbol, categoryById } from './store.js';

const SYMBOLS = { TWD: 'NT$', USD: 'US$', JPY: '¥', EUR: '€', CNY: 'CN¥', HKD: 'HK$', KRW: '₩', GBP: '£', AUD: 'A$' };
export const MASK = '****';

export function decimalsOf(symbol) {
  const i = instrumentBySymbol(symbol);
  return i ? i.decimals : 0;
}

/** 金額顯示：NT$1,234／US$100.25／0.3 BTC。opts.sign 顯示正負號；opts.plain 不加幣別符號；opts.noMask 不受隱私遮蔽影響 */
export function money(amount, symbol, opts = {}) {
  if (prefs.mask && !opts.noMask) return MASK;
  if (amount === null || amount === undefined || amount === '') return '—';
  const dec = decimalsOf(symbol);
  const body = FinMoney.format(amount, dec, { sign: opts.sign, trim: dec > 2 });
  if (opts.plain) return body;
  const sym = SYMBOLS[symbol];
  if (sym) return body.startsWith('-') || body.startsWith('+') ? body[0] + sym + body.slice(1) : sym + body;
  return body + ' ' + symbol;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export function dateLabel(d, today) {
  const p = FinDates.parse(d);
  if (!p) return d || '';
  const base = `${p.m}/${p.d}（${WEEK[FinDates.weekday(d)]}）`;
  if (today && d === today) return '今天 ' + base;
  if (today && d === FinDates.addDays(today, -1)) return '昨天 ' + base;
  return base;
}
export function monthLabel(ym) { return `${ym.slice(0, 4)} 年 ${Number(ym.slice(5, 7))} 月`; }

/** 分類的顯示資訊：圖示取自本身或上層；名稱顯示「上層 › 子分類」 */
export function categoryInfo(id) {
  const c = categoryById(id);
  if (!c) return { icon: '•', name: '未分類', short: '未分類', color: '' };
  const parent = c.parentId ? categoryById(c.parentId) : null;
  return { icon: c.icon || (parent && parent.icon) || '•', name: parent ? `${parent.name} › ${c.name}` : c.name, short: c.name, color: c.color };
}

export function amountClass(kind) { return kind === 'pos' ? 'amt amt-pos' : kind === 'neg' ? 'amt amt-neg' : kind === 'mute' ? 'amt amt-mute' : 'amt'; }

export const ACCOUNT_ICON = { 銀行: '🏦', 數位錢包: '📱', 現金: '💵', 證券: '📈', 加密交易所: '🪙', 信用卡: '💳', 貸款: '🏠', 應收: '📥', 應付: '📤', 點數: '🎫' };
