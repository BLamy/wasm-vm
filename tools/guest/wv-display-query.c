// Read-only Wayland output observer. Runs as the desktop user, never as a compositor.
#define _POSIX_C_SOURCE 200809L
#include <wayland-client.h>
#include <ctype.h>
#include <dirent.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define MAX_OUTPUTS 16
struct output {
    struct wl_output *proxy;
    uint32_t id;
    char name[64];
    int32_t width, height, refresh, scale;
    bool current;
};
static struct output outputs[MAX_OUTPUTS];
static bool watching, overflow;

static int edid_for_name(const char *name, unsigned char bytes[128]) {
    if (!*name) return -1;
    for (const unsigned char *s=(const unsigned char *)name; *s; ++s)
        if (!(isalnum(*s) || *s=='-' || *s=='_' || *s=='.')) return -1;
    DIR *dir=opendir("/sys/class/drm");
    if (!dir) return -1;
    int result=-1;
    struct dirent *entry;
    for (int count=0; count<256 && (entry=readdir(dir)); count++) {
        if (strncmp(entry->d_name,"card",4)) continue;
        const char *s=entry->d_name+4;
        if (!isdigit((unsigned char)*s)) continue;
        while (isdigit((unsigned char)*s)) s++;
        if (*s!='-' || strcmp(s+1,name)) continue;
        char file[512];
        int length=snprintf(file,sizeof file,"/sys/class/drm/%s/edid",entry->d_name);
        if (length<0 || (size_t)length>=sizeof file) break;
        int fd=open(file,O_RDONLY|O_CLOEXEC);
        if (fd<0) continue;
        ssize_t n=read(fd,bytes,128); close(fd);
        const unsigned char header[8]={0,255,255,255,255,255,255,0};
        unsigned sum=0;
        if (n==128) for (int i=0;i<128;i++) sum+=bytes[i];
        if (n==128 && !memcmp(bytes,header,8) && (sum&255)==0) result=0;
        break;
    }
    closedir(dir); return result;
}

static void print_output(struct output *out) {
    if (!out->current) return;
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC,&now)) exit(2);
    unsigned char edid[128];
    int valid=edid_for_name(out->name,edid)==0;
    int preferred_width=valid ? edid[56]+((edid[58]&0xf0)<<4) : -1;
    int preferred_height=valid ? edid[59]+((edid[61]&0xf0)<<4) : -1;
    printf("WV_DISPLAY ns=%" PRIu64 " id=%u name=%s width=%d height=%d refresh=%d scale=%d edid_width=%d edid_height=%d edid=",
        (uint64_t)now.tv_sec*1000000000+(uint64_t)now.tv_nsec,out->id,out->name,
        out->width,out->height,out->refresh,out->scale,preferred_width,preferred_height);
    if (valid) for (int i=0;i<128;i++) printf("%02x",edid[i]);
    else printf("unavailable");
    putchar('\n'); fflush(stdout);
}
static void geometry(void *data,struct wl_output *proxy,int32_t x,int32_t y,int32_t pw,int32_t ph,int32_t subpixel,const char *make,const char *model,int32_t transform) {
    (void)data;(void)proxy;(void)x;(void)y;(void)pw;(void)ph;(void)subpixel;(void)make;(void)model;(void)transform;
}
static void mode(void *data,struct wl_output *proxy,uint32_t flags,int32_t width,int32_t height,int32_t refresh) {
    (void)proxy;struct output *out=data;
    if (flags&WL_OUTPUT_MODE_CURRENT) {out->width=width;out->height=height;out->refresh=refresh;out->current=true;}
}
static void done(void *data,struct wl_output *proxy) {(void)proxy;if(watching)print_output(data);}
static void scale(void *data,struct wl_output *proxy,int32_t factor) {(void)proxy;((struct output *)data)->scale=factor;}
static void name(void *data,struct wl_output *proxy,const char *value) {(void)proxy;snprintf(((struct output *)data)->name,64,"%s",value);}
static void description(void *data,struct wl_output *proxy,const char *value) {(void)data;(void)proxy;(void)value;}
static const struct wl_output_listener listener={geometry,mode,done,scale,name,description};
static void global(void *data,struct wl_registry *registry,uint32_t id,const char *interface,uint32_t version) {
    (void)data;if(strcmp(interface,wl_output_interface.name))return;
    // The pinned Weston implements version 4, including stable connector names.
    if(version<4){overflow=true;return;}
    for(int i=0;i<MAX_OUTPUTS;i++)if(!outputs[i].proxy){
        outputs[i]=(struct output){.id=id,.scale=1};
        outputs[i].proxy=wl_registry_bind(registry,id,&wl_output_interface,4);
        if(!outputs[i].proxy){overflow=true;return;}
        wl_output_add_listener(outputs[i].proxy,&listener,&outputs[i]);return;
    }
    overflow=true;
}
static void removed(void *data,struct wl_registry *registry,uint32_t id) {
    (void)data;(void)registry;
    for(int i=0;i<MAX_OUTPUTS;i++)if(outputs[i].proxy&&outputs[i].id==id){
        if(watching){printf("WV_DISPLAY_REMOVED id=%u\n",id);fflush(stdout);}
        wl_output_release(outputs[i].proxy);outputs[i]=(struct output){0};break;
    }
}
static const struct wl_registry_listener registry_listener={global,removed};
int main(int argc,char **argv) {
    if(argc>2 || (argc==2&&strcmp(argv[1],"--watch")))return 2;
    alarm(10); // A wedged compositor cannot leave a one-shot query hanging forever.
    struct wl_display *display=wl_display_connect(NULL);
    if(!display){perror("Wayland connect");return 1;}
    struct wl_registry *registry=wl_display_get_registry(display);
    if(!registry){wl_display_disconnect(display);return 1;}
    wl_registry_add_listener(registry,&registry_listener,NULL);
    if(wl_display_roundtrip(display)<0 || wl_display_roundtrip(display)<0 || overflow)return 1;
    int found=0;
    for(int i=0;i<MAX_OUTPUTS;i++)if(outputs[i].current){print_output(&outputs[i]);found++;}
    if(argc==2){alarm(0);watching=true;while(!overflow&&wl_display_dispatch(display)>=0){}return 1;}
    for(int i=0;i<MAX_OUTPUTS;i++)if(outputs[i].proxy)wl_output_release(outputs[i].proxy);
    wl_registry_destroy(registry);wl_display_disconnect(display);
    return found?0:1;
}
