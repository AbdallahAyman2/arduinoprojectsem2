/**
 * FloraCraft Supabase Sync Service
 * ---------------------------------
 * Handles real-time telemetry upload and command relay via Supabase.
 *
 * SETUP
 * -----
 * 1. Create a Supabase project at https://supabase.com
 * 2. Run the SQL below in the Supabase SQL editor to create the required tables.
 * 3. Enter your Project URL, anon key, and Device ID in the Settings tab of the app.
 *    (stored in localStorage: 'fc_supabase_url', 'fc_supabase_key', 'fc_device_id')
 *
 * ── SQL: Create tables ──────────────────────────────────────────────────────
 *
 *   -- Sensor readings (one row per 2-second Arduino broadcast)
 *   create table readings (
 *     id         bigserial primary key,
 *     ts         timestamptz default now(),
 *     device_id  text not null,
 *     raw_data   text,
 *     temp_c     float,
 *     soil_pct   int,
 *     rain_pct   int,
 *     pump_on    boolean default false,
 *     fan_on     boolean default false,
 *     heater_on  boolean default false,
 *     lid_state  text,
 *     mode       text default 'auto',
 *     profile    text default 'silvercock'
 *   );
 *
 *   -- Commands queued by the web app for the gateway to execute
 *   create table commands (
 *     id           bigserial primary key,
 *     created_at   timestamptz default now(),
 *     device_id    text not null,
 *     command      text not null,
 *     status       text default 'queued',
 *     source       text default 'web'
 *   );
 *
 *   -- Enable Row Level Security + allow anonymous access (adjust for production)
 *   alter table readings  enable row level security;
 *   alter table commands  enable row level security;
 *   create policy "anon insert readings" on readings for insert with check (true);
 *   create policy "anon select readings" on readings for select using (true);
 *   create policy "anon insert commands" on commands for insert with check (true);
 *   create policy "anon select commands" on commands for select using (true);
 *
 *   -- Enable Realtime for the readings table (Supabase dashboard → Database → Replication)
 *   -- Or run: alter publication supabase_realtime add table readings;
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * REAL-TIME SUBSCRIPTION
 * ----------------------
 * Requires the Supabase JS SDK (loaded as a CDN script before this file).
 * Automatically falls back to 3-second polling when the SDK is unavailable.
 *
 * Call SupabaseService.subscribe(onRow, deviceId) to receive live updates.
 */

