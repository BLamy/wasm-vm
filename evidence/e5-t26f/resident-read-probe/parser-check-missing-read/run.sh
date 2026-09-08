#!/bin/sh
# Native primitive comparison only; never sources the resident identity helper.
set -eu
case ${1:-run} in
run)
    mkdir -p /work/results
    {
        /bin/busybox | head -n 1
        /usr/bin/strace -V
        uname -a
        sha256sum /bin/busybox /usr/bin/strace /work/run.sh
    } > /work/results/versions.txt 2>&1
    for mode in builtin whole; do
        /usr/bin/strace -f -yy -qq -s 16384 -e trace=execve,read \
            -o "/work/results/$mode.strace" /bin/busybox ash /work/run.sh "$mode"
    done
    printf 'native ash read probe completed\n'
    exit 0
    ;;
builtin|whole) mode=$1 ;;
*) exit 2 ;;
esac

# Real, live proc files belonging to THIS native shell, not a fabricated player.
exec 3</dev/null
printf '%s\n' "$$" > "/work/results/$mode.pid"
for kind in stat fdinfo io; do
    case $kind in
        stat) source=/proc/$$/stat ;;
        fdinfo) source=/proc/$$/fdinfo/3 ;;
        io) source=/proc/$$/io ;;
    esac
    [ -r "$source" ]
    if [ "$mode" = whole ]; then
        /bin/busybox cat "$source" > "/work/results/$mode-$kind.data"
    elif [ "$kind" = stat ]; then
        # Same builtin read -r primitive; preserve bytes instead of assigning identity fields.
        IFS= read -r line < "$source"
        printf '%s\n' "$line" > "/work/results/$mode-$kind.data"
    else
        # Source-equivalent to e5_observe's io loop. fdinfo also uses repeated read -r,
        # but here we preserve its whitespace instead of splitting its fields.
        while IFS= read -r line; do printf '%s\n' "$line"; done \
            < "$source" > "/work/results/$mode-$kind.data"
    fi
done
exec 3<&-
