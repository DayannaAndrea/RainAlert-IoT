//  RainAlert IoT — Firmware Nodo ESP32
#include <WiFi.h>
#include <ESPmDNS.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <Adafruit_BMP280.h>

//  CONFIGURACIÓN

const char* WIFI_SSID = "TU_SSID";
const char* WIFI_PASSWORD = "TU_PASSWORD";
const char* MQTT_BROKER = "TU_BROKER_IP_O_HOSTNAME";
const int MQTT_PORT = 1883;
const char* MQTT_USER = "";
const char* MQTT_PASS = "";

// const char* NODO_ID = "nodo3";

// Intervalo de publicación
const long INTERVALO_MS = 2000;

//  PINES
#define PIN_DHT 4
#define PIN_FC37_AO 35
#define PIN_LDR 32
#define PIN_SOIL 34

#define PIN_LED_R 5
#define PIN_LED_G 18
#define PIN_LED_B 19
#define PIN_BUZZER 23

//  UMBRALES
#define UMBRAL_FC37_LLUVIA 1800   // esta seco cuando es mayor de 1800
#define UMBRAL_SUELO_HUMEDO 1500  // cuando es menor de 1500 esta mojado

#define HUMEDAD_ALERTA 70.0
#define PRESION_LLUVIA 1011.0

#define MUESTRAS_FC37 10

//  NIVELES
#define NIVEL_SECO 1
#define NIVEL_LLOVIZNA 2
#define NIVEL_AGUACERO 3

//  OBJETOS Y VARIABLES GLOBALES
DHT dht(PIN_DHT, DHT22);
Adafruit_BMP280 bmp;
WiFiClient espClient;
PubSubClient mqttClient(espClient);

unsigned long ultimaPublicacion = 0;
int nivelActual = NIVEL_SECO;

//  BUZZER NO BLOQUEANTE
struct BuzzerFSM {
  bool activo = false;
  int beepsHechos = 0;
  int beepsTotal = 1;
  bool encendido = false;
  unsigned long ultimoCambio = 0;
  unsigned long durOn = 200;
  unsigned long durOff = 100;
  unsigned long pausaFinal = 0;
  unsigned long inicioPausa = 0;
  bool enPausa = false;
} buzzer;

void tickBuzzer() {
  if (!buzzer.activo) return;

  unsigned long ahora = millis();

  if (buzzer.enPausa) {
    if (ahora - buzzer.inicioPausa >= buzzer.pausaFinal) {
      buzzer.enPausa = false;
      buzzer.beepsHechos = 0;
      buzzer.encendido = true;
      digitalWrite(PIN_BUZZER, HIGH);
      buzzer.ultimoCambio = ahora;
    }
    return;
  }

  unsigned long duracion = buzzer.encendido ? buzzer.durOn : buzzer.durOff;
  if (ahora - buzzer.ultimoCambio < duracion) return;

  buzzer.ultimoCambio = ahora;

  if (buzzer.encendido) {
    digitalWrite(PIN_BUZZER, LOW);
    buzzer.encendido = false;
    buzzer.beepsHechos++;
    if (buzzer.beepsHechos >= buzzer.beepsTotal) {
      buzzer.enPausa = true;
      buzzer.inicioPausa = ahora;
    }
  } else {
    digitalWrite(PIN_BUZZER, HIGH);
    buzzer.encendido = true;
  }
}

void iniciarBuzzer(int beeps, unsigned long durOn, unsigned long durOff, unsigned long pausa) {
  buzzer.activo = true;
  buzzer.beepsHechos = 0;
  buzzer.beepsTotal = beeps;
  buzzer.encendido = true;
  buzzer.durOn = durOn;
  buzzer.durOff = durOff;
  buzzer.pausaFinal = pausa;
  buzzer.enPausa = false;
  buzzer.ultimoCambio = millis();
  digitalWrite(PIN_BUZZER, HIGH);
}

void detenerBuzzer() {
  buzzer.activo = false;
  digitalWrite(PIN_BUZZER, LOW);
}

