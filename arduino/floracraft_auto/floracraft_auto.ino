/*
 * FloraCraft Smart Greenhouse – AUTO MODE
 * =========================================
 * This is the primary operational firmware.  The Arduino reads sensors every
 * 2 seconds and prints a structured DATA line that the app can parse:
 *
 *   "DATA,<temp>,<soil%>,<rain%>,<pumpState>,<fanState>,<heaterState>,<lidState>"
 *
 * The app can also send single-character commands back:
 *
 *   'a'  → Switch to AUTO mode
 *   'm'  → Switch to MANUAL / TEST mode
 *   '1'  → Toggle Water Pump
 *   '2'  → Toggle Cooling Fan
 *   '3'  → Toggle Heater / Bulb
 *   '4'  → Open Lid  (only if CLOSED)
 *   '5'  → Close Lid (only if OPEN)
 *   '0'  → Emergency stop – all actuators OFF
 *   'S'  → Apply Silvercock profile (TEMP_HIGH_ON=35, SOIL_DRY_ON=55)
 *   'H'  → Apply Shia profile       (TEMP_HIGH_ON=30, SOIL_DRY_ON=35)
 *   'T<ms>\n' → Override PUMP_RUN_TIME  (e.g. "T2500\n")
 *   'L<ms>\n' → Override LID open/close times (e.g. "L1350\n")
 *
 * HARDWARE
 * --------
 *  - Arduino Uno / Nano
 *  - ZS-040 (HC-05/HC-06) Bluetooth module on hardware Serial (TX/RX pins)
 *    Note: Disconnect the BT module TX/RX wires before uploading firmware!
 *  - DHT11 on pin 2
 *  - Capacitive Soil Moisture v1.2 on A0
 *  - Raindrop / Leaf Wetness sensor on A1
 *  - Water Pump relay on pin 3 (Active LOW)
 *  - Cooling Fan relay on pin 4 (Active LOW)
 *  - Heater / Bulb relay on pin 5 (Active LOW)
 *  - L298N / L293D Motor Driver: IN1=8, IN2=9
 *
 * WIRING NOTE
 * -----------
 * ZS-040 uses hardware Serial at 9600 baud.  When connected, all Serial.print()
 * calls are forwarded to the Bluetooth module and received by the app.
 * Commands typed in the app are received via Serial.read().
 *
 * DEPENDENCIES
 * ------------
 * Install the "DHT sensor library" by Adafruit via the Arduino IDE Library Manager.
 */

#include "DHT.h"

// ── Pin definitions ─────────────────────────────────────────────────────────
#define DHTPIN    2
#define DHTTYPE   DHT11

const int soilPin   = A0;
const int rainPin   = A1;
const int pumpPin   = 3;
const int fanPin    = 4;
const int heaterPin = 5;
const int motorIn1  = 8;
const int motorIn2  = 9;

// ── ADC calibration ─────────────────────────────────────────────────────────
const int SOIL_AIR_VALUE  = 600;   // ADC reading in dry air
const int SOIL_WATER_VALUE = 250;  // ADC reading fully submerged
const int RAIN_DRY_VALUE   = 1020; // ADC reading on dry sensor
const int RAIN_WET_VALUE   = 200;  // ADC reading on wet sensor

// ── Adjustable thresholds (overridden by 'S'/'H' commands from app) ─────────
float TEMP_HIGH_ON  = 30.0;  // Fan turns ON  above this temp
float TEMP_HIGH_OFF = 27.0;  // Fan turns OFF below this temp
float TEMP_LOW_ON   = 24.0;  // Heater turns ON  below this temp
float TEMP_LOW_OFF  = 26.0;  // Heater turns OFF above this temp
int   SOIL_DRY_PERCENT_ON = 35;  // Pump triggers if moisture < this %
int   RAIN_THRESHOLD      = 45;  // Lid closes / heater triggers if wetness > this %

