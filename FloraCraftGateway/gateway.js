/**
 * FloraCraft Gateway (v1)
 * ──────────────────────
 * Node.js bridge between the Arduino (via HC-05 / ZS-040 Bluetooth module
 * on a serial port) and Supabase:
 *
 *   Arduino ──serial──▶ gateway ──HTTPS──▶ Supabase  readings table
 *   Web app ──HTTPS──▶ Supabase commands table ──▶ gateway ──serial──▶ Arduino
 *
 * Bug fix (reason this file exists):
 *   Previous implementations polled ALL queued commands and re-sent them on
 *   every polling cycle, flooding the Arduino with duplicate commands.
 *   This gateway fixes that by:
 *     1. Fetching only the SINGLE LATEST queued command per poll cycle.
 *     2. Updating that command's status to 'sent' BEFORE writing to serial,
 *        so a crash / restart can never cause the same command to be sent twice.
 *
 * Usage
 * ─────
 *   cd FloraCraftGateway
 *   cp .env.example .env      # fill in your values
 *   npm install
 *   node gateway.js
 *
 * Environment variables (see .env.example)
 * ─────────────────────────────────────────
 *   SUPABASE_URL        Supabase project URL
 *   SUPABASE_KEY        Supabase anon or service-role key
 *   DEVICE_ID           UUID of the device row in public.devices
 *   SERIAL_PORT         Serial port the BT module is on  (e.g. COM3, /dev/rfcomm0)
 *   BAUD_RATE           Baud rate (default 9600)
 *   POLL_INTERVAL_MS    Command polling interval in ms   (default 3000)
 */

'use strict';

require('dotenv').config();
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const https = require('https');
const http  = require('http');

// ── Configuration ─────────────────────────────────────────────────────────────

const SUPABASE_URL    = (process.env.SUPABASE_URL   || '').replace(/\/$/, '');
const SUPABASE_KEY    = process.env.SUPABASE_KEY    || '';
const DEVICE_ID       = process.env.DEVICE_ID       || '';
const SERIAL_PORT     = process.env.SERIAL_PORT     || 'COM3';
const BAUD_RATE       = parseInt(process.env.BAUD_RATE          || '9600',  10);
const POLL_INTERVAL   = parseInt(process.env.POLL_INTERVAL_MS   || '3000',  10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[Gateway] ERROR: SUPABASE_URL and SUPABASE_KEY must be set in .env');
  process.exit(1);
}

// ── Supabase REST helper ──────────────────────────────────────────────────────

/**
 * Minimal fetch wrapper around Node's built-in http/https.
 * Avoids adding a runtime dependency just for HTTP requests.
 *
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: string }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, json: () => Promise<any>, text: () => Promise<string> }>}
 */
function supaFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const driver   = parsed.protocol === 'https:' ? https : http;
    const bodyBuf  = opts.body ? Buffer.from(opts.body, 'utf8') : null;
    const headers  = {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      ...(opts.headers || {}),
      ...(bodyBuf ? { 'Content-Length': String(bodyBuf.length) } : {}),
    };

    const req = driver.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   opts.method || 'GET',
        headers,
      },
      res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { raw += chunk; });
        res.on('end',  () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          resolve({
            ok,
            status: res.statusCode,
            text:   () => Promise.resolve(raw),
            json:   () => Promise.resolve(raw ? JSON.parse(raw) : null),
          });
        });
      }
    );

    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ── Supabase API ──────────────────────────────────────────────────────────────

/**
 * Push a sensor reading row to public.readings.
 * @param {object} row
 */
async function pushReading(row) {
  try {
    const res = await supaFetch(`${SUPABASE_URL}/rest/v1/readings`, {
      method:  'POST',
      headers: { 'Prefer': 'return=minimal' },
      body:    JSON.stringify(row),
    });
    if (!res.ok) {
      console.error('[Supabase] pushReading error', res.status, await res.text());
    }
  } catch (err) {
    console.error('[Supabase] pushReading network error:', err.message);
  }
}

/**
 * Fetch the single latest queued command for this device.
 *
 * KEY FIX: We use `order=ts.desc&limit=1` so we only ever look at the newest
 * command, not every command that was ever queued.  This prevents the gateway
 * from re-processing old commands on every poll cycle.
 *
 * @returns {Promise<{ id: number, command: string }|null>}
 */
