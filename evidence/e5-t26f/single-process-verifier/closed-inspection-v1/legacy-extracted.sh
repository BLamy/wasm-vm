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

# Fixed kernel proc text only. A suffix prevents command substitution from
# discarding trailing newlines; never treat partial output from failed cat as data.
e5_capture() {
    e5_end=':e5t26f-capture-end:'
    e5_text=$(
        exec 3>&-
        /bin/cat "$1" || exit 1
        printf '%s' ':e5t26f-capture-end:'
    ) || { e5_text=; return 1; }
    case $e5_text in *"$e5_end") ;; *) e5_text=; return 1;; esac
    e5_text=${e5_text%"$e5_end"}
    case $e5_text in *"$e5_end"*) e5_text=; return 1;; esac
    [ "${#e5_text}" -le "$2" ] || { e5_text=; return 1; }
}

# Consume newline-terminated records and whitespace-separated words in RAM.
# No read builtin, pipeline, eval, unquoted expansion, or pathname tokenization.
e5_next_line() {
    e5_nl='
'
    case $e5_text in
        *"$e5_nl"*) e5_line=${e5_text%%"$e5_nl"*}; e5_text=${e5_text#*"$e5_nl"};;
        *) return 1;;
    esac
}

e5_next_word() {
    while :; do
        case $e5_words in ' '*|'	'*) e5_words=${e5_words#?};; *) break;; esac
    done
    [ -n "$e5_words" ] || return 1
    e5_word=${e5_words%%[ 	]*}
    e5_words=${e5_words#"$e5_word"}
}

e5_pair() {
    case $e5_line in *:*) ;; *) return 1;; esac
    e5_words=${e5_line%%:*}
    e5_next_word || return 1
    e5_key=$e5_word
    case $e5_key in *[!a-zA-Z0-9_]*) return 1;; esac
    if e5_next_word; then return 1; fi
    e5_words=${e5_line#*:}
    e5_next_word || return 1
    e5_value=$e5_word
    if e5_next_word; then return 1; fi
}

e5_identity() {
    case ${e5_pid:-} in ''|0|*[!0-9]*) return 1;; esac
    [ "${e5_parent:-}" = "222" ] || return 1
    [ "/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/$e5_pid/exe" -ef /Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/usr/bin/aplay ] || return 1
    e5_capture "/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/$e5_pid/stat" 4096 || return 1
    e5_next_line && [ -z "$e5_text" ] || return 1
    e5_words=$e5_line e5_stat_fields=0
    while e5_next_word; do
        e5_stat_fields=$((e5_stat_fields + 1))
        case $e5_stat_fields in
            1) e5_s_pid=$e5_word;;
            2) e5_s_comm=$e5_word; continue;;
            3) e5_s_state=$e5_word; continue;;
            4) e5_s_ppid=$e5_word;;
            22) e5_s_start=$e5_word;;
        esac
        # Linux 6.6 stat has 52 fields, numeric except comm/state. Exact comm
        # and count refuse embedded spaces or extra tokens shifting field 22.
        e5_number=${e5_word#-}
        case $e5_number in ''|*[!0-9]*) return 1;; esac
    done
    [ "$e5_stat_fields" -eq 52 ] || return 1
    [ "$e5_s_pid" = "$e5_pid" ] && [ "$e5_s_comm" = '(aplay)' ] &&
        [ "$e5_s_state" = S ] && [ "$e5_s_ppid" = "222" ] || return 1
    case $e5_s_start in ''|*[!0-9]*) return 1;; esac
    [ "/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/$e5_pid/exe" -ef /Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/usr/bin/aplay ] || return 1
}

e5_fd_flags() {
    e5_capture "$1" 4096 || return 1
    e5_flags= e5_flags_keys='|'
    while [ -n "$e5_text" ]; do
        e5_next_line && e5_pair || return 1
        case $e5_flags_keys in *"|$e5_key|"*) return 1;; esac
        e5_flags_keys="$e5_flags_keys$e5_key|"
        case $e5_value in ''|*[!0-9]*) return 1;; esac
        if [ "$e5_key" = flags ]; then
            case $e5_value in *[!0-7]*) return 1;; esac
            # Kernel file flags are u32; bound before shell octal arithmetic.
            [ "${#e5_value}" -le 11 ] || return 1
            e5_flags=$e5_value
        fi
    done
    [ -n "$e5_flags" ]
}

