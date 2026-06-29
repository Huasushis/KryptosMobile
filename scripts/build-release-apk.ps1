$ErrorActionPreference = 'Stop'

function New-HexSecret {
  param([int]$ByteCount = 32)
  $bytes = New-Object byte[] $ByteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

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
$env:NODE_ENV = 'production'
$env:GRADLE_USER_HOME = Join-Path $repoRoot '.gradle-home'
$env:TEMP = Join-Path $repoRoot '.tmp'
$env:TMP = $env:TEMP
$env:CCACHE_DIR = Join-Path $repoRoot '.ccache'

$distDir = Join-Path $repoRoot 'dist'
$keystoreFile = Join-Path $repoRoot 'android\app\kryptos-release.keystore'
$keystorePropertiesFile = Join-Path $repoRoot 'android\keystore.properties'
$keyAlias = 'kryptos-release'

New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME, $env:TEMP, $env:CCACHE_DIR, $distDir | Out-Null

if (-not (Test-Path -LiteralPath $keystoreFile) -or -not (Test-Path -LiteralPath $keystorePropertiesFile)) {
  $storePassword = New-HexSecret
  $keyPassword = $storePassword
  $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'

  & $keytool -genkeypair -v `
    -storetype PKCS12 `
    -keystore $keystoreFile `
    -alias $keyAlias `
    -keyalg RSA `
    -keysize 4096 `
    -validity 10000 `
    -storepass $storePassword `
    -keypass $keyPassword `
    -dname 'CN=Kryptos Mobile, OU=Local Release, O=Huasushis, L=Local, ST=Local, C=CN' `
    -noprompt

  @(
    'releaseStoreFile=kryptos-release.keystore'
    "releaseStorePassword=$storePassword"
    "releaseKeyAlias=$keyAlias"
    "releaseKeyPassword=$keyPassword"
  ) | Set-Content -LiteralPath $keystorePropertiesFile -Encoding ASCII
}

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
  & .\gradlew.bat assembleRelease --no-daemon --console plain --max-workers 2
  Pop-Location

  $apk = Join-Path $repoRoot 'android\app\build\outputs\apk\release\app-release.apk'
  $distApk = Join-Path $repoRoot 'dist\KryptosMobile-release.apk'
  Copy-Item -LiteralPath $apk -Destination $distApk -Force
  Write-Host "Release APK generated: $distApk"
  Write-Host "Release keystore: $keystoreFile"
} finally {
  if ((Get-Location).Path -ne $repoRoot.Path) {
    Pop-Location -ErrorAction SilentlyContinue
  }
  if ($substDrive) {
    & $substExe $substDrive /D
  }
}
