/**
 * FloraCraft Supabase Sync Service
 * ---------------------------------
 * Handles real-time telemetry upload and command relay via Supabase.
 *
 * SETUP
 * -----
 * 1. Create a Supabase project at https://supabase.com
 * 2. Run the SQL below in the Supabase SQL editor to create the required tables.
 * 3. Enter your Project URL and anon key in the Settings tab of the app
 *    (they are stored in localStorage under 'fc_supabase_url' and 'fc_supabase_key').
 *
 * ── SQL: Create tables ──────────────────────────────────────────────────────
 *
 *   -- Sensor readings (one row per 2-second Arduino broadcast)
 *   create table sensor_readings (
 *     id            bigserial primary key,
 *     created_at    timestamptz default now(),
 *     temperature   float,
 *     soil_pct      int,
 *     rain_pct      int,
 *     pump_state    text,
 *     fan_state     text,
 *     heater_state  text,
 *     lid_state     text,
 *     device_id     text default 'Flora-GW-01'
 *   );
 *
 *   -- Command log (every command sent from the app)
 *   create table command_log (
 *     id         bigserial primary key,
 *     sent_at    timestamptz default now(),
 *     command    text,
 *     source     text default 'web'
 *   );
 *
 *   -- Enable Row Level Security + allow anonymous inserts (adjust for production)
 *   alter table sensor_readings enable row level security;
 *   alter table command_log     enable row level security;
 *   create policy "anon insert readings" on sensor_readings for insert with check (true);
 *   create policy "anon insert commands" on command_log     for insert with check (true);
 *   create policy "anon select readings" on sensor_readings for select using (true);
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * REAL-TIME SUBSCRIPTION
 * ----------------------
 * Call SupabaseService.subscribe(onRow) to receive live updates whenever
 * another device (or the BT bridge) inserts a new sensor reading.
 */

const SupabaseService = (() => {
  let _url      = null;  // Supabase project URL
  let _key      = null;  // Supabase anon public key
  let _channel  = null;  // Real-time channel subscription

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _headers() {
    return {
      'Content-Type': 'application/json',
      'apikey':        _key,
      'Authorization': `Bearer ${_key}`,
    };
  }

  function _isConfigured() {
    return !!(_url && _key);
  }

  /** Load credentials from localStorage (set by Settings tab). */
  function init() {
    _url = localStorage.getItem('fc_supabase_url') || '';
    _key = localStorage.getItem('fc_supabase_key') || '';
    if (_isConfigured()) {
      console.log('[Supabase] Configured – URL:', _url);
    } else {
      console.info('[Supabase] Not configured. Enter credentials in Settings.');
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Persist a parsed sensor reading to the sensor_readings table.
   * Called automatically by app.html when a "DATA,…" line arrives via BT.
   *
   * @param {{ temperature, soil_pct, rain_pct, pump_state, fan_state, heater_state, lid_state }} reading
   */
  async function pushReading(reading) {
    if (!_isConfigured()) return;
    try {
      const res = await fetch(`${_url}/rest/v1/sensor_readings`, {
        method:  'POST',
        headers: _headers(),
        body:    JSON.stringify(reading),
      });
      if (!res.ok) console.error('[Supabase] pushReading error:', await res.text());
    } catch (err) {
      console.error('[Supabase] pushReading fetch error:', err);
    }
  }

  /**
   * Log a command that was sent to the Arduino.
   * @param {string} command - e.g. '1', 'a', 'T2500'
   */
  async function logCommand(command) {
    if (!_isConfigured()) return;
    try {
      await fetch(`${_url}/rest/v1/command_log`, {
        method:  'POST',
        headers: _headers(),
        body:    JSON.stringify({ command, source: 'web' }),
      });
    } catch (err) {
      console.error('[Supabase] logCommand error:', err);
    }
  }

  /**
   * Fetch the last N sensor readings (for dashboard history on page load).
   * @param {number} limit - Number of rows to fetch (default 60 = ~2 min of data)
   * @returns {Promise<Array>}
   */
  async function getRecentReadings(limit = 60) {
    if (!_isConfigured()) return [];
    try {
      const res = await fetch(
        `${_url}/rest/v1/sensor_readings?order=created_at.desc&limit=${limit}`,
        { headers: _headers() }
      );
      if (!res.ok) return [];
      return (await res.json()).reverse(); // chronological order
    } catch (err) {
      console.error('[Supabase] getRecentReadings error:', err);
      return [];
    }
  }

  /**
   * Subscribe to real-time INSERT events on sensor_readings.
   * Uses Supabase Realtime (WebSocket).
   *
   * ── TODO (wiring): Include the Supabase JS SDK in app.html and replace
   *    the polling approach below with a proper channel subscription:
   *
   *   const { createClient } = supabase;
   *   const client = createClient(_url, _key);
   *   _channel = client
   *     .channel('sensor_readings')
   *     .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sensor_readings' },
   *         payload => onRow(payload.new))
   *     .subscribe();
   *
   * For now this uses a simple polling fallback every 3 seconds.
   *
   * @param {function} onRow - Called with each new reading object.
   */
  function subscribe(onRow) {
    if (!_isConfigured()) return;
    let lastId = 0;

    const poll = async () => {
      try {
        const res = await fetch(
          `${_url}/rest/v1/sensor_readings?id=gt.${lastId}&order=id.asc`,
          { headers: _headers() }
        );
        if (res.ok) {
          const rows = await res.json();
          rows.forEach(row => {
            lastId = row.id;
            onRow(row);
          });
        }
      } catch (_) { /* silent */ }
    };

    // Initial fetch then poll
    poll();
    const timerId = setInterval(poll, 3000);
    _channel = timerId; // store so we can cancel
  }

  /** Stop the real-time subscription / polling. */
  function unsubscribe() {
    if (_channel !== null) {
      clearInterval(_channel);
      _channel = null;
    }
  }

  /**
   * Save Supabase credentials to localStorage.
   * Called by the Settings tab Save button.
   */
  function saveConfig(url, key) {
    _url = url.trim();
    _key = key.trim();
    localStorage.setItem('fc_supabase_url', _url);
    localStorage.setItem('fc_supabase_key', _key);
    console.log('[Supabase] Config saved.');
  }

  return { init, pushReading, logCommand, getRecentReadings, subscribe, unsubscribe, saveConfig };
})();

window.SupabaseService = SupabaseService;
