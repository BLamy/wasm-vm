/* Read-only resident-player observation. No runtime configuration or guest control.
 * The shell still owns preparation, arming, feed, wait, and success markers. */
#define _POSIX_C_SOURCE 200809L
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

enum { TEXT_LIMIT = 4096, FD_LIMIT = 4096, FLAGS_SIZE = 12 };
typedef struct { const char *p; size_t n; } Span;
typedef struct { char bytes[TEXT_LIMIT + 2]; size_t n; } Text;
typedef struct { uint64_t start; dev_t dev; ino_t ino; } Identity;
typedef struct {
    unsigned fifo_count, pcm_count, fifo_fd, pcm_fd;
    char flags[FLAGS_SIZE];
} Fds;
typedef struct {
    unsigned pid, fifo_fd, pcm_fd;
    uint64_t start;
    char fifo_flags[FLAGS_SIZE], parent_flags[FLAGS_SIZE], io[TEXT_LIMIT + 1];
} Observation;

static bool equal(Span s, const char *literal) {
    return s.n == strlen(literal) && memcmp(s.p, literal, s.n) == 0;
}

static bool text_valid(const Text *text) {
    if (text->n > TEXT_LIMIT) return false;
    for (size_t i = 0; i < text->n; ++i) {
        unsigned char c = (unsigned char)text->bytes[i];
        if (c != '\n' && c != '\t' && (c < 32 || c > 126)) return false;
    }
    return true;
}

/* Request at most limit+1 bytes, including the overflow witness. No strlen on
 * untrusted input: embedded NUL, non-text bytes and read errors all refuse. */
static bool read_text(const char *path, Text *text) {
    text->n = 0;
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return false;
    bool ok = false;
    while (text->n <= TEXT_LIMIT) {
        ssize_t n = read(fd, text->bytes + text->n, TEXT_LIMIT + 1 - text->n);
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }
        if (n == 0) { ok = text_valid(text); break; }
        text->n += (size_t)n;
    }
    if (close(fd) != 0) ok = false;
    text->bytes[text->n] = '\0';
    return ok;
}

static bool integer(Span s, unsigned base, uint64_t max, uint64_t *value) {
    if (s.n == 0) return false;
    uint64_t n = 0;
    for (size_t i = 0; i < s.n; ++i) {
        unsigned digit = (unsigned char)s.p[i] - (unsigned)'0';
        if (digit >= base || digit > max || n > (max - digit) / base) return false;
        n = n * base + digit;
    }
    *value = n;
    return true;
}

static bool word(Span *input, Span *out) {
    while (input->n && (*input->p == ' ' || *input->p == '\t')) { ++input->p; --input->n; }
    if (!input->n) return false;
    size_t n = 0;
    while (n < input->n && input->p[n] != ' ' && input->p[n] != '\t') ++n;
    *out = (Span){ input->p, n };
    input->p += n; input->n -= n;
    return true;
}

static bool line(Span *input, Span *out) {
    const char *end = memchr(input->p, '\n', input->n);
    if (!end) return false;
    size_t n = (size_t)(end - input->p);
    *out = (Span){ input->p, n };
    input->p += n + 1; input->n -= n + 1;
    return true;
}

static bool pair(Span input, Span *key, Span *value) {
    const char *colon = memchr(input.p, ':', input.n);
    if (!colon) return false;
    Span left = { input.p, (size_t)(colon - input.p) };
    Span right = { colon + 1, input.n - left.n - 1 }, extra;
    if (!word(&left, key) || word(&left, &extra) || !word(&right, value) || word(&right, &extra)) return false;
    for (size_t i = 0; i < key->n; ++i) {
        char c = key->p[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '_')) return false;
    }
    return true;
}

/* Every key:value\n record occupies at least four input bytes. Keep bounded
 * slices into that input, including keys whose values are informational. */
static bool remember_key(Span key, Span keys[TEXT_LIMIT / 4], size_t *count) {
    for (size_t i = 0; i < *count; ++i)
        if (keys[i].n == key.n && memcmp(keys[i].p, key.p, key.n) == 0) return false;
    if (*count == TEXT_LIMIT / 4) return false;
    keys[(*count)++] = key;
    return true;
}

static bool parse_stat(const Text *text, unsigned pid, unsigned parent, uint64_t *start) {
    if (!text_valid(text)) return false;
    Span rest = { text->bytes, text->n }, row, token;
    if (!line(&rest, &row) || rest.n) return false;
    unsigned count = 0;
    while (word(&row, &token)) {
        if (++count > 52) return false;
        if (count == 2) { if (!equal(token, "(aplay)")) return false; continue; }
        if (count == 3) { if (!equal(token, "S")) return false; continue; }
        uint64_t n;
        if (count == 1 || count == 4 || count == 22) {
            if (!integer(token, 10, count == 22 ? UINT64_MAX : INT_MAX, &n)) return false;
            if ((count == 1 && n != pid) || (count == 4 && n != parent)) return false;
            if (count == 22) *start = n;
        } else {
            bool negative = token.p[0] == '-';
            if (negative) { ++token.p; --token.n; }
            if (!integer(token, 10, negative ? (uint64_t)INT64_MAX + 1 : UINT64_MAX, &n)) return false;
        }
    }
    return count == 52;
}

