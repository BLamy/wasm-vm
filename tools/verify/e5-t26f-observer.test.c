/* Actual observer source, controlled filesystem/I/O fixtures. These tests do NOT
 * prove real proc, ALSA hardware, guest restore, or browser performance. */
#define _POSIX_C_SOURCE 200809L
#define _DARWIN_C_SOURCE 1
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static int test_open(const char *, int);
static int test_stat(const char *, struct stat *);
static int test_access(const char *, int);
static DIR *test_opendir(const char *);
static pid_t test_getppid(void);
static ssize_t test_read(int, void *, size_t);
static ssize_t test_write(int, const void *, size_t);
static int test_close(int);
#define E5_OBSERVER_TEST
#define open(p, f) test_open(p, f)
#define stat(p, s) test_stat(p, s)
#define access(p, m) test_access(p, m)
#define opendir(p) test_opendir(p)
#define getppid() test_getppid()
#define read(f, b, n) test_read(f, b, n)
#define write(f, b, n) test_write(f, b, n)
#define close(f) test_close(f)
#include "../guest/e5-t26f-observer.c"
#undef open
#undef stat
#undef access
#undef opendir
#undef getppid
#undef read
#undef write
#undef close

static unsigned checks;
#define CHECK(expr) do { ++checks; if (!(expr)) { fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #expr); exit(1); } } while (0)
static char fixture_root[PATH_MAX];
static char output[TEXT_LIMIT + 200];
static size_t output_size, read_chunk, write_chunk, read_bytes, largest_request;
static unsigned stat_reads, interrupts, write_interrupts, opens;
static bool io_unavailable, io_disappears, read_failure, write_failure, close_failure;
static int tracked_fd = -1, first_closed = -1;
static char first_operation;
static bool transport_mode;
static unsigned transport_parent;
enum Change { NONE, START, PID, PARENT, EXECUTABLE, VANISHED, OWN_PARENT };
static enum Change change;

static void mapped(char out[PATH_MAX], const char *path) {
    CHECK(path[0] == '/');
    int n = snprintf(out, PATH_MAX, "%s%s", fixture_root, path);
    CHECK(n > 0 && n < PATH_MAX);
}

/* Only observation I/O is remapped. Fixture creation keeps its fixed namespace. */
static void observed_path(char out[PATH_MAX], const char *path) {
    if (transport_mode) {
        char prefix[64];
        int n = snprintf(prefix, sizeof(prefix), "/proc/%u/", transport_parent);
        CHECK(n > 0 && (size_t)n < sizeof(prefix));
        if (!strncmp(path, prefix, (size_t)n)) {
            char replacement[PATH_MAX];
            int length = snprintf(replacement, sizeof(replacement), "/proc/222/%s", path + n);
            CHECK(length > 0 && length < PATH_MAX);
            mapped(out, replacement);
            return;
        }
    }
    mapped(out, path);
}

static void put_bytes(const char *name, const char *bytes, size_t n) {
    char path[PATH_MAX]; mapped(path, name);
    FILE *file = fopen(path, "wb"); CHECK(file != NULL);
    CHECK(fwrite(bytes, 1, n, file) == n); CHECK(fclose(file) == 0);
}

static void put(const char *name, const char *bytes) { put_bytes(name, bytes, strlen(bytes)); }

static void stat_record(char out[4096], const char *pid, const char *comm, const char *state,
                        const char *parent, const char *start, unsigned count) {
    size_t used = 0;
    for (unsigned i = 1; i <= count; ++i) {
        const char *s = i == 1 ? pid : i == 2 ? comm : i == 3 ? state : i == 4 ? parent : i == 22 ? start : "0";
        int n = snprintf(out + used, 4096 - used, "%s%s", i == 1 ? "" : " ", s);
        CHECK(n > 0 && (size_t)n < 4096 - used); used += (size_t)n;
    }
    out[used++] = '\n'; out[used] = '\0';
}

static void put_stat(const char *pid, const char *parent, const char *start) {
    char text[4096]; stat_record(text, pid, "(aplay)", "S", parent, start, 52);
    put("/proc/111/stat", text);
}

static void remove_entry(const char *name) {
    char path[PATH_MAX]; mapped(path, name);
    if (unlink(path) != 0) CHECK(errno == ENOENT);
}