// ── Adjustable timers (overridden by 'T…' / 'L…' commands from app) ─────────
unsigned long OPEN_TIME    = 1350;  // ms to run motor when opening lid
unsigned long CLOSE_TIME   = 1300;  // ms to run motor when closing lid
unsigned long PUMP_RUN_TIME = 2500; // ms to run the water pump per cycle

// ── Lid state machine ────────────────────────────────────────────────────────
enum LidState { CLOSED, OPEN, MOVING_OPEN, MOVING_CLOSE };
LidState currentLidState = CLOSED;

// ── App state ────────────────────────────────────────────────────────────────
bool manualMode      = false;
bool systemStabilized = false;

unsigned long lastReport     = 0;
unsigned long motorStartTime = 0;
unsigned long pumpStartTime  = 0;
unsigned long bootTime       = 0;
bool motorIsRunning = false;
bool pumpIsRunning  = false;

// Buffer for multi-character commands ('T<ms>\n', 'L<ms>\n')
String cmdBuffer = "";

DHT dht(DHTPIN, DHTTYPE);

// ── setup() ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(9600);
  dht.begin();

  pinMode(pumpPin,   OUTPUT);
  pinMode(fanPin,    OUTPUT);
  pinMode(heaterPin, OUTPUT);
  pinMode(motorIn1,  OUTPUT);
  pinMode(motorIn2,  OUTPUT);

  // Relays are Active LOW – initialize all OFF
  digitalWrite(pumpPin,   HIGH);
  digitalWrite(fanPin,    HIGH);
  digitalWrite(heaterPin, HIGH);
  digitalWrite(motorIn1,  LOW);
  digitalWrite(motorIn2,  LOW);

  bootTime = millis();
  Serial.println("--- FLORACRAFT SMART GREENHOUSE v1.0 ---");
}

// ── loop() ──────────────────────────────────────────────────────────────────
void loop() {
  // Wait 3 seconds after boot before running lid logic (motor settling)
  if (!systemStabilized && (millis() - bootTime > 3000)) systemStabilized = true;

  // ── Command processing ───────────────────────────────────────────────────
  while (Serial.available() > 0) {
    char c = Serial.read();
    cmdBuffer += c;

    // Multi-char commands end with '\n'
    if (c == '\n' || c == '\r') {
      processCommand(cmdBuffer.trim());
      cmdBuffer = "";
    }
    // Single-char commands (no newline) – handle immediately unless building buffer
    else if (cmdBuffer.length() == 1) {
      char cmd = cmdBuffer.charAt(0);
      // Single-char commands: a, m, 0-5, S, H
      if (String("am012345SH").indexOf(cmd) >= 0) {
        processCommand(cmdBuffer);
        cmdBuffer = "";
      }
      // Otherwise let it accumulate (T<ms>, L<ms>)
    }
  }

  // ── Sensor readings ──────────────────────────────────────────────────────
  float t = dht.readTemperature();
  if (isnan(t)) return; // DHT11 read failure – skip this cycle

  int rawSoil = analogRead(soilPin);
  int rawRain = analogRead(rainPin);

  int soilPercent = constrain(map(rawSoil, SOIL_AIR_VALUE, SOIL_WATER_VALUE, 0, 100), 0, 100);
  int rainPercent = constrain(map(rawRain, RAIN_DRY_VALUE, RAIN_WET_VALUE,  0, 100), 0, 100);

  // ── Automation logic (only in AUTO mode) ────────────────────────────────
  if (!manualMode) {
    // 1. Fan: cooling when too hot
    if (t > TEMP_HIGH_ON)  digitalWrite(fanPin, LOW);
    else if (t < TEMP_HIGH_OFF) digitalWrite(fanPin, HIGH);

    // 2. Pump: run for PUMP_RUN_TIME when soil is dry
    if (!pumpIsRunning && soilPercent < SOIL_DRY_PERCENT_ON) {
      digitalWrite(pumpPin, LOW);
      pumpStartTime = millis();
      pumpIsRunning = true;
    }

    // 3. Heater / Bulb: ON when raining OR too cold
    bool isTooWet  = (rainPercent > RAIN_THRESHOLD);
    bool isTooCold = (t < TEMP_LOW_ON);
    if (isTooWet || isTooCold) {
      digitalWrite(heaterPin, LOW);
    } else if (t > TEMP_LOW_OFF && rainPercent <= RAIN_THRESHOLD) {
      digitalWrite(heaterPin, HIGH);
    }

    // 4. Lid: close when raining, open when dry
    if (systemStabilized && !motorIsRunning) {
      if (rainPercent > RAIN_THRESHOLD && currentLidState == OPEN)   startMotorClose();
      else if (rainPercent <= RAIN_THRESHOLD && currentLidState == CLOSED) startMotorOpen();
    }
  }

  // ── Actuator timers ──────────────────────────────────────────────────────
  // Pump auto-off
  if (pumpIsRunning && (millis() - pumpStartTime >= PUMP_RUN_TIME)) {
    digitalWrite(pumpPin, HIGH);
    pumpIsRunning = false;
  }

  // Motor auto-stop
  if (motorIsRunning) {
    unsigned long elapsed = millis() - motorStartTime;
    if (currentLidState == MOVING_OPEN  && elapsed >= OPEN_TIME)  stopMotor();
    if (currentLidState == MOVING_CLOSE && elapsed >= CLOSE_TIME) stopMotor();
  }

  // ── Periodic reporting ───────────────────────────────────────────────────
  if (millis() - lastReport > 2000) {
    reportStatus(t, soilPercent, rainPercent);
    lastReport = millis();
  }
}

