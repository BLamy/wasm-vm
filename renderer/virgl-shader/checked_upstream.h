/* SPDX-License-Identifier: MIT */
#ifndef VIRGL_CHECKED_UPSTREAM_H
#define VIRGL_CHECKED_UPSTREAM_H
#include <stdbool.h>

/* One synchronous conversion owns the latch; the bridge is already serialized. */
void bridge_upstream_allocation_begin(void);
bool bridge_upstream_allocation_failed(void);
#endif