static bool parse_wchan(const Text *text) {
    return text_valid(text) && equal((Span){text->bytes, text->n}, "pipe_read");
}

static bool parse_flags(const Text *text, unsigned access_mode, char flags[FLAGS_SIZE]) {
    if (!text_valid(text)) return false;
    Span rest = {text->bytes, text->n}, row, key, value;
    Span keys[TEXT_LIMIT / 4];
    size_t key_count = 0;
    unsigned seen = 0;
    while (rest.n) {
        if (!line(&rest, &row) || !pair(row, &key, &value)) return false;
        if (!remember_key(key, keys, &key_count)) return false;
        uint64_t n;
        if (equal(key, "flags")) {
            if (++seen != 1 || value.n >= FLAGS_SIZE || !integer(value, 8, UINT32_MAX, &n) || (n & 3) != access_mode) return false;
            memcpy(flags, value.p, value.n); flags[value.n] = '\0';
        } else if (!integer(value, 10, UINT64_MAX, &n)) return false;
    }
    return seen == 1;
}

static bool parse_pcm(const Text *text, unsigned pid) {
    if (!text_valid(text)) return false;
    Span rest = {text->bytes, text->n}, row, key, value;
    Span keys[TEXT_LIMIT / 4];
    size_t key_count = 0;
    unsigned seen = 0;
    while (rest.n) {
        if (!line(&rest, &row)) return false;
        if (equal(row, "-----")) continue;
        if (!pair(row, &key, &value)) return false;
        if (!remember_key(key, keys, &key_count)) return false;
        unsigned bit = equal(key, "state") ? 1 : equal(key, "owner_pid") ? 2 : equal(key, "hw_ptr") ? 4 : equal(key, "appl_ptr") ? 8 : 0;
        if (!bit) continue; /* Non-proof timestamps/availability remain informational. */
        if (seen & bit) return false;
        seen |= bit;
        if (bit == 1) { if (!equal(value, "PREPARED")) return false; }
        else {
            uint64_t n;
            if (!integer(value, 10, UINT64_MAX, &n)) return false;
            if (bit == 2 ? n != pid : !equal(value, "0")) return false;
        }
    }
    return seen == 15;
}

static bool parse_io(const Text *text, char output[TEXT_LIMIT + 1]) {
    static const char *const keys[] = {"rchar", "wchar", "syscr", "syscw", "read_bytes", "write_bytes", "cancelled_write_bytes"};
    if (!text_valid(text)) return false;
    Span rest = {text->bytes, text->n}, row, key, value;
    unsigned seen = 0;
    size_t used = 0;
    while (rest.n) {
        if (!line(&rest, &row) || !pair(row, &key, &value)) return false;
        unsigned bit = 0;
        for (unsigned i = 0; i < 7; ++i) if (equal(key, keys[i])) bit = 1u << i;
        uint64_t n;
        if (!bit || (seen & bit) || !integer(value, 10, UINT64_MAX, &n)) return false;
        seen |= bit;
        if (row.n + 1 > TEXT_LIMIT - used) return false;
        output[used++] = '|'; memcpy(output + used, row.p, row.n); used += row.n;
    }
    output[used] = '\0';
    return seen == 15 || seen == 127;
}

static bool same_inode(const struct stat *a, const struct stat *b) {
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino;
}

static bool proc_path(char path[128], unsigned pid, const char *suffix) {
    int n = snprintf(path, 128, "/proc/%u/%s", pid, suffix);
    return n > 0 && n < 128;
}

static bool identity(unsigned pid, unsigned parent, Identity *out) {
    char path[128];
    struct stat expected, before, after;
    Text text;
    if (stat("/usr/bin/aplay", &expected) != 0 || !proc_path(path, pid, "exe") || stat(path, &before) != 0 || !same_inode(&expected, &before)) return false;
    if (!proc_path(path, pid, "stat") || !read_text(path, &text) || !parse_stat(&text, pid, parent, &out->start)) return false;
    if (!proc_path(path, pid, "exe") || stat(path, &after) != 0 || !same_inode(&before, &after)) return false;
    out->dev = before.st_dev; out->ino = before.st_ino;
    return true;
}

