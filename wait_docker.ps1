Write-Host 'Waiting for Docker daemon...'
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    $result = & docker info 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'Docker is ready'
        exit 0
    }
}
Write-Host 'Docker not ready after 2 minutes'
exit 1
