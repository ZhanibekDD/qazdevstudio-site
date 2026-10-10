#!/usr/bin/env node
// Funnel report from the Node bridge analytics files (.data/analytics-YYYY-MM.ndjson).
//
//   node scripts/lead-report.mjs analytics-2026-10.ndjson           — sources and contact intent
//   node scripts/lead-report.mjs analytics-2026-10.ndjson QD-7K2PM  — visit behind a WhatsApp code
//
// Clicks and opened WhatsApp forms are intent, not leads. A lead is a message that
// actually arrived in WhatsApp; its "Код с сайта" links it back to the visit here.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const CONTACT_EVENTS = new Set(['whatsapp_click', 'telegram_click', 'phone_click', 'email_click']);
const FORM_EVENTS = new Set(['whatsapp_form_submit', 'generate_lead']);
const TOOL_EVENTS = new Set(['calculator_submit', 'quiz_completed', 'checklist_completed', 'tz_generated']);

export function parseRecords(text) {
  return text.split('\n').filter(Boolean).flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

export function sourceOf(record) {
  if (record.utm_source) return `utm:${record.utm_source}`;
  const host = String(record.referrer || '').split('/')[0].toLowerCase();
  if (!host || host.endsWith('qazdevstudio.kz')) return 'direct';
  if (/(^|\.)google\./.test(host)) return 'google';
  if (/(^|\.)(yandex|ya)\./.test(host)) return 'yandex';
  if (/(instagram|facebook|fb)\./.test(host)) return 'instagram/facebook';
  if (/(^|\.)2gis\./.test(host)) return '2gis';
  return host;
}

export function sessions(records) {
  const bySession = new Map();
  for (const record of records) {
    const key = record.session_id || `${record.visitor_id}:${record.timestamp}`;
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(record);
  }
  return [...bySession.values()].map(events => {
    events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return {
      source: sourceOf(events[0]),
      landing: events[0].page_url,
      events,
      contact: events.some(event => CONTACT_EVENTS.has(event.event_type)),
      form: events.some(event => FORM_EVENTS.has(event.event_type)),
      tool: events.some(event => TOOL_EVENTS.has(event.event_type)),
      refs: [...new Set(events.map(event => event.ref).filter(Boolean))],
    };
  });
}

export function summarize(records) {
  const rows = new Map();
  for (const session of sessions(records)) {
    const row = rows.get(session.source) || {source: session.source, sessions: 0, tool: 0, contact: 0, form: 0, refs: []};
    row.sessions += 1;
    row.tool += Number(session.tool);
    row.contact += Number(session.contact);
    row.form += Number(session.form);
    row.refs.push(...session.refs);
    rows.set(session.source, row);
  }
  return [...rows.values()].sort((a, b) => b.sessions - a.sessions);
}

export function findRef(records, ref) {
  return sessions(records).filter(session => session.refs.includes(ref));
}

function main([file, ref]) {
  if (!file) {
    console.error('Usage: node scripts/lead-report.mjs <analytics.ndjson> [QD-CODE]');
    process.exit(2);
  }
  const records = parseRecords(readFileSync(file, 'utf8'));
  if (ref) {
    const found = findRef(records, ref.toUpperCase());
    if (!found.length) console.log(`${ref}: визит не найден в ${file}`);
    for (const session of found) {
      console.log(`${ref}: источник ${session.source}, вход на ${session.landing}`);
      for (const event of session.events) {
        console.log(`  ${event.timestamp}  ${event.event_type.padEnd(22)} ${event.page_url}  ${event.event_label || ''}`);
      }
    }
    return;
  }
  console.log('источник | сессии | инструменты | клик связи | форма→WhatsApp | коды');
  for (const row of summarize(records)) {
    console.log(`${row.source} | ${row.sessions} | ${row.tool} | ${row.contact} | ${row.form} | ${row.refs.join(' ')}`);
  }
  console.log('\nКлики и формы — это намерение. Заявкой считайте только сообщение, пришедшее в WhatsApp с кодом.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
