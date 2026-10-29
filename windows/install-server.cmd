@echo off
rem Windows: start the Planner server now and at every login, at http://localhost:47823/
rem   Double-click this file, or in a Command Prompt:
rem     windows\install-server.cmd                       data in %USERPROFILE%\PlannerData (or wherever it was set before)
rem     windows\install-server.cmd "D:\Dropbox\Planner"   data in that folder
rem     windows\install-server.cmd /uninstall             stop it and stop starting it at login
rem   Run it again any time: after moving the app's folder, reinstalling Python, or updating serve_planner.py.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-server.ps1" %*
echo.
pause
