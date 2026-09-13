# Start the ORBITAL frontend dev server (Vite, port 5173).
$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\app"
npm run dev
