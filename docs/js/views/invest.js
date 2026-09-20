import { h, mount } from '../dom.js';
import { renderHoldingsBody } from './holdings.js';
import { renderInstrumentsBody } from './instruments.js';
import { renderBrokersBody } from './brokers.js';

export function subtabs(active) {
  return h('div', { class: 'subtabs' },
    h('button', { class: active === 'holdings' ? 'on' : '', onclick: () => { location.hash = '#/invest'; } }, '持倉'),
    h('button', { class: active === 'instruments' ? 'on' : '', 'data-testid': 'subtab-instruments', onclick: () => { location.hash = '#/invest/instruments'; } }, '標的'),
    h('button', { class: active === 'brokers' ? 'on' : '', 'data-testid': 'subtab-brokers', onclick: () => { location.hash = '#/invest/brokers'; } }, '券商設定'));
}

export function renderInvest(root, route) {
  const body = h('div');
  mount(root, h('div', { class: 'page-head' }, h('h1', null, '投資')), subtabs(route.sub === 'instruments' ? 'instruments' : route.sub === 'brokers' ? 'brokers' : 'holdings'), body);
  if (route.sub === 'instruments') renderInstrumentsBody(body);
  else if (route.sub === 'brokers') renderBrokersBody(body);
  else renderHoldingsBody(body);
}
