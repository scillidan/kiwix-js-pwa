#!/bin/bash
# Script to upload Linux packages to download.kiwix.org
target="/data/download/release/kiwix-js-electron"
if [[ ${INPUT_TARGET} = "nightly" ]]; then
    CRON_LAUNCHED="1"
fi
if [[ "qq${CRON_LAUNCHED}" != "qq" ]]; then
    echo "This script was launched by the GitHub Cron proces"
    CURRENT_DATE=$(date +'%Y-%m-%d')
    target="/data/download/nightly/$CURRENT_DATE"
fi
echo "Uploading packages to https://download.kiwix.org$target/"
ssh -o StrictHostKeyChecking=no -i ./scripts/ssh_key ci@download.kiwix.org mkdir -p $target
for file in ./bld/Electron/* ; do
    if [[ "$file" =~ \.(AppImage|deb|rpm)$ ]]; then
        directory=$(sed -E 's/[^\/]+$//' <<<"$file")
        filename=$(sed -E 's/^.+([^\/]+)$/\1/' <<<"$file")
        filename=$(sed 's/\s/-/g' <<<"$filename")
        filename=$(sed 's/_/-/g' <<<"$filename")
        # Convert to all lowercase
        filename="${filename,,}"
        renamed_file="$directory$filename"
        if [[ "$file" != "$renamed_file" ]]; then
            mv "$file" "$renamed_file"
        fi
        scp -o StrictHostKeyChecking=no -i ./scripts/ssh_key "$renamed_file" ci@download.kiwix.org:$target
        echo "Copied $renamed_file to $target"
    fi
done