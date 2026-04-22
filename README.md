# 🌿 FloraCraft – Smart Greenhouse IoT Dashboard

A **hybrid web + mobile** dashboard for monitoring and controlling an Arduino-based smart greenhouse via Bluetooth and Supabase cloud sync.

---

## 📁 Repository Structure

```
arduinoprojectsem2/
├── arduino/
│   ├── floracraft_auto/          # Primary AUTO firmware (floracraft_auto.ino)
│   └── floracraft_test/          # Testing / calibration firmware (floracraft_test.ino)
│
├── src/
│   ├── app.html                  # ★ Main hybrid app (open in Chrome to run)
│   ├── bluetooth.js              # Web Bluetooth serial service (ZS-040/HC-05)
│   └── supabase.js               # Supabase real-time sync service
│
├── ui/
│   ├── screens/
│   │   ├── mobile/               # Stitch-generated mobile screen designs
│   │   │   ├── onboarding.html
│   │   │   ├── dashboard.html
│   │   │   ├── raw_stream.html
│   │   │   ├── plant_profiles.html
│   │   │   ├── testing_mode.html
│   │   │   └── settings.html
│   │   └── web/                  # Stitch-generated web/desktop screen designs
│   │       ├── dashboard.html
│   │       ├── raw_stream.html
│   │       ├── plant_profiles.html
│   │       ├── testing_mode.html
│   │       └── settings.html
│   └── assets/
│       ├── screenshots/          # Design reference screenshots (PNG)
│       └── design/DESIGN.md      # FloraCraft Industrial design system tokens
│
└── stitch_floracraft_iot_dashboard.zip   # Original Stitch UI export
```

---

## 🚀 Quick Start – Web App (no hardware needed for testing)

### Prerequisites
- **Google Chrome** (required for Web Bluetooth API)
- Node.js (optional – only for `npx serve`)

### Run locally

```bash
# Option A – serve with npx (recommended)
# Run from the REPO ROOT so vercel.json rewrites work (/ → /src/app.html)
npx serve .
# Then open: http://localhost:3000

# Option B – Python built-in server
python3 -m http.server 8080
# Then open: http://localhost:8080/src/app.html
```

> ⚠️ **Do not open `app.html` as a `file://` URL** – the Web Bluetooth API and
> absolute script paths (`/src/bluetooth.js`, `/src/supabase.js`) require an HTTP context.

### Deploy to Vercel

The repo includes a `vercel.json` that rewrites the root URL (`/`) to
`src/app.html`, so visiting `https://<your-project>.vercel.app/` loads the
app directly. No build step is required – it is a fully static single-page
app served from CDN assets.

---

## 🔧 Arduino Setup

### 1. Install dependencies

In the **Arduino IDE Library Manager**, install:
- **DHT sensor library** by Adafruit

### 2. Choose a firmware

| Sketch | When to use |
|--------|-------------|
| `arduino/floracraft_auto/floracraft_auto.ino` | Normal operation with full automation |
| `arduino/floracraft_test/floracraft_test.ino` | Commissioning / hardware testing |

### 3. Upload

> ⚠️ **Disconnect the ZS-040 TX/RX wires before uploading** – they share the
> hardware Serial port used for programming.

1. Open the `.ino` file in Arduino IDE
2. Select your board (`Arduino Uno` or `Nano`) and COM port
3. Click **Upload**
4. Reconnect the ZS-040 module after upload completes

---

## 📡 Connecting Bluetooth

The ZS-040 (HC-05 / HC-06) module communicates at **9600 baud** over the
Arduino's hardware Serial port (the same port used for uploading – hence the
disconnect-before-upload requirement above).

