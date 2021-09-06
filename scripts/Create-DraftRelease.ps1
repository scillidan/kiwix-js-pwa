param (
    [string]$tag_name = "",
    [switch]$dryrun = $false,
    [switch]$buildstorerelease = $false,
    [switch]$draftonly = $false,
    [switch]$buildonly = $false,
    [switch]$updatewinget = $false,
    [string]$respondtowingetprompt = "" # Provide an override response (Y/N) to the winget prompt at the end of the script - for automation
)
# DEV: To build Electron packages for all platforms and NWJS for XP and Vista in a single release, use, e.g., "v1.3.0E+N" (Electron + NWJS)
# DEV: To build new icons, use
# electron-icon-builder --input=C:\Users\geoff\Source\Repos\kiwix-js-windows\bld\icon.png --output=./bld/
# then move icons in png into /bld/icons/

# Provide parameters
$release_uri = 'https://api.github.com/repos/kiwix/kiwix-js-windows/releases'
$github_token = Get-Content -Raw "$PSScriptRoot/github_token"

$init_params = Get-Content -Raw "$PSScriptRoot\..\www\js\init.js"
$file_tag = ''
if ($init_params -match 'params\[[''"]version[''"]]\s*=\s*[''"]([^''"]+)') {
  $file_tag = 'v' + $matches[1] 
}

if ($tag_name -eq "") {
  $tag_name = Read-Host "`nEnter the tag name for this release, or Enter to accept suggested tag, or add any suffix to suggested tag [$file_tag]"
  if ($tag_name -match '^[EN-]|^$') {
    $split = $file_tag -imatch '^([v\d.]+)(.*)$'
    if ($split) {
      $tag_name = $matches[1] + $tag_name + $matches[2]
      # Clean up in case there was already a WikiMed or Wikivoyage suffix and we added one
      $tag_name = $tag_name -replace '(\-[^\d.-]+)\-[^\d.]+$', '$1'
    }
    "Tag name set to: $tag_name"
  }
  if (-Not $dryrun) {
    $dryrun_check = Read-Host "Is this a dry run? [Y/N]"
    $dryrun = -Not ( $dryrun_check -imatch 'n' )
    If ($dryrun) {
      "Initiating dry run..."
    }
  }
  if ($draftonly) {
    "Creating a draft release only with no assets attached."
  } elseif (-Not ($buildonly -or $dryrun -or $updatewinget)) {
    $buildonly_check = Read-Host "Do you wish to Build only, or build and Release? [B/R]"
    $buildonly = -Not ( $buildonly_check -imatch 'r' )
    If ($buildonly) {
      "Packages will be built, but not uploaded for release."
    }
  }
}
if ($tag_name -NotMatch '^v\d+\.\d+\.\d+([EN-]|$)') {
  "`nTag name must be in the format " + '"v0.0.0[E][N][-text]"!' + "`n"
  exit
}
if ($updatewinget) {
  "`nUpdating winget repository only..."
} else {
  "`nCreating release for $tag_name..."
}
$base_tag = $tag_name -replace '^v([\d.EN]+).*', '$1'
$text_tag = $tag_name -replace '^v[\d.EN+]+-?(.*)$', '$1'
$numeric_tag = $base_tag -replace "([\d.]+)[EN]", '$1'
$old_windows_support = $tag_name -match '\+N'
if ($text_tag -eq '') { $text_tag = 'Windows' }
$release_title = "Kiwix JS $text_tag $base_tag UWP"
if ($text_tag -eq "Wikivoyage") { $release_title = "Wikivoyage by Kiwix $base_tag UWP" }
$flavour = ''
$file_version = ''
if ($init_params -match 'params\[[''"]fileVersion[''"]]\s*=\s*(?:getSetting\([''"]fileVersion[''"]\)\s*\|\|\s*)?[''"]([^''"]+)') {
  $file_version = $matches[1] 
}
$zim = ''
$date = ''
if ($file_version) { 
  $zim = ($file_version -replace '\s\([^(]+\)\s*$', '')
  $date = $file_version -replace '^[^(]+\(([^(]+)\)\s*$', '$1'
}
"File Version: $file_version"
"Zim: $zim"
"Date: $date"
$branch = "master"
if ($text_tag -ne "Windows") { $branch = "Kiwix-JS-$text_tag" }
if ($base_tag -match '[EN]$') {
  $flavour = '_' + $matches[0]
  $title_flavour = 'Electron'
  if ($flavour -eq '_N') { 
    $title_flavour = 'NWJS'
    $branch = 'nwjs-en-top' 
  }
  if ($tag_name -match 'E\+N') {
    $title_flavour = 'Electron and NWJS'
    $release_title = $release_title -replace 'Windows\s', ''
  }
  $release_title = $release_title -replace '([^\s]+)\sUWP$', ("$title_flavour (Windows/Linux) " + '$1')
  if ($flavour -eq '_N') { $release_title = $release_title -replace 'Edition\s(for\s)', '$1XP/Vista/' } 
}
# Get package name
$json_object = Get-Content -Raw "$PSScriptRoot/../package.json"
$package_name = '' 
if ($json_object -imatch '"name":\s"([\w]+-[^"]+)') {
	$package_name = $matches[1]
}
"Text tag: $text_tag"
"Base tag: $base_tag"
"Numeric tag: $numeric_tag"
"Branch: $branch"
"Release title: $release_title"
"Package name: $package_name"
$release_body = Get-Content -Raw ("$PSScriptRoot/Kiwix_JS_" + $text_tag + $flavour + "_Release_Body.md")
$release_body = $release_body -replace '<<base_tag>>', "$base_tag"
$release_body = $release_body -replace '<<numeric_tag>>', "$numeric_tag"
$release_body = $release_body -replace '<<zim>>', "$zim"
$release_body = $release_body -replace '<<date>>', "$date"
# Set up release_params object - for API see https://docs.github.com/en/rest/reference/repos#releases
$release_body_json = @{
  'tag_name' = "$base_tag"
  'target_commitish' = $branch
  'name' = $release_title
  'draft' = $true
  'body' = $release_body
} | ConvertTo-Json
# Explicitly encode as UTF8 (or else it will fail with UTF8 characters)
$release_body_json = ([System.Text.Encoding]::UTF8.GetBytes($release_body_json))
$release_params = @{
  Uri = $release_uri
  Method = 'POST'
  Headers = @{
    'Authorization' = "token $github_token"
    'Accept' = 'application/vnd.github.v3+json'
  }
  Body = $release_body_json
  ContentType = "application/json"
}

