/* Appended to a mechanically copied worker fixture harness, replacing main only. */
int main(int argc, char **argv) {
    if (argc == 2 && !strcmp(argv[1], "worker-parser")) {
        parser_tests();
        printf("worker parser oracle: %u checks passed\n", checks);
        return 0;
    }
    CHECK(argc == 3);
    CHECK(strlen(argv[1]) < sizeof(fixture_root));
    strcpy(fixture_root, argv[1]);
    CHECK(mkdir(fixture_root, 0700) == 0);
    const char *dirs[] = {"/proc", "/proc/111", "/proc/111/fd", "/proc/111/fdinfo", "/proc/222", "/proc/222/fd", "/proc/222/fdinfo",
        "/proc/asound", "/proc/asound/card0", "/proc/asound/card0/pcm0p", "/proc/asound/card0/pcm0p/sub0", "/usr", "/usr/bin", "/dev", "/dev/snd", "/tmp"};
    for (size_t i = 0; i < sizeof(dirs) / sizeof(*dirs); ++i) {
        char name[PATH_MAX]; mapped(name, dirs[i]); CHECK(mkdir(name, 0700) == 0);
    }
    char fifo[PATH_MAX]; mapped(fifo, "/tmp/e5t26f-resident.fifo"); CHECK(mkfifo(fifo, 0600) == 0);
    reset_fixture();
    char pcm[4096];
    int prefix = snprintf(pcm, sizeof(pcm), "%ststamp: 0.000000\n-----\n", good_pcm);
    CHECK(prefix > 0); size_t used = (size_t)prefix;
    for (unsigned i = 0; i < 80; ++i) {
        int n = snprintf(pcm + used, sizeof(pcm) - used, "padding_%03u: 0.000000\n", i);
        CHECK(n > 0 && (size_t)n < sizeof(pcm) - used); used += (size_t)n;
    }
    while (used % 7 != 6) pcm[used++] = ' ';
    size_t split_key = used;
    int n = snprintf(pcm + used, sizeof(pcm) - used, "%sstamp\t: 1.000000\n", !strcmp(argv[2], "valid") ? "x" : "t");
    CHECK(n > 0 && (size_t)n < sizeof(pcm) - used); used += (size_t)n;
    put_bytes("/proc/asound/card0/pcm0p/sub0/status", pcm, used);
    read_chunk = 7; interrupts = 2;
    int result = run();
    printf("{\"vector\":\"%s\",\"pcmBytes\":%zu,\"splitKeyOffset\":%zu,\"readChunk\":%zu,\"injectedEintr\":2,\"observerExit\":%d,\"outputBytes\":%zu,\"firstClosed\":%d}\n",
        argv[2], used, split_key, read_chunk, result, output_size, first_closed);
    if (output_size) CHECK(fwrite(output, 1, output_size, stdout) == output_size);
    if (!strcmp(argv[2], "valid")) {
        CHECK(result == 0);
        CHECK(!strcmp(output, "e5-observe-v1/111/777/4/0100000/5/0100002/|rchar:\t100|wchar: 89 |syscr: 19|syscw: 5\n"));
    } else {
        CHECK(result == 30); CHECK(output_size == 0);
    }
    return 0;
}