static void alias(const char *name, const char *target) {
    char from[PATH_MAX], to[PATH_MAX]; mapped(from, name); mapped(to, target);
    remove_entry(name); CHECK(symlink(to, from) == 0);
}

static const char *const good_pcm = "state: PREPARED\nowner_pid   : 111\nhw_ptr     : 0\nappl_ptr   : 0\n";
static const char *const good_io = "rchar:\t100\nwchar: 89 \nsyscr: 19\nsyscw: 5\n";

static void reset_fixture(void) {
    output_size = read_bytes = largest_request = 0; output[0] = '\0';
    read_chunk = write_chunk = 0; stat_reads = interrupts = write_interrupts = opens = 0;
    io_unavailable = io_disappears = read_failure = write_failure = close_failure = false;
    tracked_fd = first_closed = -1; first_operation = 0; change = NONE;
    put("/usr/bin/aplay", "CONTROLLED executable-inode fixture, not real aplay\n");
    put("/dev/snd/pcmC0D0p", "CONTROLLED device-inode fixture, not PCM hardware\n");
    put("/foreign", "different inode\n");
    alias("/proc/111/exe", "/usr/bin/aplay");
    alias("/proc/111/fd/4", "/tmp/e5t26f-resident.fifo");
    alias("/proc/111/fd/5", "/dev/snd/pcmC0D0p");
    alias("/proc/222/fd/3", "/tmp/e5t26f-resident.fifo");
    remove_entry("/proc/111/fd/6"); remove_entry("/proc/111/fd/7"); remove_entry("/proc/222/fd/7");
    char parent[16];
    snprintf(parent, sizeof(parent), "%u", transport_mode ? transport_parent : 222);
    put_stat("111", parent, "777");
    put("/proc/111/wchan", "pipe_read");
    put("/proc/111/fdinfo/4", "pos:\t0\nflags:\t0100000\nmnt_id: 11\nino: 99\n");
    put("/proc/222/fdinfo/3", "pos: 0\nflags: 0100002\n");
    put("/proc/asound/card0/pcm0p/sub0/status", good_pcm);
    put("/proc/111/io", good_io);
}

static int test_open(const char *name, int flags) {
    if (!first_operation) first_operation = 'o';
    ++opens;
    CHECK(flags == (O_RDONLY | O_CLOEXEC));
    if (!strcmp(name, "/proc/111/stat") && ++stat_reads == 2) {
        if (change == START) put_stat("111", "222", "778");
        if (change == PID) put_stat("112", "222", "777");
        if (change == PARENT) put_stat("111", "223", "777");
        if (change == VANISHED) { errno = ENOENT; return -1; }
    }
    if (io_disappears && !strcmp(name, "/proc/111/io")) { errno = ENOENT; return -1; }
    char path[PATH_MAX]; observed_path(path, name);
    tracked_fd = open(path, flags); return tracked_fd;
}

static int test_stat(const char *name, struct stat *out) {
    if (!first_operation) first_operation = 's';
    char path[PATH_MAX]; observed_path(path, name);
    int result = stat(path, out);
    if (result == 0 && change == EXECUTABLE && stat_reads >= 2 && !strcmp(name, "/proc/111/exe")) ++out->st_ino;
    return result;
}

static int test_access(const char *name, int mode) {
    if (io_unavailable && !strcmp(name, "/proc/111/io")) { errno = EACCES; return -1; }
    char path[PATH_MAX]; observed_path(path, name); return access(path, mode);
}

static DIR *test_opendir(const char *name) {
    char path[PATH_MAX]; observed_path(path, name); return opendir(path);
}

static pid_t test_getppid(void) {
    if (transport_mode) return getppid();
    return change == OWN_PARENT && stat_reads ? 223 : 222;
}

static ssize_t test_read(int fd, void *bytes, size_t count) {
    CHECK(fd == tracked_fd); CHECK(count > 0 && count <= TEXT_LIMIT + 1);
    if (count > largest_request) largest_request = count;
    if (interrupts) { --interrupts; errno = EINTR; return -1; }
    if (read_failure) { errno = EIO; return -1; }
    if (read_chunk && count > read_chunk) count = read_chunk;
    ssize_t n = read(fd, bytes, count);
    if (n > 0) read_bytes += (size_t)n;
    return n;
}

