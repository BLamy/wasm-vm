// Independent E5.5-T03ap critic fixture. Linux only; no input device required.
// Build: cc -std=c11 -Wall -Wextra -Werror -pthread adversarial-fixture.c -o fixture
// Protocol: READY -> attach all TIDs -> stdin GO\n -> READY_TO_DETACH ->
// detach and independently inspect TracerPid -> stdin DONE\n -> DETACHED.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <poll.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <time.h>
#include <unistd.h>

// Literal RV64 input_event bytes, independent of observer code and structs.
static const unsigned char key_a[24] = {
    1,0,0,0,0,0,0,0, 2,0,0,0,0,0,0,0, 1,0,30,0, 1,0,0,0
};
static const unsigned char syn_dropped[24] = {
    3,0,0,0,0,0,0,0, 4,0,0,0,0,0,0,0, 0,0,3,0, 0,0,0,0
};
static const unsigned char signed_key[25] = {
    5,0,0,0,0,0,0,0, 6,0,0,0,0,0,0,0, 1,0,30,0, 255,255,255,255, 165
};
static const unsigned char syn_report[24] = {
    7,0,0,0,0,0,0,0, 8,0,0,0,0,0,0,0, 0,0,0,0, 0,0,0,0
};

static int data_pipe[2], vector_pipe[2], worker_pipe[2], gate_pipe[2], reuse_pipe[2];
static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t condition = PTHREAD_COND_INITIALIZER;
static pid_t main_tid, worker_tid;
static int phase;

static void fail(const char *fmt, ...) {
    va_list args;
    va_start(args, fmt);
    fputs("fixture failure: ", stderr);
    vfprintf(stderr, fmt, args);
    fputc('\n', stderr);
    va_end(args);
    exit(1);
}

static int64_t monotonic_ms(void) {
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC, &t)) fail("clock_gettime: %s", strerror(errno));
    return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

static void write_exact(int fd, const void *bytes, size_t length) {
    ssize_t result;
    do { result = write(fd, bytes, length); } while (result < 0 && errno == EINTR);
    if (result != (ssize_t)length) fail("write fd %d expected %zu got %zd errno %d", fd, length, result, errno);
}

static void hex(const unsigned char *bytes, size_t length) {
    for (size_t i = 0; i < length; i++) printf("%02x", bytes[i]);
}

static void result(const char *name, pid_t tid, int fd, size_t requested,
                   ssize_t actual, int error, const unsigned char *bytes) {
    printf("{\"type\":\"read-result\",\"name\":\"%s\",\"tid\":%d,\"fd\":%d,"
           "\"requested\":%zu,\"returned\":%zd,\"errno\":%d,\"hex\":\"",
           name, tid, fd, requested, actual, error);
    if (actual > 0) hex(bytes, (size_t)actual);
    puts("\"}");
}

static struct stat identity(const char *name, int fd) {
    struct stat s;
    if (fstat(fd, &s)) fail("fstat %s: %s", name, strerror(errno));
    printf("{\"type\":\"fd-identity\",\"name\":\"%s\",\"fd\":%d,"
           "\"dev\":%" PRIuMAX ",\"inode\":%" PRIuMAX ",\"rdev\":%" PRIuMAX ","
           "\"mode\":%" PRIuMAX ",\"isFifo\":%s}\n",
           name, fd, (uintmax_t)s.st_dev, (uintmax_t)s.st_ino,
           (uintmax_t)s.st_rdev, (uintmax_t)s.st_mode, S_ISFIFO(s.st_mode) ? "true" : "false");
    if (!S_ISFIFO(s.st_mode) || s.st_rdev != 0) fail("%s must remain a pipe", name);
    return s;
}

static void receive_line(const char *expected) {
    char text[16];
    size_t n = 0;
    int64_t end = monotonic_ms() + 30000;
    while (n + 1 < sizeof(text)) {
        int64_t remaining = end - monotonic_ms();
        if (remaining <= 0) fail("timeout waiting for %s", expected);
        struct pollfd p = {.fd = STDIN_FILENO, .events = POLLIN};
        int ready = poll(&p, 1, (int)remaining);
        if (ready < 0 && errno == EINTR) continue;
        if (ready <= 0) fail("poll waiting for %s: %d errno %d", expected, ready, errno);
        ssize_t count = read(STDIN_FILENO, &text[n], 1);
        if (count < 0 && errno == EINTR) continue;
        if (count != 1) fail("stdin closed before %s", expected);
        if (text[n++] == '\n') break;
    }
    text[n] = 0;
    if (strcmp(text, expected)) fail("unexpected control line");
}

static void set_phase(int value) {
    if (pthread_mutex_lock(&mutex)) fail("mutex lock");
    phase = value;
    if (pthread_cond_broadcast(&condition)) fail("condition broadcast");
    if (pthread_mutex_unlock(&mutex)) fail("mutex unlock");
}

