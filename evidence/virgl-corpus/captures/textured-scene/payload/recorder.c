/* Reference-only virglrenderer API recorder. Never loaded by the VM/browser.
 * Compile against the pinned virglrenderer 1.3.0 public header. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <openssl/sha.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/uio.h>
#include <unistd.h>
#include "virglrenderer.h"
#include "virgl_hw.h"

#define MAX_RESOURCES 4096
#define MAX_IOVS 16384
#define MAX_BACKING (64u * 1024u * 1024u)
#define MAX_BLOB (64u * 1024u * 1024u)

struct backing { uint32_t id; struct iovec *iov; unsigned count; bool live; };
static struct backing backings[MAX_RESOURCES];
static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static FILE *events;
static const char *directory, *workload;
static uint64_t sequence, active_calls, blob_bytes, event_bytes, next_thread_id;
static _Thread_local uint64_t call_stack[64], thread_id;
static _Thread_local unsigned stack_depth;
static uint64_t max_events = 100000, max_blob_bytes = 256u * 1024u * 1024u;
static uint64_t max_event_bytes = 64u * 1024u * 1024u;
static bool failed, initialized, cleanup_seen;
static struct virgl_renderer_callbacks original_callbacks, wrapped_callbacks;
static void *real_library;
static pthread_once_t library_once = PTHREAD_ONCE_INIT;

static void quoted(FILE *out, const char *s, size_t n) {
    fputc('"', out);
    for (size_t i = 0; i < n; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c == '"' || c == '\\') { fputc('\\', out); fputc(c, out); }
        else if (c < 32 || c >= 127) fprintf(out, "\\u%04x", c);
        else fputc(c, out);
    }
    fputc('"', out);
}

static void failure(const char *reason) {
    if (failed) return;
    failed = true;
    if (events) {
        fprintf(events, "{\"seq\":%" PRIu64 ",\"type\":\"failure\",\"reason\":", ++sequence);
        quoted(events, reason, strlen(reason));
        fputs(",\"blobs\":[]}\n", events);
        fflush(events);
    }
    if (directory) {
        char path[PATH_MAX];
        snprintf(path, sizeof(path), "%s/FAILED", directory);
        FILE *f = fopen(path, "w");
        if (f) { fprintf(f, "%s\n", reason); fclose(f); }
    }
}

static uint64_t limit_env(const char *name, uint64_t fallback) {
    const char *s = getenv(name);
    if (!s) return fallback;
    for (const char *p = s; *p; p++) {
        if (*p < '0' || *p > '9') { failure("invalid recorder limit"); return fallback; }
    }
    char *end;
    errno = 0;
    unsigned long long value = strtoull(s, &end, 10);
    if (errno || *end || !value || value > UINT32_MAX) { failure("invalid recorder limit"); return fallback; }
    return value;
}

static void setup(void) {
    if (initialized) return;
    initialized = true;
    directory = getenv("VIRGL_CAPTURE_DIR");
    workload = getenv("VIRGL_CAPTURE_WORKLOAD");
    if (!directory || !workload) { failure("missing capture directory/workload"); return; }
    if (strlen(directory) > PATH_MAX - 100) { failure("capture path too long"); return; }
    char path[PATH_MAX];
    if (snprintf(path, sizeof(path), "%s/events.jsonl", directory) >= (int)sizeof(path)) {
        failure("capture path too long"); return;
    }
    events = fopen(path, "wx");
    if (!events) { failure("cannot exclusively create events.jsonl"); return; }
    snprintf(path, sizeof(path), "%s/blobs", directory);
    if (mkdir(path, 0755) && errno != EEXIST) { failure("cannot create blobs directory"); return; }
    max_events = limit_env("VIRGL_CAPTURE_MAX_EVENTS", max_events);
    max_blob_bytes = limit_env("VIRGL_CAPTURE_MAX_BLOB_BYTES", max_blob_bytes);
    max_event_bytes = limit_env("VIRGL_CAPTURE_MAX_EVENT_BYTES", max_event_bytes);
    fprintf(events, "{\"seq\":%" PRIu64 ",\"type\":\"begin\",\"schema\":\"wasm-vm-virgl-capture-v1\",\"workload\":", ++sequence);
    quoted(events, workload, strlen(workload));
    fprintf(events, ",\"byteOrder\":\"little\",\"limits\":{\"events\":%" PRIu64 ",\"blobBytes\":%" PRIu64 ",\"eventBytes\":%" PRIu64 ",\"singleBlobBytes\":%u,\"resources\":%u,\"iovs\":%u},\"blobs\":[]}\n", max_events, max_blob_bytes, max_event_bytes, MAX_BLOB, MAX_RESOURCES, MAX_IOVS);
    fflush(events);
}

/* Called only under mutex. Each event is complete before releasing the lock. */
static uint64_t start(const char *type, const char *phase) {
    setup();
    if (failed || !events) return 0;
    if (sequence >= max_events || event_bytes >= max_event_bytes) {
        failure("recording limit exceeded"); return 0;
    }
    uint64_t seq = ++sequence;
    fprintf(events, "{\"seq\":%" PRIu64 ",\"type\":\"%s\"", seq, type);
    if (phase) fprintf(events, ",\"phase\":\"%s\"", phase);
    return seq;
}
static uint64_t call_start(const char *type) {
    if (!thread_id) thread_id = ++next_thread_id;
    uint64_t seq = start(type, "enter");
    if (seq) fprintf(events, ",\"threadId\":%" PRIu64 ",\"parentCallSeq\":%" PRIu64,
                     thread_id, stack_depth ? call_stack[stack_depth - 1] : 0);
    active_calls++;
    if (stack_depth < 64) call_stack[stack_depth++] = seq;
    else failure("API nesting limit exceeded");
    return seq;
}
static void call_pop(uint64_t seq) {
    if (active_calls) active_calls--; else failure("unpaired return");
    if (!stack_depth || call_stack[stack_depth - 1] != seq) failure("API call nesting mismatch");
    else stack_depth--;
}
static void finish(void) {
    fputs("}\n", events);
    if (fflush(events) || ferror(events)) { failure("event write failed"); return; }
    long pos = ftell(events);
    if (pos < 0) failure("event position failed");
    else {
        event_bytes = (uint64_t)pos;
        if (event_bytes > max_event_bytes) failure("event byte limit exceeded");
    }
}