static bool scan_fds(unsigned pid, const struct stat *fifo, const struct stat *pcm, unsigned mode, Fds *out) {
    char path[128], suffix[64];
    if (!proc_path(path, pid, "fd")) return false;
    DIR *dir = opendir(path);
    if (!dir) return false;
    memset(out, 0, sizeof(*out));
    bool ok = true;
    unsigned entries = 0;
    for (;;) {
        errno = 0;
        struct dirent *entry = readdir(dir);
        if (!entry) { if (errno) ok = false; break; }
        if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
        uint64_t fd;
        if (++entries > FD_LIMIT || !integer((Span){entry->d_name, strlen(entry->d_name)}, 10, INT_MAX, &fd)) { ok = false; break; }
        struct stat actual;
        snprintf(suffix, sizeof(suffix), "fd/%u", (unsigned)fd);
        if (!proc_path(path, pid, suffix) || stat(path, &actual) != 0) { ok = false; break; }
        if (same_inode(&actual, fifo)) {
            if (++out->fifo_count > 1) { ok = false; break; }
            out->fifo_fd = (unsigned)fd;
            Text text;
            snprintf(suffix, sizeof(suffix), "fdinfo/%u", (unsigned)fd);
            if (!proc_path(path, pid, suffix) || !read_text(path, &text) || !parse_flags(&text, mode, out->flags)) { ok = false; break; }
        }
        if (pcm && same_inode(&actual, pcm)) { ++out->pcm_count; out->pcm_fd = (unsigned)fd; }
    }
    if (closedir(dir) != 0) ok = false;
    return ok;
}

/* Guard refusals: identity=10, FIFO=20, PCM/accounting=30. Nothing emitted. */
static int observe(unsigned pid, unsigned parent, Observation *out) {
    Identity first, last;
    char path[128];
    Text text;
    if (getppid() != (pid_t)parent || !identity(pid, parent, &first)) return 10;
    if (!proc_path(path, pid, "wchan") || !read_text(path, &text) || !parse_wchan(&text)) return 10;
    struct stat fifo, pcm;
    if (stat("/tmp/e5t26f-resident.fifo", &fifo) != 0 || !S_ISFIFO(fifo.st_mode)) return 20;
    bool pcm_exists = stat("/dev/snd/pcmC0D0p", &pcm) == 0;
    Fds child, shell;
    if (!scan_fds(pid, &fifo, pcm_exists ? &pcm : NULL, 0, &child) || child.fifo_count != 1) return 20;
    if (!scan_fds(parent, &fifo, NULL, 2, &shell) || shell.fifo_count != 1 || shell.fifo_fd != 3) return 20;
    if (child.pcm_count != 1) return 30;
    if (!read_text("/proc/asound/card0/pcm0p/sub0/status", &text) || !parse_pcm(&text, pid)) return 30;
    if (!proc_path(path, pid, "io")) return 30;
    if (access(path, R_OK) != 0) strcpy(out->io, "unavailable");
    else if (!read_text(path, &text) || !parse_io(&text, out->io)) return 30;
    if (getppid() != (pid_t)parent || !identity(pid, parent, &last) ||
        first.start != last.start || first.dev != last.dev || first.ino != last.ino) return 10;
    out->pid = pid; out->start = first.start;
    out->fifo_fd = child.fifo_fd; out->pcm_fd = child.pcm_fd;
    strcpy(out->fifo_flags, child.flags); strcpy(out->parent_flags, shell.flags);
    return 0;
}

static bool emit(const Observation *out) {
    char line_buffer[TEXT_LIMIT + 160];
    int n = snprintf(line_buffer, sizeof(line_buffer), "e5-observe-v1/%u/%" PRIu64 "/%u/%s/%u/%s/%s\n",
        out->pid, out->start, out->fifo_fd, out->fifo_flags, out->pcm_fd, out->parent_flags, out->io);
    if (n < 0 || (size_t)n >= sizeof(line_buffer)) return false;
    size_t used = 0;
    while (used < (size_t)n) {
        ssize_t wrote = write(STDOUT_FILENO, line_buffer + used, (size_t)n - used);
        if (wrote < 0 && errno == EINTR) continue;
        if (wrote <= 0) return false;
        used += (size_t)wrote;
    }
    return true;
}

static int observer_main(int argc, char **argv) {
    /* Close the inherited FIFO writer before parsing arguments or opening files. */
    (void)close(3);
    uint64_t pid, parent;
    if (argc != 3 || strlen(argv[1]) > 10 || strlen(argv[2]) > 10 ||
        !integer((Span){argv[1], strlen(argv[1])}, 10, INT_MAX, &pid) || !pid ||
        !integer((Span){argv[2], strlen(argv[2])}, 10, INT_MAX, &parent) || !parent) return 64;
    Observation observation;
    int result = observe((unsigned)pid, (unsigned)parent, &observation);
    if (result) return result;
    return emit(&observation) ? 0 : 74; /* Output I/O error, not a guard success. */
}

#ifndef E5_OBSERVER_TEST
int main(int argc, char **argv) { return observer_main(argc, argv); }
#endif
