@echo off
echo Iniciando servidores...

cd /d "C:\Users\Patrick\OneDrive\Documentos\Agenda PWA"

echo Iniciando Servidor Node...
start "Servidor Node" node server.js

echo Iniciando HTTP Server...
start "HTTP Server" call http-server -p 8080

echo Comandos de inicio enviados.
exit