/*
 * FloraCraft Smart Greenhouse – TESTING / CALIBRATION MODE
 * ==========================================================
 * Standalone sketch used during hardware commissioning.
 * No automation logic runs; every actuator is controlled manually via
 * serial commands, and each one auto-off after a configurable duration.
 *
 * Use this to:
 *  - Verify relay wiring (pump, fan, heater)
 *  - Verify motor direction and timing (lid open/close)
 *  - Read raw ADC values from soil and rain sensors
 *
 * COMMANDS (sent from the FloraCraft app Testing tab, or the Arduino IDE
 *           Serial Monitor at 9600 baud)
 * -----------------------------------------------------------------------
 *   '1'  → Test Water Pump  (runs for testDuration ms then auto-off)
 *   '2'  → Test Cooling Fan (runs for testDuration ms then auto-off)
 *   '3'  → Test Heater/Bulb (runs for testDuration ms then auto-off)
 *   '4'  → Open Lid   (runs motor for testDuration ms, then stops)
 *   '5'  → Close Lid  (runs motor for testDuration ms, then stops)
 *   '0'  → Emergency stop – turn everything off immediately
 *   'T<ms>\n' → Change testDuration for all timers (e.g. "T1350\n")
 *
 * OUTPUT (every 2 seconds)
 * -------------------------
 *   Human-readable sensor block + structured DATA line (same format as
 *   floracraft_auto.ino so the Dashboard parses it correctly).
 *
 * HARDWARE – same pin layout as floracraft_auto.ino
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
const int SOIL_AIR_VALUE   = 600;
const int SOIL_WATER_VALUE = 250;
const int RAIN_DRY_VALUE   = 1020;
const int RAIN_WET_VALUE   = 200;

// ── Test duration (ms) – adjustable via 'T<ms>\n' command ───────────────────
// Default of 1350 ms matches the OPEN_TIME in floracraft_auto.ino so a single
// test run exercises the full lid-open stroke without over-driving the motor.
unsigned long testDuration = 1350;

// ── Per-actuator timer tracking ──────────────────────────────────────────────
unsigned long pumpStartTime   = 0;
unsigned long fanStartTime    = 0;
unsigned long heaterStartTime = 0;
unsigned long motorStartTime  = 0;

// Command buffer for multi-char input
String cmdBuffer = "";

unsigned long lastReport = 0;
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

  // All relays OFF (Active LOW → set HIGH)
  digitalWrite(pumpPin,   HIGH);
  digitalWrite(fanPin,    HIGH);
  digitalWrite(heaterPin, HIGH);
  digitalWrite(motorIn1,  LOW);
  digitalWrite(motorIn2,  LOW);

  Serial.println("--- FLORACRAFT TEST MODE ---");
  Serial.println("Commands: 1=Pump  2=Fan  3=Heater  4=Open  5=Close  0=STOP  T<ms>=Duration");
  Serial.print("Test duration: "); Serial.print(testDuration); Serial.println("ms");
}

// ── loop() ──────────────────────────────────────────────────────────────────
void loop() {
  // ── Command processing ───────────────────────────────────────────────────
  while (Serial.available() > 0) {
    char c = Serial.read();
    cmdBuffer += c;

    if (c == '\n' || c == '\r') {
      processTestCommand(cmdBuffer.trim());
      cmdBuffer = "";
    } else if (cmdBuffer.length() == 1) {
      char cmd = cmdBuffer.charAt(0);
      if (String("012345").indexOf(cmd) >= 0) {
        processTestCommand(cmdBuffer);
        cmdBuffer = "";
      }
    }
  }

  // ── Auto-off logic ───────────────────────────────────────────────────────
  if (digitalRead(pumpPin) == LOW && (millis() - pumpStartTime > testDuration)) {
    digitalWrite(pumpPin, HIGH);
    Serial.println("[AUTO-OFF] Pump");
  }
  if (digitalRead(fanPin) == LOW && (millis() - fanStartTime > testDuration)) {
    digitalWrite(fanPin, HIGH);
    Serial.println("[AUTO-OFF] Fan");
  }
  if (digitalRead(heaterPin) == LOW && (millis() - heaterStartTime > testDuration)) {
    digitalWrite(heaterPin, HIGH);
    Serial.println("[AUTO-OFF] Heater");
  }
  if ((digitalRead(motorIn1) == HIGH || digitalRead(motorIn2) == HIGH) &&
      (millis() - motorStartTime > testDuration)) {
    digitalWrite(motorIn1, LOW);
    digitalWrite(motorIn2, LOW);
    Serial.println("[AUTO-OFF] Motor");
  }

  // ── Sensor reporting every 2 s ───────────────────────────────────────────
  if (millis() - lastReport > 2000) {
    reportSensors();
    lastReport = millis();
  }
}

// ── Command handler ──────────────────────────────────────────────────────────
void processTestCommand(String cmd) {
  if (cmd.length() == 0) return;
  char first = cmd.charAt(0);

  if (first == 'T') {
    unsigned long ms = (unsigned long) cmd.substring(1).toInt();
    if (ms > 0) {
      testDuration = ms;
      Serial.print("[TIMER] testDuration="); Serial.print(testDuration); Serial.println("ms");
    }
    return;
  }

  switch (first) {
    case '1':
      digitalWrite(pumpPin, LOW);
      pumpStartTime = millis();
      Serial.print("[TEST] Pump ON – auto-off in "); Serial.print(testDuration); Serial.println("ms");
      break;
    case '2':
      digitalWrite(fanPin, LOW);
      fanStartTime = millis();
      Serial.print("[TEST] Fan ON – auto-off in "); Serial.print(testDuration); Serial.println("ms");
      break;
    case '3':
      digitalWrite(heaterPin, LOW);
      heaterStartTime = millis();
      Serial.print("[TEST] Heater ON – auto-off in "); Serial.print(testDuration); Serial.println("ms");
      break;
    case '4':
      // Open lid – motor forward
      digitalWrite(motorIn1, HIGH); digitalWrite(motorIn2, LOW);
      motorStartTime = millis();
      Serial.print("[TEST] Lid OPENING – auto-stop in "); Serial.print(testDuration); Serial.println("ms");
      break;
    case '5':
      // Close lid – motor reverse
      digitalWrite(motorIn1, LOW); digitalWrite(motorIn2, HIGH);
      motorStartTime = millis();
      Serial.print("[TEST] Lid CLOSING – auto-stop in "); Serial.print(testDuration); Serial.println("ms");
      break;
    case '0':
      stopAll();
      Serial.println("[STOP] All actuators OFF");
      break;
  }
}

// ── Emergency stop ────────────────────────────────────────────────────────────
void stopAll() {
  digitalWrite(pumpPin,   HIGH);
  digitalWrite(fanPin,    HIGH);
  digitalWrite(heaterPin, HIGH);
  digitalWrite(motorIn1,  LOW);
  digitalWrite(motorIn2,  LOW);
}

// ── Sensor report ─────────────────────────────────────────────────────────────
// Emits human-readable + structured DATA line (same format as floracraft_auto.ino)
void reportSensors() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  int rawSoil = analogRead(soilPin);
  int rawRain = analogRead(rainPin);

  int soilPct = constrain(map(rawSoil, SOIL_AIR_VALUE, SOIL_WATER_VALUE, 0, 100), 0, 100);
  int rainPct = constrain(map(rawRain, RAIN_DRY_VALUE, RAIN_WET_VALUE,  0, 100), 0, 100);

  if (!isnan(t)) {
    Serial.println("---");
    Serial.print("Temp: "); Serial.print(t); Serial.print("C  Hum: ");
    Serial.print(h); Serial.print("%  Soil: "); Serial.print(rawSoil);
    Serial.print(" ("); Serial.print(soilPct); Serial.print("%)  Rain: ");
    Serial.print(rawRain); Serial.print(" ("); Serial.print(rainPct); Serial.println("%)");

    // Structured DATA line for app
    // Actuator states come from direct pin reads
    Serial.print("DATA,");
    Serial.print(t); Serial.print(",");
    Serial.print(soilPct); Serial.print(",");
    Serial.print(rainPct); Serial.print(",");
    Serial.print(digitalRead(pumpPin)   == LOW ? "ON" : "OFF"); Serial.print(",");
    Serial.print(digitalRead(fanPin)    == LOW ? "ON" : "OFF"); Serial.print(",");
    Serial.print(digitalRead(heaterPin) == LOW ? "ON" : "OFF"); Serial.print(",");
    bool motorActive = (digitalRead(motorIn1) == HIGH || digitalRead(motorIn2) == HIGH);
    Serial.println(motorActive ? "MOVING" : "STOPPED");
  }
}
