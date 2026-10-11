# Original integer image storage

The selected integer owner/backend/layout alone admit original formats177..200.
R/RG use native integer storage; RGB expands within charged scratch to matching RGBA
with integer alpha1. Sync and PBO reads use RGBA_INTEGER/INT or UNSIGNED_INT and
compact original little-endian words in the same charged scratch.
NEAREST framebuffer blits copy matching integer ranges entirely on the GPU.

The metadata marker integerBits is owned, never an accepted guest field.
All earlier constructors remain closed to integer images. Limits are unchanged:
4MiB/resource,32MiB aggregate and8MiB scratch. The guaranteed16-byte integer read
limits each read to524288 texels; this change does not lift that bound.

This storage facet grants no typed shader, packet consumer, production capset,
guest rendering, scanout or performance authority.