//  SETUP
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== RainAlert IoT - " + String(NODO_ID) + " ===");

  pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT);
  pinMode(PIN_LED_B, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  setLED(0, 0, 0);
  digitalWrite(PIN_BUZZER, LOW);

  dht.begin();

  if (!bmp.begin(0x76)) {
    Serial.println("[ERROR] BMP280 no encontrado en 0x76. Intentando 0x77...");
    if (!bmp.begin(0x77)) {
      Serial.println("[ERROR] BMP280 tampoco en 0x77.");
    } else {
      Serial.println("[OK] BMP280 en 0x77.");
      bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                      Adafruit_BMP280::SAMPLING_X2,
                      Adafruit_BMP280::SAMPLING_X16,
                      Adafruit_BMP280::FILTER_X16,
                      Adafruit_BMP280::STANDBY_MS_500);
    }
  } else {
    Serial.println("[OK] BMP280 en 0x76.");
    bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                    Adafruit_BMP280::SAMPLING_X2,
                    Adafruit_BMP280::SAMPLING_X16,
                    Adafruit_BMP280::FILTER_X16,
                    Adafruit_BMP280::STANDBY_MS_500);
  }

  conectarWiFi();  // mDNS se inicia dentro de esta función
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(callbackMQTT);

  parpadeoInicio();
  Serial.println("[OK] Sistema listo.\n");
}

//  LOOP PRINCIPAL
void loop() {
  // Reconexión WiFi automática si se cae
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WARN] WiFi perdido — reconectando...");
    conectarWiFi();
  }

  if (!mqttClient.connected()) {
    reconectarMQTT();
  }
  mqttClient.loop();
  tickBuzzer();

  unsigned long ahora = millis();
  if (ahora - ultimaPublicacion >= INTERVALO_MS) {
    ultimaPublicacion = ahora;
    leerYPublicar();
  }
}

//  LECTURA PROMEDIADA DEL FC-37
int leerFC37Promedio() {
  long suma = 0;
  for (int i = 0; i < MUESTRAS_FC37; i++) {
    suma += analogRead(PIN_FC37_AO);
    delay(5);
  }
  return (int)(suma / MUESTRAS_FC37);
}

//  LECTURA DE SENSORES Y PUBLICACIÓN MQTT
void leerYPublicar() {
  Serial.println("--- Leyendo sensores ---");

  float temperatura = dht.readTemperature();
  float humedad = dht.readHumidity();
  if (isnan(temperatura) || isnan(humedad)) {
    Serial.println("[WARN] Error leyendo DHT22.");
    temperatura = -1;
    humedad = -1;
  } else {
    Serial.printf("  Temp: %.1f°C  Humedad: %.1f%%\n", temperatura, humedad);
  }

  float presion = bmp.readPressure() / 100.0F;
  if (isnan(presion) || presion < 800.0 || presion > 1100.0) {
    Serial.println("[WARN] BMP280 lectura inválida, usando valor neutro.");
    presion = 1013.0;
  } else {
    Serial.printf("  Presión: %.2f hPa\n", presion);
  }

  int lecturaLluvia = leerFC37Promedio();
  Serial.printf("  FC-37 promedio (%d muestras): %d\n", MUESTRAS_FC37, lecturaLluvia);

  int lecturaLuz = analogRead(PIN_LDR);
  int lecturaSuelo = analogRead(PIN_SOIL);
  Serial.printf("  LDR: %d  Suelo: %d\n", lecturaLuz, lecturaSuelo);

  int nivel = clasificarLluvia(lecturaLluvia, humedad, presion, lecturaLuz, lecturaSuelo);
  Serial.printf("  Nivel resultado: %d\n", nivel);

  if (nivel != nivelActual) {
    nivelActual = nivel;
    actualizarSalidas(nivel);
  }

  publicarDato("temperatura", String(temperatura, 1));
  publicarDato("humedad", String(humedad, 1));
  publicarDato("presion", String(presion, 2));
  publicarDato("lluvia_raw", String(lecturaLluvia));
  publicarDato("luz", String(lecturaLuz));
  publicarDato("humedad_suelo", String(lecturaSuelo));
  publicarDato("nivel", String(nivel));

  if (humedad > HUMEDAD_ALERTA && presion < PRESION_LLUVIA) {
    publicarDato("prediccion", "lluvia_proxima");
    Serial.println("  [ALERTA] Predicción: lluvia próxima.");
  } else {
    publicarDato("prediccion", "normal");
  }

  Serial.println();
}

