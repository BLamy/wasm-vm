#!/bin/sh
export PATH=/bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
printf 'past\n' > /state
sync
printf 'BRANCH_READY\n'
while IFS= read -r choice; do
    case "$choice" in
        P|A|B)
            printf '%s\n' "$choice" > /state
            sync
            printf 'BRANCH_FILE_'
            cat /state
            sha256sum /state
            ;;
        *) printf 'Choose P, A, or B\n' ;;
    esac
done