// ── Command dispatcher ───────────────────────────────────────────────────────
void processCommand(String cmd) {
  if (cmd.length() == 0) return;

  char first = cmd.charAt(0);

  if (first == 'a') {
    manualMode = false;
    Serial.println("[CMD] AUTO mode");

  } else if (first == 'm') {
    manualMode = true;
    Serial.println("[CMD] MANUAL/TEST mode");

  } else if (first == 'S') {
    // Silvercock profile
    TEMP_HIGH_ON = 35.0; TEMP_HIGH_OFF = 32.0;
    SOIL_DRY_PERCENT_ON = 55;
    Serial.println("[PROFILE] Silvercock: TEMP_HIGH=35, SOIL_DRY=55");

  } else if (first == 'H') {
    // Shia profile
    TEMP_HIGH_ON = 30.0; TEMP_HIGH_OFF = 27.0;
    SOIL_DRY_PERCENT_ON = 35;
    Serial.println("[PROFILE] Shia: TEMP_HIGH=30, SOIL_DRY=35");

  } else if (first == 'T') {
    // Timer override: "T<ms>"
    unsigned long ms = (unsigned long) cmd.substring(1).toInt();
    if (ms > 0) {
      PUMP_RUN_TIME = ms;
      Serial.print("[TIMER] PUMP_RUN_TIME="); Serial.println(ms);
    }

  } else if (first == 'L') {
    // Lid timer override: "L<ms>"
    unsigned long ms = (unsigned long) cmd.substring(1).toInt();
    if (ms > 0) {
      OPEN_TIME = CLOSE_TIME = ms;
      Serial.print("[TIMER] LID_TIME="); Serial.println(ms);
    }

  } else {
    // Manual actuator commands (only act when in manual mode)
    manualMode = true;
    switch (first) {
      case '1':
        digitalWrite(pumpPin, !digitalRead(pumpPin));
        pumpIsRunning = false;
        Serial.println("[MANUAL] Pump toggled");
        break;
      case '2':
        digitalWrite(fanPin, !digitalRead(fanPin));
        Serial.println("[MANUAL] Fan toggled");
        break;
      case '3':
        digitalWrite(heaterPin, !digitalRead(heaterPin));
        Serial.println("[MANUAL] Heater toggled");
        break;
      case '4':
        if (currentLidState == CLOSED && !motorIsRunning) {
          startMotorOpen();
          Serial.println("[MANUAL] Opening lid");
        } else {
          Serial.println("[MANUAL] Lid already open or moving");
        }
        break;
      case '5':
        if (currentLidState == OPEN && !motorIsRunning) {
          startMotorClose();
          Serial.println("[MANUAL] Closing lid");
        } else {
          Serial.println("[MANUAL] Lid already closed or moving");
        }
        break;
      case '0':
        // Emergency stop
        digitalWrite(pumpPin,   HIGH);
        digitalWrite(fanPin,    HIGH);
        digitalWrite(heaterPin, HIGH);
        pumpIsRunning = false;
        if (currentLidState == OPEN && !motorIsRunning) startMotorClose();
        Serial.println("[MANUAL] Emergency stop – all OFF");
        break;
    }
  }
}

