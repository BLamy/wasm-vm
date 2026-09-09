#!/bin/sh
# Source in the physical terminal shell. No environment switches or mock paths:
# e5_prepare runs before save; physically type play only after restore + gesture.
# An empty FIFO + pipe_read + PREPARED/zero pointers establishes no queued PCM.
# The browser separately proves fresh non-silent PCM and the original 2000-ms cap.

e5_fail() {
    if [ "${e5_writer_open:-0}" = 1 ]; then
        exec 3>&-
        e5_writer_open=0
    fi
    e5_armed=0
    printf '\033[41me5t26f-resident-failed:%s\033[0m\n' "$1"
    return 1
}

e5_observe() {
    e5_reason=identity
    case ${e5_pid:-} in ''|0|*[!0-9]*) return 1;; esac
    [ "${e5_parent:-}" = "$$" ] || return 1
    [ "/proc/$e5_pid/exe" -ef /usr/bin/aplay ] || return 1
    # Require the exact comm of the executable we launched, so field 22 cannot
    # be shifted by spaces/parentheses in a foreign comm. read/set are builtins.
    IFS=' ' read -r e5_s_pid e5_s_comm e5_s_state e5_s_ppid \
        e5_s_pgrp e5_s_session e5_s_tty e5_s_tpgid e5_s_flags \
        e5_s_minflt e5_s_cminflt e5_s_majflt e5_s_cmajflt e5_s_utime \
        e5_s_stime e5_s_cutime e5_s_cstime e5_s_priority e5_s_nice \
        e5_s_threads e5_s_itreal e5_s_start e5_s_rest \
        < "/proc/$e5_pid/stat" || return 1
    [ "$e5_s_pid" = "$e5_pid" ] && [ "$e5_s_comm" = '(aplay)' ] &&
        [ "$e5_s_state" = S ] && [ "$e5_s_ppid" = "$$" ] || return 1
    case $e5_s_start in ''|*[!0-9]*) return 1;; esac
    # proc wchan has no trailing newline: read's EOF status is not its value.
    e5_wchan=
    IFS= read -r e5_wchan < "/proc/$e5_pid/wchan"
    [ "$e5_wchan" = pipe_read ] || { e5_reason=not-pipe-read; return 1; }

    e5_reason=fifo
    [ -p /tmp/e5t26f-resident.fifo ] || return 1
    e5_fifo_count=0 e5_pcm_count=0 e5_fifo_fd= e5_fifo_flags= e5_pcm_fd=
    for e5_fd in /proc/"$e5_pid"/fd/*; do
        if [ "$e5_fd" -ef /tmp/e5t26f-resident.fifo ]; then
            e5_fifo_count=$((e5_fifo_count + 1))
            e5_fifo_fd=${e5_fd##*/}
            e5_fifo_flags=
            while IFS=' 	' read -r e5_key e5_value e5_extra; do
                [ "$e5_key" != flags: ] || e5_fifo_flags=$e5_value
            done < "/proc/$e5_pid/fdinfo/$e5_fifo_fd" || return 1
            case $e5_fifo_flags in ''|*[!0-7]*) return 1;; esac
            [ "$((0$e5_fifo_flags & 3))" -eq 0 ] || return 1
        fi
        if [ "$e5_fd" -ef /dev/snd/pcmC0D0p ]; then
            e5_pcm_count=$((e5_pcm_count + 1))
            e5_pcm_fd=${e5_fd##*/}
        fi
    done
    [ "$e5_fifo_count" -eq 1 ] || return 1
    e5_parent_count=0 e5_parent_flags=
    for e5_fd in /proc/"$$"/fd/*; do
        if [ "$e5_fd" -ef /tmp/e5t26f-resident.fifo ]; then
            e5_parent_count=$((e5_parent_count + 1))
            [ "${e5_fd##*/}" = 3 ] || return 1
        fi
    done
    [ "$e5_parent_count" -eq 1 ] || return 1
    while IFS=' 	' read -r e5_key e5_value e5_extra; do
        [ "$e5_key" != flags: ] || e5_parent_flags=$e5_value
    done < "/proc/$$/fdinfo/3" || return 1
    case $e5_parent_flags in ''|*[!0-7]*) return 1;; esac
    [ "$((0$e5_parent_flags & 3))" -eq 2 ] || return 1

    e5_reason=pcm
    [ "$e5_pcm_count" -eq 1 ] || return 1
    e5_pcm_state= e5_pcm_owner= e5_hw_ptr= e5_appl_ptr= e5_pcm_fields=0
    while IFS=' :	' read -r e5_key e5_value e5_extra; do
        case $e5_key in
            state) e5_pcm_state=$e5_value; e5_pcm_fields=$((e5_pcm_fields + 1));;
            owner_pid) e5_pcm_owner=$e5_value; e5_pcm_fields=$((e5_pcm_fields + 1));;
            hw_ptr) e5_hw_ptr=$e5_value; e5_pcm_fields=$((e5_pcm_fields + 1));;
            appl_ptr) e5_appl_ptr=$e5_value; e5_pcm_fields=$((e5_pcm_fields + 1));;
        esac
    done < /proc/asound/card0/pcm0p/sub0/status || return 1
    [ "$e5_pcm_fields" -eq 4 ] && [ "$e5_pcm_state" = PREPARED ] &&
        [ "$e5_pcm_owner" = "$e5_pid" ] && [ "$e5_hw_ptr" = 0 ] &&
        [ "$e5_appl_ptr" = 0 ] || return 1
    # Supplemental accounting is kernel-config dependent, unlike the mandatory
    # PCM pointers + pipe_read proof above. Preserve its availability as well as
    # values when present; do not require CONFIG_TASK_IO_ACCOUNTING to prepare.
    e5_io=unavailable
    if [ -r "/proc/$e5_pid/io" ]; then
        e5_io=
        while IFS= read -r e5_line; do e5_io="$e5_io|$e5_line"; done \
            < "/proc/$e5_pid/io" || return 1
        [ -n "$e5_io" ] || return 1
    fi
    e5_seen="$e5_pid/$e5_s_start/$e5_fifo_fd/$e5_fifo_flags/$e5_pcm_fd/$e5_parent_flags/$e5_io"
    e5_reason=
}

