import { h, mount } from '../dom.js';
import { renderHoldingsBody } from './holdings.js';
import { renderInstrumentsBody } from './instruments.js';
import { renderBrokersBody } from './brokers.js';
import { renderInvestReportBody } from './investreport.js';
import { renderSettlementsBody } from './settlements.js';
import { renderDividendsBody } from './dividends.js';

export function subtabs(active) {
  return h('div', { class: 'subtabs' },
    h('button', { class: active === 'holdings' ? 'on' : '', onclick: () => { location.hash = '#/invest'; } }, '持倉'),
    h('button', { class: active === 'report' ? 'on' : '', 'data-testid': 'subtab-report', onclick: () => { location.hash = '#/invest/report'; } }, '報表'),
    h('button', { class: active === 'settle' ? 'on' : '', 'data-testid': 'subtab-settle', onclick: () => { location.hash = '#/invest/settle'; } }, '交割'),
    h('button', { class: active === 'dividends' ? 'on' : '', 'data-testid': 'subtab-dividends', onclick: () => { location.hash = '#/invest/dividends'; } }, '股息'),
    h('button', { class: active === 'instruments' ? 'on' : '', 'data-testid': 'subtab-instruments', onclick: () => { location.hash = '#/invest/instruments'; } }, '標的'),
    h('button', { class: active === 'brokers' ? 'on' : '', 'data-testid': 'subtab-brokers', onclick: () => { location.hash = '#/invest/brokers'; } }, '券商設定'));
}

export function renderInvest(root, route) {
  const body = h('div');
  mount(root, h('div', { class: 'page-head' }, h('h1', null, '投資')), subtabs(['instruments', 'brokers', 'report', 'settle', 'dividends'].includes(route.sub) ? route.sub : 'holdings'), body);
  if (route.sub === 'instruments') renderInstrumentsBody(body);
  else if (route.sub === 'brokers') renderBrokersBody(body);
  else if (route.sub === 'report') renderInvestReportBody(body);
  else if (route.sub === 'settle') renderSettlementsBody(body);
  else if (route.sub === 'dividends') renderDividendsBody(body);
  else renderHoldingsBody(body);
}