# Post to the release server
if (-Not ($dryrun -or $buildonly -or $updatewinget)) { 
  $release = Invoke-RestMethod @release_params 
} elseif (-Not $updatewinget) {
  "[DRYRUN] Release Body:`n$release_body"
}

# We should have enough information to find the release URL
if ($updatewinget) {
  if ($release_body -match 'https:[^)]+?\.(?:appxbundle|exe)') {
    $package_url = $matches[0]
  } else {
    "`nUnable to find the package URL!"
    return
  }
  "`nThe package URL is: $package_url"
  $package_id = 'Kiwix.' + $text_tag
  if ($text_tag -eq 'Windows') { $package_id = 'Kiwix.' +  'KiwixJS' }
  if ($base_tag -match 'E$') { $package_id = $package_id + '.Electron' }
  $winget_version = $numeric_tag + $flavour
  if ($flavour -eq '') { $winget_version = $winget_version + '.0' }  
  if (-Not $dryrun) {
    "Submitting to winget-pkg repository..."
    & wingetcreate.exe update -i $package_id -v "$winget_version" -u $package_url -s $true -t $github_token
  } else {
    "[DRYRUN:] & wingetcreate.exe update -i $package_id -v $winget_version -u $package_url -s -t $github_token"
  }
  "`nDone."
  return
}

