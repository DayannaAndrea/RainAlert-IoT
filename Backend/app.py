from dotenv import load_dotenv
import paho.mqtt.client as mqtt
import sqlite3
import datetime
import requests
import math
import os

load_dotenv()

#  CONFIGURACIÓN
BROKER_IP   = os.getenv("BROKER_IP")
BROKER_PORT = os.getenv("BROKER_PORT")
DB_PATH     = os.getenv("DB_PATH")

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
TELEGRAM_CHAT  = os.getenv("TELEGRAM_CHAT")
#  UMBRALES

# FC-37
FC37_SECO     = 2300
FC37_AGUACERO = 1000

# Suelo capacitivo
SUELO_HUMEDO = 1500

# Niveles
NIVEL_SECO     = 1
NIVEL_LLOVIZNA = 2
NIVEL_AGUACERO = 3

#  ESTADO POR NODO
#  Acumula los últimos valores para clasificar con todos juntos

estado_nodos = {}

def actualizar_estado(nodo, variable, valor):
    if nodo not in estado_nodos:
        estado_nodos[nodo] = {}
    try:
        estado_nodos[nodo][variable] = float(valor)
    except (ValueError, TypeError):
        pass

def clasificar_nivel(nodo):
    """
    AGUACERO  → FC-37 < 1000  Y  suelo < 1500
    LLOVIZNA  → FC-37 entre 1000 y 2300
    SECO      → FC-37 > 2300
    """
    datos = estado_nodos.get(nodo, {})
    fc37  = datos.get("lluvia_raw",    4095)
    suelo = datos.get("humedad_suelo", 4095)

    if fc37 < FC37_AGUACERO and suelo < SUELO_HUMEDO:
        return NIVEL_AGUACERO
    if fc37 < FC37_SECO:
        return NIVEL_LLOVIZNA
    return NIVEL_SECO

#  BASE DE DATOS

def iniciar_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS lecturas (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            nodo      TEXT NOT NULL,
            variable  TEXT NOT NULL,
            valor     REAL NOT NULL,
            timestamp TEXT NOT NULL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS alertas (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            nodo      TEXT NOT NULL,
            nivel     INTEGER NOT NULL,
            mensaje   TEXT,
            timestamp TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()
    print("[DB] Base de datos lista:", DB_PATH)

def guardar_lectura(nodo, variable, valor):
    try:
        v = float(valor)
        if math.isnan(v):
            return
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "INSERT INTO lecturas (nodo, variable, valor, timestamp) VALUES (?, ?, ?, ?)",
            (nodo, variable, v, datetime.datetime.now().isoformat())
        )
        conn.commit()
        conn.close()
    except ValueError:
        pass
    except Exception as e:
        print(f"[DB ERROR] {e}")

def guardar_alerta(nodo, nivel, mensaje):
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "INSERT INTO alertas (nodo, nivel, mensaje, timestamp) VALUES (?, ?, ?, ?)",
            (nodo, nivel, mensaje, datetime.datetime.now().isoformat())
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR alerta] {e}")

#  TELEGRAM

def enviar_telegram(mensaje):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    try:
        requests.post(url, json={"chat_id": TELEGRAM_CHAT, "text": mensaje}, timeout=5)
        print(f"[TELEGRAM] Enviado: {mensaje}")
    except Exception as e:
        print(f"[TELEGRAM ERROR] {e}")

# Anti-spam: una alerta por nodo cada 5 minutos
ultima_alerta = {}
ultimo_nivel  = {}