//  CLASIFICACIÓN
int clasificarLluvia(int fc37, float hum, float pres, int ldr, int suelo) {
  bool lluviaFC37 = (fc37 < UMBRAL_FC37_LLUVIA);
  bool lluviaSuelo = (suelo < UMBRAL_SUELO_HUMEDO);

  Serial.printf(
    "  [DETECCION] fc37=%d(%s)  suelo=%d(%s)\n",
    fc37, lluviaFC37 ? "MOJADO" : "seco",
    suelo, lluviaSuelo ? "MOJADO" : "seco");

  if (lluviaFC37 && lluviaSuelo) return NIVEL_AGUACERO;
  if (lluviaFC37 && !lluviaSuelo) return NIVEL_LLOVIZNA;
  return NIVEL_SECO;
}

//  SALIDAS — LED y buzzer
void actualizarSalidas(int nivel) {
  switch (nivel) {
    case NIVEL_SECO:
      setLED(0, 255, 0);
      detenerBuzzer();
      break;

    case NIVEL_LLOVIZNA:
      setLED(255, 165, 0);
      iniciarBuzzer(1, 300, 100, 2000);
      break;

    case NIVEL_AGUACERO:
      setLED(255, 0, 0);
      iniciarBuzzer(3, 150, 80, 1000);
      break;
  }
}

void setLED(int r, int g, int b) {
  analogWrite(PIN_LED_R, r);
  analogWrite(PIN_LED_G, g);
  analogWrite(PIN_LED_B, b);
}

//  PUBLICACIÓN MQTT
void publicarDato(String variable, String valor) {
  String topic = "rainAlert/" + String(NODO_ID) + "/" + variable;
  mqttClient.publish(topic.c_str(), valor.c_str());
  Serial.printf("  MQTT → %s : %s\n", topic.c_str(), valor.c_str());
}

void callbackMQTT(char* topic, byte* payload, unsigned int length) {
  String mensaje = "";
  for (unsigned int i = 0; i < length; i++) mensaje += (char)payload[i];
  Serial.printf("[MQTT entrada] %s → %s\n", topic, mensaje.c_str());
  if (mensaje == "test") parpadeoInicio();
}

//  WiFi + mDNS
void conectarWiFi() {
  Serial.printf("Conectando a WiFi: %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 30) {
    delay(500);
    Serial.print(".");
    intentos++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[OK] WiFi conectado. IP: %s\n", WiFi.localIP().toString().c_str());

    //Iniciar mDNS
    if (MDNS.begin(NODO_ID)) {
      // Anunciar servicio MQTT para que el broker también
      // pueda descubrir el nodo si lo necesita
      MDNS.addService("mqtt", "tcp", MQTT_PORT);
      Serial.printf("[OK] mDNS activo → %s.local\n", NODO_ID);
    } else {
      Serial.println("[WARN] mDNS no pudo iniciarse.");
    }

  } else {
    Serial.println("\n[ERROR] No se pudo conectar al WiFi.");
  }
}

//  MQTT — reconexión
void reconectarMQTT() {
  if (mqttClient.connected()) return;
  Serial.printf("Conectando a broker MQTT [%s:%d]... ", MQTT_BROKER, MQTT_PORT);

  String clientId = "RainAlert-" + String(NODO_ID);
  bool conectado = (strlen(MQTT_USER) > 0)
                     ? mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)
                     : mqttClient.connect(clientId.c_str());

  if (conectado) {
    Serial.println("[OK]");
    publicarDato("estado", "conectado");
    String topicCmd = "rainAlert/" + String(NODO_ID) + "/cmd";
    mqttClient.subscribe(topicCmd.c_str());
  } else {
    Serial.printf("[ERROR] rc=%d — reintentando en el próximo ciclo\n", mqttClient.state());
    delay(500);
  }
}

//  UTILIDADES
void parpadeoInicio() {
  setLED(255, 0, 0);
  delay(300);
  setLED(0, 255, 0);
  delay(300);
  setLED(0, 0, 255);
  delay(300);
  setLED(0, 0, 0);
  delay(200);
  setLED(0, 255, 0);
  delay(500);
}
