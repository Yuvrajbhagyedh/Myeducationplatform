@echo off
title LearnHub
start "" http://localhost:4321
node "%~dp0server.js"
pause
