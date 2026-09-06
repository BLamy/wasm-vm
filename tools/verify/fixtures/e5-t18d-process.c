/* Linux-only process/socket double for the supervision pre-check, NOT guest proof. */
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

int main(int argc, char **argv) {
    int seat = argc > 1 && strcmp(argv[1], "seatd") == 0;
    if (seat) {
        prctl(PR_SET_NAME, "seatd", 0, 0, 0);
    }
    {
        const char *mode = getenv("E5_T18D_FIXTURE");
        if (mode && strcmp(mode, "exit") == 0) return 23;
        if (mode && strcmp(mode, "stubborn") == 0) signal(SIGTERM, SIG_IGN);
        if (!mode || strcmp(mode, "no-socket") != 0) {
            struct sockaddr_un address = {.sun_family = AF_UNIX};
            if (seat) snprintf(address.sun_path, sizeof(address.sun_path), "/run/seatd.sock");
            else snprintf(address.sun_path, sizeof(address.sun_path), "%s/wayland-0", getenv("XDG_RUNTIME_DIR"));
            int fd = socket(AF_UNIX, SOCK_STREAM, 0);
            if (fd < 0 || bind(fd, (struct sockaddr *)&address, sizeof(address)) || listen(fd, 1)) return 24;
        }
    }
    for (;;) pause();
}
