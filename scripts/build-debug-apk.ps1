$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$jdkHome = Join-Path $repoRoot '.jdk17\jdk-17.0.19+10'
$defaultAndroidSdk = 'E:\Android\Sdk'

if (Test-Path -LiteralPath $jdkHome) {
  $env:JAVA_HOME = $jdkHome
} elseif (-not $env:JAVA_HOME) {
  throw 'JDK 17 was not found. Install JDK 17 or set JAVA_HOME before building.'
}

if (-not $env:ANDROID_HOME) {
  if (Test-Path -LiteralPath $defaultAndroidSdk) {
    $env:ANDROID_HOME = $defaultAndroidSdk
  } else {
    throw 'Android SDK was not found. Set ANDROID_HOME before building.'
  }
}

$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:NODE_ENV = 'development'
$env:GRADLE_USER_HOME = Join-Path $repoRoot '.gradle-home'
$env:TEMP = Join-Path $repoRoot '.tmp'
$env:TMP = $env:TEMP
$env:CCACHE_DIR = Join-Path $repoRoot '.ccache'

New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME, $env:TEMP, $env:CCACHE_DIR, (Join-Path $repoRoot 'dist') | Out-Null

$substExe = Join-Path $env:SystemRoot 'System32\subst.exe'
$substDrive = $null
$buildRoot = $repoRoot.Path
$parent = Split-Path -Parent $repoRoot
$projectName = Split-Path -Leaf $repoRoot

foreach ($letter in @('K','L','M','N','O','P','Q','R','S','T','V','W','X','Y','Z')) {
  $candidate = "${letter}:"
  if (-not (Test-Path -LiteralPath "${candidate}\")) {
    & $substExe $candidate $parent
    $substDrive = $candidate
    $buildRoot = Join-Path "${candidate}\" $projectName
    break
  }
}

try {
  Push-Location (Join-Path $buildRoot 'android')
  & .\gradlew.bat assembleDebug --no-daemon --console plain --max-workers 2
  Pop-Location

  $apk = Join-Path $repoRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
  $distApk = Join-Path $repoRoot 'dist\KryptosMobile-debug.apk'
  Copy-Item -LiteralPath $apk -Destination $distApk -Force
  Write-Host "APK generated: $distApk"
} finally {
  if ((Get-Location).Path -ne $repoRoot.Path) {
    Pop-Location -ErrorAction SilentlyContinue
  }
  if ($substDrive) {
    & $substExe $substDrive /D
  }
}
