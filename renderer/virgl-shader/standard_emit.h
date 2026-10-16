/* SPDX-License-Identifier: MIT */
#ifndef VIRGL_STANDARD_EMIT_H
#define VIRGL_STANDARD_EMIT_H
#include "standard_guard.h"
struct tgsi_token;
/* Consumes checked, pinned TGSI records. Owns the returned bounded allocation;
 * native floating math has ordinary GLES3 precision, while untyped/integer
 * register operations never round-trip their words through float variables. */
const char *standard_emit(const struct standard_profile *profile,
                          const struct tgsi_token *tokens, char **output);
#endif
