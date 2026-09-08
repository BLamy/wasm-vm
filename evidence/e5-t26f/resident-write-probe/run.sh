#!/bin/sh
# Native syscall precheck only. Run in the owned offline Alpine container;
# /work is disposable. This never sources or edits the real resident helper.
set -eu
if [ "${1:-run}" = run ]; then
    mkdir -p /work/results
    {
        /bin/busybox | head -n 1
        /usr/bin/strace -V
        uname -a
        sha256sum /bin/busybox /usr/bin/strace /work/run.sh
    } > /work/results/versions.txt 2>&1
    for name in escaped-file escaped-fifo decoded-fifo; do
        /usr/bin/strace -f -yy -qq -s 80 -e trace=execve,write,writev \
            -o "/work/results/$name.strace" /bin/busybox ash /work/run.sh "$name"
    done
    exit 0
fi

name=$1
case $name in escaped-file|escaped-fifo|decoded-fifo) ;; *) exit 2;; esac
# Identical expression and timed printf to the actual frozen resident helper.
e5_pcm=$(yes '\001\000\377\177' | head -n 960 | tr -d '\n')
[ "${#e5_pcm}" -eq 15360 ]
if [ "$name" = decoded-fifo ]; then
    # Prospective fixture alternative only: replace the NUL sample byte with 1
    # so decoded PCM can live in an ash variable. Do ALL decoding before feed.
    escaped=$(yes '\001\001\377\177' | head -n 960 | tr -d '\n')
    e5_pcm=$(printf '%b' "$escaped")
    [ "${#e5_pcm}" -eq 3840 ]
fi
if [ "$name" = escaped-file ]; then
    exec 3>"/work/results/$name.pcm"
else
    [ ! -p "/work/results/$name.fifo" ] || unlink "/work/results/$name.fifo"
    mkfifo "/work/results/$name.fifo"
    exec 3<>"/work/results/$name.fifo"
    (exec 3>&-; exec /bin/busybox cat "/work/results/$name.fifo" \
        >"/work/results/$name.pcm") &
    reader=$!
    # Match the real prepared-reader boundary: do not close the parent before
    # the child has opened the FIFO (otherwise its initial open can block).
    ready=0 attempts=0
    while [ "$attempts" -lt 100 ]; do
        reader_wait=
        IFS= read -r reader_wait < "/proc/$reader/wchan" || :
        if [ "$reader_wait" = pipe_read ]; then ready=1; break; fi
        attempts=$((attempts + 1))
        sleep 0.01
    done
    [ "$ready" -eq 1 ]
fi
if [ "$name" = decoded-fifo ]; then
    printf '%s' "$e5_pcm" >&3
else
    printf '%b' "$e5_pcm" >&3
fi
exec 3>&-
if [ "$name" != escaped-file ]; then wait "$reader"; fi
