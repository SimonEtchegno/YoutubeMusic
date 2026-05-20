@echo off
title SonicTube - YouTube Audio Downloader
echo ====================================================
echo             INICIANDO SONICTUBE
echo ====================================================
echo.
echo Iniciando Servidor Backend...
start "SonicTube Backend" /min cmd /c "npm run start --prefix backend"
echo.
echo Iniciando Servidor Frontend...
start "SonicTube Frontend" /min cmd /c "npm run dev --prefix frontend"
echo.
echo Esperando a que los servidores inicien...
timeout /t 4 /nobreak >nul
echo.
echo Abriendo SonicTube en el navegador...
start http://localhost:5173
echo.
echo ====================================================
echo   SonicTube se esta ejecutando en segundo plano.
echo   Para cerrar la aplicacion, cierra esta ventana.
echo ====================================================
echo.
pause
