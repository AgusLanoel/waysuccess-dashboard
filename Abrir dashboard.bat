@echo off
rem Levanta el dashboard de WaySuccess en esta PC y lo abre en el navegador.
rem Para cerrarlo: cerrar esta ventana (o Ctrl+C).
title Dashboard WaySuccess
cd /d "%~dp0web"
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install
)
echo.
echo Dashboard en http://localhost:5190  (cerrar esta ventana para apagarlo)
echo.
call npx vite --port 5190 --strictPort --open