static int test_close(int fd) {
    if (!first_operation) { first_operation = 'c'; first_closed = fd; }
    bool was_read = fd == tracked_fd && fd >= 0;
    int result = close(fd);
    if (was_read) tracked_fd = -1;
    if (was_read && close_failure) { errno = EIO; return -1; }
    return result;
}

static ssize_t test_write(int fd, const void *bytes, size_t count) {
    CHECK(fd == STDOUT_FILENO); CHECK(stat_reads == 2); /* No output before final identity. */
    if (write_interrupts) { --write_interrupts; errno = EINTR; return -1; }
    if (write_failure) { errno = EIO; return -1; }
    if (write_chunk && count > write_chunk) count = write_chunk;
    CHECK(count < sizeof(output) - output_size);
    memcpy(output + output_size, bytes, count); output_size += count; output[output_size] = '\0';
    return (ssize_t)count;
}

static Text text_of(const char *bytes) {
    Text text; text.n = strlen(bytes); CHECK(text.n <= TEXT_LIMIT + 1);
    memcpy(text.bytes, bytes, text.n + 1); return text;
}

static int run(void) {
    char *argv[] = {"e5t26f-observe", "111", "222", NULL};
    int result = observer_main(3, argv);
    CHECK(first_operation == 'c' && first_closed == 3);
    return result;
}

static void refused(int code) { CHECK(run() == code); CHECK(output_size == 0); }