static bool blob(const char *role, const void *data, size_t size) {
    if (size > MAX_BLOB || (size && !data)) return false;
    unsigned char digest[SHA256_DIGEST_LENGTH];
    SHA256(data, size, digest);
    char hex[65], path[PATH_MAX];
    for (int i = 0; i < 32; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
    snprintf(path, sizeof(path), "%s/blobs/%s.bin", directory, hex);
    FILE *f = fopen(path, "wx");
    if (f) {
        if (blob_bytes + size > max_blob_bytes) { fclose(f); unlink(path); return false; }
        bool ok = fwrite(data, 1, size, f) == size;
        if (fclose(f)) ok = false;
        if (!ok) { unlink(path); return false; }
        blob_bytes += size;
    } else if (errno != EEXIST) return false;
    fprintf(events, "{\"role\":\"%s\",\"sha256\":\"%s\",\"bytes\":%zu}", role, hex, size);
    return true;
}

static struct backing *find_backing(uint32_t id, bool create) {
    struct backing *free_slot = NULL;
    for (unsigned i = 0; i < MAX_RESOURCES; i++) {
        if (backings[i].live && backings[i].id == id) return &backings[i];
        if (!backings[i].live && !free_slot) free_slot = &backings[i];
    }
    if (create && free_slot) { free_slot->id = id; free_slot->live = true; return free_slot; }
    if (create) failure("resource table full");
    return NULL;
}
static void save_iov(uint32_t id, const struct iovec *iov, unsigned count) {
    struct backing *b = find_backing(id, true);
    if (!b || failed) return;
    if (count > MAX_IOVS || (count && !iov)) { failure("invalid iov array"); return; }
    struct iovec *copy = count ? malloc(count * sizeof(*copy)) : NULL;
    if (count && !copy) { failure("iov allocation failed"); return; }
    if (count) memcpy(copy, iov, count * sizeof(*copy));
    free(b->iov); b->iov = copy; b->count = count;
}
static bool emit_iov(const struct iovec *iov, unsigned count, const char *role) {
    if (count > MAX_IOVS || (count && !iov)) { fputs(",\"iovLengths\":[],\"blobs\":[]", events); return false; }
    size_t size = 0;
    for (unsigned i = 0; i < count; i++) {
        if (iov[i].iov_len > MAX_BACKING - size || (iov[i].iov_len && !iov[i].iov_base)) {
            fputs(",\"iovLengths\":[],\"blobs\":[]", events); return false;
        }
        size += iov[i].iov_len;
    }
    unsigned char *data = size ? malloc(size) : NULL;
    if (size && !data) { fputs(",\"iovLengths\":[],\"blobs\":[]", events); return false; }
    fputs(",\"iovLengths\":[", events);
    for (unsigned i = 0; i < count; i++) {
        fprintf(events, "%s%zu", i ? "," : "", iov[i].iov_len);
    }
    fputs("],\"blobs\":[", events);
    size_t offset = 0;
    for (unsigned i = 0; i < count; i++) {
        if (iov[i].iov_len) {
            if (!iov[i].iov_base) { free(data); return false; }
            memcpy(data + offset, iov[i].iov_base, iov[i].iov_len);
        }
        offset += iov[i].iov_len;
    }
    bool ok = blob(role, data, size);
    free(data);
    fputs("]", events);
    return ok;
}
static void snapshot(uint32_t id, const struct iovec *iov, unsigned count, const char *reason) {
    if (!count || failed) return;
    if (!start("backing_snapshot", NULL)) return;
    fprintf(events, ",\"resourceId\":%u,\"reason\":\"%s\"", id, reason);
    bool ok = emit_iov(iov, count, "backing");
    finish();
    if (!ok) failure("backing snapshot failed or exceeded limit");
}
static uint64_t enter(const char *type, const char *format, ...) {
    pthread_mutex_lock(&mutex);
    uint64_t seq = call_start(type);
    if (seq) {
        va_list args; va_start(args, format); vfprintf(events, format, args); va_end(args);
        fputs(",\"blobs\":[]", events); finish();
    }
    pthread_mutex_unlock(&mutex);
    return seq;
}
static void return_context(void) {
    fprintf(events, ",\"threadId\":%" PRIu64 ",\"parentCallSeq\":%" PRIu64, thread_id, stack_depth ? call_stack[stack_depth - 1] : 0);
}
static void returned(const char *type, uint64_t call, int result) {
    pthread_mutex_lock(&mutex);
    call_pop(call);
    if (start(type, "return")) {
        return_context();
        fprintf(events, ",\"callSeq\":%" PRIu64 ",\"result\":%d,\"blobs\":[]", call, result); finish();
    }
    pthread_mutex_unlock(&mutex);
}
static void load_real_library(void) {
    const char *path = getenv("VIRGL_CAPTURE_REAL_LIBRARY");
    if (path) real_library = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!real_library) {
        fprintf(stderr, "virgl capture: cannot load explicit real library: %s\n", dlerror());
        _exit(125);
    }
}
static void *symbol(const char *name) {
    /* QEMU loads its graphics DSO RTLD_LOCAL, outside RTLD_NEXT's lookup scope. */
    pthread_once(&library_once, load_real_library);
    void *p = dlsym(real_library, name);
    if (!p) { fprintf(stderr, "virgl capture: missing real symbol %s\n", name); _exit(125); }
    return p;
}
#define REAL(name) __typeof__(&name) real = (__typeof__(&name))symbol(#name)

