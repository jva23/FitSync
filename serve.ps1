# Tiny static file server for running FitSync locally — this repo has no
# build step, but ES modules need to be served over http:// (file:// blocks
# them), so `python -m http.server` or equivalent is required. This script
# exists because this machine doesn't have a working python/node install.
param(
    [int]$Port = 8080,
    [string]$Root = $PSScriptRoot
)

Add-Type -AssemblyName System.Net.HttpListener -ErrorAction SilentlyContinue

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $Root on http://localhost:$Port/  (Ctrl+C to stop)"

$mime = @{
    ".html" = "text/html"; ".js" = "application/javascript"; ".css" = "text/css";
    ".json" = "application/json"; ".webmanifest" = "application/manifest+json";
    ".png" = "image/png"; ".svg" = "image/svg+xml"; ".ico" = "image/x-icon";
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    try {
        $path = $req.Url.LocalPath
        if ($path -eq "/") { $path = "/index.html" }
        $filePath = Join-Path $Root ($path.TrimStart("/"))
        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath)
            $ct = $mime[$ext]
            if (-not $ct) { $ct = "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentType = $ct
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not found: $path")
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    } catch {
        $res.StatusCode = 500
    } finally {
        $res.OutputStream.Close()
    }
}