static void parser_tests(void) {
    uint64_t n;
    CHECK(integer((Span){"18446744073709551615", 20}, 10, UINT64_MAX, &n) && n == UINT64_MAX);
    const char *bad[] = {"", "-1", "+1", " 1", "1 ", "0x10", "1;true", "18446744073709551616"};
    for (size_t i = 0; i < sizeof(bad) / sizeof(*bad); ++i) CHECK(!integer((Span){bad[i], strlen(bad[i])}, 10, UINT64_MAX, &n));
    CHECK(!integer((Span){"2147483648", 10}, 10, INT_MAX, &n));
    CHECK(!integer((Span){"40000000000", 11}, 8, UINT32_MAX, &n));
    char bytes[4096];
    stat_record(bytes, "111", "(aplay)", "S", "222", "18446744073709551615", 52);
    Text t = text_of(bytes); CHECK(parse_stat(&t, 111, 222, &n) && n == UINT64_MAX);
    const char *stat_bad[][5] = {
        {"112", "(aplay)", "S", "222", "777"}, {"111", "(a play)", "S", "222", "777"},
        {"111", "(aplay)", "R", "222", "777"}, {"111", "(aplay)", "S", "223", "777"},
        {"111", "(aplay)", "S", "222", "-1"}, {"111", "(aplay)", "S", "222", "18446744073709551616"},
        {"111", "(aplay)", "S", "222", "*"},
    };
    for (size_t i = 0; i < sizeof(stat_bad) / sizeof(*stat_bad); ++i) {
        stat_record(bytes, stat_bad[i][0], stat_bad[i][1], stat_bad[i][2], stat_bad[i][3], stat_bad[i][4], 52);
        t = text_of(bytes); CHECK(!parse_stat(&t, 111, 222, &n));
    }
    for (unsigned fields = 51; fields <= 53; fields += 2) {
        stat_record(bytes, "111", "(aplay)", "S", "222", "777", fields);
        t = text_of(bytes); CHECK(!parse_stat(&t, 111, 222, &n));
    }
    stat_record(bytes, "111", "(aplay)", "S", "222", "777", 52);
    t = text_of(bytes); --t.n; CHECK(!parse_stat(&t, 111, 222, &n));
    t = text_of(bytes); t.bytes[5] = '\0'; CHECK(!parse_stat(&t, 111, 222, &n));
    t = text_of("pipe_read"); CHECK(parse_wchan(&t));
    const char *bad_wchan[] = {"pipe_read\n", "pipe_read\nother", "pipe_rea", "", "wait_woken"};
    for (size_t i = 0; i < sizeof(bad_wchan) / sizeof(*bad_wchan); ++i) { t = text_of(bad_wchan[i]); CHECK(!parse_wchan(&t)); }
    char flags[FLAGS_SIZE];
    t = text_of("pos: 0\nflags:\t0100000 \n"); CHECK(parse_flags(&t, 0, flags)); CHECK(!strcmp(flags, "0100000"));
    CHECK(!parse_flags(&t, 2, flags));
    const char *bad_flags[] = {"", "pos: 0\n", "flags: 0100001\n", "flags: 0100002\n", "flags: 0100008\n",
        "flags: 0100000\nflags: 0100000\n", "flags: 0100000 extra\n", "flags: 0100000", "flags: 40000000000\n", "flags: 000000000000\n"};
    for (size_t i = 0; i < sizeof(bad_flags) / sizeof(*bad_flags); ++i) { t = text_of(bad_flags[i]); CHECK(!parse_flags(&t, 0, flags)); }
    t = text_of("flags: 0100002\n"); CHECK(parse_flags(&t, 2, flags));
    const char *fd_keys[] = {"pos", "mnt_id", "ino", "other_counter"};
    for (size_t i = 0; i < sizeof(fd_keys) / sizeof(*fd_keys); ++i) {
        snprintf(bytes, sizeof(bytes), "flags: 0100000\n%s: 0\n", fd_keys[i]);
        t = text_of(bytes); CHECK(parse_flags(&t, 0, flags));
        snprintf(bytes, sizeof(bytes), "flags: 0100000\n%s: 0\n %s\t: 1\n", fd_keys[i], fd_keys[i]);
        t = text_of(bytes); CHECK(!parse_flags(&t, 0, flags));
    }
    t = text_of(good_pcm); CHECK(parse_pcm(&t, 111)); CHECK(!parse_pcm(&t, 112));
    const char *bad_pcm[] = {
        "state: RUNNING\nowner_pid: 111\nhw_ptr: 0\nappl_ptr: 0\n",
        "state: PREPARED\nowner_pid: 111\nhw_ptr: 1\nappl_ptr: 0\n",
        "state: PREPARED\nowner_pid: 111\nhw_ptr: 0\nappl_ptr: 1\n",
        "state: PREPARED\nowner_pid: 111\nhw_ptr: -0\nappl_ptr: 0\n",
        "state: PREPARED\nowner_pid: 111\nhw_ptr: 0\nappl_ptr: 0\nowner_pid: 111\n",
        "state: PREPARED\nowner_pid: 111\nhw_ptr: 0\nappl_ptr: 0 extra\n",
        "state: PREPARED\nowner_pid: 18446744073709551616\nhw_ptr: 0\nappl_ptr: 0\n",
        "state: PREPARED\nowner_pid: 111\nhw_ptr: 0\n", "state PREPARED\n",
    };
    for (size_t i = 0; i < sizeof(bad_pcm) / sizeof(*bad_pcm); ++i) { t = text_of(bad_pcm[i]); CHECK(!parse_pcm(&t, 111)); }
    const char *pcm_keys[] = {"trigger_time", "tstamp", "delay", "avail", "avail_max", "other_counter"};
    for (size_t i = 0; i < sizeof(pcm_keys) / sizeof(*pcm_keys); ++i) {
        snprintf(bytes, sizeof(bytes), "%s%s: 0.000000\n", good_pcm, pcm_keys[i]);
        t = text_of(bytes); CHECK(parse_pcm(&t, 111));
        snprintf(bytes, sizeof(bytes), "%s%s: 0.000000\n-----\n %s\t: 1.000000\n", good_pcm, pcm_keys[i], pcm_keys[i]);
        t = text_of(bytes); CHECK(!parse_pcm(&t, 111));
    }
    char serialized[TEXT_LIMIT + 1];
    t = text_of(good_io); CHECK(parse_io(&t, serialized)); CHECK(!strcmp(serialized, "|rchar:\t100|wchar: 89 |syscr: 19|syscw: 5"));
    const char *accounting[] = {"0", "18446744073709551615", "-1", "18446744073709551616"};
    for (unsigned i = 0; i < 4; ++i) {
        snprintf(bytes, sizeof(bytes), "%sread_bytes: 0\nwrite_bytes: 0\ncancelled_write_bytes: %s\n", good_io, accounting[i]);
        t = text_of(bytes); CHECK(parse_io(&t, serialized) == (i < 2));
    }
    const char *bad_io[] = {"", "rchar: 1\n", "rchar: 1\nwchar: 2\nsyscr: 3\nsyscw: 4",
        "rchar: 1\nwchar: 2\nsyscr: 3\nsyscw: 4\nrchar: 1\n", "rchar: -1\nwchar: 2\nsyscr: 3\nsyscw: 4\n",
        "rchar: 1 extra\nwchar: 2\nsyscr: 3\nsyscw: 4\n", "rchar: 1\nwchar: 2\nsyscr: 3\nsyscw: 4\nread_bytes: 0\n",
        "rchar: 1\nwchar: 2\nsyscr: 3\nsyscw: 4\nunknown: 0\n", "rchar: $(touch /tmp/no)\nwchar: 2\nsyscr: 3\nsyscw: 4\n"};
    for (size_t i = 0; i < sizeof(bad_io) / sizeof(*bad_io); ++i) { t = text_of(bad_io[i]); CHECK(!parse_io(&t, serialized)); }
    t = text_of(good_io); t.bytes[1] = '\0'; CHECK(!parse_io(&t, serialized));
}