static void wait_phase(int value) {
    struct timespec until;
    if (clock_gettime(CLOCK_REALTIME, &until)) fail("clock for condition");
    until.tv_sec += 30;
    if (pthread_mutex_lock(&mutex)) fail("mutex lock");
    while (phase < value) {
        int rc = pthread_cond_timedwait(&condition, &mutex, &until);
        if (rc) fail("waiting for phase %d: %s", value, strerror(rc));
    }
    if (pthread_mutex_unlock(&mutex)) fail("mutex unlock");
}

// Force main's read ENTRY to remain outstanding while the worker executes its
// own read pair. This attacks a single global entry/exit state without sleeps
// deciding correctness. /proc syscall observation itself is not evdev evidence.
static void wait_for_main_read(void) {
    char path[96];
    snprintf(path, sizeof(path), "/proc/self/task/%d/syscall", main_tid);
    int64_t deadline = monotonic_ms() + 5000;
    while (monotonic_ms() < deadline) {
        int fd = open(path, O_RDONLY | O_CLOEXEC);
        if (fd < 0) fail("open main syscall: %s", strerror(errno));
        char text[512];
        ssize_t n = read(fd, text, sizeof(text) - 1);
        if (close(fd)) fail("close syscall fd");
        if (n < 0) fail("read main syscall: %s", strerror(errno));
        text[n] = 0;
        long nr = -1;
        unsigned long long arg0 = 0;
        if (sscanf(text, "%ld %llx", &nr, &arg0) == 2 &&
            nr == SYS_read && arg0 == (unsigned)gate_pipe[0]) return;
        struct timespec pause = {.tv_sec = 0, .tv_nsec = 1000000};
        nanosleep(&pause, NULL);
    }
    fail("main did not enter blocking read within 5 seconds");
}

static void *worker(void *unused) {
    (void)unused;
    if (pthread_mutex_lock(&mutex)) fail("worker mutex lock");
    worker_tid = (pid_t)syscall(SYS_gettid);
    if (pthread_cond_broadcast(&condition)) fail("worker broadcast");
    if (pthread_mutex_unlock(&mutex)) fail("worker mutex unlock");
    wait_phase(1);
    wait_for_main_read();
    unsigned char data[96];
    memset(data, 0xee, sizeof(data));
    errno = 0;
    ssize_t n = read(worker_pipe[0], data, sizeof(data));
    int error = n < 0 ? errno : 0;
    result("worker-partial-25", worker_tid, worker_pipe[0], sizeof(data), n, error, data);
    if (n != 25 || memcmp(data, signed_key, 25)) fail("worker literal bytes");
    memset(data, 0xee, sizeof(data));
    errno = 0;
    n = read(worker_pipe[0], data, sizeof(data));
    error = n < 0 ? errno : 0;
    result("worker-eagain", worker_tid, worker_pipe[0], sizeof(data), n, error, data);
    if (n != -1 || error != EAGAIN) fail("worker expected EAGAIN");
    for (size_t i = 0; i < sizeof(data); i++) if (data[i] != 0xee) fail("failed worker read altered memory");
    write_exact(gate_pipe[1], syn_report, sizeof(syn_report));
    wait_phase(2);
    printf("{\"type\":\"worker-post-detach-progress\",\"tid\":%d}\n", worker_tid);
    return NULL;
}

static int tracer_pid(pid_t tid) {
    char path[96], line[512];
    snprintf(path, sizeof(path), "/proc/self/task/%d/status", tid);
    FILE *file = fopen(path, "r");
    if (!file) fail("open status %d: %s", tid, strerror(errno));
    int tracer = -1;
    while (fgets(line, sizeof(line), file)) {
        if (sscanf(line, "TracerPid: %d", &tracer) == 1) break;
    }
    if (fclose(file)) fail("close status");
    if (tracer < 0) fail("missing TracerPid %d", tid);
    return tracer;
}

