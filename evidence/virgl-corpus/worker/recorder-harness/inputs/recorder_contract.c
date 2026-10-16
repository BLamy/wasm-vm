/* Recorder-only mock ABI contract test. The fake renderer never renders pixels.
 * Compiled twice: -DRECORDER_FAKE for the DSO, otherwise the test caller.
 * Public declarations come from pinned virglrenderer 1.3.0, not copied prototypes. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/uio.h>
#include "virglrenderer.h"
#include "virgl_hw.h"

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "CONTRACT_FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); exit(90); } } while (0)
struct expectation {
    const char *op;
    uint64_t n[8];
    void *p[5];
    int result;
    const char *before;
    const char *after;
};
void fake_expect(struct expectation e);
unsigned fake_calls(void);

#ifdef RECORDER_FAKE
static struct expectation expected;
static unsigned calls;
static struct virgl_renderer_callbacks callbacks;
static void *saved_cookie;
static struct iovec attached[2];
static unsigned attached_count;
static struct iovec *original_iov;
void fake_expect(struct expectation e) { CHECK(expected.op == NULL); expected = e; }
unsigned fake_calls(void) { CHECK(expected.op == NULL); return calls; }
static void check(const char *op) {
    CHECK(expected.op && strcmp(expected.op, op) == 0);
    expected.op = NULL;
    calls++;
    printf("FAKE_FORWARD %s\n", op);
    fflush(stdout);
}
static void save(struct iovec *iov, unsigned count) {
    CHECK(count <= 2); attached_count = count; original_iov = iov;
    if (count) memcpy(attached, iov, count * sizeof(*iov));
}
static void check_bytes(struct iovec *iov, unsigned count) {
    if (!iov) { iov = attached; count = attached_count; }
    size_t at = 0;
    for (unsigned i = 0; i < count; i++) {
        CHECK(at + iov[i].iov_len <= 8);
        CHECK(memcmp(iov[i].iov_base, expected.before + at, iov[i].iov_len) == 0);
        if (expected.after) memcpy(iov[i].iov_base, expected.after + at, iov[i].iov_len);
        at += iov[i].iov_len;
    }
    CHECK(at == 8);
}
int virgl_renderer_init(void *cookie, int flags, struct virgl_renderer_callbacks *cb) {
    check("init"); CHECK(cookie == expected.p[0] && flags == (int)expected.n[0]);
    saved_cookie = cookie;
    if (!cb) { CHECK(expected.p[1] == NULL); return expected.result; }
    struct virgl_renderer_callbacks *original = expected.p[1];
    CHECK(cb->version == original->version);
    if (cb->version >= 1 && cb->version <= 4) {
        CHECK(cb != original);
        CHECK(cb->create_gl_context == original->create_gl_context);
        CHECK(cb->destroy_gl_context == original->destroy_gl_context);
        CHECK(cb->make_current == original->make_current);
        CHECK(cb->write_fence != NULL && cb->write_fence != original->write_fence);
        CHECK(cb->get_drm_fd == (cb->version >= 2 ? original->get_drm_fd : NULL));
        CHECK(cb->get_server_fd == (cb->version >= 3 ? original->get_server_fd : NULL));
        CHECK(cb->get_egl_display == (cb->version >= 4 ? original->get_egl_display : NULL));
        if (cb->version >= 3) CHECK(cb->write_context_fence != NULL && cb->write_context_fence != original->write_context_fence);
        else CHECK(cb->write_context_fence == NULL);
        callbacks = *cb;
    } else CHECK(cb == original);
    return expected.result;
}
int virgl_renderer_resource_create(struct virgl_renderer_resource_create_args *a, struct iovec *iov, uint32_t count) {
    check("create"); CHECK(a == expected.p[0] && iov == expected.p[1] && count == expected.n[0]);
    if (expected.n[1] == 0 && !expected.result) save(iov, count);
    return expected.result;
}
int virgl_renderer_resource_attach_iov(int id, struct iovec *iov, int count) {
    check("attach"); CHECK((uint32_t)id == expected.n[0] && iov == expected.p[0] && count == (int)expected.n[1]);
    if (!expected.result) save(iov, count);
    return expected.result;
}
void virgl_renderer_resource_detach_iov(int id, struct iovec **iov, int *count) {
    check("detach"); CHECK((uint32_t)id == expected.n[0] && iov == expected.p[0] && count == expected.p[1]);
    *iov = original_iov; *count = attached_count; save(NULL, 0);
}
void virgl_renderer_resource_unref(uint32_t id) { check("unref"); CHECK(id == expected.n[0]); save(NULL, 0); }
static void transfer(const char *op, uint32_t id, uint32_t ctx, int level, uint32_t stride,
                     uint32_t layer, struct virgl_box *box, uint64_t offset, struct iovec *iov, unsigned count) {
    check(op); CHECK(id == expected.n[0] && ctx == expected.n[1] && level == (int)expected.n[2]);
    CHECK(stride == expected.n[3] && layer == expected.n[4] && offset == expected.n[5]);
    CHECK(box == expected.p[0] && iov == expected.p[1] && count == expected.n[6]);
    check_bytes(iov, count);
}
int virgl_renderer_transfer_write_iov(uint32_t id, uint32_t ctx, int level, uint32_t stride,
                                    uint32_t layer, struct virgl_box *box, uint64_t offset, struct iovec *iov, unsigned count) {
    transfer("write", id, ctx, level, stride, layer, box, offset, iov, count); return expected.result;
}
int virgl_renderer_transfer_read_iov(uint32_t id, uint32_t ctx, uint32_t level, uint32_t stride,
                                   uint32_t layer, struct virgl_box *box, uint64_t offset, struct iovec *iov, int count) {
    transfer("read", id, ctx, (int)level, stride, layer, box, offset, iov, (unsigned)count); return expected.result;
}
int virgl_renderer_submit_cmd(void *buffer, int ctx, int ndw) {
    check("submit"); CHECK(buffer == expected.p[0] && ctx == (int)expected.n[0] && ndw == (int)expected.n[1]);
    if (expected.before) CHECK(memcmp(buffer, expected.before, (size_t)ndw * 4) == 0);
    return expected.result;
}
int virgl_renderer_context_create(uint32_t ctx, uint32_t length, const char *name) {
    check("context"); CHECK(ctx == expected.n[0] && length == expected.n[1] && name == expected.p[0]); return expected.result;
}
int virgl_renderer_context_create_with_flags(uint32_t ctx, uint32_t flags, uint32_t length, const char *name) {
    check("context_flags"); CHECK(ctx == expected.n[0] && flags == expected.n[2] && length == expected.n[1] && name == expected.p[0]); return expected.result;
}
void virgl_renderer_context_destroy(uint32_t ctx) { check("context_destroy"); CHECK(ctx == expected.n[0]); }
void virgl_renderer_ctx_attach_resource(int ctx, int id) { check("ctx_attach"); CHECK(ctx == (int)expected.n[0] && id == (int)expected.n[1]); }
void virgl_renderer_ctx_detach_resource(int ctx, int id) { check("ctx_detach"); CHECK(ctx == (int)expected.n[0] && id == (int)expected.n[1]); }
int virgl_renderer_create_fence(int fence, uint32_t ctx) {
    check("fence"); CHECK((uint32_t)fence == expected.n[0] && ctx == expected.n[1]);
    callbacks.write_fence(saved_cookie, (uint32_t)fence); return expected.result;
}
int virgl_renderer_context_create_fence(uint32_t ctx, uint32_t flags, uint32_t ring, uint64_t fence) {
    check("context_fence"); CHECK(ctx == expected.n[0] && flags == expected.n[1] && ring == expected.n[2] && fence == expected.n[3]);
    callbacks.write_context_fence(saved_cookie, ctx, ring, fence); return expected.result;
}
void virgl_renderer_get_cap_set(uint32_t set, uint32_t *version, uint32_t *size) {
    /* fill_caps asks the real library for size directly: that query is expected too. */
    CHECK(set == 2); *version = 3; *size = 8;
    if (expected.op && !strcmp(expected.op, "exit_active")) { check("exit_active"); exit(0); }
    check("caps");
}
void virgl_renderer_fill_caps(uint32_t set, uint32_t version, void *caps) {
    check("fill_caps"); CHECK(set == 2 && version == 3 && caps == expected.p[0]);
    memcpy(caps, "CAPS\0\x7f\x80\xff", 8);
    expected.op = "caps";
}
void virgl_renderer_reset(void) { check("reset"); save(NULL, 0); }
void virgl_renderer_cleanup(void *cookie) { check("cleanup"); CHECK(cookie == saved_cookie); }
int virgl_renderer_resource_create_blob(const struct virgl_renderer_resource_create_blob_args *args) {
    check("blob"); CHECK(args == expected.p[0]);
    CHECK(args->res_handle == 7 && args->ctx_id == 19 && args->blob_id == UINT64_C(0xfedcba9876543210));
    return expected.result;
}
#else
static int cookie;
static unsigned legacy_callbacks, context_callbacks;
static void on_fence(void *p, uint32_t fence) { CHECK(p == &cookie && fence == 0xfedcba98); legacy_callbacks++; }
static void on_context_fence(void *p, uint32_t ctx, uint32_t ring, uint64_t fence) {
    CHECK(p == &cookie && ctx == 19 && ring == 3 && fence == UINT64_C(0xfedcba9876543210)); context_callbacks++;
}
static virgl_renderer_gl_context create_gl(void *p, int index, struct virgl_renderer_gl_ctx_param *param) { (void)p; (void)index; (void)param; return NULL; }
static void destroy_gl(void *p, virgl_renderer_gl_context ctx) { (void)p; (void)ctx; }
static int current_gl(void *p, int index, virgl_renderer_gl_context ctx) { (void)p; (void)index; (void)ctx; return 0; }
static int drm_fd(void *p) { (void)p; return -1; }
static int server_fd(void *p, uint32_t version) { (void)p; (void)version; return -1; }
static void *egl_display(void *p) { return p; }
static void init(int version) {
    struct virgl_renderer_callbacks cb = {.version=version, .write_fence=on_fence, .create_gl_context=create_gl,
        .destroy_gl_context=destroy_gl, .make_current=current_gl, .get_drm_fd=drm_fd,
        .write_context_fence=on_context_fence, .get_server_fd=server_fd, .get_egl_display=egl_display};
    fake_expect((struct expectation){.op="init", .n={0x51}, .p={&cookie,&cb}});
    CHECK(virgl_renderer_init(&cookie,0x51,&cb)==0);
}
static void cleanup(void) { fake_expect((struct expectation){.op="cleanup"}); virgl_renderer_cleanup(&cookie); }
static void caps(void) {
    uint32_t version=0,size=0;
    fake_expect((struct expectation){.op="caps"}); virgl_renderer_get_cap_set(2,&version,&size);
    CHECK(version==3 && size==8);
}
static struct virgl_renderer_resource_create_args resource = {.handle=7,.target=2,.format=67,.bind=8,
    .width=17,.height=19,.depth=1,.array_size=1,.last_level=2,.nr_samples=4,.flags=3};