static void write_fence(void *cookie, uint32_t fence) {
    uint64_t call = enter("write_fence", ",\"fenceId\":%u", fence);
    original_callbacks.write_fence(cookie, fence);
    returned("write_fence", call, 0);
}
static void write_context_fence(void *cookie, uint32_t ctx, uint32_t ring, uint64_t fence) {
    uint64_t call = enter("write_context_fence", ",\"ctxId\":%u,\"ringId\":%u,\"fenceId\":%" PRIu64, ctx, ring, fence);
    original_callbacks.write_context_fence(cookie, ctx, ring, fence);
    returned("write_context_fence", call, 0);
}
int virgl_renderer_init(void *cookie, int flags, struct virgl_renderer_callbacks *cb) {
    REAL(virgl_renderer_init);
    uint64_t call = enter("init", ",\"flags\":%d,\"callbackVersion\":%d", flags, cb ? cb->version : -1);
    if (!cb || cb->version < 1 || cb->version > 4) {
        pthread_mutex_lock(&mutex); failure("unsupported callback version"); pthread_mutex_unlock(&mutex);
        int result = real(cookie, flags, cb); returned("init", call, result); return result;
    }
    size_t bytes = cb->version == 1 ? offsetof(struct virgl_renderer_callbacks, get_drm_fd) :
        cb->version == 2 ? offsetof(struct virgl_renderer_callbacks, write_context_fence) :
        cb->version == 3 ? offsetof(struct virgl_renderer_callbacks, get_egl_display) : sizeof(*cb);
    memset(&original_callbacks, 0, sizeof(original_callbacks));
    memcpy(&original_callbacks, cb, bytes); wrapped_callbacks = original_callbacks;
    if (cb->write_fence) wrapped_callbacks.write_fence = write_fence;
    if (original_callbacks.write_context_fence) wrapped_callbacks.write_context_fence = write_context_fence;
    int result = real(cookie, flags, &wrapped_callbacks); returned("init", call, result); return result;
}

