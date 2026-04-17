/**
 * FloraCraft Bluetooth Serial Service
 * ------------------------------------
 * Wraps the Web Bluetooth API to communicate with the ZS-040 (HC-05/HC-06)
 * module connected to the Arduino via a Serial UART bridge characteristic.
 *
 * HOW TO CONNECT
 * --------------
 * 1. Pair the ZS-040 to your device via the OS Bluetooth settings (PIN: 1234 or 0000).
 * 2. Call BluetoothService.connect() – the browser will show a device picker.
 * 3. Send commands with BluetoothService.send(char) matching the Arduino protocol:
 *
 *    Auto / Manual modes
 *      'a'  → Switch to AUTO mode
 *      'm'  → Switch to MANUAL / TEST mode
 *
 *    Manual test commands (also used in Testing tab)
 *      '1'  → Toggle Water Pump
 *      '2'  → Toggle Cooling Fan
 *      '3'  → Toggle Heater / Bulb
 *      '4'  → Open Lid   (only if CLOSED)
 *      '5'  → Close Lid  (only if OPEN)
 *      '0'  → Emergency stop – all actuators OFF
 *
 *    Plant-profile commands
 *      'S'  → Apply Silvercock profile
 *      'H'  → Apply Shia (حشيش) profile
 *
 *    Timer-override commands (Testing tab sliders)
 *      'T<ms>\n'   → Set PUMP_RUN_TIME  (e.g. "T2500\n")
 *      'L<ms>\n'   → Set LID open/close time (e.g. "L1350\n")
 *
 * INCOMING DATA FORMAT (from Arduino every ~2 s)
 * -----------------------------------------------
 *   "DATA,<temp>,<soilPct>,<rainPct>,<pumpState>,<fanState>,<heaterState>,<lidState>\n"
 *   Example: "DATA,24.5,65,12,OFF,ON,OFF,CLOSED\n"
 *
 * NOTE: The Web Bluetooth UART service UUID below is for the Nordic UART Service
 * (NUS) which is commonly used in BLE modules. For the classic ZS-040 (BLE variant),
 * use the appropriate UUID. For a classic BT module you may need a Chrome extension
 * or Serial API instead of Web Bluetooth – see README for alternatives.
 */

// ─── Nordic UART Service (NUS) UUIDs ─────────────────────────────────────────
const UART_SERVICE_UUID      = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHARACTERISTIC = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write (app → Arduino)
const UART_RX_CHARACTERISTIC = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify (Arduino → app)
// ─────────────────────────────────────────────────────────────────────────────

const BluetoothService = (() => {
  let _device    = null;  // BluetoothDevice
  let _server    = null;  // BluetoothRemoteGATTServer
  let _txChar    = null;  // Write characteristic
  let _rxChar    = null;  // Notify characteristic
  let _onData    = null;  // Callback for incoming raw strings
  let _onStatus  = null;  // Callback for connection-state changes

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Open the browser device picker and establish a GATT connection.
   * @param {function} onData   - Called with each incoming line (string).
   * @param {function} onStatus - Called with status strings: 'connected' | 'disconnected' | 'error'
   */
  async function connect(onData, onStatus) {
    _onData   = onData   || (() => {});
    _onStatus = onStatus || (() => {});

    try {
      // ── TODO (wiring): If using classic BT (not BLE), swap to Web Serial API:
      //   const port = await navigator.serial.requestPort();
      //   await port.open({ baudRate: 9600 });
      //   // … read/write with port.readable / port.writable

      _device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'Flora' },   // Match "FloraCraft", "Flora-GW-01" etc.
          { namePrefix: 'HC-0' },    // HC-05 / HC-06 default names
          { namePrefix: 'ZS-040' },
        ],
        optionalServices: [UART_SERVICE_UUID],
      });

      _device.addEventListener('gattserverdisconnected', _onDisconnected);

      _server = await _device.gatt.connect();
      const service = await _server.getPrimaryService(UART_SERVICE_UUID);

      _txChar = await service.getCharacteristic(UART_TX_CHARACTERISTIC);
      _rxChar = await service.getCharacteristic(UART_RX_CHARACTERISTIC);

      // Subscribe to incoming notifications
      await _rxChar.startNotifications();
      _rxChar.addEventListener('characteristicvaluechanged', _handleRx);

      _onStatus('connected');
    } catch (err) {
      console.error('[BT] connect error:', err);
      _onStatus('error');
    }
  }

  /**
   * Send a single character or short string command to the Arduino.
   * @param {string} data - Command character(s) to send, e.g. '1', 'a', 'T2500\n'
   */
  async function send(data) {
    if (!_txChar) {
      console.warn('[BT] Not connected – cannot send:', data);
      return;
    }
    try {
      const encoded = new TextEncoder().encode(data);
      await _txChar.writeValue(encoded);
      console.log('[BT] TX →', data.replace(/\n/g, '\\n'));
    } catch (err) {
      console.error('[BT] send error:', err);
    }
  }

  /** Gracefully disconnect from the device. */
  function disconnect() {
    if (_device && _device.gatt.connected) {
      _device.gatt.disconnect();
    }
  }

  /** Returns true if currently connected. */
  function isConnected() {
    return !!(_device && _device.gatt.connected);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  function _handleRx(event) {
    const raw = new TextDecoder().decode(event.target.value);
    // The Arduino sends multi-line blocks – split and emit each line
    raw.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed) _onData(trimmed);
    });
  }

  function _onDisconnected() {
    console.warn('[BT] Device disconnected');
    _txChar = null;
    _rxChar = null;
    if (_onStatus) _onStatus('disconnected');
  }

  return { connect, send, disconnect, isConnected };
})();

// Make available globally (used by app.html inline scripts)
window.BluetoothService = BluetoothService;