e5_print_observation() {
    printf 'e5t26f-%s pid=%s start=%s exe=/usr/bin/aplay(inode-match) wchan=%s\n' \
        "$1" "$e5_pid" "$e5_s_start" "$e5_wchan"
    printf 'fifoFD=%s flags=%s readonly=1 parentFD=3 flags=%s child-writers=0\n' \
        "$e5_fifo_fd" "$e5_fifo_flags" "$e5_parent_flags"
    printf 'pcmFD=%s owner=%s state=%s hw_ptr=%s appl_ptr=%s\n' \
        "$e5_pcm_fd" "$e5_pcm_owner" "$e5_pcm_state" "$e5_hw_ptr" "$e5_appl_ptr"
}

e5_prepare() {
    [ "${e5_armed:-0}" != 1 ] || { e5_fail already-prepared; return 1; }
    # Never close/overwrite a descriptor or path owned by the caller.
    [ ! -e /proc/"$$"/fd/3 ] && [ ! -e /tmp/e5t26f-resident.fifo ] || {
        e5_fail occupied; return 1;
    }
    e5_writer_open=0 e5_armed=0 e5_parent=$$
    # All external work is before the checkpoint. Escapes avoid shell NUL loss.
    # 960 repetitions * four decoded bytes = 3840 finite S16 stereo PCM bytes.
    e5_pcm=$(yes '\001\000\377\177' | head -n 960 | tr -d '\n')
    [ "${#e5_pcm}" -eq 15360 ] || { e5_fail payload; return 1; }
    mkfifo /tmp/e5t26f-resident.fifo || { e5_fail mkfifo; return 1; }
    exec 3<>/tmp/e5t26f-resident.fifo
    e5_writer_open=1
    (exec 3>&-; exec /usr/bin/aplay -Dhw:0,0 --period-size=480 --buffer-size=960 \
        -f S16_LE -t raw -r48000 -c2 /tmp/e5t26f-resident.fifo) &
    e5_pid=$!
    e5_attempt=0
    while [ "$e5_attempt" -lt 100 ]; do
        if e5_observe; then
            e5_first=$e5_seen
            e5_print_observation pre-1
            sleep 0.05
            if e5_observe && [ "$e5_seen" = "$e5_first" ]; then
                e5_expected_pid=$e5_pid e5_expected=$e5_seen e5_armed=1
                e5_print_observation pre-2
                printf '\033[42me5t26f-prepared\033[0m\n'
                return 0
            fi
        fi
        e5_attempt=$((e5_attempt + 1))
        sleep 0.05
    done
    e5_fail "prepare-timeout:${e5_reason:-changed}"
}

e5_play() {
    [ "${e5_armed:-0}" = 1 ] && [ "$e5_pid" = "$e5_expected_pid" ] || {
        e5_fail unarmed-or-pid; return 1;
    }
    e5_observe && [ "$e5_seen" = "$e5_expected" ] || {
        e5_fail "post-identity:${e5_reason:-changed}"; return 1;
    }
    e5_print_observation post
    e5_armed=0
    # Catch a broken FIFO reader without letting SIGPIPE skip the red failure.
    trap ':' PIPE
    if printf '%b' "$e5_pcm" >&3; then
        trap - PIPE
    else
        trap - PIPE
        e5_fail feed; return 1
    fi
    exec 3>&-
    e5_writer_open=0
    if wait "$e5_pid"; then
        printf '\033[42me5t26f-aplay\033[0m\n'
    else
        e5_fail child-exit; return 1
    fi
}

# Four plain letters avoid shifted-key input in the post-restore command.
play() { e5_play; }
