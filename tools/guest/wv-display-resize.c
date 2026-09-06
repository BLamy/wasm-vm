// Pinned Weston 12.0.4 / DRM / pixman module. No compositor or client restart.
// This is deliberately a pinned backend-ABI integration, not a portable Weston
// plugin: build-display-tools.sh checks the upstream source and installed ABI.
#define _POSIX_C_SOURCE 200809L
#include "libweston/backend-drm/drm-internal.h"
#include <ctype.h>
#include <dirent.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "wv-display-mode.h"

#define MAX_OUTPUTS 16
// Guest monotonic time advances with emulated work, not browser wall time. A
// short bounded guest timer keeps one-pixel/no-head-signal changes responsive.
#define POLL_MS 10
struct resize_slot {
    struct weston_output *output;
    struct wl_listener destroyed;
    // The backend owns every inserted mode and frees it on output destruction.
    // While live we prune only our own unused entries, including their KMS blob.
    struct drm_mode *owned[2];
};
struct resize_context {
    struct weston_compositor *compositor;
    const struct weston_drm_output_api *api;
    struct wl_event_source *timer;
    struct wl_listener destroyed;
    struct resize_slot slots[MAX_OUTPUTS];
};

static bool preferred_mode(const char *name, struct wv_display_mode *mode) {
    if (!name || !*name || strlen(name) > 63) return false;
    for (const unsigned char *p=(const unsigned char *)name; *p; p++)
        if (!(isalnum(*p) || *p=='-' || *p=='_' || *p=='.')) return false;
    DIR *dir = opendir("/sys/class/drm");
    if (!dir) return false;
    bool valid = false;
    struct dirent *entry;
    for (int i=0; i<256 && (entry=readdir(dir)); i++) {
        if (strncmp(entry->d_name,"card",4)) continue;
        const char *p = entry->d_name + 4;
        if (!isdigit((unsigned char)*p)) continue;
        while (isdigit((unsigned char)*p)) p++;
        if (*p!='-' || strcmp(p+1,name)) continue;
        char path[512];
        int n = snprintf(path,sizeof path,"/sys/class/drm/%s/edid",entry->d_name);
        if (n<0 || (size_t)n>=sizeof path) break;
        int fd = open(path,O_RDONLY|O_CLOEXEC);
        if (fd<0) continue;
        uint8_t bytes[128];
        ssize_t length = read(fd,bytes,sizeof bytes);
        close(fd);
        valid = length>=0 && wv_display_mode_decode(bytes,(size_t)length,mode);
        break;
    }
    closedir(dir);
    return valid;
}

static void output_destroyed(struct wl_listener *listener, void *data) {
    (void)data;
    struct resize_slot *slot = wl_container_of(listener,slot,destroyed);
    wl_list_remove(&slot->destroyed.link);
    *slot = (struct resize_slot){0};
}

static struct resize_slot *slot_for(struct resize_context *ctx, struct weston_output *output) {
    for (int i=0; i<MAX_OUTPUTS; i++) if (ctx->slots[i].output==output) return &ctx->slots[i];
    for (int i=0; i<MAX_OUTPUTS; i++) if (!ctx->slots[i].output) {
        struct resize_slot *slot = &ctx->slots[i];
        slot->output=output;
        slot->destroyed.notify=output_destroyed;
        weston_output_add_destroy_listener(output,&slot->destroyed);
        return slot;
    }
    return NULL;
}

static bool mode_pending(const struct drm_output *output) {
    return output->page_flip_pending || output->atomic_complete_pending ||
           output->mode_switch_pending;
}

static void prune_modes(struct resize_slot *slot, struct drm_output *output) {
    if (mode_pending(output)) return;
    for (size_t i=0; i<2; i++) {
        struct drm_mode *mode=slot->owned[i];
        if (!mode || &mode->base==output->base.current_mode ||
            &mode->base==output->base.native_mode ||
            &mode->base==output->base.original_mode) continue;
        if (mode->blob_id && drmModeDestroyPropertyBlob(output->device->drm.fd,mode->blob_id))
            continue; // Keep ownership on a failed destroy; never grow the pool.
        wl_list_remove(&mode->base.link);
        free(mode);
        slot->owned[i]=NULL;
    }
}

static struct drm_mode *preferred_drm_mode(struct resize_slot *slot,
                                          struct drm_output *output,
                                          struct wv_display_mode preferred) {
    // Read the backend's connector cache only after it matches the newer EDID.
    // A sysfs hotplug can precede udev dispatch; never modeset the stale cache.
    struct weston_head *base=weston_output_get_first_head(&output->base);
    struct drm_head *head=container_of(base,struct drm_head,base);
    const drmModeConnector *conn=head->connector.conn;
    if (!conn || conn->count_modes<0 || conn->count_modes>256) return NULL;
    for (int i=0; i<conn->count_modes; i++) {
        const drmModeModeInfo *info=&conn->modes[i];
        if (!(info->type&DRM_MODE_TYPE_PREFERRED) ||
            info->hdisplay!=preferred.width || info->vdisplay!=preferred.height ||
            !info->clock || info->htotal<=info->hdisplay || info->vtotal<=info->vdisplay ||
            (info->flags&(DRM_MODE_FLAG_INTERLACE|DRM_MODE_FLAG_DBLSCAN)) || info->vscan>1)
            continue;
        struct drm_mode *mode;
        wl_list_for_each(mode,&output->base.mode_list,base.link)
            if (!memcmp(&mode->mode_info,info,sizeof *info)) return mode;
        size_t index=0;
        while (index<2 && slot->owned[index]) index++;
        if (index==2) return NULL;
        mode=calloc(1,sizeof *mode);
        if (!mode) return NULL;
        mode->base.width=info->hdisplay;
        mode->base.height=info->vdisplay;
        mode->base.refresh=((uint64_t)info->clock*1000000/info->htotal+info->vtotal/2)/info->vtotal;
        mode->base.flags=WL_OUTPUT_MODE_PREFERRED;
        mode->base.aspect_ratio=WESTON_MODE_PIC_AR_NONE;
        mode->mode_info=*info;
        wl_list_insert(output->base.mode_list.prev,&mode->base.link);
        slot->owned[index]=mode;
        return mode;
    }
    return NULL;
}