def evaluar_y_alertar(nodo, mqtt_client):
    nivel = clasificar_nivel(nodo)
    ahora = datetime.datetime.now()

    nivel_anterior = ultimo_nivel.get(nodo, NIVEL_SECO)

    nombres = {1: "SECO", 2: "LLOVIZNA", 3: "AGUACERO"}
    datos   = estado_nodos.get(nodo, {})
    print(f"[CLASIFICACIÓN] {nodo} → {nombres[nivel]}"
          f"  FC37={datos.get('lluvia_raw','?')}"
          f"  Suelo={datos.get('humedad_suelo','?')}")

    # Solo publicar nivel si cambió — evita flood de mensajes al dashboard
    if nivel != nivel_anterior:
        ultimo_nivel[nodo] = nivel
        mqtt_client.publish(f"rainAlert/{nodo}/nivel", str(nivel))

    # Alertar si es aguacero y:
    ultima    = ultima_alerta.get(nodo)
    tiempo_ok = ultima is None or (ahora - ultima).total_seconds() > 300
    subio     = nivel == NIVEL_AGUACERO and nivel_anterior < NIVEL_AGUACERO

    if nivel == NIVEL_AGUACERO and (tiempo_ok or subio):
        msg = (f"AGUACERO en {nodo.upper()} ({ahora.strftime('%H:%M:%S')})\n"
               f"FC-37: {datos.get('lluvia_raw','?')} | "
               f"Suelo: {datos.get('humedad_suelo','?')}\n"
               f"¡Recoge la ropa!")
        enviar_telegram(msg)
        guardar_alerta(nodo, nivel, msg)
        ultima_alerta[nodo] = ahora
        print(f"[ALERTA] {msg}")

#  PREDICCIÓN POR PRESIÓN
historial_presion = {}

def evaluar_prediccion(nodo, presion):
    if math.isnan(presion) or presion < 0:
        return
    if nodo not in historial_presion:
        historial_presion[nodo] = []
    historial_presion[nodo].append((datetime.datetime.now(), presion))
    corte = datetime.datetime.now() - datetime.timedelta(minutes=10)
    historial_presion[nodo] = [(t, p) for t, p in historial_presion[nodo] if t > corte]
    if len(historial_presion[nodo]) >= 2:
        primera = historial_presion[nodo][0][1]
        ultima  = historial_presion[nodo][-1][1]
        caida   = primera - ultima
        if caida > 2.0:
            print(f"[PREDICCIÓN] {nodo}: presión cayó {caida:.2f} hPa → lluvia próxima")

#  CALLBACKS MQTT
mqtt_client_global = None

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"[MQTT] Conectado al broker {BROKER_IP}:{BROKER_PORT}")
        client.subscribe("rainAlert/#")
        print("[MQTT] Suscrito a rainAlert/#")
    else:
        print(f"[MQTT ERROR] rc={rc}")

def on_message(client, userdata, msg):
    topic = msg.topic
    valor = msg.payload.decode("utf-8")
    partes = topic.split("/")
    if len(partes) < 3:
        return

    nodo     = partes[1]
    variable = partes[2]

    # Ignorar el nivel publicado por este mismo backend para evitar loop
    if variable == "nivel" and msg.topic.startswith("rainAlert/"):
        # Solo ignorar si lo publicó el backend (no viene del ESP32)
        # El ESP32 no publica "nivel", solo el backend lo hace
        return

    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {topic} → {valor}")

    guardar_lectura(nodo, variable, valor)
    actualizar_estado(nodo, variable, valor)

    # Reclasificar cada vez que llega un sensor clave
    if variable in ("lluvia_raw", "humedad_suelo"):
        evaluar_y_alertar(nodo, client)

    if variable == "presion":
        try:
            evaluar_prediccion(nodo, float(valor))
        except ValueError:
            pass

def on_disconnect(*args, **kwargs):
    rc = args[2] if len(args) > 2 else args[1] if len(args) > 1 else 0
    print(f"[MQTT] Desconectado (rc={rc}).")

#  MAIN
def main():
    print("=" * 50)
    print("  RainAlert IoT — Backend Python")
    print("=" * 50)

    iniciar_db()

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="RainAlert-Backend")
    client.on_connect    = on_connect
    client.on_message    = on_message
    client.on_disconnect = on_disconnect

    print(f"[MQTT] Conectando a {BROKER_IP}:{BROKER_PORT}...")
    client.connect(BROKER_IP, BROKER_PORT, keepalive=60)

    enviar_telegram("RainAlert Backend iniciado")

    print("[OK] Backend corriendo. Ctrl+C para detener.\n")
    try:
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n[OK] Backend detenido.")
        client.disconnect()

if __name__ == "__main__":
    main()