async function fetchLatestQueuedCommand() {
  try {
    const deviceFilter = DEVICE_ID
      ? `device_id=eq.${encodeURIComponent(DEVICE_ID)}&`
      : '';
    const url = `${SUPABASE_URL}/rest/v1/commands`
              + `?${deviceFilter}status=eq.queued&order=ts.desc&limit=1`;

    const res = await supaFetch(url);
    if (!res.ok) {
      console.error('[Supabase] fetchLatestQueuedCommand error', res.status, await res.text());
      return null;
    }
    const rows = await res.json();
    return (rows && rows.length > 0) ? rows[0] : null;
  } catch (err) {
    console.error('[Supabase] fetchLatestQueuedCommand network error:', err.message);
    return null;
  }
}

/**
 * Mark a command row as 'sent' so it is never processed again.
 *
 * KEY FIX: We update the status BEFORE writing to the serial port so that
 * even if the process crashes during the write, the command is not re-sent.
 *
 * @param {number} id  - Primary key of the commands row
 */
async function markCommandSent(id) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/commands`
              + `?id=eq.${encodeURIComponent(id)}`;
    const res = await supaFetch(url, {
      method:  'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body:    JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      console.error('[Supabase] markCommandSent error', res.status, await res.text());
    }
  } catch (err) {
    console.error('[Supabase] markCommandSent network error:', err.message);
  }
}

// ── Arduino data parser ───────────────────────────────────────────────────────

/**
 * Parse an Arduino "DATA,…" line into a readings row.
 * Expected format:  DATA,<temp>,<soilPct>,<rainPct>,<pumpState>,<fanState>,<heaterState>,<lidState>
 *
 * @param {string} line
 * @returns {object|null}
 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('DATA,')) return null;

  const parts = trimmed.split(',');
  if (parts.length < 8) return null;

  const [, temp, soil, rain, pump, fan, heater, lid] = parts;
  return {
    ...(DEVICE_ID ? { device_id: DEVICE_ID } : {}),
    raw_data:  trimmed,
    temp_c:    parseFloat(temp)  || null,
    soil_pct:  parseInt(soil, 10) || null,
    rain_pct:  parseInt(rain, 10) || null,
    pump_on:   pump   === 'ON',
    fan_on:    fan    === 'ON',
    heater_on: heater === 'ON',
    lid_state: lid    || null,
    mode:      'AUTO',
  };
}

// ── Serial port setup ─────────────────────────────────────────────────────────

const port = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

port.on('open', () => {
  console.log(`[Serial] Port ${SERIAL_PORT} opened at ${BAUD_RATE} baud`);
  startCommandPolling();
});

port.on('error', err => {
  console.error('[Serial] Port error:', err.message);
});

parser.on('data', async line => {
  const trimmed = line.trim();
  if (!trimmed) return;

  console.log('[Arduino]', trimmed);

  const row = parseLine(trimmed);
  if (row) {
    await pushReading(row);
  }
});

// ── Command polling ───────────────────────────────────────────────────────────

/**
 * Poll Supabase once for the latest queued command, send it to the Arduino
 * exactly once, then update its status.
 *
 * Design decisions that prevent the duplicate-command bug:
 *  - Only the LATEST command (`order=ts.desc&limit=1`) is fetched per cycle.
 *  - The status is set to 'sent' immediately after we decide to send it,
 *    before the serial write, so the same command cannot be picked up in the
 *    next poll cycle.
 */
async function pollAndForwardCommand() {
  const cmd = await fetchLatestQueuedCommand();
  if (!cmd) return; // nothing queued

  const { id, command } = cmd;
  console.log(`[Command] Received command id=${id}: '${command}'`);

  // Mark as sent FIRST to prevent re-processing on the next poll cycle
  await markCommandSent(id);

  // Write the command to the serial port (appending \n as the Arduino expects)
  const payload = command.endsWith('\n') ? command : command + '\n';
  port.write(payload, err => {
    if (err) {
      console.error('[Serial] Write error:', err.message);
    } else {
      console.log(`[Serial] Sent: '${command.trim()}'`);
    }
  });
}

function startCommandPolling() {
  console.log(`[Gateway] Polling commands every ${POLL_INTERVAL} ms`);
  // Run once immediately, then on the interval
  pollAndForwardCommand();
  setInterval(pollAndForwardCommand, POLL_INTERVAL);
}

console.log('[Gateway] FloraCraft Gateway starting…');
console.log(`[Gateway] Supabase URL : ${SUPABASE_URL}`);
console.log(`[Gateway] Device ID    : ${DEVICE_ID || '(not set – no device filter)'}`);
console.log(`[Gateway] Serial port  : ${SERIAL_PORT} @ ${BAUD_RATE} baud`);