int virgl_renderer_context_create_with_flags(uint32_t ctx, uint32_t flags, uint32_t length, const char *name) {
    REAL(virgl_renderer_context_create_with_flags);
    pthread_mutex_lock(&mutex);
    uint64_t call = call_start("context_create_with_flags");
    if (call) {
        fprintf(events, ",\"ctxId\":%u,\"flags\":%u,\"nameBytes\":%u,\"blobs\":[", ctx, flags, length);
        bool ok = blob("context_name", name, length); fputs("]", events); finish();
        if (!ok) failure("context name capture failed");
    }
    pthread_mutex_unlock(&mutex);
    int result = real(ctx, flags, length, name); returned("context_create_with_flags", call, result); return result;
}
int virgl_renderer_context_create(uint32_t ctx, uint32_t length, const char *name) {
    REAL(virgl_renderer_context_create);
    pthread_mutex_lock(&mutex);
    uint64_t call = call_start("context_create");
    if (call) {
        fprintf(events, ",\"ctxId\":%u,\"nameBytes\":%u,\"blobs\":[", ctx, length);
        bool ok = blob("context_name", name, length); fputs("]", events); finish();
        if (!ok) failure("context name capture failed");
    }
    pthread_mutex_unlock(&mutex);
    int result = real(ctx, length, name); returned("context_create", call, result); return result;
}
void virgl_renderer_context_destroy(uint32_t ctx) {
    REAL(virgl_renderer_context_destroy); uint64_t call = enter("context_destroy", ",\"ctxId\":%u", ctx);
    real(ctx); returned("context_destroy", call, 0);
}
int virgl_renderer_resource_create(struct virgl_renderer_resource_create_args *a, struct iovec *iov, uint32_t count) {
    REAL(virgl_renderer_resource_create);
    uint64_t call = enter("resource_create", ",\"resourceId\":%u,\"target\":%u,\"format\":%u,\"bind\":%u,\"width\":%u,\"height\":%u,\"depth\":%u,\"arraySize\":%u,\"lastLevel\":%u,\"nrSamples\":%u,\"flags\":%u,\"iovCount\":%u", a->handle,a->target,a->format,a->bind,a->width,a->height,a->depth,a->array_size,a->last_level,a->nr_samples,a->flags,count);
    pthread_mutex_lock(&mutex); snapshot(a->handle, iov, count, "create"); pthread_mutex_unlock(&mutex);
    int result = real(a, iov, count);
    pthread_mutex_lock(&mutex); if (!result) save_iov(a->handle, iov, count); pthread_mutex_unlock(&mutex);
    returned("resource_create", call, result); return result;
}
void virgl_renderer_resource_unref(uint32_t id) {
    REAL(virgl_renderer_resource_unref); uint64_t call = enter("resource_unref", ",\"resourceId\":%u", id);
    real(id);
    pthread_mutex_lock(&mutex); struct backing *b = find_backing(id, false);
    if (b) { free(b->iov); memset(b, 0, sizeof(*b)); } pthread_mutex_unlock(&mutex);
    returned("resource_unref", call, 0);
}
int virgl_renderer_resource_attach_iov(int id, struct iovec *iov, int count) {
    REAL(virgl_renderer_resource_attach_iov);
    uint64_t call = enter("resource_attach_iov", ",\"resourceId\":%u,\"iovCount\":%d", (uint32_t)id, count);
    pthread_mutex_lock(&mutex); snapshot(id, iov, (unsigned)count, "attach"); pthread_mutex_unlock(&mutex);
    int result = real(id, iov, count);
    pthread_mutex_lock(&mutex); if (!result) save_iov(id, iov, (unsigned)count); pthread_mutex_unlock(&mutex);
    returned("resource_attach_iov", call, result); return result;
}
void virgl_renderer_resource_detach_iov(int id, struct iovec **iov, int *count) {
    REAL(virgl_renderer_resource_detach_iov); uint64_t call = enter("resource_detach_iov", ",\"resourceId\":%u", (uint32_t)id);
    real(id, iov, count);
    pthread_mutex_lock(&mutex); save_iov(id, NULL, 0); pthread_mutex_unlock(&mutex);
    returned("resource_detach_iov", call, 0);
}
void virgl_renderer_ctx_attach_resource(int ctx, int id) {
    REAL(virgl_renderer_ctx_attach_resource); uint64_t call = enter("ctx_attach_resource", ",\"ctxId\":%d,\"resourceId\":%u", ctx, (uint32_t)id);
    real(ctx,id); returned("ctx_attach_resource",call,0);
}
void virgl_renderer_ctx_detach_resource(int ctx, int id) {
    REAL(virgl_renderer_ctx_detach_resource); uint64_t call = enter("ctx_detach_resource", ",\"ctxId\":%d,\"resourceId\":%u", ctx, (uint32_t)id);
    real(ctx,id); returned("ctx_detach_resource",call,0);
}
int virgl_renderer_submit_cmd(void *buffer, int ctx, int ndw) {
    REAL(virgl_renderer_submit_cmd);
    pthread_mutex_lock(&mutex);
    setup();
    for (unsigned i=0; i<MAX_RESOURCES; i++) if(backings[i].live)
        snapshot(backings[i].id,backings[i].iov,backings[i].count,"submit");
    uint64_t call = call_start("submit_cmd");
    if(call) {
        fprintf(events, ",\"ctxId\":%d,\"ndw\":%d,\"blobs\":[",ctx,ndw);
        bool ok = ndw >= 0 && (uint64_t)ndw*4 <= MAX_BLOB && blob("command",buffer,(size_t)ndw*4);
        fputs("]",events); finish(); if(!ok) failure("submit capture failed");
    }
    pthread_mutex_unlock(&mutex);
    int result=real(buffer,ctx,ndw); returned("submit_cmd",call,result); return result;
}