### Pairing
1. Power on the Arduino (the ZS-040's LED will blink rapidly)
2. On your phone/laptop, open Bluetooth settings and pair with the module
   - Default name: `HC-05`, `HC-06`, or `ZS-040`
   - Default PIN: **1234** or **0000**

### Connecting in the app
1. Open `http://localhost:3000/src/app.html` in Chrome
2. Tap **Connect** (top-right on mobile, sidebar badge on desktop)
3. The browser device picker will appear – select your HC-05/ZS-040
4. The status dot turns green when connected

> **Note:** Web Bluetooth works best with BLE modules. For classic Bluetooth
> HC-05/HC-06, you may need to use the [Web Serial API](https://developer.chrome.com/docs/capabilities/serial)
> instead. See `src/bluetooth.js` for the commented-out Web Serial alternative.

---

## 🌱 Plant Profiles

| Profile | TEMP_HIGH_ON | SOIL_DRY_ON | Serial command |
|---------|-------------|-------------|----------------|
| **Silvercock** | 35 °C | 55 % | `S` |
| **Shia** | 30 °C | 35 % | `H` |

Switch profiles from the **Plant Profiles** tab. The app sends a single
character (`S` or `H`) to the Arduino, which updates its threshold variables
at runtime without reflashing.

---

## 🧪 Testing Mode

1. Navigate to the **Testing** tab
2. Switch to **TEST** mode (sends `'m'` to Arduino)
3. Use the **Test Pump / Fan / Heater / Open Lid / Close Lid** buttons
4. Adjust **Pump Duration** and **Lid Transition Time** sliders, then tap
   **Send Timers to Arduino** to apply at runtime
5. Use **Stop All** (sends `'0'`) for an emergency shutdown
6. Switch back to **AUTO** (sends `'a'`) to restore automation

---

## ☁️ Supabase Cloud Sync

### Database setup

1. Create a project at [supabase.com](https://supabase.com)
2. Open the **SQL Editor** and run:

```sql
-- Sensor readings (one row per 2-second Arduino broadcast)
create table readings (
  id         bigserial primary key,
  ts         timestamptz default now(),
  device_id  text not null,
  raw_data   text,
  temp_c     float,
  soil_pct   int,
  rain_pct   int,
  pump_on    boolean default false,
  fan_on     boolean default false,
  heater_on  boolean default false,
  lid_state  text,
  mode       text default 'auto',
  profile    text default 'silvercock'
);

-- Commands queued by the web app for the gateway to execute
create table commands (
  id         bigserial primary key,
  created_at timestamptz default now(),
  device_id  text not null,
  command    text not null,
  status     text default 'queued',
  source     text default 'web'
);

-- Row Level Security (allow anonymous access – tighten for production)
alter table readings  enable row level security;
alter table commands  enable row level security;
create policy "anon insert readings" on readings for insert with check (true);
create policy "anon select readings" on readings for select using (true);
create policy "anon insert commands" on commands for insert with check (true);
create policy "anon select commands" on commands for select using (true);

-- Enable Realtime for live dashboard updates
alter publication supabase_realtime add table readings;
```

3. In the **Settings** tab of the app:
   - Enter your **Project URL** and **Anon Key**
   - Set the **Device ID** to match the `device_id` value your gateway uses (default: `Flora-GW-01`)
4. Click **Save Configuration** – readings will start syncing automatically

### How Device ID works

The `device_id` field links readings and commands to a specific Arduino gateway node.
The gateway (Node.js script) uses this same identifier when inserting rows into `readings`.
The web app filters live readings and routes queued commands by this ID.

### Gateway setup (Node.js BT→Supabase bridge)

The gateway reads Arduino serial output via Bluetooth and writes to Supabase:

1. Set environment variables (or `.env` file):

```
SUPABASE_URL=https://rpxxybykewhtzmlloadf.supabase.co
SUPABASE_KEY=<your-anon-key>
DEVICE_ID=Flora-GW-01
SERIAL_PORT=COM10   # Windows: check Device Manager → Bluetooth COM ports
                    # Linux/Mac: /dev/rfcomm0 or /dev/tty.HC-05-...
BAUD_RATE=9600
```

2. The gateway:
   - Parses `DATA,<temp>,<soil%>,<rain%>,<pump>,<fan>,<heater>,<lid>` lines
   - Inserts into `readings` with the mapped column names
   - Polls `commands` for rows with `status='queued'` matching the device ID
   - Sends each command to the Arduino over serial, then marks it `status='done'`

### Realtime setup

Supabase Realtime pushes new rows to the web app over WebSocket without polling.
After running the SQL above, verify in the Supabase dashboard:

1. Go to **Database → Replication**
2. Confirm `readings` is listed under `supabase_realtime` publication

The web app uses `@supabase/supabase-js v2` (loaded from CDN) for Realtime.
If the SDK fails to load, the app automatically falls back to 3-second REST polling.

---

## 📱 Mobile PWA (Add to Home Screen)

`app.html` includes `apple-mobile-web-app-capable` and `theme-color` meta tags.
Serve it over HTTPS (e.g. deploy to Vercel/Netlify) and:
- **iOS Safari**: Share → Add to Home Screen
- **Android Chrome**: Menu → Add to Home Screen / Install App

---

## 🔌 Wiring Next Steps (for contributors)

| Task | File | Search for |
|------|------|-----------|
| Switch to Web Serial API (classic BT) | `src/bluetooth.js` | `// ── TODO (wiring): If using classic BT` |
| Add Chart.js real gauge (semicircle) | `src/app.html` | `gauge-arc` |
| Add historical chart data on startup | `src/app.html` | `startSupabaseSubscription` |

---

## 🧩 UI Asset Instructions

The `ui/screens/mobile/` and `ui/screens/web/` folders contain the original
Stitch-generated standalone HTML files. They are **design references** – each
can be opened independently in a browser to preview the intended layout.

The integrated, functional app lives in `src/app.html`. All Stitch screen
designs have been adapted and merged into that single file.

Design tokens (colors, typography, spacing) are documented in
`ui/assets/design/DESIGN.md` and mirrored in the Tailwind config inside
`src/app.html`.

---

## 🏗️ Arduino Serial Protocol Reference

### Output (Arduino → App, every ~2 s)

```
--- STATUS ---
TEMP: 24.5C | SOIL: 65% | WET: 12%
PUMP:[OFF] FAN:[ON] HEATER:[OFF] LID:OPEN
DATA,24.5,65,12,OFF,ON,OFF,OPEN
```

The `DATA,…` line is the machine-readable format the Dashboard parses.

### Input (App → Arduino)

| Command | Action |
|---------|--------|
| `a` | Switch to AUTO mode |
| `m` | Switch to MANUAL/TEST mode |
| `1` | Toggle Water Pump |
| `2` | Toggle Cooling Fan |
| `3` | Toggle Heater/Bulb |
| `4` | Open Lid (if CLOSED) |
| `5` | Close Lid (if OPEN) |
| `0` | Emergency stop |
| `S` | Apply Silvercock profile |
| `H` | Apply Shia profile |
| `T<ms>\n` | Set PUMP_RUN_TIME |
| `L<ms>\n` | Set LID open/close time |

---

## 📜 License

MIT © 2026 Abdullah Ayman Gamal Ahmed

