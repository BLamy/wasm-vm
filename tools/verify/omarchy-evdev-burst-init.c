// Tiny real Linux initramfs reader. It never reads the measured client until the
// separate state client's final B-down sentinel proves the entire burst arrived.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mount.h>
#include <sys/reboot.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>

static void die(const char *message) {
    printf("WVB_ERROR %s errno=%d\n", message, errno);
    fflush(stdout);
    reboot(RB_POWER_OFF);
    for (;;) pause();
}

static long milliseconds(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts)) die("clock");
    return ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
}

int main(int argc, char **argv) {
    setbuf(stdout, NULL);
    int legacy = argc == 2 && !strcmp(argv[1], "legacy");
    if (argc != 2 || (!legacy && strcmp(argv[1], "burst"))) die("arguments");
    mkdir("/dev", 0755);
    if (mount("devtmpfs", "/dev", "devtmpfs", 0, "")) die("devtmpfs");
    struct utsname kernel;
    if (uname(&kernel)) die("uname");
    printf("WVB_KERNEL %s %s %s\n", kernel.release, kernel.version, kernel.machine);
    long deadline = milliseconds() + 10000;
    int measured = -1;
    while ((measured = open("/dev/input/event0", O_RDONLY | O_NONBLOCK)) < 0) {
        if (milliseconds() >= deadline) die("open measured timeout");
        usleep(1000);
    }
    int state = open("/dev/input/event0", O_RDONLY | O_NONBLOCK);
    if (state < 0 || state == measured) die("open separate state client");
    char name[128] = {0};
    struct stat info, state_info;
    if (ioctl(measured, EVIOCGNAME(sizeof(name)), name) < 0 ||
        strcmp(name, "wasm-vm virtio keyboard") || fstat(measured, &info) ||
        fstat(state, &state_info) || !S_ISCHR(info.st_mode) ||
        info.st_rdev != state_info.st_rdev || info.st_ino != state_info.st_ino)
        die("keyboard identity");
    printf("WVB_DEVICE name=%s measured=%d state=%d major=%u minor=%u inode=%lu event_bytes=%zu\n",
           name, measured, state, major(info.st_rdev), minor(info.st_rdev),
           (unsigned long)info.st_ino, sizeof(struct input_event));
    if (sizeof(struct input_event) != 24) die("event size");
    unsigned char keys[(KEY_MAX + 8) / 8] = {0};
    if (ioctl(state, EVIOCGKEY(sizeof(keys)), keys) < 0 || (keys[KEY_B / 8] & (1U << (KEY_B % 8))))
        die("sentinel initially down");
    puts("WVM_KB_INJECT");
    deadline = milliseconds() + 10000;
    if (!legacy) {
        do {
            // EVIOCGKEY flushes only this *separate* client's key queue. Never
            // issue this ioctl against measured, including before readback.
            if (ioctl(state, EVIOCGKEY(sizeof(keys)), keys) < 0) die("sentinel state");
            if (keys[KEY_B / 8] & (1U << (KEY_B % 8))) break;
            if (milliseconds() >= deadline) die("sentinel timeout");
            usleep(1000);
        } while (1);
        puts("WVB_SENTINEL B_DOWN separate_client=1");
    }
    struct input_event events[4096];
    size_t count = 0;
    for (;;) {
        ssize_t bytes = read(measured, events + count, sizeof(events) - count * sizeof(*events));
        if (bytes < 0) {
            if (errno != EAGAIN) die("read");
            if (!legacy || count == 4) break;
            if (milliseconds() >= deadline) die("legacy read timeout");
            usleep(1000);
            continue;
        }
        if (!bytes || bytes % sizeof(*events)) die("partial event");
        count += (size_t)bytes / sizeof(*events);
        if (count >= 4096) die("reader bound");
    }
    for (size_t i = 0; i < count; i++) {
        const unsigned char *raw = (const unsigned char *)&events[i];
        printf("WVB_EVENT %zu ", i);
        for (size_t j = 0; j < sizeof(*events); j++) printf("%02x", raw[j]);
        putchar('\n');
    }
    printf("WVB_DONE count=%zu eagain=1\n", count);
    if (close(state) || close(measured)) die("close");
    reboot(RB_POWER_OFF);
    die("poweroff returned");
}
