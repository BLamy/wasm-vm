// Actual adapter, actual hash-pinned Weston structs. Only external services are
// stubbed: this proves bounded ownership/state transitions, not guest rendering.
#define _POSIX_C_SOURCE 200809L
#include <dirent.h>
static DIR *counted_opendir(const char *path);
#define opendir counted_opendir
#include "../../guest/wv-display-resize.c"
#undef opendir
#include <stdarg.h>
#include <sys/wait.h>

static unsigned calls, destroys, next_blob, checks;
static bool fail_switch, fail_blob, destroy_in_switch, fail_timer, wrong_version, no_api;
static struct resize_context *timer_context;
static const struct weston_drm_output_api test_api={0};
static int timer_token;
static unsigned sysfs_opens;
static struct weston_head *poll_head;
#define CHECK(expr) do { checks++; if (!(expr)) { fprintf(stderr,"FAIL %s:%d: %s\n",__FILE__,__LINE__,#expr); abort(); } } while (0)

static DIR *counted_opendir(const char *path) {
    CHECK(!strcmp(path,"/sys/class/drm"));sysfs_opens++;return NULL;
}

void wl_list_init(struct wl_list *list) { list->prev=list; list->next=list; }
void wl_list_insert(struct wl_list *list,struct wl_list *entry) {
    entry->prev=list;entry->next=list->next;list->next->prev=entry;list->next=entry;
}
void wl_list_remove(struct wl_list *entry) {
    entry->prev->next=entry->next;entry->next->prev=entry->prev;
    entry->prev=NULL;entry->next=NULL;
}
int wl_list_empty(const struct wl_list *list) { return list->next==list; }
int weston_log(const char *fmt,...) { (void)fmt; return 0; }
void weston_output_add_destroy_listener(struct weston_output *output,struct wl_listener *listener) {
    wl_list_insert(output->user_destroy_signal.listener_list.prev,&listener->link);
}
struct weston_head *weston_output_get_first_head(struct weston_output *output) {
    if (wl_list_empty(&output->head_list)) return NULL;
    return container_of(output->head_list.next,struct weston_head,output_link);
}
struct weston_head *weston_output_iterate_heads(struct weston_output *output,struct weston_head *head) {
    if (!head) return weston_output_get_first_head(output);
    if (head->output_link.next==&output->head_list) return NULL;
    return container_of(head->output_link.next,struct weston_head,output_link);
}
struct weston_head *weston_compositor_iterate_heads(struct weston_compositor *compositor,struct weston_head *head) {
    (void)compositor;return head?NULL:poll_head;
}
bool weston_head_is_connected(struct weston_head *head) { return head->connected; }
const char *weston_head_get_name(struct weston_head *head) { return head->name; }
struct weston_output *weston_head_get_output(struct weston_head *head) { return head->output; }
const void *weston_plugin_api_get(struct weston_compositor *compositor,const char *name,size_t size) {
    (void)compositor; CHECK(!strcmp(name,WESTON_DRM_OUTPUT_API_NAME));CHECK(size==sizeof test_api);
    return no_api?NULL:&test_api;
}
void weston_version(int *major,int *minor,int *micro) { *major=12;*minor=0;*micro=wrong_version?5:4; }
struct wl_event_loop *wl_display_get_event_loop(struct wl_display *display) { return (void *)display; }
struct wl_event_source *wl_event_loop_add_timer(struct wl_event_loop *loop,wl_event_loop_timer_func_t fn,void *data) {
    (void)loop;CHECK(fn==poll_modes);if (fail_timer) return NULL;
    timer_context=data;return (void *)&timer_token;
}
int wl_event_source_timer_update(struct wl_event_source *source,int ms) {
    CHECK(source==(void *)&timer_token);CHECK(ms==POLL_MS);return 0;
}
int wl_event_source_remove(struct wl_event_source *source) { CHECK(source==(void *)&timer_token);return 0; }
int drmModeDestroyPropertyBlob(int fd,uint32_t id) {
    CHECK(fd==47);CHECK(id>0);if (fail_blob) return -1;destroys++;return 0;
}

