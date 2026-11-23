[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [int]$StartupTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$tauriConfig = Get-Content (Join-Path $repoRoot 'desktop\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$expectedVersion = $tauriConfig.version

$installDir = Join-Path $env:LOCALAPPDATA 'RoleSpec'
$installedExe = Join-Path $installDir 'rolespec-desktop.exe'
$uninstaller = Join-Path $installDir 'uninstall.exe'

if (-not $env:RUNNER_TEMP) {
    $env:RUNNER_TEMP = [System.IO.Path]::GetTempPath()
}
$testLocalAppData = Join-Path $env:RUNNER_TEMP 'rolespec-installer-smoke'

function Get-RoleSpecProcesses {
    param([string]$Root)

    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)
    })
}

function Stop-RoleSpecProcesses {
    param(
        $AppProcess,
        [string]$Root
    )

    if ($null -ne $AppProcess) {
        try {
            $AppProcess.Refresh()
        } catch {
            # The process may already be gone.
        }
        if (-not $AppProcess.HasExited) {
            try {
                $null = $AppProcess.CloseMainWindow()
            } catch {
                # A failed close request is followed by the forced fallback below.
            }
            if (-not $AppProcess.WaitForExit(30000)) {
                Stop-Process -Id $AppProcess.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }

    # The shell owns node and PostgreSQL in a kill-on-close job, but a forced
    # close can still leave a child behind. Never leave an installed process
    # holding files when the uninstaller runs.
    $deadline = (Get-Date).AddSeconds(30)
    while ($true) {
        $remaining = @(Get-RoleSpecProcesses -Root $Root)
        if ($remaining.Count -eq 0) {
            return
        }
        foreach ($process in $remaining) {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        }
        if ((Get-Date) -ge $deadline) {
            return
        }
        Start-Sleep -Milliseconds 500
    }
}

function Write-RoleSpecLogs {
    param([string]$DataRoot)

    foreach ($name in @('desktop.log', 'postgres.log')) {
        $path = Join-Path $DataRoot "RoleSpecData\logs\$name"
        if (Test-Path $path) {
            Write-Host "--- $name (tail) ---"
            Get-Content $path -Tail 40
        }
    }
}

$failure = $null
$app = $null
$installed = $false

try {
    Write-Host "Installer: $installer"
    Write-Host "Expected version: $expectedVersion"

    if (Test-Path $installDir) {
        throw "RoleSpec is already installed at $installDir; this test expects a clean runner."
    }
    if (Test-Path $testLocalAppData) {
        Remove-Item $testLocalAppData -Recurse -Force
    }

    $setupVersion = (Get-Item -LiteralPath $installer).VersionInfo.ProductVersion
    if ($setupVersion -ne $expectedVersion) {
        throw "Installer version $setupVersion does not match tauri.conf.json version $expectedVersion."
    }

    $installProcess = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
    if ($installProcess.ExitCode -ne 0) {
        throw "Installer exited with code $($installProcess.ExitCode)."
    }
    $installed = $true

    if (-not (Test-Path $installedExe)) {
        throw "Installed executable not found at $installedExe."
    }
    $installedVersion = (Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion
    if ($installedVersion -ne $expectedVersion) {
        throw "Installed version $installedVersion does not match expected version $expectedVersion."
    }
    Write-Host "Installed executable version: $installedVersion"

    $uninstallEntry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq 'RoleSpec' } |
        Select-Object -First 1
    if (-not $uninstallEntry) {
        throw 'The installer did not create an uninstall entry.'
    }
    if ($uninstallEntry.DisplayVersion -ne $expectedVersion) {
        throw "Uninstall entry version $($uninstallEntry.DisplayVersion) does not match $expectedVersion."
    }
    Write-Host "Uninstall entry version: $($uninstallEntry.DisplayVersion)"

    # The release workflow exports build-only DATABASE_URL/AUTH_SECRET values.
    # A desktop launch must use its managed database, so force that mode for the
    # child and restore the runner environment afterwards.
    New-Item -ItemType Directory -Path $testLocalAppData -Force | Out-Null
    $originalLocalAppData = $env:LOCALAPPDATA
    $originalDatabaseUrl = $env:DATABASE_URL
    $originalManagedDb = $env:ROLESPEC_MANAGED_DB
    try {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
        $env:ROLESPEC_MANAGED_DB = '1'
        $env:LOCALAPPDATA = $testLocalAppData
        $app = Start-Process -FilePath $installedExe -PassThru
    } finally {
        $env:LOCALAPPDATA = $originalLocalAppData
        if ($null -eq $originalDatabaseUrl) {
            Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
        } else {
            $env:DATABASE_URL = $originalDatabaseUrl
        }
        if ($null -eq $originalManagedDb) {
            Remove-Item Env:ROLESPEC_MANAGED_DB -ErrorAction SilentlyContinue
        } else {
            $env:ROLESPEC_MANAGED_DB = $originalManagedDb
        }
    }

    $baseUrl = 'http://127.0.0.1:3100'
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    $health = $null
    while ((Get-Date) -lt $deadline) {
        $app.Refresh()
        if ($app.HasExited) {
            throw "RoleSpec exited before becoming healthy (exit code $($app.ExitCode))."
        }
        try {
            $health = Invoke-WebRequest -Uri "$baseUrl/api/health" -UseBasicParsing -TimeoutSec 5
            if ($health.StatusCode -eq 200) {
                break
            }
        } catch {
            # PostgreSQL and the Next.js server need a few seconds on first run.
        }
        Start-Sleep -Seconds 2
    }
    if ($null -eq $health -or $health.StatusCode -ne 200) {
        throw "RoleSpec did not answer /api/health within $StartupTimeoutSeconds seconds."
    }
    if ($health.Content -notmatch '"status"\s*:\s*"ok"') {
        throw "Unexpected /api/health response: $($health.Content)"
    }
    Write-Host 'Health check: 200 (status ok)'

    $onboarding = Invoke-WebRequest -Uri "$baseUrl/onboarding" -UseBasicParsing -TimeoutSec 20
    if ($onboarding.StatusCode -ne 200) {
        throw "Onboarding returned HTTP $($onboarding.StatusCode)."
    }
    if ($onboarding.Content -notmatch 'Get started') {
        throw 'Onboarding page did not contain the expected start action.'
    }
    Write-Host 'Onboarding check: 200 (start action present)'

    $app.Refresh()
    if ($app.HasExited) {
        throw "RoleSpec exited during the smoke test (exit code $($app.ExitCode))."
    }
} catch {
    $failure = $_
    Write-Host "::error::$($_.Exception.Message)"
    Write-RoleSpecLogs -DataRoot $testLocalAppData
} finally {
    try {
        Stop-RoleSpecProcesses -AppProcess $app -Root $installDir

        if ($installed -and (Test-Path $uninstaller)) {
            $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
            if ($uninstallProcess.ExitCode -ne 0) {
                throw "Uninstaller exited with code $($uninstallProcess.ExitCode)."
            }

            $deadline = (Get-Date).AddSeconds(60)
            while ((Test-Path $installDir) -and ((Get-Date) -lt $deadline)) {
                Start-Sleep -Seconds 1
            }
            if (Test-Path $installDir) {
                throw "The installer directory still exists after uninstall: $installDir"
            }

            $uninstallEntry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
                Where-Object { $_.DisplayName -eq 'RoleSpec' } |
                Select-Object -First 1
            if ($uninstallEntry) {
                throw 'The uninstall entry still exists after uninstall.'
            }

            if (-not (Test-Path (Join-Path $testLocalAppData 'RoleSpecData'))) {
                throw 'Uninstall removed the separate RoleSpecData directory.'
            }
            Write-Host 'Uninstall check: install directory and registry entry removed; data root preserved.'
        }

        if (Test-Path $testLocalAppData) {
            Remove-Item $testLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch {
        if ($null -eq $failure) {
            $failure = $_
        }
        Write-Host "::error::Cleanup failed: $($_.Exception.Message)"
    }
}

if ($null -ne $failure) {
    throw $failure
}

Write-Host 'Installer smoke test passed.'