static void observation_tests(void) {
    reset_fixture();
    int fd = open("/dev/null", O_RDONLY); CHECK(fd >= 0); CHECK(dup2(fd, 3) == 3); if (fd != 3) CHECK(close(fd) == 0);
    CHECK(run() == 0); CHECK(fcntl(3, F_GETFD) == -1 && errno == EBADF);
    CHECK(!strcmp(output, "e5-observe-v1/111/777/4/0100000/5/0100002/|rchar:\t100|wchar: 89 |syscr: 19|syscw: 5\n"));
    reset_fixture(); read_chunk = 1; interrupts = 3; write_chunk = 1; write_interrupts = 2;
    CHECK(run() == 0); CHECK(strstr(output, "e5-observe-v1/111/777/") == output); CHECK(largest_request == TEXT_LIMIT + 1);
    reset_fixture(); io_unavailable = true; CHECK(run() == 0); CHECK(strstr(output, "/unavailable\n") != NULL);
    reset_fixture(); io_disappears = true; refused(30);
    reset_fixture(); read_failure = true; refused(10);
    reset_fixture(); close_failure = true; refused(10);
    reset_fixture(); write_failure = true; CHECK(run() == 74); CHECK(output_size == 0);
    for (enum Change c = START; c <= OWN_PARENT; ++c) { reset_fixture(); change = c; refused(10); }
    reset_fixture(); alias("/proc/111/exe", "/foreign"); refused(10);
    reset_fixture(); put("/proc/111/wchan", "wait_woken"); refused(10);
    reset_fixture(); remove_entry("/proc/111/fd/4"); refused(20);
    reset_fixture(); alias("/proc/111/fd/6", "/tmp/e5t26f-resident.fifo"); refused(20);
    reset_fixture(); put("/proc/111/fdinfo/4", "flags: 0100002\n"); refused(20);
    reset_fixture(); put("/proc/111/fdinfo/4", "flags: 0100000\npos: 0\npos: 0\n"); refused(20);
    reset_fixture(); remove_entry("/proc/222/fd/3"); alias("/proc/222/fd/7", "/tmp/e5t26f-resident.fifo"); put("/proc/222/fdinfo/7", "flags: 0100002\n"); refused(20);
    reset_fixture(); alias("/proc/222/fd/7", "/tmp/e5t26f-resident.fifo"); refused(20);
    reset_fixture(); put("/proc/222/fdinfo/3", "flags: 0100000\n"); refused(20);
    reset_fixture(); remove_entry("/proc/111/fd/5"); refused(30);
    reset_fixture(); alias("/proc/111/fd/6", "/dev/snd/pcmC0D0p"); refused(30);
    reset_fixture(); put("/proc/asound/card0/pcm0p/sub0/status", "state: OPEN\n"); refused(30);
    reset_fixture(); put("/proc/asound/card0/pcm0p/sub0/status", "state: PREPARED\nowner_pid: 111\nhw_ptr: 0\nappl_ptr: 0\navail: 960\navail: 960\n"); refused(30);
    reset_fixture(); put("/proc/111/io", ""); refused(30);
    reset_fixture(); Text text; memset(text.bytes, 'x', TEXT_LIMIT + 1);
    put_bytes("/proc/111/stat", text.bytes, TEXT_LIMIT + 1); refused(10); CHECK(read_bytes == TEXT_LIMIT + 1);
    reset_fixture(); put_bytes("/bounded", text.bytes, TEXT_LIMIT); CHECK(read_text("/bounded", &text)); CHECK(text.n == TEXT_LIMIT);
    text.bytes[5] = '\0'; put_bytes("/bounded", text.bytes, TEXT_LIMIT); CHECK(!read_text("/bounded", &text));
}