// ── Motor helpers ────────────────────────────────────────────────────────────
void startMotorOpen() {
  digitalWrite(motorIn1, HIGH); digitalWrite(motorIn2, LOW);
  motorStartTime = millis(); motorIsRunning = true; currentLidState = MOVING_OPEN;
}

void startMotorClose() {
  digitalWrite(motorIn1, LOW); digitalWrite(motorIn2, HIGH);
  motorStartTime = millis(); motorIsRunning = true; currentLidState = MOVING_CLOSE;
}

void stopMotor() {
  if (currentLidState == MOVING_OPEN)  currentLidState = OPEN;
  if (currentLidState == MOVING_CLOSE) currentLidState = CLOSED;
  digitalWrite(motorIn1, LOW); digitalWrite(motorIn2, LOW);
  motorIsRunning = false;
}

// ── Status reporter ──────────────────────────────────────────────────────────
// Emits two lines:
//   1. Human-readable status block (visible in Raw Stream terminal)
//   2. Structured DATA line (parsed by the app dashboard)
void reportStatus(float t, int soilPct, int rainPct) {
  // Human-readable block
  Serial.println("\n--- STATUS ---");
  Serial.print("TEMP: ");   Serial.print(t);       Serial.print("C");
  Serial.print(" | SOIL: "); Serial.print(soilPct); Serial.print("%");
  Serial.print(" | WET: ");  Serial.print(rainPct); Serial.println("%");
  Serial.print("PUMP:");    Serial.print(digitalRead(pumpPin)   == LOW ? "[ON]"  : "[OFF]");
  Serial.print(" FAN:");    Serial.print(digitalRead(fanPin)    == LOW ? "[ON]"  : "[OFF]");
  Serial.print(" HEATER:"); Serial.print(digitalRead(heaterPin) == LOW ? "[ON]"  : "[OFF]");
  Serial.print(" LID:");
  if      (currentLidState == OPEN)         Serial.println("OPEN");
  else if (currentLidState == CLOSED)       Serial.println("CLOSED");
  else                                       Serial.println("MOVING...");

  // ── Structured line for app parsing ──
  // Format: DATA,<temp>,<soil%>,<rain%>,<pumpState>,<fanState>,<heaterState>,<lidState>
  Serial.print("DATA,");
  Serial.print(t); Serial.print(",");
  Serial.print(soilPct); Serial.print(",");
  Serial.print(rainPct); Serial.print(",");
  Serial.print(digitalRead(pumpPin)   == LOW ? "ON" : "OFF"); Serial.print(",");
  Serial.print(digitalRead(fanPin)    == LOW ? "ON" : "OFF"); Serial.print(",");
  Serial.print(digitalRead(heaterPin) == LOW ? "ON" : "OFF"); Serial.print(",");
  if      (currentLidState == OPEN)   Serial.println("OPEN");
  else if (currentLidState == CLOSED) Serial.println("CLOSED");
  else                                 Serial.println("MOVING");
}