static void destroy_output(struct weston_output *base) {
    while (!wl_list_empty(&base->user_destroy_signal.listener_list)) {
        struct wl_listener *listener=container_of(base->user_destroy_signal.listener_list.next,struct wl_listener,link);
        listener->notify(listener,base);
    }
    while (!wl_list_empty(&base->mode_list)) {
        struct drm_mode *mode=container_of(base->mode_list.next,struct drm_mode,base.link);
        wl_list_remove(&mode->base.link);free(mode);
    }
    free(container_of(base,struct drm_output,base));
}
static int unused_backend_switch(struct weston_output *base,struct weston_mode *mode) {
    (void)base;(void)mode;abort();
}
int weston_output_mode_set_native(struct weston_output *base,struct weston_mode *mode,int32_t scale) {
    calls++;
    CHECK(base->enabled && !base->destroying);
    CHECK(!mode_pending(container_of(base,struct drm_output,base)));
    CHECK(scale==1);
    if (destroy_in_switch) { destroy_output(base);return 0; }
    if (fail_switch) {
        // Reproduce the pinned backend's mutation BEFORE failure, including its
        // now-dangling renderer pointer. A same-mode retry must not run here.
        CHECK(calls==1);
        base->current_mode=mode;
        void *renderer=malloc(64);CHECK(renderer);free(renderer);
        base->renderer_state=renderer;
        return -1;
    }
    if (!base->original_mode) {
        base->current_mode=mode;base->width=mode->width;base->height=mode->height;
    }
    base->native_mode=mode;
    struct drm_mode *drm=container_of(mode,struct drm_mode,base);
    if (!drm->blob_id) drm->blob_id=++next_blob;
    return 0;
}

struct fixture {
    struct resize_context context;
    struct drm_device device;
    struct drm_head head;
    drmModeConnector connector;
    drmModeModeInfo info;
    struct drm_output *output;
    struct resize_slot *slot;
};
static drmModeModeInfo mode_info(int width,int height) {
    return (drmModeModeInfo){.clock=40000,.hdisplay=width,.htotal=width+160,
        .hsync_start=width+40,.hsync_end=width+80,.vdisplay=height,.vtotal=height+30,
        .vsync_start=height+3,.vsync_end=height+6,.type=DRM_MODE_TYPE_PREFERRED};
}
static void init(struct fixture *f) {
    memset(f,0,sizeof *f);calls=0;fail_switch=false;fail_blob=false;destroy_in_switch=false;
    f->output=calloc(1,sizeof *f->output);CHECK(f->output);
    f->output->device=&f->device;f->device.drm.fd=47;
    struct weston_output *base=&f->output->base;
    base->name="Virtual-1";base->enabled=true;base->current_scale=1;
    base->switch_mode=unused_backend_switch;
    wl_list_init(&base->mode_list);wl_list_init(&base->head_list);
    wl_signal_init(&base->user_destroy_signal);
    f->head.base.output=base;f->head.base.connected=true;f->head.base.name="Virtual-1";
    wl_list_insert(&base->head_list,&f->head.base.output_link);
    f->head.connector.conn=&f->connector;f->connector.count_modes=1;f->connector.modes=&f->info;
    f->info=mode_info(1280,800);
    struct drm_mode *mode=calloc(1,sizeof *mode);CHECK(mode);
    mode->base.width=1280;mode->base.height=800;mode->mode_info=f->info;
    base->current_mode=base->native_mode=&mode->base;base->width=1280;base->height=800;
    wl_list_insert(&base->mode_list,&mode->base.link);
    f->slot=slot_for(&f->context,base);CHECK(f->slot);CHECK(slot_for(&f->context,base)==f->slot);
}
static unsigned mode_count(struct fixture *f) {
    unsigned n=0;struct weston_mode *mode;
    wl_list_for_each(mode,&f->output->base.mode_list,link) n++;
    return n;
}
static void request(struct fixture *f,int width,int height,bool update_cache) {
    if (update_cache) f->info=mode_info(width,height);
    apply_mode(&f->context,f->slot,(struct wv_display_mode){width,height});
    CHECK(f->output->base.enabled);CHECK(mode_count(f)<=3);
}
static void finish(struct fixture *f) {
    destroy_output(&f->output->base);CHECK(f->slot->output==NULL);
    CHECK(!f->slot->owned[0]&&!f->slot->owned[1]);
}
static uint32_t rng(uint32_t *state) { *state^=*state<<13;*state^=*state>>17;*state^=*state<<5;return *state; }