static void cli_tests(void) {
    const char *invalid[] = {"", "0", "-1", "+111", " 111", "111 ", "2147483648", "000000000001", "111/x"};
    for (size_t i = 0; i < sizeof(invalid) / sizeof(*invalid); ++i) {
        for (unsigned argument = 1; argument <= 2; ++argument) {
            reset_fixture(); char *argv[] = {"e5t26f-observe", "111", "222", NULL}; argv[argument] = (char *)invalid[i];
            CHECK(observer_main(3, argv) == 64); CHECK(opens == 0 && output_size == 0); CHECK(first_closed == 3);
        }
    }
    reset_fixture(); char *argv[] = {"e5t26f-observe", "111", "222", "extra", NULL};
    CHECK(observer_main(2, argv) == 64); CHECK(observer_main(4, argv) == 64); CHECK(output_size == 0);
    reset_fixture(); argv[2] = "223"; CHECK(observer_main(3, argv) == 10); CHECK(opens == 0 && output_size == 0);
}

static void cleanup(const char *path) {
    DIR *dir = opendir(path); CHECK(dir != NULL);
    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
        char child[PATH_MAX]; int n = snprintf(child, sizeof(child), "%s/%s", path, entry->d_name); CHECK(n > 0 && n < PATH_MAX);
        struct stat st; CHECK(lstat(child, &st) == 0);
        if (S_ISDIR(st.st_mode)) cleanup(child); else CHECK(unlink(child) == 0);
    }
    CHECK(closedir(dir) == 0); CHECK(rmdir(path) == 0);
}

int main(int argc, char **argv) {
    /* No args: normal self-tests. Two args: production observer_main transport,
     * real getppid/close, with only proc/device fixture data substituted. */
    if (argc != 1) {
        uint64_t parent;
        if (argc != 3 || strcmp(argv[1], "111") || strlen(argv[2]) > 10 ||
            !integer((Span){argv[2], strlen(argv[2])}, 10, INT_MAX, &parent) || !parent) return 64;
        transport_mode = true; transport_parent = (unsigned)parent;
    }
    char template[] = "/tmp/e5t26f-observer-test-XXXXXX";
    char *root = mkdtemp(template); CHECK(root != NULL); strcpy(fixture_root, root);
    const char *dirs[] = {"/proc", "/proc/111", "/proc/111/fd", "/proc/111/fdinfo", "/proc/222", "/proc/222/fd", "/proc/222/fdinfo",
        "/proc/asound", "/proc/asound/card0", "/proc/asound/card0/pcm0p", "/proc/asound/card0/pcm0p/sub0", "/usr", "/usr/bin", "/dev", "/dev/snd", "/tmp"};
    for (size_t i = 0; i < sizeof(dirs) / sizeof(*dirs); ++i) { char path[PATH_MAX]; mapped(path, dirs[i]); CHECK(mkdir(path, 0700) == 0); }
    char fifo[PATH_MAX]; mapped(fifo, "/tmp/e5t26f-resident.fifo"); CHECK(mkfifo(fifo, 0600) == 0);
    if (transport_mode) {
        reset_fixture();
        int result = observer_main(argc, argv);
        CHECK(first_operation == 'c' && first_closed == 3);
        if (!result && fwrite(output, 1, output_size, stdout) != output_size) result = 74;
        cleanup(fixture_root);
        return result;
    }
    parser_tests(); observation_tests(); cli_tests(); cleanup(fixture_root);
    printf("observer: %u checks passed (controlled fixtures; not real hardware or browser evidence)\n", checks);
    return 0;
}