static void create(struct iovec *iov, unsigned count, int skip_save) {
    fake_expect((struct expectation){.op="create",.n={count,(unsigned)skip_save},.p={&resource,iov}});
    CHECK(virgl_renderer_resource_create(&resource,iov,count)==0);
}
static void submit(void) {
    unsigned char bytes[8]={0x12,0x34,0x56,0x78,0xfe,0xdc,0xba,0x98};
    fake_expect((struct expectation){.op="submit",.n={19,2},.p={bytes},.result=37,.before=(char*)bytes});
    CHECK(virgl_renderer_submit_cmd(bytes,19,2)==37);
}
static void unref(void) { fake_expect((struct expectation){.op="unref",.n={7}}); virgl_renderer_resource_unref(7); }
static void transfer(int read, struct iovec *iov, unsigned count, const char *before, const char *after) {
    struct virgl_box box={.x=1,.y=2,.z=3,.w=4,.h=5,.d=6};
    struct expectation e={.op=read?"read":"write",.n={7,19,2,97,997,UINT64_C(0x1234567887654321),count},
        .p={&box,iov},.before=before,.after=after,.result=read?-19:-17};
    fake_expect(e);
    int result=read?virgl_renderer_transfer_read_iov(7,19,2,97,997,&box,e.n[5],iov,(int)count):
        virgl_renderer_transfer_write_iov(7,19,2,97,997,&box,e.n[5],iov,count);
    CHECK(result==e.result);
}
static void fences(int version) {
    fake_expect((struct expectation){.op="fence",.n={0xfedcba98,19},.result=41});
    CHECK(virgl_renderer_create_fence((int)0xfedcba98,19)==41); CHECK(legacy_callbacks==1);
    if(version>=3) {
        fake_expect((struct expectation){.op="context_fence",.n={19,1,3,UINT64_C(0xfedcba9876543210)},.result=43});
        CHECK(virgl_renderer_context_create_fence(19,1,3,UINT64_C(0xfedcba9876543210))==43); CHECK(context_callbacks==1);
    }
}
static void happy(void) {
    init(4);
    const char name[5]={'m','\0','"','\\',(char)0xff};
    fake_expect((struct expectation){.op="context",.n={19,5},.p={(void*)name},.result=47});
    CHECK(virgl_renderer_context_create(19,5,name)==47);
    fake_expect((struct expectation){.op="context_flags",.n={19,5,0x1234},.p={(void*)name},.result=49});
    CHECK(virgl_renderer_context_create_with_flags(19,0x1234,5,name)==49);
    char bytes[8]="abcDEFGH"; struct iovec attached[2]={{bytes,3},{bytes+3,5}};
    create(attached,2,0);
    char other[8]="ijklMNOP"; struct iovec explicit[2]={{other,4},{other+4,4}};
    transfer(0,explicit,2,"ijklMNOP","writeOUT");
    transfer(0,NULL,0,"abcDEFGH","writeOUT");
    transfer(1,explicit,2,"writeOUT","readAFT0");
    transfer(1,NULL,0,"writeOUT","readAFT0");
    CHECK(memcmp(bytes,"readAFT0",8)==0 && memcmp(other,"readAFT0",8)==0); submit();
    struct iovec *detached=NULL; int count=0;
    fake_expect((struct expectation){.op="detach",.n={7},.p={&detached,&count}});
    virgl_renderer_resource_detach_iov(7,&detached,&count); CHECK(detached==attached && count==2); submit();
    memcpy(bytes,"REATTACH",8);
    fake_expect((struct expectation){.op="attach",.n={7,2},.p={attached}});
    CHECK(virgl_renderer_resource_attach_iov(7,attached,2)==0);
    /* Both the ABI fake and recorder copied descriptors when registered. */
    attached[0]=(struct iovec){other,1}; submit();
    fake_expect((struct expectation){.op="ctx_attach",.n={19,7}});virgl_renderer_ctx_attach_resource(19,7);
    fake_expect((struct expectation){.op="ctx_detach",.n={19,7}});virgl_renderer_ctx_detach_resource(19,7);
    unref(); memcpy(bytes,"REUSED!!",8);attached[0]=(struct iovec){bytes,3};create(attached,2,0);submit();
    fake_expect((struct expectation){.op="reset"});virgl_renderer_reset();submit();
    memcpy(bytes,"RESETNEW",8);create(attached,2,0);submit();unref();
    fences(4);caps();unsigned char cap[8];
    fake_expect((struct expectation){.op="fill_caps",.p={cap}});virgl_renderer_fill_caps(2,3,cap);
    CHECK(memcmp(cap,"CAPS\0\x7f\x80\xff",8)==0);
    fake_expect((struct expectation){.op="context_destroy",.n={19}});virgl_renderer_context_destroy(19);
    cleanup();
}
int main(int argc,char **argv) {
    CHECK(argc==2);const char *scenario=argv[1];
    if(!strcmp(scenario,"happy")) happy();
    else if(!strncmp(scenario,"callbacks-",10)) {int v=atoi(scenario+10);CHECK(v>=1&&v<=4);init(v);fences(v);cleanup();}
    else if(!strcmp(scenario,"callback-invalid")) init(5);
    else if(!strcmp(scenario,"callback-null")) {
        fake_expect((struct expectation){.op="init",.n={0x51},.p={&cookie,NULL},.result=-23});
        CHECK(virgl_renderer_init(&cookie,0x51,NULL)==-23);
    }
    else if(!strcmp(scenario,"blob")) {
        struct virgl_renderer_resource_create_blob_args a={.res_handle=7,.ctx_id=19,.blob_mem=1,.blob_flags=3,
            .blob_id=UINT64_C(0xfedcba9876543210),.size=4096};
        fake_expect((struct expectation){.op="blob",.p={&a},.result=-29});CHECK(virgl_renderer_resource_create_blob(&a)==-29);
    } else if(!strcmp(scenario,"blob-limit")) {
        char name[]="four";fake_expect((struct expectation){.op="context",.n={19,4},.p={name},.result=-31});
        CHECK(virgl_renderer_context_create(19,4,name)==-31);
    } else if(!strcmp(scenario,"iov-count")) {char b=1;struct iovec iov={&b,1};create(&iov,16385,1);}
    else if(!strcmp(scenario,"iov-size")) {char b=1;struct iovec iov={&b,64u*1024u*1024u+1};create(&iov,1,1);}
    else if(!strcmp(scenario,"iov-null")) {struct iovec iov={NULL,1};create(&iov,1,1);}
    else if(!strcmp(scenario,"iov-array-null")) create(NULL,1,1);
    else if(!strncmp(scenario,"submit-",7)) {
        char byte=0;
        int ndw=!strcmp(scenario,"submit-negative")?-1:!strcmp(scenario,"submit-large")?16777217:1;
        void *data=!strcmp(scenario,"submit-null")?NULL:&byte;
        fake_expect((struct expectation){.op="submit",.n={19,(uint64_t)ndw},.p={data},.result=-41});
        CHECK(virgl_renderer_submit_cmd(data,19,ndw)==-41);
    }
    else if(!strcmp(scenario,"resource-limit")) {for(unsigned i=0;i<4097;i++){resource.handle=i+1;create(NULL,0,1);}}
    else if(!strcmp(scenario,"active-exit")) {uint32_t v,s;fake_expect((struct expectation){.op="exit_active"});virgl_renderer_get_cap_set(2,&v,&s);CHECK(0);}
    else if(!strcmp(scenario,"caps")) caps();
    else CHECK(0);
    printf("HARNESS_FORWARDING_PASS scenario=%s calls=%u\n",scenario,fake_calls());return 0;
}
#endif
