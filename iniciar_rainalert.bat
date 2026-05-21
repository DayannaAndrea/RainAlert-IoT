@echo off
title RainAlert IoT

echo Iniciando Mosquitto...
start "Mosquitto" "C:\Program Files\mosquitto\mosquitto.exe" -c "C:\Program Files\mosquitto\mosquitto.conf" -v

timeout /t 2 /nobreak >nul

echo Iniciando Backend Python...
start "Backend" python Backend/app.py

timeout /t 2 /nobreak >nul

echo Abriendo Dashboard...
start brave "file:///C:/Users/dagar/OneDrive/Desktop/RainAlert_Dashboard/Frontend/index.html"

echo.
echo Todo listo. Cierra esta ventana cuando quieras detener.
pause