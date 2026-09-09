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
    [ "${e5_parent:-}" = "222" ] || return 1
    # Explicit exec preserves the physical shell as parent. The observer closes
    # only its inherited FD3 before reading; this shell keeps its writer open.
    if e5_record=$(/bin/cat '/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/closed-inspection-v1/actual-c-record.txt'); then
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

