/**
 * FloraCraft Supabase Sync Service (v2)
 * ---------------------------------------
 * Handles real-time telemetry display and command relay via Supabase.
 *
 * This service connects to the same Supabase project used by the
 * FloraCraft Gateway (Node.js).  The gateway writes sensor readings from
 * the Arduino to `public.readings`; the web app reads them and displays
 * live data.  Manual commands are sent by inserting rows into
 * `public.commands` with status = 'queued'.
 *
 * SETUP
 * -----
 * 1. Create a Supabase project at https://supabase.com
 * 2. Run the SQL in README.md to create the required tables and RLS policies.
 * 3. In the Settings tab enter your Project URL, Anon Key and Device UUID.
 *    Values are stored in localStorage under:
 *      fc_supabase_url  – Project URL
 *      fc_supabase_key  – Anon key
 *      fc_device_id     – Device UUID (from devices.id in Supabase)
 *
 * TABLE SCHEMAS (managed by the gateway – created once in Supabase SQL Editor)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   -- Devices registry
 *   create table public.devices (
 *     id         uuid primary key default gen_random_uuid(),
 *     name       text not null,
 *     created_at timestamptz default now()
 *   );
 *
 *   -- Sensor readings written by the gateway
 *   create table public.readings (
 *     id         bigserial primary key,
 *     device_id  uuid references public.devices(id),
 *     raw_data   text,
 *     temp_c     float,
 *     soil_pct   int,
 *     rain_pct   int,
 *     pump_on    boolean default false,
 *     fan_on     boolean default false,
 *     heater_on  boolean default false,
 *     lid_state  text,
 *     mode       text default 'AUTO',
 *     profile    text,
 *     ts         timestamptz default now()
 *   );
 *
 *   -- Commands queued by the web app, consumed by the gateway
 *   create table public.commands (
 *     id           bigserial primary key,
 *     device_id    uuid references public.devices(id),
 *     command      text not null,
 *     status       text default 'queued',
 *     response     text,
 *     sent_at      timestamptz,
 *     applied_at   timestamptz,
 *     requested_by text,
 *     ts           timestamptz default now()
 *   );
 *
 * RLS POLICIES (run in Supabase SQL Editor)
 * ─────────────────────────────────────────
 *   alter table public.readings enable row level security;
 *   alter table public.commands  enable row level security;
 *   alter table public.devices   enable row level security;
 *
 *   create policy "anon select readings" on public.readings for select to anon using (true);
 *   create policy "anon insert readings" on public.readings for insert to anon with check (true);
 *   create policy "anon select devices"  on public.devices  for select to anon using (true);
 *   create policy "anon insert commands" on public.commands for insert to anon with check (true);
 *   create policy "anon select commands" on public.commands for select to anon using (true);
 *
 * REALTIME (Supabase Dashboard)
 * ─────────────────────────────
 *   Database → Replication → enable Realtime for table `readings`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

const SupabaseService = (() => {
  let _url       = null;  // Supabase project URL
  let _key       = null;  // Supabase anon public key
  let _deviceId  = null;  // Device UUID (from public.devices.id)
  let _client    = null;  // Supabase JS client (SDK loaded via CDN in app.html)
  let _channel   = null;  // Realtime channel (or polling interval ID as fallback)
  let _pollTimer = null;  // Fallback polling interval

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _headers() {
    return {
      'Content-Type':  'application/json',
      'apikey':        _key,
      'Authorization': `Bearer ${_key}`,
    };
  }

  function _isConfigured() {
    return !!(_url && _key);
  }

  function _getDeviceId() {
    return _deviceId || '';
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  /** Load credentials from localStorage (set by Settings tab). */
  function init() {
    _url      = localStorage.getItem('fc_supabase_url') || '';
    _key      = localStorage.getItem('fc_supabase_key') || '';
    _deviceId = localStorage.getItem('fc_device_id')    || '';

    if (_isConfigured()) {
      console.log('[Supabase] Configured – URL:', _url, '| Device:', _deviceId || '(none)');
      // Create the Supabase JS client if the SDK was loaded (via CDN script in app.html)
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        _client = window.supabase.createClient(_url, _key);
        console.log('[Supabase] JS SDK client ready.');
      } else {
        console.info('[Supabase] JS SDK not found – falling back to fetch polling.');
      }
    } else {
      console.info('[Supabase] Not configured. Enter URL, key and device ID in Settings.');
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Persist a sensor reading to the `readings` table.
   * Called when a "DATA,…" line arrives via direct Bluetooth connection.
   * Maps the BT-parsed object to the gateway-compatible column names.
   *
   * @param {{ temperature, soil_pct, rain_pct, pump_state, fan_state, heater_state, lid_state, mode, profile, raw_data }} reading
   */
  async function pushReading(reading) {
    if (!_isConfigured()) return;
    try {
      const deviceId = _getDeviceId();
      const row = {
        ...(deviceId ? { device_id: deviceId } : {}),
        temp_c:    reading.temperature    ?? reading.temp_c    ?? null,
        soil_pct:  reading.soil_pct       ?? null,
        rain_pct:  reading.rain_pct       ?? null,
        pump_on:   (reading.pump_state    === 'ON') || (reading.pump_on    === true),
        fan_on:    (reading.fan_state     === 'ON') || (reading.fan_on     === true),
        heater_on: (reading.heater_state  === 'ON') || (reading.heater_on  === true),
        lid_state: reading.lid_state      ?? null,
        mode:      reading.mode           ?? 'AUTO',
        profile:   reading.profile        ?? null,
        raw_data:  reading.raw_data       ?? '',
      };
      const res = await fetch(`${_url}/rest/v1/readings`, {
        method:  'POST',
        headers: { ..._headers(), 'Prefer': 'return=minimal' },
        body:    JSON.stringify(row),
      });
      if (!res.ok) {
        console.error('[Supabase] pushReading error:', await res.text());
      } else {
        const el = document.getElementById('last-sync');
        if (el) el.textContent = new Date().toLocaleTimeString();
      }
    } catch (err) {
      console.error('[Supabase] pushReading fetch error:', err);
    }
  }

  /**
   * Queue a command for the gateway by inserting a row into `public.commands`.
   * The gateway polls this table and forwards queued commands to the Arduino.
   *
   * @param {string} command - Single-char or multi-char command string
   *   'a' = AUTO mode  |  'm' = TEST mode  |  '0' = stop all
   *   '1'=pump  '2'=fan  '3'=heater  '4'=open lid  '5'=close lid
   *   'S'=Silvercock profile  |  'H'=Shia profile
   *   'T<ms>'=pump timer  |  'L<ms>'=lid timer
   */
  async function queueCommand(command) {
    if (!_isConfigured()) return;
    try {
      const deviceId = _getDeviceId();
      const row = {
        ...(deviceId ? { device_id: deviceId } : {}),
        command:      command,
        status:       'queued',
        requested_by: 'web',
      };
      const res = await fetch(`${_url}/rest/v1/commands`, {
        method:  'POST',
        headers: { ..._headers(), 'Prefer': 'return=minimal' },
        body:    JSON.stringify(row),
      });
      if (!res.ok) {
        console.error('[Supabase] queueCommand error:', await res.text());
      } else {
        console.log('[Supabase] Command queued:', command);
      }
    } catch (err) {
      console.error('[Supabase] queueCommand fetch error:', err);
    }
  }

  /**
   * Log a command (queues it via `commands` table for gateway delivery).
   * Kept for backwards compatibility with sendRawCommand().
   * @param {string} command
   */
  async function logCommand(command) {
    await queueCommand(command);
  }

  /**
   * Fetch the latest reading for the configured device.
   * @returns {Promise<Object|null>}
   */
  async function getLatestReading() {
    if (!_isConfigured()) return null;
    try {
      const deviceId = _getDeviceId();
      const filter   = deviceId ? `device_id=eq.${encodeURIComponent(deviceId)}&` : '';
      const res = await fetch(
        `${_url}/rest/v1/readings?${filter}order=ts.desc&limit=1`,
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
   * Fetch the last N readings for the configured device (chronological order).
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async function getRecentReadings(limit = 60) {
    if (!_isConfigured()) return [];
    try {
      const deviceId = _getDeviceId();
      const filter   = deviceId ? `device_id=eq.${encodeURIComponent(deviceId)}&` : '';
      const res = await fetch(
        `${_url}/rest/v1/readings?${filter}order=ts.desc&limit=${limit}`,
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
   * Subscribe to real-time INSERT events on `public.readings`.
   *
   * Uses the Supabase JS SDK (postgres_changes Realtime) when available
   * (requires the CDN script in app.html and Realtime enabled for the table
   * in the Supabase dashboard).
   *
   * Falls back to polling every 5 seconds if the SDK is not loaded.
   *
   * @param {function} onRow - Called with each new reading row object.
   */
  function subscribe(onRow) {
    if (!_isConfigured()) return;

    if (_client) {
      // ── Supabase Realtime (WebSocket) ──────────────────────────────────────
      const deviceId = _getDeviceId();
      const chanOpts = {
        event:  'INSERT',
        schema: 'public',
        table:  'readings',
      };
      if (deviceId) chanOpts.filter = `device_id=eq.${deviceId}`;

      _channel = _client
        .channel('readings-live')
        .on('postgres_changes', chanOpts, payload => onRow(payload.new))
        .subscribe(status => {
          console.log('[Supabase] Realtime status:', status);
        });
      console.log('[Supabase] Realtime subscription started.');
      return;
    }

    // ── Fallback: polling every 5 s ────────────────────────────────────────
    console.info('[Supabase] Realtime SDK unavailable – using 5 s polling.');
    let lastTs = new Date(0).toISOString();

    const poll = async () => {
      try {
        const deviceId = _getDeviceId();
        const filter   = deviceId ? `device_id=eq.${encodeURIComponent(deviceId)}&` : '';
        const res = await fetch(
          `${_url}/rest/v1/readings?${filter}ts=gt.${encodeURIComponent(lastTs)}&order=ts.asc`,
          { headers: _headers() }
        );
        if (res.ok) {
          const rows = await res.json();
          rows.forEach(row => {
            lastTs = row.ts;
            onRow(row);
          });
        }
      } catch (_) { /* silent */ }
    };

    poll();
    _pollTimer = setInterval(poll, 5000);
    _channel   = _pollTimer;
  }

  /** Stop the real-time subscription or polling timer. */
  function unsubscribe() {
    if (_client && _channel && typeof _channel.unsubscribe === 'function') {
      _channel.unsubscribe();
    } else if (typeof _channel === 'number') {
      clearInterval(_channel);
    }
    _channel   = null;
    _pollTimer = null;
  }

  /**
   * Save Supabase credentials and device ID to localStorage.
   * Called by the Settings tab Save button.
   * @param {string} url
   * @param {string} key
   * @param {string} [deviceId]
   */
  function saveConfig(url, key, deviceId) {
    _url      = url.trim();
    _key      = key.trim();
    _deviceId = (deviceId || '').trim();
    localStorage.setItem('fc_supabase_url', _url);
    localStorage.setItem('fc_supabase_key', _key);
    localStorage.setItem('fc_device_id',    _deviceId);
    // Re-create the SDK client with updated credentials
    _client = null;
    if (_isConfigured() && window.supabase && typeof window.supabase.createClient === 'function') {
      _client = window.supabase.createClient(_url, _key);
    }
    console.log('[Supabase] Config saved.');
  }

  /** Return the currently configured device UUID. */
  function getDeviceId() {
    return _getDeviceId();
  }

  return {
    init,
    pushReading,
    queueCommand,
    logCommand,
    getLatestReading,
    getRecentReadings,
    subscribe,
    unsubscribe,
    saveConfig,
    getDeviceId,
  };
})();

window.SupabaseService = SupabaseService;