static void apply_mode(struct resize_context *ctx, struct resize_slot *slot,
                       struct wv_display_mode preferred) {
    (void)ctx;
    struct weston_output *base=slot->output;
    struct drm_output *output=container_of(base,struct drm_output,base);
    if (!base->enabled || base->destroying || output->virtual ||
        output->destroy_pending || output->disable_pending || mode_pending(output)) return;
    prune_modes(slot,output);
    if (!base->current_mode || !base->switch_mode) return;
    if (base->native_mode && base->native_mode->width==preferred.width &&
        base->native_mode->height==preferred.height) return;
    struct drm_mode *mode=preferred_drm_mode(slot,output,preferred);
    if (!mode) return;
    // The actual backend mode switch updates pixman buffers; libweston updates
    // geometry, input clamping, wl_output events, and desktop-shell listeners.
    // Crucially the output/global is NEVER disabled, removed or recreated here.
    int result=weston_output_mode_set_native(base,&mode->base,base->current_scale);
    if (slot->output!=base) return; // Signals may cause final output destruction.
    if (result<0) {
        // Weston 12's DRM switch can replace current_mode and tear down pixman
        // before failing allocation. Retrying that mode is a false-success no-op;
        // normal compositor teardown could also touch the freed renderer state.
        // This is a fatal backend fault, never a successful resize. Fail-stop
        // immediately, letting the existing bounded supervisor handle the exit.
        // Successful transitions never use this path or restart the compositor.
        static const char fatal[]="WV_DISPLAY_FATAL native mode switch failed; no retry or renderer teardown\n";
        (void)write(STDERR_FILENO,fatal,sizeof fatal-1);
        _exit(70);
    }
    prune_modes(slot,output);
    weston_log("WV_DISPLAY_APPLIED output=%s width=%d height=%d\n",
               base->name,base->current_mode->width,base->current_mode->height);
}

static int poll_modes(void *data) {
    struct resize_context *ctx=data;
    struct weston_head *head=NULL;
    int visited=0;
    while (visited++<MAX_OUTPUTS &&
           (head=weston_compositor_iterate_heads(ctx->compositor,head))) {
        if (!weston_head_is_connected(head)) continue;
        struct weston_output *output=weston_head_get_output(head);
        if (!output) continue;
        // Cloned heads need a joint modeset policy, which this module does not own.
        struct weston_head *first=weston_output_get_first_head(output);
        if (head!=first || weston_output_iterate_heads(output,first)) continue;
        struct wv_display_mode mode;
        if (!preferred_mode(weston_head_get_name(head),&mode)) continue;
        struct resize_slot *slot=slot_for(ctx,output);
        if (slot) apply_mode(ctx,slot,mode);
    }
    wl_event_source_timer_update(ctx->timer,POLL_MS);
    return 0;
}

static void compositor_destroyed(struct wl_listener *listener, void *data) {
    (void)data;
    struct resize_context *ctx=wl_container_of(listener,ctx,destroyed);
    wl_event_source_remove(ctx->timer);
    wl_list_remove(&ctx->destroyed.link);
    for (int i=0;i<MAX_OUTPUTS;i++) if (ctx->slots[i].output)
        wl_list_remove(&ctx->slots[i].destroyed.link);
    free(ctx);
}

WL_EXPORT int wet_module_init(struct weston_compositor *compositor,int *argc,char *argv[]) {
    (void)argc;(void)argv;
    int major,minor,micro;
    weston_version(&major,&minor,&micro);
    const struct weston_drm_output_api *api=weston_drm_output_get_api(compositor);
    if (major!=12 || minor!=0 || micro!=4 || !api || !compositor->renderer) {
        weston_log("WV_DISPLAY requires pinned Weston 12.0.4 DRM\n");
        return -1;
    }
    struct resize_context *ctx=calloc(1,sizeof *ctx);
    if (!ctx) return -1;
    ctx->compositor=compositor;ctx->api=api;
    ctx->timer=wl_event_loop_add_timer(wl_display_get_event_loop(compositor->wl_display),poll_modes,ctx);
    if (!ctx->timer) {free(ctx);return -1;}
    ctx->destroyed.notify=compositor_destroyed;
    wl_signal_add(&compositor->destroy_signal,&ctx->destroyed);
    wl_event_source_timer_update(ctx->timer,POLL_MS);
    weston_log("WV_DISPLAY enabled bounded %dms EDID watcher\n",POLL_MS);
    return 0;
}