static uint64_t transfer_enter(const char *type,uint32_t id,uint32_t ctx,int level,uint32_t stride,uint32_t layer,struct virgl_box *box,uint64_t offset,struct iovec *iov,unsigned count) {
    uint64_t call=enter(type,",\"resourceId\":%u,\"ctxId\":%u,\"level\":%d,\"stride\":%u,\"layerStride\":%u,\"offset\":%" PRIu64 ",\"box\":{\"x\":%u,\"y\":%u,\"z\":%u,\"w\":%u,\"h\":%u,\"d\":%u},\"iovCount\":%u,\"explicitIov\":%s",id,ctx,level,stride,layer,offset,box->x,box->y,box->z,box->w,box->h,box->d,count,iov?"true":"false");
    pthread_mutex_lock(&mutex);
    if (iov) snapshot(id,iov,count,"transfer_before");
    else { struct backing *b=find_backing(id,false); if(b) snapshot(id,b->iov,b->count,"transfer_before"); }
    pthread_mutex_unlock(&mutex); return call;
}
int virgl_renderer_transfer_write_iov(uint32_t id,uint32_t ctx,int level,uint32_t stride,uint32_t layer,struct virgl_box *box,uint64_t offset,struct iovec *iov,unsigned count) {
    REAL(virgl_renderer_transfer_write_iov); uint64_t call=transfer_enter("transfer_write_iov",id,ctx,level,stride,layer,box,offset,iov,count);
    int result=real(id,ctx,level,stride,layer,box,offset,iov,count); returned("transfer_write_iov",call,result); return result;
}
int virgl_renderer_transfer_read_iov(uint32_t id,uint32_t ctx,uint32_t level,uint32_t stride,uint32_t layer,struct virgl_box *box,uint64_t offset,struct iovec *iov,int count) {
    REAL(virgl_renderer_transfer_read_iov); uint64_t call=transfer_enter("transfer_read_iov",id,ctx,(int)level,stride,layer,box,offset,iov,(unsigned)count);
    int result=real(id,ctx,level,stride,layer,box,offset,iov,count);
    pthread_mutex_lock(&mutex);
    if(iov) snapshot(id,iov,(unsigned)count,"transfer_after");
    else {struct backing *b=find_backing(id,false); if(b) snapshot(id,b->iov,b->count,"transfer_after");}
    pthread_mutex_unlock(&mutex); returned("transfer_read_iov",call,result); return result;
}
void virgl_renderer_get_cap_set(uint32_t set,uint32_t *version,uint32_t *size) {
    REAL(virgl_renderer_get_cap_set); uint64_t call=enter("get_cap_set",",\"set\":%u",set); real(set,version,size);
    pthread_mutex_lock(&mutex); call_pop(call);
    if(start("get_cap_set","return")) { return_context(); fprintf(events,",\"callSeq\":%" PRIu64 ",\"version\":%u,\"bytes\":%u,\"result\":0,\"blobs\":[]",call,*version,*size);finish(); }
    pthread_mutex_unlock(&mutex);
}
void virgl_renderer_fill_caps(uint32_t set,uint32_t version,void *caps) {
    REAL(virgl_renderer_fill_caps); uint64_t call=enter("fill_caps",",\"set\":%u,\"version\":%u",set,version);
    real(set,version,caps);
    __typeof__(&virgl_renderer_get_cap_set) get=(__typeof__(get))symbol("virgl_renderer_get_cap_set");
    uint32_t maxver,size; get(set,&maxver,&size);
    pthread_mutex_lock(&mutex); call_pop(call);
    if(start("fill_caps","return")) {
        return_context();
        fprintf(events,",\"callSeq\":%" PRIu64 ",\"result\":0,\"blobs\":[",call);
        bool ok=blob("capset",caps,size); fputs("]",events);finish();if(!ok)failure("capset capture failed");
    } pthread_mutex_unlock(&mutex);
}
int virgl_renderer_create_fence(int fence,uint32_t ctx) {
    REAL(virgl_renderer_create_fence); uint64_t call=enter("create_fence",",\"fenceId\":%u,\"ctxId\":%u",(uint32_t)fence,ctx);
    int result=real(fence,ctx);returned("create_fence",call,result);return result;
}
int virgl_renderer_context_create_fence(uint32_t ctx,uint32_t flags,uint32_t ring,uint64_t fence) {
    REAL(virgl_renderer_context_create_fence);uint64_t call=enter("context_create_fence",",\"ctxId\":%u,\"flags\":%u,\"ringId\":%u,\"fenceId\":%" PRIu64,ctx,flags,ring,fence);
    int result=real(ctx,flags,ring,fence);returned("context_create_fence",call,result);return result;
}
void virgl_renderer_cleanup(void *cookie) {
    REAL(virgl_renderer_cleanup);uint64_t call=enter("cleanup","");real(cookie);
    cleanup_seen=true;returned("cleanup",call,0);
}
void virgl_renderer_reset(void) {
    REAL(virgl_renderer_reset);uint64_t call=enter("reset","");real();
    pthread_mutex_lock(&mutex);
    for(unsigned i=0;i<MAX_RESOURCES;i++){free(backings[i].iov);memset(&backings[i],0,sizeof(backings[i]));}
    pthread_mutex_unlock(&mutex);returned("reset",call,0);
}

