# This script is intended to be run by Create-DraftRelease, and must be dot-sourced (run with `. ./Build-Electron.ps1`)
# because it modifies variables needed in Create-DraftRelease
$base_dir = "$PSScriptRoot/../bld/electron/"
$comp_electron_archive = $base_dir + "Kiwix.JS.$text_tag.$base_tag.zip"
# Package installer electron app for Windows
"`nChecking for installer package for Windows..."
$alt_tag = $text_tag -ireplace 'Windows', 'PWA'
$WinInstaller = $base_dir + "Kiwix JS $alt_tag Setup $numeric_tag-E.exe"
if ($alt_tag -imatch 'WikiMed|Wikivoyage') {
  $WinInstaller = $base_dir + "$alt_tag by Kiwix Setup $numeric_tag-E.exe"
}
if (-Not (Test-Path $WinInstaller -PathType Leaf)) {
  "No package found: building $WinInstaller..."
  if (-Not $dryrun) {
    npm run dist-win
    if (Test-Path $WinInstaller -PathType Leaf) {
      "Successfully built."
    } else {
      "Oh no! The Windows installer build failed!"
    }
  }
} else {
  "Package found."
}
if (-Not ($old_windows_support -or (Test-Path $comp_electron_archive -PathType Leaf))) {
  # Package portable electron app for Windows
  "Building portable Electron app for Windows"
  # Line below uses electron-packager, but not necessary if we run the setup version first above
  # if (-Not $dryrun) { npm run package-win }
  "Compressing release package for Electron..."
  $unpacked_folder = $base_dir + "win-ia32-unpacked"
  $foldername = "kiwix-js-windows-win32-ia32"
  $compressed_assets_dir = $base_dir + $foldername
  # Find the executable filename in the folder
  $executable = (ls "$unpacked_folder/*.exe") -replace '^.*[/\\]([^/\\]+)$', '$1' 
  "Processing executable: $executable"
  # Rename the compressed assets folder
  if (-Not $dryrun) { 
    if (Test-Path $compressed_assets_dir -PathType Container) {
      rm -r $compressed_assets_dir
    }
    # PowerShell bug: you have to make the directory before you can cleanly copy another folder's contents into it!
    mkdir $compressed_assets_dir
    cp -r "$unpacked_folder\*" $compressed_assets_dir
  }
  $comp_electron_archive = $base_dir + "Kiwix.JS.$text_tag.$base_tag.zip"
  "Creating launchers..."
  $launcherStub = "$base_dir\Start Kiwix JS $text_tag"
  # Batch file
  $batch = '@cd "' + $foldername + '"' + "`r`n" + '@start "Kiwix JS ' + $text_tag + '" "' + $executable + '"' + "`r`n"
  if (-Not $dryrun) {
    $batch > "$launcherStub.bat"
    # Shortcut
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut("$launcherStub.lnk")
    $Shortcut.TargetPath = '%windir%\explorer.exe'
    $Shortcut.Arguments = "$foldername\$executable"
    $Shortcut.IconLocation = '%windir%\explorer.exe,12'
    $Shortcut.Save()
  } else {
    "Would have written batch file:"
    "$batch"
  }
  $AddAppPackage = $base_dir + "Start*$text_tag.*"
  "Compressing: $AddAppPackage, $compressed_assets_dir to $comp_electron_archive"
  if (-Not $dryrun) { "$AddAppPackage", "$compressed_assets_dir" | Compress-Archive -DestinationPath $comp_electron_archive -Force }
}
# Package Electron app for Linux
"`nChecking for Electron packages for Linux..."
$LinuxBasePackage = $base_dir + "Kiwix JS $alt_tag-$numeric_tag-E"
if ($alt_tag -imatch 'Wikivoyage|WikiMed') {
  $LinuxBasePackage = $base_dir + "$alt_tag by Kiwix-$numeric_tag-E"
}
$DebBasePackage = $base_dir + $package_name + "_$numeric_tag-E"
$AppImageArchives = @("$LinuxBasePackage.AppImage", ($LinuxBasePackage + "-i386.AppImage"),
  ("$DebBasePackage" + "_i386.deb"), ("$DebBasePackage" + "_amd64.deb"))
"Processing $AppImageArchives"
foreach ($AppImageArchive in $AppImageArchives) {
  if (-Not (Test-Path $AppImageArchive -PathType Leaf)) {
    "No packages found: building $AppImageArchive..."
    if (-Not $dryrun) {
      # To get docker to start, you might need to run below commands as admin
      # net stop com.docker.service
      # taskkill /IM "Docker Desktop.exe" /F
      # net start com.docker.service
      # runas /noprofile /user:Administrator "net stop com.docker.service; taskkill /IM 'Docker Desktop.exe' /F; net start com.docker.service"
      $repo_dir = ($PSScriptRoot -replace '[\\/]scripts[\\/]*$', '')
      "Using docker command:"
      "docker run -v $repo_dir\:/project -w /project electronuserland/builder npm run dist-linux"
      docker run -v $repo_dir\:/project -w /project electronuserland/builder npm run dist-linux
      # Alternatively build with wsl
      # wsl . ~/.bashrc; npm run dist-linux
      # docker $build_command
    }
  } else {
    "Linux Electron package $AppImageArchive is available"
  }
}
if ($old_windows_support) {
  "`nSupport for XP and Vista was requested."
  "Searching for archives..."
  $nwjs_base = $PSScriptRoot -ireplace 'kiwix-js-windows.scripts.*$', 'kiwix-js-windows-nwjs'
  "NWJS base directory: " + $nwjs_base
  $nwjs_archives_path = "$nwjs_base/bld/nwjs/kiwix_js_windows*$numeric_tag" + "N-win-ia32.zip"
  "NWJS archives path: " + $nwjs_archives_path
  $nwjs_archives = dir $nwjs_archives_path
  if (-Not ($nwjs_archives.count -eq 2)) {
    "`nBuilding portable 32bit NWJS archives to add to Electron release for XP and Vista..."
    "Updating Build-NWJS script with required tags..."
    $nw_json = Get-Content -Raw "$nwjs_base/package.json"
    $script_body = Get-Content -Raw ("$nwjs_base/scripts/Build-NWJS.ps1")
    $json_nwVersion = ''
    if ($nw_json -match '"build":\s*\{[^"]*"nwVersion":\s*"([^"]+)') {
      $json_nwVersion = $matches[1]
    }
    if ($json_nwVersion) {
      "Updating Build-NWJS with NWJS version from package.json: $json_nwVersion"
      $script_body = $script_body -ireplace '(\$version10\s*=\s*")[^"]+', "`${1}$json_nwVersion" 
    }
    $script_body = $script_body -ireplace '(appBuild\s*=\s*")[^"]+', ("`${1}$numeric_tag" + "N")
    $script_body = $script_body -replace '\s+$', "`n"
    if ($dryrun) {
      "[DRYRUN] would have written:`n"
      $script_body
    } else {
      Set-Content "$nwjs_base/scripts/Build-NWJS.ps1" $script_body
    }
    if (-Not $dryrun) {
      "Building..."
      & $nwjs_base/scripts/Build-NWJS.ps1 -only32bit
    } else {
      "Build command: $nwjs_base/scripts/Build-NWJS.ps1 -only32bit"
    }
    "Verifying build..."
    $nwjs_archives = dir $nwjs_archives_path
    if ($nwjs_archives.count -eq 2) {
      "NWJS packages were correclty built."
      $found = $true
    } else {
      "Oh no! The NWJS package build failed."
    }
  } else {
    "NWJS packages found."
    $found = $true
  }
}