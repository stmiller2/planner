# Windows: start the Planner server now and at every login, at http://localhost:47823/ (run it through
# install-server.cmd, which lets this script run without changing PowerShell's settings).
# At login it runs with pythonw (no window); errors go to server-errors.log in the data folder.
param([string]$Data = '')
$ErrorActionPreference = 'Stop'

$App = Split-Path -Parent $PSScriptRoot
$Server = Join-Path $App 'serve_planner.py'
$Link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Planner server.lnk'

# stop a Planner server that's already running (an older copy, or one started from a terminal)
function Stop-Planner {
  Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" |
    Where-Object { $_.CommandLine -like '*serve_planner.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Data -in @('/uninstall', '-uninstall', '--uninstall')) {
  Stop-Planner
  if (Test-Path $Link) { Remove-Item $Link }
  Write-Host 'Planner server stopped; it no longer starts at login. Your data folder was not touched.'
  exit 0
}

# Python 3.7 or newer: the "py" launcher first, then "python" (the Microsoft Store stub doesn't count)
$Code = "import sys; print(sys.executable if sys.version_info >= (3, 7) else '')"
$Py = $null
foreach ($try in @({ py -3 -c $Code }, { python -c $Code }, { python3 -c $Code })) {
  try {
    $out = & $try 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { $Py = ([string]$out).Trim(); break }
  } catch { }
}
if (-not $Py) {
  Write-Host 'Needs Python 3.7 or newer. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then run this again.'
  exit 1
}
$Pyw = Join-Path (Split-Path $Py) 'pythonw.exe'
if (-not (Test-Path $Pyw)) { $Pyw = $Py }

if ($Data) {
  New-Item -ItemType Directory -Force -Path $Data | Out-Null
  & $Py $Server --set-data $Data
}

Stop-Planner

# a shortcut in the Startup folder starts it at every login
$Shell = New-Object -ComObject WScript.Shell
$Lnk = $Shell.CreateShortcut($Link)
$Lnk.TargetPath = $Pyw
$Lnk.Arguments = '"' + $Server + '"'
$Lnk.WorkingDirectory = $App
$Lnk.WindowStyle = 7
$Lnk.Description = 'Planner server (http://localhost:47823/)'
$Lnk.Save()

# and start it now
Start-Process -FilePath $Pyw -ArgumentList ('"' + $Server + '"') -WorkingDirectory $App -WindowStyle Hidden
for ($i = 0; $i -lt 20; $i++) {
  try {
    $info = Invoke-RestMethod -Uri 'http://localhost:47823/api/folder' -TimeoutSec 2
    Write-Host 'Planner server running: http://localhost:47823/'
    Write-Host "  app:  $App"
    Write-Host "  data: $($info.file)"
    exit 0
  } catch { Start-Sleep -Milliseconds 500 }
}
Write-Host 'The server did not answer. To see why, open a Command Prompt in the app folder and run:  python serve_planner.py'
exit 1
