#!/bin/sh
# Separate single-process observer fixture. Source in the physical terminal.
# Arming/feed/wait and three print calls below are unchanged from the held helper.
# The static observer owns only bounded read-only /proc/device identity checks.

e5_fail() {
    if [ "${e5_writer_open:-0}" = 1 ]; then
        exec 3>&-
        e5_writer_open=0
    fi
    e5_armed=0
    printf '\033[41me5t26f-resident-failed:%s\033[0m\n' "$1"
    return 1
}

# Split a bounded, versioned result in memory; never eval it or launch a parser.
e5_observer_field() {
    case $e5_rest in */*) ;; *) return 1;; esac
    e5_field=${e5_rest%%/*}
    e5_rest=${e5_rest#*/}
    case $e5_field in ''|*[!0-9]*) return 1;; esac
}

e5_observe() {
    e5_reason=identity
    e5_seen= e5_record=
    case ${e5_pid:-} in ''|0|*[!0-9]*) return 1;; esac
    [ "${e5_parent:-}" = "$$" ] || return 1
    # Explicit exec preserves the physical shell as parent. The observer closes
    # only its inherited FD3 before reading; this shell keeps its writer open.
    if e5_record=$(exec /usr/libexec/wasm-vm/e5t26f-observe "$e5_pid" "$e5_parent"); then
        :
    else
        e5_exit=$?
        e5_record=
        case $e5_exit in 20) e5_reason=fifo;; 30) e5_reason=pcm;; esac
        return 1
    fi
    [ "${#e5_record}" -le 4352 ] || return 1
    case $e5_record in e5-observe-v1/*) ;; *) return 1;; esac
    e5_seen=${e5_record#e5-observe-v1/}
    e5_rest=$e5_seen
    e5_observer_field && [ "$e5_field" = "$e5_pid" ] || return 1
    e5_observer_field || return 1
    e5_s_start=$e5_field
    e5_observer_field || return 1
    e5_fifo_fd=$e5_field
    e5_observer_field || return 1
    e5_fifo_flags=$e5_field
    e5_observer_field || return 1
    e5_pcm_fd=$e5_field
    e5_observer_field || return 1
    e5_parent_flags=$e5_field
    case $e5_fifo_flags$e5_parent_flags in *[!0-7]*) return 1;; esac
    [ "${#e5_fifo_flags}" -le 11 ] && [ "${#e5_parent_flags}" -le 11 ] || return 1
    [ "$((0$e5_fifo_flags & 3))" -eq 0 ] && [ "$((0$e5_parent_flags & 3))" -eq 2 ] || return 1
    case $e5_rest in unavailable|'|'*) ;; *) return 1;; esac
    # The C parser validates accounting keys/values and emits no slash/newline.
    case $e5_rest in *'/'*|*'
'*) return 1;; esac
    e5_io=$e5_rest
    e5_wchan=pipe_read e5_pcm_owner=$e5_pid e5_pcm_state=PREPARED
    e5_hw_ptr=0 e5_appl_ptr=0
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
    # Payload construction is before the checkpoint. Escapes avoid shell NUL loss.
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
