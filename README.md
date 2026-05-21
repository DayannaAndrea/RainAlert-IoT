# RainAlert IoT 🌧️

Sistema de monitoreo climático en tiempo real para detectar lluvia y alertar via Telegram. Desarrollado con ESP32, Python y un dashboard web que se comunica por MQTT/WebSocket.

---

## ¿Qué hace?

- Lee sensores de lluvia (FC-37), temperatura/humedad (DHT22), presión (BMP280), luminosidad (LDR) y humedad de suelo
- Clasifica el nivel de lluvia: **Seco → Llovizna → Aguacero**
- Envía alertas por **Telegram** cuando detecta aguacero
- Muestra todo en un **dashboard web en tiempo real**
- Predice lluvia próxima analizando la caída de presión barométrica

---

## Estructura del proyecto

```
rainalert-iot/
├── firmware/
│   └── rainAlert.ino        # Código ESP32 (Arduino IDE)
├── Backend/
│   ├── app.py               # Backend Python (MQTT + SQLite + Telegram)
│   ├── .env.example         # Plantilla de variables de entorno
│   └── rainalert.db         # Base de datos (se genera automáticamente)
├── Frontend/
│   ├── index.html           # Dashboard web
│   ├── css/styles.css
│   └── js/app.js
├── iniciar_rainalert.bat    # Script de inicio rápido (Windows)
└── README.md
```

---

## Requisitos

### Hardware por nodo
| Componente | Descripción |
|---|---|
| ESP32 | Microcontrolador principal |
| FC-37 | Sensor de lluvia (salida analógica) |
| DHT22 | Temperatura y humedad del aire |
| BMP280 | Presión barométrica (I2C) |
| LDR | Sensor de luminosidad |
| Sensor capacitivo | Humedad del suelo |
| LED RGB | Indicador visual de nivel |
| Buzzer | Alerta sonora |

### Software
- [Mosquitto MQTT Broker](https://mosquitto.org/) con WebSocket habilitado en puerto 9001
- Python 3.10+
- Arduino IDE con soporte ESP32

---

## Instalación

### 1. Broker MQTT (Mosquitto)

Instala Mosquitto y habilita WebSocket agregando esto a `mosquitto.conf`:

```
listener 1883
listener 9001
protocol websockets
allow_anonymous true
```

### 2. Firmware ESP32

1. Abre `firmware/rainAlert.ino` en Arduino IDE
2. Instala las librerías necesarias:
   - `PubSubClient`
   - `DHT sensor library` (Adafruit)
   - `Adafruit BMP280`
3. Edita las credenciales al inicio del archivo:
```cpp
const char* WIFI_SSID     = "TU_SSID";
const char* WIFI_PASSWORD = "TU_PASSWORD";
const char* MQTT_BROKER   = "IP_DE_TU_BROKER";
const char* NODO_ID       = "nodo1";  // cambia por nodo
```
4. Sube el código al ESP32

### 3. Backend Python

```bash
# Crear entorno virtual
python -m venv .venv
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # Linux/Mac

# Instalar dependencias
pip install paho-mqtt python-dotenv requests

# Configurar variables de entorno
cp Backend/.env.example Backend/.env
# Edita Backend/.env con tus datos

# Ejecutar
python Backend/app.py
```

### 4. Dashboard web

Abre `Frontend/index.html` en el navegador, ingresa la IP del broker y el puerto WebSocket (9001), y haz clic en **Conectar**.

> En Windows puedes usar `iniciar_rainalert.bat` para arrancar el backend directamente.

---

## Pines ESP32

| Pin | Sensor |
|---|---|
| GPIO 4 | DHT22 (data) |
| GPIO 35 | FC-37 (analógico) |
| GPIO 32 | LDR (analógico) |
| GPIO 34 | Sensor suelo (analógico) |
| GPIO 21/22 | BMP280 (I2C SDA/SCL) |
| GPIO 5 | LED Rojo |
| GPIO 18 | LED Verde |
| GPIO 19 | LED Azul |
| GPIO 23 | Buzzer |

---

## Tópicos MQTT

Todos los mensajes siguen el patrón `rainAlert/{nodo}/{variable}`:

| Tópico | Ejemplo | Descripción |
|---|---|---|
| `rainAlert/nodo1/temperatura` | `27.5` | °C |
| `rainAlert/nodo1/humedad` | `68.0` | % |
| `rainAlert/nodo1/presion` | `1012.45` | hPa |
| `rainAlert/nodo1/lluvia_raw` | `890` | ADC 0-4095 |
| `rainAlert/nodo1/luz` | `2100` | ADC 0-4095 |
| `rainAlert/nodo1/humedad_suelo` | `1300` | ADC 0-4095 |
| `rainAlert/nodo1/nivel` | `1`, `2` o `3` | Seco/Llovizna/Aguacero |
| `rainAlert/nodo1/prediccion` | `lluvia_proxima` | Predicción por presión |

---

## Niveles de lluvia

| Nivel | Estado | FC-37 | Suelo |
|---|---|---|---|
| 1 | ☀ Seco | > 1800 | cualquiera |
| 2 | 🌦 Llovizna | < 1800 | > 1500 |
| 3 | ⛈ Aguacero | < 1800 | < 1500 |

---

## Variables de entorno (`Backend/.env`)

```env
BROKER_IP=192.168.1.100
BROKER_PORT=1883
DB_PATH=rainalert.db
TELEGRAM_TOKEN=tu_token_del_bot
TELEGRAM_CHAT=tu_chat_id
```

Para obtener el token de Telegram: habla con [@BotFather](https://t.me/BotFather) en Telegram.

---

## Tecnologías

- **ESP32** — firmware en C++ (Arduino framework)
- **Python** — paho-mqtt, sqlite3, requests
- **MQTT** — Mosquitto broker
- **HTML/CSS/JS** — dashboard estático, sin frameworks
- **Chart.js** — gráfica de historial
- **SQLite** — persistencia de lecturas y alertas

---

## Desarrollado en Santa Marta, Colombia 🇨🇴
