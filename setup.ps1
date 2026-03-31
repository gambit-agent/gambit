# PowerShell setup script for Gambit CLI command
Write-Host "Setting up Gambit CLI command..."

# Get the current directory
 = Get-Location

# Create the gambit function
 = @"
function gambit {
    Set-Location ''
    bun run .
}
"@

# Add to PowerShell profile
 = .CurrentUserAllHosts
if (-not (Test-Path )) {
    New-Item -Path  -ItemType File -Force
}

# Check if function already exists
 = Get-Content  -Raw
if ( -notmatch "function gambit") {
    Add-Content  
    Write-Host "Added gambit function to PowerShell profile"
} else {
    Write-Host "gambit function already exists in PowerShell profile"
}

Write-Host "Setup complete! Please restart PowerShell to use the 'gambit' command."
Write-Host "You can now run 'gambit' from anywhere to start the application."
