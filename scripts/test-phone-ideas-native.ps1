# Runs the real Android JSON and media checks offline. Never selects a physical phone.
param([string]$Serial = $env:NOTEBOOK_TEST_EMULATOR)
$ErrorActionPreference = 'Stop'
if ($Serial -notmatch '^emulator-\d+$') { throw 'Set NOTEBOOK_TEST_EMULATOR to an explicit PC emulator.' }
$sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$jbr = 'C:/Program Files/Android/Android Studio/jbr/bin'
$androidJar = Join-Path $sdk 'platforms/android-37.0/android.jar'
$adb = Join-Path $sdk 'platform-tools/adb.exe'
$root = Split-Path $PSScriptRoot -Parent
$run = Join-Path ([IO.Path]::GetTempPath()) ('notebook-ideas-check-' + [guid]::NewGuid().ToString('N'))
$classes = New-Item -ItemType Directory -Path (Join-Path $run 'classes')
$zip = Join-Path $run 'checks.zip'
$remote = '/data/local/tmp/' + (Split-Path $run -Leaf) + '.zip'
& "$jbr/javac.exe" -source 17 -target 17 -cp $androidJar -d $classes.FullName `
    (Join-Path $root 'phone/app/src/main/java/com/mani/notebook/PhoneIdeasNet.java') `
    (Join-Path $root 'phone/app/src/test/java/com/mani/notebook/PhoneIdeasNetTest.java')
if ($LASTEXITCODE) { throw 'Native check compilation failed.' }
$classFiles = @(Get-ChildItem -LiteralPath $classes.FullName -Recurse -Filter '*.class' | ForEach-Object FullName)
& "$jbr/java.exe" -cp (Join-Path $sdk 'build-tools/36.0.0/lib/d8.jar') com.android.tools.r8.D8 --lib $androidJar --output $zip @classFiles
if ($LASTEXITCODE) { throw 'Android test packaging failed.' }
& $adb -s $Serial push $zip $remote
if ($LASTEXITCODE) { throw 'Could not copy checks to the emulator.' }
try {
    & $adb -s $Serial shell "CLASSPATH=$remote app_process / com.mani.notebook.PhoneIdeasNetTest"
    if ($LASTEXITCODE) { throw 'Native Ideas checks failed.' }
} finally {
    & $adb -s $Serial shell rm $remote
}