e5_observe() {
    e5_reason=identity
    e5_identity || return 1
    e5_identity_start=$e5_s_start
    # wchan legitimately ends at EOF without a newline. Any extra byte refuses.
    e5_capture "/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/$e5_pid/wchan" 128 || return 1
    e5_wchan=$e5_text
    [ "$e5_wchan" = pipe_read ] || { e5_reason=not-pipe-read; return 1; }

    e5_reason=fifo
    [ -p /Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/tmp/e5t26f-resident.fifo ] || return 1
    e5_fifo_count=0 e5_pcm_count=0 e5_fifo_fd= e5_fifo_flags= e5_pcm_fd=
    for e5_fd in /Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/"$e5_pid"/fd/*; do
        if [ "$e5_fd" -ef /Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/tmp/e5t26f-resident.fifo ]; then
            e5_fifo_count=$((e5_fifo_count + 1))
            e5_fifo_fd=${e5_fd##*/}
            e5_fd_flags "/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/$e5_pid/fdinfo/$e5_fifo_fd" || return 1
            e5_fifo_flags=$e5_flags
            case $e5_fifo_flags in ''|*[!0-7]*) return 1;; esac
            [ "$((0$e5_fifo_flags & 3))" -eq 0 ] || return 1
        fi
        if [ "$e5_fd" -ef /Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/dev/snd/pcmC0D0p ]; then
            e5_pcm_count=$((e5_pcm_count + 1))
            e5_pcm_fd=${e5_fd##*/}
        fi
    done
    [ "$e5_fifo_count" -eq 1 ] || return 1
    e5_parent_count=0 e5_parent_flags=
    for e5_fd in /Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/"222"/fd/*; do
        if [ "$e5_fd" -ef /Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/tmp/e5t26f-resident.fifo ]; then
            e5_parent_count=$((e5_parent_count + 1))
            [ "${e5_fd##*/}" = 3 ] || return 1
        fi
    done
    [ "$e5_parent_count" -eq 1 ] || return 1
    e5_fd_flags "/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/222/fdinfo/3" || return 1
    e5_parent_flags=$e5_flags
    case $e5_parent_flags in ''|*[!0-7]*) return 1;; esac
    [ "$((0$e5_parent_flags & 3))" -eq 2 ] || return 1

    e5_reason=pcm
    [ "$e5_pcm_count" -eq 1 ] || return 1
    e5_pcm_state= e5_pcm_owner= e5_hw_ptr= e5_appl_ptr= e5_pcm_fields=0
    e5_capture /Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/asound/card0/pcm0p/sub0/status 4096 || return 1
    e5_pcm_keys='|'
    while [ -n "$e5_text" ]; do
        e5_next_line || return 1
        [ "$e5_line" != '-----' ] || continue
        e5_pair || return 1
        case $e5_pcm_keys in *"|$e5_key|"*) return 1;; esac
        e5_pcm_keys="$e5_pcm_keys$e5_key|"
        case $e5_key in
            state) e5_pcm_state=$e5_value; e5_pcm_fields=$((e5_pcm_fields + 1));;
            owner_pid) e5_pcm_owner=$e5_value; e5_pcm_fields=$((e5_pcm_fields + 1));;
            hw_ptr) e5_hw_ptr=$e5_value; e5_pcm_fields=$((e5_pcm_fields + 1));;
            appl_ptr) e5_appl_ptr=$e5_value; e5_pcm_fields=$((e5_pcm_fields + 1));;
        esac
    done
    [ "$e5_pcm_fields" -eq 4 ] && [ "$e5_pcm_state" = PREPARED ] &&
        [ "$e5_pcm_owner" = "$e5_pid" ] && [ "$e5_hw_ptr" = 0 ] &&
        [ "$e5_appl_ptr" = 0 ] || return 1
    # Supplemental accounting is kernel-config dependent, unlike the mandatory
    # PCM pointers + pipe_read proof above. Preserve its availability as well as
    # values when present; do not require CONFIG_TASK_IO_ACCOUNTING to prepare.
    e5_io=unavailable
    if [ -r "/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/$e5_pid/io" ]; then
        e5_capture "/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/attack-0JMGjB/original-valid-tree/proc/$e5_pid/io" 4096 || return 1
        e5_io= e5_io_keys='|' e5_io_basic=0 e5_io_accounting=0
        while [ -n "$e5_text" ]; do
            e5_next_line && e5_pair || return 1
            case $e5_io_keys in *"|$e5_key|"*) return 1;; esac
            e5_io_keys="$e5_io_keys$e5_key|"
            case $e5_value in ''|*[!0-9]*) return 1;; esac
            case $e5_key in
                rchar|wchar|syscr|syscw) e5_io_basic=$((e5_io_basic + 1));;
                read_bytes|write_bytes|cancelled_write_bytes) e5_io_accounting=$((e5_io_accounting + 1));;
                *) return 1;;
            esac
            e5_io="$e5_io|$e5_line"
        done
        [ -n "$e5_io" ] || return 1
        [ "$e5_io_basic" -eq 4 ] || return 1
        [ "$e5_io_accounting" -eq 0 ] || [ "$e5_io_accounting" -eq 3 ] || return 1
    fi
    # Captures launch short-lived readers. Do not combine metadata from a child
    # that exited, changed executable/parent, or reused this PID while they ran.
    e5_reason=identity
    e5_identity && [ "$e5_s_start" = "$e5_identity_start" ] || return 1
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