const SupabaseService = (() => {
  const DEFAULT_DEVICE_ID = 'Flora-GW-01';

  let _url           = null;   // Supabase project URL
  let _key           = null;   // Supabase anon public key
  let _deviceId      = null;   // Active device identifier
  let _client        = null;   // Supabase JS SDK client (when available)
  let _realtimeCh    = null;   // Supabase Realtime channel
  let _pollTimer     = null;   // Polling fallback interval ID

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

  /** Build (or reuse) the Supabase JS SDK client. */
  function _getClient() {
    if (_client) return _client;
    if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
      _client = window.supabase.createClient(_url, _key);
    }
    return _client;
  }

  /** Load credentials from localStorage (set by Settings tab). */
  function init() {
    _url      = localStorage.getItem('fc_supabase_url') || '';
    _key      = localStorage.getItem('fc_supabase_key') || '';
    _deviceId = localStorage.getItem('fc_device_id')    || DEFAULT_DEVICE_ID;
    _client   = null; // reset client so it picks up new credentials
    if (_isConfigured()) {
      console.log('[Supabase] Configured – URL:', _url, '| Device:', _deviceId);
    } else {
      console.info('[Supabase] Not configured. Enter credentials in Settings.');
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Persist a sensor reading to the `readings` table.
   * Called by app.html each time a "DATA,…" line arrives via Bluetooth.
   *
   * @param {{ temperature, soil_pct, rain_pct, pump_state, fan_state, heater_state, lid_state }} reading
   * @param {string} [rawLine]  - The original "DATA,…" string from the Arduino.
   * @param {string} [deviceId] - Overrides the stored device ID.
   * @param {string} [mode]     - Current mode ('auto' | 'test').
   * @param {string} [profile]  - Current profile ('silvercock' | 'shia').
   * @returns {Promise<void>}
   */
  async function pushReading(reading, rawLine, deviceId, mode, profile) {
    if (!_isConfigured()) return;
    const row = {
      device_id:  deviceId || _deviceId || DEFAULT_DEVICE_ID,
      raw_data:   rawLine  || null,
      temp_c:     reading.temperature,
      soil_pct:   reading.soil_pct,
      rain_pct:   reading.rain_pct,
      pump_on:    reading.pump_state  === 'ON',
      fan_on:     reading.fan_state   === 'ON',
      heater_on:  reading.heater_state === 'ON',
      lid_state:  reading.lid_state,
      mode:       mode    || 'auto',
      profile:    profile || 'silvercock',
    };
    try {
      const res = await fetch(`${_url}/rest/v1/readings`, {
        method:  'POST',
        headers: _headers(),
        body:    JSON.stringify(row),
      });
      if (!res.ok) console.error('[Supabase] pushReading error:', await res.text());
    } catch (err) {
      console.error('[Supabase] pushReading fetch error:', err);
    }
  }

  /**
   * Queue a command for the gateway by inserting into the `commands` table.
   * The gateway polls this table and executes rows with status='queued'.
   *
   * @param {string} command  - Command character(s), e.g. '1', 'a', 'T2500'
   * @param {string} [deviceId] - Overrides the stored device ID.
   * @returns {Promise<void>}
   */
  async function queueCommand(command, deviceId) {
    if (!_isConfigured()) return;
    try {
      const res = await fetch(`${_url}/rest/v1/commands`, {
        method:  'POST',
        headers: _headers(),
        body:    JSON.stringify({
          device_id: deviceId || _deviceId || DEFAULT_DEVICE_ID,
          command,
          status:    'queued',
          source:    'web',
        }),
      });
      if (!res.ok) console.error('[Supabase] queueCommand error:', await res.text());
    } catch (err) {
      console.error('[Supabase] queueCommand fetch error:', err);
    }
  }

  /**
   * Alias kept for backward compatibility.
   * @param {string} command
   */
  function logCommand(command) {
    return queueCommand(command);
  }

  /**
   * Fetch the most recent reading for the current device.
   * Used to pre-populate the dashboard on page load.
   *
   * @param {string} [deviceId] - Overrides the stored device ID.
   * @returns {Promise<object|null>}
   */
  async function getLatestReading(deviceId) {
    if (!_isConfigured()) return null;
    const id = deviceId || _deviceId || DEFAULT_DEVICE_ID;
    try {
      const res = await fetch(
        `${_url}/rest/v1/readings?device_id=eq.${encodeURIComponent(id)}&order=ts.desc&limit=1`,
        { headers: _headers() }
      );
      if (!res.ok) return null;
      const rows = await res.json();
      return rows.length ? rows[0] : null;
    } catch (err) {
      console.error('[Supabase] getLatestReading error:', err);
      return null;
    }
  }

  /**
   * Subscribe to real-time INSERT events on `readings`.
   * Uses Supabase Realtime (WebSocket via SDK) when available,
   * otherwise falls back to 3-second REST polling.
   *
   * @param {function} onRow   - Called with each new reading row object.
   * @param {string} [deviceId] - Filter events to this device ID.
   */
  function subscribe(onRow, deviceId) {
    if (!_isConfigured()) return;
    const id = deviceId || _deviceId || DEFAULT_DEVICE_ID;

    const client = _getClient();
    if (client) {
      // ── Supabase Realtime (requires `alter publication supabase_realtime add table readings`) ──
      _realtimeCh = client
        .channel('readings:' + id)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'readings', filter: `device_id=eq.${id}` },
          payload => onRow(payload.new)
        )
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            console.log('[Supabase] Realtime subscribed for device:', id);
          }
        });
      return;
    }

    // ── Polling fallback (no SDK) ──
    let lastId = 0;
    const poll = async () => {
      try {
        const res = await fetch(
          `${_url}/rest/v1/readings?device_id=eq.${encodeURIComponent(id)}&id=gt.${lastId}&order=id.asc`,
          { headers: _headers() }
        );
        if (res.ok) {
          const rows = await res.json();
          rows.forEach(row => { lastId = row.id; onRow(row); });
        }
      } catch (_) { /* silent */ }
    };
    poll();
    _pollTimer = setInterval(poll, 3000);
  }

  /** Stop the real-time subscription or polling timer. */
  function unsubscribe() {
    if (_realtimeCh) {
      _realtimeCh.unsubscribe();
      _realtimeCh = null;
    }
    if (_pollTimer !== null) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  /**
   * Save Supabase credentials and device ID to localStorage.
   * Called by the Settings tab Save button.
   */
  function saveConfig(url, key, deviceId) {
    _url      = url.trim();
    _key      = key.trim();
    _deviceId = (deviceId || DEFAULT_DEVICE_ID).trim();
    _client   = null; // reset so next call to _getClient() uses new creds
    localStorage.setItem('fc_supabase_url', _url);
    localStorage.setItem('fc_supabase_key', _key);
    localStorage.setItem('fc_device_id',    _deviceId);
    console.log('[Supabase] Config saved.');
  }

  return {
    init,
    pushReading,
    queueCommand,
    logCommand,
    getLatestReading,
    subscribe,
    unsubscribe,
    saveConfig,
  };
})();

window.SupabaseService = SupabaseService;
