import test from 'node:test';
import assert from 'node:assert/strict';
import {findRef, parseRecords, sourceOf, summarize} from '../scripts/lead-report.mjs';

const log = [
  {timestamp: '2026-10-09T10:00:00Z', session_id: 's1', event_type: 'page_view', page_url: '/telegram-bot-kazakhstan.html', referrer: 'www.google.com/', ref: ''},
  {timestamp: '2026-10-09T10:01:00Z', session_id: 's1', event_type: 'whatsapp_form_submit', page_url: '/telegram-bot-kazakhstan.html', referrer: 'qazdevstudio.kz/', ref: 'QD-7K2PM'},
  {timestamp: '2026-10-09T11:00:00Z', session_id: 's2', event_type: 'page_view', page_url: '/', referrer: '', utm_source: 'kaspi', ref: ''},
  {timestamp: '2026-10-09T11:02:00Z', session_id: 's2', event_type: 'whatsapp_click', page_url: '/', referrer: '', ref: 'QD-ABCDE'},
  {timestamp: '2026-10-09T12:00:00Z', session_id: 's3', event_type: 'page_view', page_url: '/blog/', referrer: 'yandex.kz/', ref: ''},
].map(record => JSON.stringify(record)).join('\n') + '\nnot json\n';

test('classifies traffic sources', () => {
  assert.equal(sourceOf({utm_source: 'kaspi', referrer: 'www.google.com/'}), 'utm:kaspi');
  assert.equal(sourceOf({referrer: 'www.google.com/search'}), 'google');
  assert.equal(sourceOf({referrer: 'yandex.kz/'}), 'yandex');
  assert.equal(sourceOf({referrer: 'l.instagram.com/'}), 'instagram/facebook');
  assert.equal(sourceOf({referrer: 'qazdevstudio.kz/blog/'}), 'direct');
  assert.equal(sourceOf({referrer: ''}), 'direct');
});

test('attributes contact intent to the landing source, not the last page', () => {
  const rows = Object.fromEntries(summarize(parseRecords(log)).map(row => [row.source, row]));
  assert.deepEqual(rows.google, {source: 'google', sessions: 1, tool: 0, contact: 0, form: 1, refs: ['QD-7K2PM']});
  assert.deepEqual(rows['utm:kaspi'], {source: 'utm:kaspi', sessions: 1, tool: 0, contact: 1, form: 0, refs: ['QD-ABCDE']});
  assert.equal(rows.yandex.contact + rows.yandex.form, 0);
});

test('finds the visit behind a WhatsApp code', () => {
  const [session] = findRef(parseRecords(log), 'QD-7K2PM');
  assert.equal(session.source, 'google');
  assert.equal(session.landing, '/telegram-bot-kazakhstan.html');
  assert.equal(findRef(parseRecords(log), 'QD-NONE1').length, 0);
});