int main(void) {
    if (setvbuf(stdout, NULL, _IOLBF, 0)) fail("stdout buffering");
    main_tid = (pid_t)syscall(SYS_gettid);
    if (pipe2(data_pipe, O_NONBLOCK | O_CLOEXEC) ||
        pipe2(vector_pipe, O_NONBLOCK | O_CLOEXEC) ||
        pipe2(worker_pipe, O_NONBLOCK | O_CLOEXEC) ||
        pipe2(gate_pipe, O_CLOEXEC) || pipe2(reuse_pipe, O_NONBLOCK | O_CLOEXEC)) fail("pipe2");
    write_exact(data_pipe[1], key_a, sizeof(key_a));
    write_exact(vector_pipe[1], syn_dropped, sizeof(syn_dropped));
    write_exact(vector_pipe[1], signed_key, 24);
    write_exact(worker_pipe[1], signed_key, sizeof(signed_key));
    write_exact(reuse_pipe[1], syn_dropped, sizeof(syn_dropped));
    pthread_t thread;
    int rc = pthread_create(&thread, NULL, worker, NULL);
    if (rc) fail("pthread_create: %s", strerror(rc));
    struct timespec until;
    if (clock_gettime(CLOCK_REALTIME, &until)) fail("clock");
    until.tv_sec += 30;
    if (pthread_mutex_lock(&mutex)) fail("mutex lock");
    while (!worker_tid) {
        rc = pthread_cond_timedwait(&condition, &mutex, &until);
        if (rc) fail("worker ready: %s", strerror(rc));
    }
    if (pthread_mutex_unlock(&mutex)) fail("mutex unlock");
    printf("{\"type\":\"READY\",\"pid\":%d,\"mainTid\":%d,\"workerTid\":%d,"
           "\"dataFd\":%d,\"readvFd\":%d,\"workerFd\":%d,\"gateFd\":%d,\"reuseSourceFd\":%d}\n",
           getpid(), main_tid, worker_tid, data_pipe[0], vector_pipe[0], worker_pipe[0], gate_pipe[0], reuse_pipe[0]);
    receive_line("GO\n");
    struct stat before = identity("before-reuse", data_pipe[0]);
    unsigned char data[96];
    memset(data, 0xee, sizeof(data));
    errno = 0;
    ssize_t n = read(data_pipe[0], data, sizeof(data));
    int error = n < 0 ? errno : 0;
    result("main-short-24", main_tid, data_pipe[0], sizeof(data), n, error, data);
    if (n != 24 || memcmp(data, key_a, 24)) fail("main literal bytes");
    memset(data, 0xee, sizeof(data));
    errno = 0;
    n = read(data_pipe[0], data, sizeof(data));
    error = n < 0 ? errno : 0;
    result("main-eagain", main_tid, data_pipe[0], sizeof(data), n, error, data);
    if (n != -1 || error != EAGAIN) fail("main expected EAGAIN");
    for (size_t i = 0; i < sizeof(data); i++) if (data[i] != 0xee) fail("failed main read altered memory");
    unsigned char first[7], second[65], joined[72];
    memset(first, 0xee, sizeof(first));
    memset(second, 0xee, sizeof(second));
    struct iovec vectors[2] = {{.iov_base = first, .iov_len = sizeof(first)},
                               {.iov_base = second, .iov_len = sizeof(second)}};
    errno = 0;
    n = readv(vector_pipe[0], vectors, 2);
    error = n < 0 ? errno : 0;
    memcpy(joined, first, sizeof(first));
    memcpy(joined + sizeof(first), second, sizeof(second));
    result("main-readv-48-split-7-41", main_tid, vector_pipe[0], sizeof(joined), n, error, joined);
    if (n != 48 || memcmp(joined, syn_dropped, 24) || memcmp(joined + 24, signed_key, 24)) fail("readv literal bytes");
    for (size_t i = 41; i < sizeof(second); i++) if (second[i] != 0xee) fail("readv touched unreturned bytes");
    set_phase(1);
    memset(data, 0xee, sizeof(data));
    errno = 0;
    n = read(gate_pipe[0], data, sizeof(data));
    error = n < 0 ? errno : 0;
    result("main-interleaved-blocking-24", main_tid, gate_pipe[0], sizeof(data), n, error, data);
    if (n != 24 || memcmp(data, syn_report, 24)) fail("interleaved literal bytes");
    if (dup2(reuse_pipe[0], data_pipe[0]) != data_pipe[0]) fail("dup2 reuse");
    if (close(reuse_pipe[0])) fail("close duplicated pipe");
    struct stat after = identity("after-reuse", data_pipe[0]);
    if (before.st_dev == after.st_dev && before.st_ino == after.st_ino) fail("fd did not change identity");
    memset(data, 0xee, sizeof(data));
    errno = 0;
    n = read(data_pipe[0], data, sizeof(data));
    error = n < 0 ? errno : 0;
    result("main-reused-non-input-24", main_tid, data_pipe[0], sizeof(data), n, error, data);
    if (n != 24 || memcmp(data, syn_dropped, 24)) fail("reused fd literal bytes");
    printf("{\"type\":\"READY_TO_DETACH\",\"pid\":%d,\"mainTid\":%d,\"workerTid\":%d,\"ok\":true}\n",
           getpid(), main_tid, worker_tid);
    receive_line("DONE\n");
    int main_tracer = tracer_pid(main_tid), worker_tracer = tracer_pid(worker_tid);
    if (main_tracer || worker_tracer) fail("still traced after DONE: %d %d", main_tracer, worker_tracer);
    set_phase(2);
    if (pthread_join(thread, NULL)) fail("pthread_join");
    printf("{\"type\":\"DETACHED\",\"pid\":%d,\"mainTracerPid\":%d,\"workerTracerPid\":%d,\"ok\":true}\n",
           getpid(), main_tracer, worker_tracer);
    return 0;
}