static void test_transitions(void) {
    struct fixture f;init(&f);
    request(&f,1280,800,true);CHECK(calls==0);
    request(&f,803,603,false);CHECK(calls==0);CHECK(mode_count(&f)==1);
    request(&f,803,603,true);CHECK(calls==1);CHECK(f.output->base.width==803);
    request(&f,803,603,true);CHECK(calls==1);
    for (unsigned bit=0;bit<3;bit++) {
        f.output->page_flip_pending=bit==0;
        f.output->atomic_complete_pending=bit==1;
        f.output->mode_switch_pending=bit==2;
        unsigned before=calls;
        for (int i=0;i<1000;i++) request(&f,640+i%2,480+i%2,true);
        CHECK(calls==before);CHECK(f.output->base.width==803);
    }
    f.output->page_flip_pending=f.output->atomic_complete_pending=f.output->mode_switch_pending=false;
    request(&f,802,601,true);CHECK(f.output->base.width==802);
    uint32_t seed=0x225c001;
    for (int i=0;i<10000;i++) {
        int w=640+rng(&seed)%1921,h=480+rng(&seed)%1121;
        request(&f,w,h,true);CHECK(f.output->base.width==w&&f.output->base.height==h);
        CHECK(mode_count(&f)<=2);
    }
    request(&f,1280,800,true);CHECK(mode_count(&f)==1);
    finish(&f);
}
static void test_slot_bound(void) {
    struct resize_context shared={0};struct fixture fixtures[MAX_OUTPUTS+1];
    for (int i=0;i<=MAX_OUTPUTS;i++) {
        init(&fixtures[i]);
        CHECK((slot_for(&shared,&fixtures[i].output->base)!=NULL)==(i<MAX_OUTPUTS));
    }
    finish(&fixtures[0]);
    CHECK(slot_for(&shared,&fixtures[MAX_OUTPUTS].output->base)!=NULL);
    for (int i=1;i<=MAX_OUTPUTS;i++)finish(&fixtures[i]);
    for (int i=0;i<MAX_OUTPUTS;i++)CHECK(!shared.slots[i].output);
}
static void test_failures(void) {
    struct fixture f;init(&f);
    pid_t child=fork();CHECK(child>=0);
    if (!child) {
        fail_switch=true;
        request(&f,803,603,true);
        _exit(99); // Reaching this would falsely recover the destroyed renderer.
    }
    int status;CHECK(waitpid(child,&status,0)==child);
    CHECK(WIFEXITED(status)&&WEXITSTATUS(status)==70);
    request(&f,804,603,true);CHECK(calls==1);
    fail_blob=true;
    request(&f,805,603,true);CHECK(f.output->base.width==805);
    unsigned before=calls;
    for (int i=0;i<1000;i++) request(&f,806+i%2,603,true);
    CHECK(calls==before);CHECK(mode_count(&f)==3);
    fail_blob=false;request(&f,802,601,true);CHECK(f.output->base.width==802);CHECK(mode_count(&f)==2);
    f.output->base.destroying=true;before=calls;request(&f,800,600,true);CHECK(calls==before);
    f.output->base.destroying=false;f.output->disable_pending=true;request(&f,800,600,true);CHECK(calls==before);
    f.output->disable_pending=false;f.output->destroy_pending=true;request(&f,800,600,true);CHECK(calls==before);
    f.output->destroy_pending=false;
    f.info=mode_info(800,600);f.info.htotal=0;
    request(&f,800,600,false);CHECK(calls==before);
    f.connector.count_modes=257;request(&f,800,600,true);CHECK(calls==before);
    f.connector.count_modes=1;
    finish(&f);
    init(&f);destroy_in_switch=true;
    f.info=mode_info(803,603);
    apply_mode(&f.context,f.slot,(struct wv_display_mode){803,603});
    CHECK(!f.slot->output);CHECK(!f.slot->owned[0]&&!f.slot->owned[1]);
    destroy_in_switch=false;
}
static void test_init_cleanup(void) {
    struct weston_compositor compositor={0};wl_signal_init(&compositor.destroy_signal);
    compositor.renderer=(void *)&timer_token;
    wrong_version=true;CHECK(wet_module_init(&compositor,NULL,NULL)==-1);wrong_version=false;
    no_api=true;CHECK(wet_module_init(&compositor,NULL,NULL)==-1);no_api=false;
    fail_timer=true;CHECK(wet_module_init(&compositor,NULL,NULL)==-1);fail_timer=false;
    CHECK(wet_module_init(&compositor,NULL,NULL)==0);CHECK(timer_context);
    CHECK(poll_modes(timer_context)==0);
    compositor_destroyed(&timer_context->destroyed,&compositor);timer_context=NULL;
    CHECK(wl_list_empty(&compositor.destroy_signal.listener_list));
}
static void test_idle_poll(void) {
    struct fixture f;init(&f);f.context.timer=(void *)&timer_token;
    poll_head=&f.head.base;sysfs_opens=0;
    for(int i=0;i<10000;i++)CHECK(poll_modes(&f.context)==0);
    CHECK(sysfs_opens==0);CHECK(calls==0);
    // A cached one-pixel change prompts an independent EDID read; cached mode
    // dimensions alone must never authorize the switch (the test read fails).
    f.info=mode_info(1281,800);CHECK(poll_modes(&f.context)==0);
    CHECK(sysfs_opens==1);CHECK(calls==0);
    f.info.clock=0;CHECK(poll_modes(&f.context)==0);CHECK(sysfs_opens==1);
    f.info=mode_info(803,603);f.connector.count_modes=257;
    CHECK(poll_modes(&f.context)==0);CHECK(sysfs_opens==1);f.connector.count_modes=1;
    for(unsigned bit=0;bit<3;bit++){
        f.output->page_flip_pending=bit==0;f.output->atomic_complete_pending=bit==1;f.output->mode_switch_pending=bit==2;
        CHECK(poll_modes(&f.context)==0);CHECK(sysfs_opens==1);
    }
    f.output->page_flip_pending=f.output->atomic_complete_pending=f.output->mode_switch_pending=false;
    f.output->base.enabled=false;CHECK(poll_modes(&f.context)==0);CHECK(sysfs_opens==1);
    f.output->base.enabled=true;poll_head=NULL;finish(&f);
}
static void test_decoder(void) {
    // Independently recorded guest EDID, not generated by the adapter.
    const char *hex="00ffffffffffff005ecd010001000000011e0104a51510780a9605a3544c99260f505400000001010101010101010101010101010101490e23a0305b1e2028147300d2a00000001a000000fd001e780ffa3c010a202020202020000000fc005741534d20564d0a2020202020000000ff0057564d2d303030310a202020200036";
    uint8_t bytes[128];CHECK(strlen(hex)==256);
    for (int i=0;i<128;i++) { unsigned byte;CHECK(sscanf(hex+2*i,"%2x",&byte)==1);bytes[i]=byte; }
    struct wv_display_mode mode={7,9};CHECK(wv_display_mode_decode(bytes,128,&mode));CHECK(mode.width==803&&mode.height==603);
    CHECK(!wv_display_mode_decode(NULL,128,&mode));CHECK(!wv_display_mode_decode(bytes,127,&mode));CHECK(!wv_display_mode_decode(bytes,128,NULL));
    for (int i=0;i<128;i++) for (int bit=0;bit<8;bit++) {
        bytes[i]^=1<<bit;mode=(struct wv_display_mode){7,9};
        CHECK(!wv_display_mode_decode(bytes,128,&mode));CHECK(mode.width==7&&mode.height==9);bytes[i]^=1<<bit;
    }
    const uint8_t invalid[][2]={{8,0},{9,0},{18,2},{19,3},{126,1}};
    for (size_t i=0;i<sizeof invalid/sizeof invalid[0];i++) {
        uint8_t modified[128];memcpy(modified,bytes,128);modified[invalid[i][0]]=invalid[i][1];
        unsigned sum=0;for (int j=0;j<127;j++)sum+=modified[j];modified[127]=(uint8_t)-sum;
        CHECK(!wv_display_mode_decode(modified,128,&mode));
    }
    for (int width=0;width<=4095;width+=4095) {
        uint8_t modified[128];memcpy(modified,bytes,128);
        modified[56]=width;modified[58]=(modified[58]&15)|((width>>4)&240);
        unsigned sum=0;for (int j=0;j<127;j++)sum+=modified[j];modified[127]=(uint8_t)-sum;
        CHECK(wv_display_mode_decode(modified,128,&mode)==(width>=320));
    }
    uint8_t blank_clock[128];memcpy(blank_clock,bytes,128);blank_clock[54]=blank_clock[55]=0;
    unsigned clock_sum=0;for(int i=0;i<127;i++)clock_sum+=blank_clock[i];blank_clock[127]=(uint8_t)-clock_sum;
    CHECK(!wv_display_mode_decode(blank_clock,128,&mode));
    uint32_t seed=0x225c002;
    for (int run=0;run<100000;run++) {
        for (int i=0;i<128;i++) bytes[i]=rng(&seed);
        mode=(struct wv_display_mode){7,9};
        if (!wv_display_mode_decode(bytes,128,&mode)) CHECK(mode.width==7&&mode.height==9);
        else CHECK(mode.width>=320&&mode.width<=4095&&mode.height>=240&&mode.height<=4095);
    }
    CHECK(!preferred_mode("../card0",&mode));CHECK(!preferred_mode("Virtual/1",&mode));CHECK(!preferred_mode("",&mode));
}
int main(void) {
    test_transitions();test_slot_bound();test_failures();test_init_cleanup();test_decoder();test_idle_poll();
    printf("PASS actual adapter ASan/UBSan: %u checks; 10000 seeded transitions; 3000 pending polls; 100000 parser seeds; %u retired KMS blobs\n",checks,destroys);
    return 0;
}
