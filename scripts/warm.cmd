@echo off
REM Keeps the deployed site's first click fast.
REM
REM Two things go cold and compound: the Netlify function unloads after a quiet spell, and Neon's free plan
REM suspends its compute after about five minutes idle. Measured in production, a first request paying both
REM took 5.1 seconds against 0.4-1.0 for every one after it. A request every four minutes keeps both awake.
REM
REM It must hit /api/health, not the home page: the passcode gate redirects anything else to /login before the
REM page runs, so pinging the site normally would warm precisely nothing.
REM
REM The address comes from %LOCALAPPDATA%\RegulationTracker\site.url, deliberately not from the repository.
REM services/pipeline/.env holds SITE_URL for local development -- it points at localhost, so reading it here
REM would warm the dev server and never touch production, which is exactly the bug this replaced. Keeping the
REM deployed address in a local file also keeps it out of a repository that may one day be published.
REM
REM Costs nothing: Netlify's free tier allows 125,000 function invocations a month and this uses about 11,000,
REM only while this machine is awake.

setlocal
set "LOGDIR=%LOCALAPPDATA%\RegulationTracker"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\warm.log"
set "SITEFILE=%LOGDIR%\site.url"

if not exist "%SITEFILE%" (
  echo %DATE% %TIME% no %SITEFILE% - nothing to warm >> "%LOG%"
  exit /b 0
)
set /p SITE=<"%SITEFILE%"
if "%SITE%"=="" exit /b 0

REM Keep the log bounded; this runs every four minutes.
for %%F in ("%LOG%") do if %%~zF GTR 1000000 del "%LOG%"

REM tokens=* or the default space delimiter keeps only the status code and throws the timing away -- which is
REM the number that shows whether warming is working at all.
for /f "tokens=*" %%R in ('curl -s -o nul -w "%%{http_code} in %%{time_total}s" -m 30 "%SITE%/api/health"') do set "RESULT=%%R"
echo %DATE% %TIME%  %RESULT% >> "%LOG%"
exit /b 0