/* These interfaces are outside the advertised no-blob/no-context-init profile.
 * Fail the recording explicitly if a caller uses one, while preserving its call. */
int virgl_renderer_resource_create_blob(const struct virgl_renderer_resource_create_blob_args *args) {
    REAL(virgl_renderer_resource_create_blob);
    pthread_mutex_lock(&mutex);setup();failure("blob resources are outside capture profile");pthread_mutex_unlock(&mutex);
    return real(args);
}

__attribute__((destructor)) static void finalize(void) {
    pthread_mutex_lock(&mutex);
    if(events) {
        if(active_calls) failure("process exited with active calls");
        /* Reserve bounded footer overhead rather than reporting success after
         * the final API return consumed the remaining event-byte budget. */
        if(event_bytes > max_event_bytes || max_event_bytes - event_bytes < 1024)
            failure("insufficient event budget for footer");
        fprintf(events,"{\"seq\":%" PRIu64 ",\"type\":\"end\",\"complete\":%s,\"normalExit\":true,\"cleanupSeen\":%s,\"openCalls\":%" PRIu64 ",\"droppedRecords\":0,\"blobBytes\":%" PRIu64 ",\"workload\":",++sequence,failed?"false":"true",cleanup_seen?"true":"false",active_calls,blob_bytes);
        quoted(events,workload?workload:"",workload?strlen(workload):0);fputs(",\"blobs\":[]}\n",events);
        FILE *closing=events; events=NULL;
        if(fclose(closing)) failure("final close failed");
    }
    pthread_mutex_unlock(&mutex);
}
