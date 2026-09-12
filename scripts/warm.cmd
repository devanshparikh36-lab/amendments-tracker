@echo off
REM Keeps the deployed site's first click fast.
REM
REM Two things go cold and compound: the Netlify function unloads after a quiet spell, and Neon's free plan
REM suspends its compute after about five minutes idle. Measured in production, a first click paying both was
REM 5.4 seconds against 0.4-1.0 for every click after it. A request every four minutes keeps both awake.
REM
REM It must hit /api/health, not the home page: the passcode gate redirects anything else to /login before the
REM page runs, so pinging the site normally would warm precisely nothing.
REM
REM Costs nothing. Netlify's free tier allows 125,000 function invocations a month; this uses about 11,000,
REM and only while this machine is awake.

setlocal
for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0..\services\pipeline\.env") do (
  if /i "%%A"=="SITE_URL" set "SITE=%%B"
)
if "%SITE%"=="" (
  echo SITE_URL is not set in services\pipeline\.env - nothing to warm
  exit /b 0
)

set "LOGDIR=%LOCALAPPDATA%\RegulationTracker"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\warm.log"
for %%F in ("%LOG%") do if %%~zF GTR 1000000 del "%LOG%"

for /f %%R in ('curl -s -o nul -w "%%{http_code} %%{time_total}" -m 30 "%SITE%/api/health"') do set "RESULT=%%R"
echo %DATE% %TIME% %SITE%/api/health -^> %RESULT% >> "%LOG%"
exit /b 0
