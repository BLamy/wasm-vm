// The adapter accepts only this project's bounded virtual-monitor base block.
// The independent Wayland observer deliberately does not use this decoder.
#ifndef WV_DISPLAY_MODE_H
#define WV_DISPLAY_MODE_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

struct wv_display_mode { int width, height; };
static bool wv_display_mode_decode(const uint8_t *bytes, size_t length,
                                  struct wv_display_mode *mode) {
    static const uint8_t header[8] = {0,255,255,255,255,255,255,0};
    if (!bytes || !mode || length != 128 || memcmp(bytes, header, 8)) return false;
    unsigned checksum = 0;
    for (size_t i = 0; i < length; i++) checksum += bytes[i];
    if ((checksum & 255) || bytes[8] != 0x5e || bytes[9] != 0xcd ||
        bytes[18] != 1 || bytes[19] != 4 || bytes[126] != 0 ||
        (bytes[54] == 0 && bytes[55] == 0)) return false;
    const int width = bytes[56] | ((bytes[58] & 0xf0) << 4);
    const int height = bytes[59] | ((bytes[61] & 0xf0) << 4);
    if (width < 320 || height < 240 || width > 4095 || height > 4095) return false;
    *mode = (struct wv_display_mode){width, height};
    return true;
}
#endif
