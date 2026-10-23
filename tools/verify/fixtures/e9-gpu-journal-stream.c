/* Freestanding storage-boundary guest, not Linux/Mesa or workload qualification.
 * It consumes every queued UART byte and checks 256 distinct immutable block
 * chunks byte-for-byte. The production exact GPU machine owns all deliveries. */
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long u64;
#ifndef INPUT_COUNT
#error INPUT_COUNT must be sealed by the build
#endif
#ifndef BLOCK_COUNT
#error BLOCK_COUNT must be sealed by the build
#endif
struct desc { u64 address; u32 length; u16 flags, next; };
struct used { u32 id, length; };
struct queue {
    struct desc descriptors[256] __attribute__((aligned(4096)));
    volatile u16 avail_flags, avail_index, available[256], avail_event;
    volatile u16 used_flags __attribute__((aligned(4))), used_index;
    volatile struct used used[256];
    u16 used_event;
};
static struct queue disk;
static volatile u8 block_bytes[512] __attribute__((aligned(16))), status;
static volatile u32 *reg(u32 offset) {
    return (volatile u32 *)(0x10001000UL + offset);
}
static void barrier(void) { __asm__ volatile("fence iorw,iorw" ::: "memory"); }
static void putc(char c) {
    register u64 a0 __asm__("a0") = (u8)c;
    register u64 a7 __asm__("a7") = 1;
    __asm__ volatile("ecall" : "+r"(a0) : "r"(a7) : "memory");
}
static void text(const char *s) { while (*s) putc(*s++); }
static void fail(const char *s) {
    text("STREAM_FAIL "); text(s); text("\n");
    for (;;) __asm__ volatile("nop");
}
static void disk_init(void) {
    if (*reg(0) != 0x74726976 || *reg(8) != 2) fail("BLOCK_ID");
    *reg(0x70) = 0; *reg(0x70) = 3;
    *reg(0x24) = 0; *reg(0x20) = 0;
    *reg(0x24) = 1; *reg(0x20) = 1;
    *reg(0x70) = 11;
    if (!(*reg(0x70) & 8)) fail("BLOCK_FEATURES");
    *reg(0x30) = 0; *reg(0x38) = 256;
    *reg(0x80) = (u32)(u64)disk.descriptors; *reg(0x84) = 0;
    *reg(0x90) = (u32)(u64)&disk.avail_flags; *reg(0x94) = 0;
    *reg(0xa0) = (u32)(u64)&disk.used_flags; *reg(0xa4) = 0;
    *reg(0x44) = 1; *reg(0x70) = 15;
}
static void read_chunk(u32 chunk) {
    u32 header[4] = {0, 0, chunk * 512, 0};
    u16 before = disk.used_index;
    status = 0xff;
    for (u32 i = 0; i < 512; i++) block_bytes[i] = (u8)(chunk + 1);
    disk.descriptors[0] = (struct desc){(u64)header, 16, 1, 1};
    disk.descriptors[1] = (struct desc){(u64)block_bytes, 512, 3, 2};
    disk.descriptors[2] = (struct desc){(u64)&status, 1, 2, 0};
    u16 index = disk.avail_index;
    disk.available[index & 255] = 0; barrier();
    disk.avail_index = index + 1; barrier(); *reg(0x50) = 0;
    while (disk.used_index == before) __asm__ volatile("nop" ::: "memory");
    barrier(); *reg(0x64) = 1;
    if (disk.used_index != (u16)(before + 1) || status) fail("BLOCK_STATUS");
    for (u32 i = 0; i < 512; i++) if (block_bytes[i] != (u8)chunk) fail("BLOCK_BYTES");
}
void main(void) {
    volatile u8 *uart = (volatile u8 *)0x10000000UL;
    text("STREAM_START\n");
    for (u32 i = 0; i < INPUT_COUNT; i++) {
        while (!(uart[5] & 1)) __asm__ volatile("nop" ::: "memory");
        if (uart[0] != 97) fail("UART_BYTE");
    }
    text("STREAM_UART_OK\n");
    if (BLOCK_COUNT) disk_init();
    for (u32 chunk = 0; chunk != BLOCK_COUNT; chunk++) read_chunk(chunk);
    text("STREAM_BLOCKS_OK\nSTREAM_DONE\n");
    for (;;) __asm__ volatile("nop");
}
