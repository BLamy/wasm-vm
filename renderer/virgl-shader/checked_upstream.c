/* SPDX-License-Identifier: MIT
 * Compile the pinned, unchanged translator through checked string allocations.
 * Some operand strbuf reallocations do not propagate failure to its return value.
 * The owning bridge must reject such a conversion, including a mixed raw pair.
 */
#include "checked_upstream.h"
#include <stdlib.h>
#include <string.h>

#ifdef BRIDGE_UPSTREAM_ALLOCATION_TEST
void *precise_word_upstream_malloc(size_t bytes);
void *precise_word_upstream_realloc(void *pointer, size_t bytes);
#define UPSTREAM_MALLOC precise_word_upstream_malloc
#define UPSTREAM_REALLOC precise_word_upstream_realloc
#else
#define UPSTREAM_MALLOC malloc
#define UPSTREAM_REALLOC realloc
#endif

static bool allocation_failed;

void bridge_upstream_allocation_begin(void) { allocation_failed = false; }
bool bridge_upstream_allocation_failed(void) { return allocation_failed; }

static void *checked_malloc(size_t bytes)
{
   void *result = UPSTREAM_MALLOC(bytes);
   if (!result && bytes) allocation_failed = true;
   return result;
}

static void *checked_realloc(void *pointer, size_t bytes)
{
   void *result = UPSTREAM_REALLOC(pointer, bytes);
   if (!result && bytes) allocation_failed = true;
   return result;
}

#define malloc checked_malloc
#define realloc checked_realloc
/* Initialize ignored strbuf failures as a safe, empty external buffer. Upstream
 * may continue formatting after a caller ignores false; it must not read an
 * uninitialized size, free static storage, or pass a NULL operand to printf. */
#define strbuf_alloc upstream_strbuf_alloc
#include "vrend/vrend_strbuf.h"
#undef strbuf_alloc

static void checked_strbuf_empty(struct vrend_strbuf *buffer)
{
   static char empty[1];
   buffer->buf = empty;
   buffer->alloc_size = sizeof(empty);
   buffer->size = 0;
   buffer->error_state = true;
   buffer->external_buffer = true;
}

static bool checked_strbuf_alloc(struct vrend_strbuf *buffer, int initial_size)
{
   memset(buffer, 0, sizeof(*buffer));
   if (upstream_strbuf_alloc(buffer, initial_size)) return true;
   checked_strbuf_empty(buffer);
   return false;
}

static bool checked_strbuf_ready(struct vrend_strbuf *buffer)
{
   if (strbuf_get_error(buffer)) return false;
   /* Operand buffers begin zeroed and grow lazily. Reserve their first byte
    * before the variadic formatter computes a pointer or publishes an operand. */
   if (!buffer->buf && !strbuf_grow(buffer, 0)) {
      checked_strbuf_empty(buffer);
      return false;
   }
   return true;
}

__attribute__((format(printf, 2, 3)))
static void checked_strbuf_fmt(struct vrend_strbuf *buffer, const char *format, ...)
{
   if (!checked_strbuf_ready(buffer)) return;
   va_list args;
   va_start(args, format);
   strbuf_vfmt(buffer, format, args);
   va_end(args);
}

__attribute__((format(printf, 2, 3)))
static void checked_strbuf_appendf(struct vrend_strbuf *buffer, const char *format, ...)
{
   if (!checked_strbuf_ready(buffer)) return;
   va_list args;
   va_start(args, format);
   strbuf_vappendf(buffer, format, args);
   va_end(args);
}

#define strbuf_alloc checked_strbuf_alloc
#define strbuf_fmt checked_strbuf_fmt
#define strbuf_appendf checked_strbuf_appendf
#ifndef BRIDGE_UPSTREAM_ALLOC_GUARD_ONLY
#include "vendor/src/vrend/vrend_shader.c"
#endif