# Check that we appear to have created a release
if ($dryrun -or $buildonly -or $release.assets_url -imatch '^https:') {
  if (-Not $buildonly) { "The draft release details were successfully created." }
  "`nUpdating release version in package.json"
  $json_object = $json_object -replace '("version": ")[^"]+', "`${1}$base_tag"
  $json_object = $json_object -replace '\s*$', "`n"
  if ($dryrun) {
    "[DRYRUN] would have written:`n"
    $json_object
  } else {
    Set-Content "$PSScriptRoot/../package.json" $json_object
  }
  if ($draftonly) {
    "`nDraft only switch was set, so we will not upload assets. Please do so manually."
    "Done."
    return
  }
  "Searching for assets..."
  if ($flavour -eq '_E') {
    $base_dir = "$PSScriptRoot/../bld/electron/"
    $compressed_archive = $base_dir + "Kiwix.JS.$text_tag.$base_tag.zip"
    if (-Not ($old_windows_support -or (Test-Path $compressed_archive -PathType Leaf))) {
      # Package portable electron app for Windows
      "Building portable Electron app for Windows"
      if (-Not $dryrun) { npm run package-win }
      "Compressing release package for Electron..."
      $foldername = "kiwix-js-windows-win32-ia32"
      $compressed_assets_dir = "$PSScriptRoot/../bld/electron/$foldername"
      $base_dir = "$PSScriptRoot/../bld/electron/"
      $compressed_archive = $base_dir + "Kiwix.JS.$text_tag.$base_tag.zip"
      "Creating launchers..."
      $launcherStub = "$base_dir\Start Kiwix JS $text_tag"
      # Batch file
      $batch = '@cd "' + $foldername + '"' + "`r`n" + '@start "Kiwix JS $text_tag" "kiwix-js-windows.exe"' + "`r`n"
      if (-Not $dryrun) {
        $batch > "$launcherStub.bat"
        # Shortcut
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut("$launcherStub.lnk")
        $Shortcut.TargetPath = '%windir%\explorer.exe'
        $Shortcut.Arguments = "$foldername\kiwix-js-windows.exe"
        $Shortcut.IconLocation = '%windir%\explorer.exe,12'
        $Shortcut.Save()
      } else {
        "Would have written batch file:"
        "$batch"
      }
      $AddAppPackage = $base_dir + "Start*$text_tag.*"
      "Compressing: $AddAppPackage, $compressed_assets_dir to $compressed_archive"
      if (-Not $dryrun) { "$AddAppPackage", "$compressed_assets_dir" | Compress-Archive -DestinationPath $compressed_archive -Force }
    }
    # Package installer electron app for Windows
    "`nChecking for installer package for Windows..."
    $alt_tag = $text_tag -ireplace 'Windows', 'PWA'
    $WinInstaller = $base_dir + "Kiwix JS $alt_tag Setup $numeric_tag-E.exe"
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
    # Package Electron app for Linux
    "`nChecking for Electron packages for Linux..."
    $LinuxBasePackage = $base_dir + "Kiwix JS $alt_tag-$numeric_tag-E"
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
    $ReleaseBundle = ''
  } elseif ($flavour -eq '_N') {
    # Package NWJS app if necessary
    $base_dir = "$PSScriptRoot/../bld/nwjs"
    $stubs = @("$base_tag-win-ia32", "$base_tag-win-x64", "XP-$base_tag-win-ia32")
    $found = $true
    $NWJSAssets = @()
    $NWJSAssets = {$NWJSAssets}.Invoke()
    foreach ($stub in $stubs) {
      $NWJSAsset = "$base_dir/kiwix_js_windows-$stub.zip"
      $NWJSAssets.Add($NWJSAsset)
      if (-Not (Test-Path $NWJSAsset -PathType Leaf)) { $found = $false }
      if (-Not $found) { "Unable to locate $NWJSAsset..." }
    }
    if (-Not $found) {
      "One or more NWJS build(s) could not be found."
      "`nBuilding..."
      "Updating Build-NWJS script with required tag..."
      $script_body = Get-Content -Raw ("$PSScriptRoot/Build-NWJS.ps1")
      $script_body = $script_body -ireplace '(appBuild\s*=\s*")[^"]+', "`${1}$base_tag"
      $json_nwVersion = ''
      if ($json_object -match '"build":\s*\{[^"]*"nwVersion":\s*"([^"]+)') {
        $json_nwVersion = $matches[1]
      }
      if ($json_nwVersion) {
        "Updating Build-NWJS with NWJS version from package.json: $json_nwVersion"
        $script_body = $script_body -ireplace '(\$version10\s*=\s*")[^"]+', "`${1}$json_nwVersion" 
      }
      $script_body = $script_body -replace '\s+$', "`n"
      if ($dryrun) {
        "[DRYRUN] would have written:`n"
        $script_body
      } else {
        Set-Content "$PSScriptRoot/Build-NWJS.ps1" $script_body
        "Building NWJS apps..."
        & $PSScriptRoot/Build-NWJS.ps1
        $found = $true
      }
    }
  } else {
    # We need to check for UWP assets - let's see what type the user last built
    $appxmanifest = Get-Content -Raw $PSScriptRoot/../package.appxmanifest
    if (-Not ($appxmanifest -match "Publisher=['`"]CN=Association\sKiwix")) {
      if ($buildstorerelease) {
      "`n** App manifest is correctly associated with the MS Store..."
      } else {
        "`n**WARNING: The app manifest is not correct for building an app for release on GitHub! Please associate the app with 'Association Kiwix' in Visual Studio and try again"
        "or else run this script with the flag -buildstorerelease`n"
        return
      }
    } else {
      "`nBe aware that the version you are building is good for public release on GitHub, but not for upload to the Microsoft Store."
      "To create a valid appxupload, please associate the app with the Store in Visual Studio.`n"
    } 
    # Let's check if we have the assets
    $ReleaseBundle = dir "$PSScriptRoot/../AppPackages/*_$base_tag*_Test/*_$base_tag*.appx*"
    # Check the file exists and it's of the right type
    if ($ReleaseBundle -and ($ReleaseBundle.count -eq 1) -and (Test-Path $ReleaseBundle -PathType leaf) -and 
      ($ReleaseBundle -imatch '\.(?:appx|appxbundle|appxupload)$')) {
      "`nUWP app packages were found."
    } else {
      "`nBuilding UWP app..."
      if (-Not ($appxmanifest -match "Version=['`"]$numeric_tag\.0['`"]")) {
        "The requested release version does not match the version in package.appxmanifest"
        "Updating..."
        $appxmanifest = $appxmanifest -replace "(\sVersion=['`"])\d+\.\d+\.\d+(\.0['`"])", "`${1}$numeric_tag`${2}"
        if (-Not $dryrun) {
          Set-Content $PSScriptRoot/../package.appxmanifest $appxmanifest
        } else {
          "[DRYRUN] Would have written package.appxmanifest:"
          "$appxmanifest"
        }
      }
      if (-Not $dryrun) {
        $projstub = $text_tag
        if ($text_tag -eq "Windows") { $projstub = "" }
        cmd.exe /c " `"C:\Program Files (x86)\Microsoft Visual Studio\2017\Community\Common7\Tools\VsDevCmd.bat`" && msbuild.exe KiwixWebApp$projstub.jsproj -p:Configuration=Release "
      }
    }
    # If we are releasing the MS Store version we have to copy it from a different location
    if ($buildstorerelease) {
      if (-Not ($appxmanifest -match "Publisher=['`"]CN=Association\sKiwix")) {
        "Using Store release becuase buildstorerelease flag was set."
        $UploadBundle = dir "$PSScriptRoot/../bin/Release/Upload/*_$base_tag.0/*_$base_tag*.appx*"
        "$UploadBundle"
        if ($UploadBundle -and ($UploadBundle.count -eq 1) -and (Test-Path $UploadBundle -PathType leaf) -and ($UploadBundle -imatch '\.(?:appx|appxbundle|appxupload)$')) {
          $ReleaseFolder = dir "$PSScriptRoot/../AppPackages/*_$base_tag*_Test"
          if ($ReleaseFolder -and (Test-Path $ReleaseFolder -PathType Container)) {
            "Copying signed archive $UploadBundle to release folder..."
            if (-Not $dryrun) { cp $UploadBundle $ReleaseFolder }
          } else {
            "WARNING: Could not find release folder!"
          }
        } else {
          "WARNING: Could not find the upload bundle, so we will use the test release..."
        }
      } else {
        "WARNING: You requested a release valid for the MS Store, but the app manifest is not associated with the Store! We cannot build a Store release."
        "Please associate the app with the MS Store in Visual Studio, save the manifest, and try again."
        return
      }
      if (-Not $buildonly) {
        "** You can use the appxupload to submit to the Store, but we won't release..."
        $buildonly = $true
        $forced_buildonly = $true
      }
    } else {
      if ($appxmanifest -match "Publisher=['`"]CN=Association\sKiwix") {
        "Using locally signed release."
      } else {
        "**WARNING: The app manifest is not correct for building an app for release on GitHub! Please associate the app with 'Association Kiwix' in Visual Studio and try again."
        return
      }
    }
    $ReleaseBundle = dir "$PSScriptRoot/../AppPackages/*_$base_tag*_Test/*_$base_tag*.appx*"
    # Check the file exists and it's of the right type
    if ($ReleaseBundle -and ($ReleaseBundle.count -eq 1) -and (Test-Path $ReleaseBundle -PathType leaf) -and 
      ($ReleaseBundle -imatch '\.(?:appx|appxbundle|appxupload)$')) {
        "Setting main bundle file to $ReleaseBundle..."
    } elseif ($ReleaseBundle.count -ge 2) {
        "More than one file matches that tag!"
        return
    } elseif (-Not $dryrun) {
        "No package matching that tag was found. Aborting."
        "Tag yielded: $ReleaseBundle " + ($ReleaseBundle -or $false)
        return
    }
    if (-Not $buildstorerelease) {
      "Signing app package for release on GitHub..."
      $pfxpwd = Get-Content -Raw $PSScriptRoot\secret_kiwix.p12.pass
      if (-Not $dryrun) {
        cmd.exe /c " `"C:\Program Files (x86)\Microsoft Visual Studio\2017\Community\Common7\Tools\VsDevCmd.bat`" && SignTool sign /fd SHA256 /a /f `"$PSScriptRoot\..\kiwix2021-5.pfx`" /p $pfxpwd /tr http://timestamp.digicert.com /td SHA256 `"$ReleaseBundle`" "
      } else {
        'cmd.exe /c " "C:\Program Files (x86)\Microsoft Visual Studio\2017\Community\Common7\Tools\VsDevCmd.bat" && SignTool sign /fd SHA256 /a /f ' + $PSScriptRoot + '\..\kiwix2021-5.pfx /p ' + $pfxpwd + ' /tr http://timestamp.digicert.com  /td SHA256 ' + $ReleaseBundle + ' "'
      }
    }
    # ZIP the remaining assets
    "`nCompressing remaining assets..."
    $compressed_assets_dir = $ReleaseBundle -replace '[^/\\]+$', ''
    $compressed_assets_base = $compressed_assets_dir -replace '^.*[\\/]([^\\/]+)[\\/]', '$1'
    $compressed_archive = $compressed_assets_dir + "PowerShell.Installation.Script.$compressed_assets_base.zip"
    $AddAppPackage = $compressed_assets_dir + "Add-AppDevPackage*.*"
    $cert_file = $ReleaseBundle -replace '\.[^.]+$', '.cer'
    "Compressing: $AddAppPackage, $cert_file"
    if (-Not $dryrun) { "$AddAppPackage", "$cert_file" | Compress-Archive -DestinationPath $compressed_archive -Force }
  }
  # Check the compressed file exists
  if ($dryrun -or $found -or (Test-Path $compressed_archive -PathType leaf)) {
    "Compression successful`n"
  } else {
    "There was an error compressing assets."
    return
  }
  if ($forced_buildonly) {
    "`nBecause your app package was not valid for release on GitHub, we have not uploaded it."
    "You will need to delete any draft release that was created and aborted as part of this run."
    "Your appxupload is valid for release on the Microsoft Store."
    "`nDone."
    return
  } elseif ($buildonly) {
    "`nThe buildonly option was set, so no draft release was created."
    "Please upload and release your packages manually, or re-run this script without the buildonly switch."
    "`nDone."
    return
  }
  # Upload the release
  $upload_assets = @($compressed_archive, $ReleaseBundle)
  if ($flavour -eq '_N') { $upload_assets = $NWJSAssets }
  if ($flavour -eq '_E') { 
    if ($old_windows_support) {
      $upload_assets = ($AppImageArchives += $nwjs_archives)  
    } else {
      $upload_assets = ($AppImageArchives += $compressed_archive)
    }
    $upload_assets += $WinInstaller
  }
  $upload_uri = $release.upload_url -ireplace '\{[^{}]+}', '' 
  "Uploading assets to: $upload_uri..."
  
  ForEach($asset in $upload_assets) {
    if (-Not $asset) { Continue }
    $asset_name = $asset -replace '^.*[\\/]([^\\/]+)$', '$1'
    # Establish upload params
    $upload_params = @{
      Uri = $upload_uri + "?name=$asset_name"
      Method = 'POST'
      Headers = @{
        'Authorization' = "token $github_token"
        'Accept' = 'application/vnd.github.everest-preview+json'
      }
      # Body = [System.IO.File]::ReadAllBytes($upload_file)
      InFile = $asset
      ContentType = 'application/octet-stream'
    }
    "`nUploading $asset..."
    # Upload asset to the release server
    # $upload = [System.IO.File]::ReadAllBytes($upload_file) | Invoke-RestMethod @upload_params
    if (-Not $dryrun) { $upload = Invoke-RestMethod @upload_params }
    if ($dryrun -or $upload.name -eq ($asset_name -replace '\s', '.')) {
      if (-Not $dryrun) {
        "Upload successfully posted as " + $upload.url
        "Full details:"
        echo $upload
      } else {
        echo "DRYRUN with these upload parameters:`n" + @upload_params 
      }
    } else {
      "`nI'm sorry, this upload appears to have failed! Please upload manually or try again..."
      if ($upload) {
        "`nThe server returned:"
        echo $upload
      } else {
        "The server did not respond."
      }
    }
  }
  "`nCreating permalink..."
  $permalinkFile = "$PSScriptRoot/../kiwix-js-uwp.html"
  if ($tag_name -imatch 'WikiMed') { $permalinkFile = $permalinkFile -replace 'kiwix-js-uwp', 'wikimed-uwp' }
  if ($tag_name -imatch 'Wikivoyage') { $permalinkFile = $permalinkFile -replace 'kiwix-js-uwp', 'wikivoyage-uwp' }
  if ($flavour -eq '_N') { $permalinkFile = $permalinkFile -replace 'uwp', 'nwjs' }
  if ($flavour -eq '_E') { $permalinkFile = $permalinkFile -replace 'uwp', 'electron' }
  "Looking for: $permalinkFile"
  $permalink = Get-Content -Raw $permalinkFile
  $permalink = $permalink -replace 'v[\d.EN]{5,}', "v$base_tag"
  $permalink = $permalink -replace '\s*$', "`n"
  if (-Not $dryrun) { Set-Content $permalinkFile $permalink }
  else { "`n[DRYRUN] would have written:`n$permalink`n" }
  "Cleaning up..."
  if ((-Not ($dryrun -or $old_windows_support)) -and $compressed_archive ) { del $compressed_archive }
  "`nDone.`n"
  # Now update winget manifest if we are not building NWJS or Electron
  if ($flavour -eq '' -or $flavour -eq '_E') {
    if ($respondtowingetprompt) {
      $wingetcreate_check = $respondtowingetprompt
    } else {
      $wingetcreate_check = Read-Host "Would you like to update the WinGet repository with this new build?`nWARNING: be sure you have published the draft release (if in doubt answer N)! [Y/N]"
    }
    $wingetcreate_check = $wingetcreate_check -imatch 'y'
    if ($wingetcreate_check) {
      "`nUpdating WinGet repository..."
      cd $PSScriptRoot\..
      pwd
      if (-Not $dryrun) { 
        & .\scripts\Create-DraftRelease.ps1 -updatewinget -tag_name $tag_name
      } else {
        "[DRYRUN:] & .\scripts\Create-DraftRelease.ps1 -updatewinget -tag_name $tag_name"
      }
    } else {
      "You can update the WinGet repository manually by running 'Create-DraftRelease -updatewinget'"
    }
  }
} else {
  "There was an error setting up the release!"
  if ($release) {
    "The server returned:"
    echo $release
  } else {
    "The server did not respond or could not process the command correctly."
    "$release_body_json"
  }
}
