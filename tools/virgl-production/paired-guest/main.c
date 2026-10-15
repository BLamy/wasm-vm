/* A small supervisor guest, not Linux/Mesa. It exercises the real production
 * worker and original MMIO queues, real GPU draws, disk and trusted input.
 * Production Omarchy/Mesa acceptance is a separate recorded boot. */
typedef unsigned char u8; typedef unsigned short u16; typedef unsigned int u32; typedef unsigned long u64;
#include "commands.h"
struct desc { u64 address; u32 length; u16 flags,next; };
struct used {u32 id,length;};
struct queue {struct desc d[256] __attribute__((aligned(4096))); volatile u16 availFlags,availIndex,available[256],availEvent; volatile u16 usedFlags __attribute__((aligned(4))),usedIndex; volatile struct used used[256];u16 usedEvent;};
static struct queue gpu, cursor, disk, keyboard, tablet;
static volatile u8 response[256],request[16384];
static u64 fence=0x0020000000000071UL;
static float vertices[]={-1,-1,0,1,1,-1,0,1,-1,1,0,1,1,1,0,1};
static u32 cursorPixels[64];
static volatile u8 keyEvents[256][8],tabletEvents[256][8];
static u8 diskBytes[512] __attribute__((aligned(16)));static volatile u8 diskStatus;
static u32 color=0,marker=0x4d,cursorX=8,cursorY=8,frames=0;static u16 keyUsed,tabletUsed;
static volatile u32 *reg(u32 slot,u32 offset){return (volatile u32 *)(0x10001000UL+4096UL*slot+offset);}
static void barrier(void){__asm__ volatile("fence iorw,iorw":::"memory");}
static void putc(char c){register u64 a0 __asm__("a0")=(u8)c;register u64 a7 __asm__("a7")=1;__asm__ volatile("ecall":"+r"(a0):"r"(a7):"memory");}
static void text(const char *s){while(*s)putc(*s++);}
static void fail(const char *s){text("PAIR_FAIL ");text(s);text("\n");for(;;)__asm__ volatile("nop");}
static void zero(volatile void *p,u32 n){volatile u8 *b=p;while(n--)*b++=0;}
static void copy(volatile void *d,const void *s,u32 n){volatile u8 *a=d;const u8 *b=s;while(n--)*a++=*b++;}
static void word(u32 at,u32 n){*(volatile u32 *)(request+at)=n;}
static void init(u32 slot,u32 low){if(*reg(slot,0)!=0x74726976)fail("MMIO");*reg(slot,0x70)=0;*reg(slot,0x70)=3;*reg(slot,0x24)=0;*reg(slot,0x20)=low;*reg(slot,0x24)=1;*reg(slot,0x20)=1;*reg(slot,0x70)=11;if(!(*reg(slot,0x70)&8))fail("FEATURES");}
static void queue(u32 slot,u32 index,struct queue *q){*reg(slot,0x30)=index;*reg(slot,0x38)=256;*reg(slot,0x80)=(u32)(u64)q->d;*reg(slot,0x84)=0;*reg(slot,0x90)=(u32)(u64)&q->availFlags;*reg(slot,0x94)=0;*reg(slot,0xa0)=(u32)(u64)&q->usedFlags;*reg(slot,0xa4)=0;*reg(slot,0x44)=1;}
static void post(u32 slot,u32 index,struct queue *q,u16 id){u16 n=q->availIndex;q->available[n&255]=id;barrier();q->availIndex=n+1;barrier();*reg(slot,0x50)=index;}
static void wait(u32 slot,struct queue *q,u16 before){while(q->usedIndex==before)__asm__ volatile("nop":::"memory");barrier();*reg(slot,0x64)=1;}
static void head(u32 type,u32 ctx,u32 bytes){zero(request,bytes);word(0,type);word(16,ctx);}
static void gpuCommand(u32 bytes,int cur){struct queue *q=cur?&cursor:&gpu;u16 before=q->usedIndex;u32 flags=*(volatile u32*)(request+4);u64 sentFence=*(volatile u64*)(request+8);zero(response,sizeof(response));q->d[0]=(struct desc){(u64)request,bytes,1,1};q->d[1]=(struct desc){(u64)response,sizeof(response),2,0};post(7,cur?1:0,q,0);wait(7,q,before);if(q->usedIndex!=(u16)(before+1))fail("GPU_USED_COUNT");if(!cur && *(volatile u32*)response!=0x1100)fail("GPU_RESPONSE");if(!cur && (flags&1) && (*(volatile u32*)(response+4)!=flags||*(volatile u64*)(response+8)!=sentFence))fail("GPU_FENCE");}
static void resource(u32 id,u32 target,u32 format,u32 bind,u32 w,u32 h){head(0x204,0,72);u32 values[]={id,target,format,bind,w,h,1,1,0,0,0,0};copy(request+24,values,48);gpuCommand(72,0);head(0x202,1,32);word(24,id);gpuCommand(32,0);}
static void backing(u32 id,void *address,u32 bytes){head(0x106,0,48);word(24,id);word(28,1);*(volatile u64*)(request+32)=(u64)address;word(40,bytes);gpuCommand(48,0);}
static void stream(const u8 *bytes,u32 length){head(0x207,1,32+length);word(4,1);*(volatile u64*)(request+8)=fence++;word(24,length);copy(request+32,bytes,length);gpuCommand(32+length,0);}
static void flush(void){head(0x104,0,48);word(32,64);word(36,64);word(40,1);word(4,1);*(volatile u64*)(request+8)=fence++;gpuCommand(48,0);}
static void cursorMove(void){head(0x300,0,56);word(28,cursorX);word(32,cursorY);word(40,30);gpuCommand(56,1);}
static void diskOp(u32 write){u32 h[4]={write?1:0,0,8,0};u16 before=disk.usedIndex;diskStatus=0xff;disk.d[0]=(struct desc){(u64)h,16,1,1};disk.d[1]=(struct desc){(u64)diskBytes,512,write?1:3,2};disk.d[2]=(struct desc){(u64)&diskStatus,1,2,0};post(0,0,&disk,0);wait(0,&disk,before);if(diskStatus)fail("DISK_STATUS");}
static void writeMarker(void){for(u32 i=0;i<512;i++)diskBytes[i]=(u8)marker;diskOp(1);}
static void readMarker(void){zero(diskBytes,512);diskOp(0);for(u32 i=0;i<512;i++)if(diskBytes[i]!=(u8)marker)fail("DISK_MARKER");}
static void inputInit(u32 slot,struct queue *q,volatile u8 events[256][8]){init(slot,0);queue(slot,0,q);for(u32 i=0;i<256;i++){q->d[i]=(struct desc){(u64)events[i],8,2,0};post(slot,0,q,i);}*reg(slot,0x70)=15;}
static void inputs(void){
 while(keyUsed!=keyboard.usedIndex){u32 id=keyboard.used[keyUsed&255].id;volatile u16 *e=(volatile u16*)keyEvents[id];u32 value=*(volatile u32*)(keyEvents[id]+4);if(e[0]==1&&value==1){color=e[1]==48?2:1;marker=color==2?0x7a:0x4d;writeMarker();text(color==2?"PAIR_KEY_BLUE\n":"PAIR_KEY_RED\n");}keyUsed++;post(3,0,&keyboard,id);}
 int moved=0;while(tabletUsed!=tablet.usedIndex){u32 id=tablet.used[tabletUsed&255].id;volatile u16 *e=(volatile u16*)tabletEvents[id];u32 value=*(volatile u32*)(tabletEvents[id]+4);if(e[0]==3&&e[1]<2){if(e[1]==0)cursorX=value*63/32767;else cursorY=value*63/32767;moved=1;}tabletUsed++;post(4,0,&tablet,id);}if(moved){cursorMove();text("PAIR_CURSOR_MOVED\n");}
}
void main(void){
 text("PAIR_GUEST_START\n");init(0,0);queue(0,0,&disk);*reg(0,0x70)=15;writeMarker();readMarker();
 inputInit(3,&keyboard,keyEvents);inputInit(4,&tablet,tabletEvents);
 init(7,1);queue(7,0,&gpu);queue(7,1,&cursor);*reg(7,0x70)=15;
 head(0x200,1,96);word(24,4);copy(request+32,"pair",4);gpuCommand(96,0);
 resource(1,2,67,2,64,64);resource(2,0,64,16,64,1);backing(2,vertices,64);
 head(0x205,1,72);word(36,64);word(40,1);word(44,1);word(56,2);gpuCommand(72,0);
 stream(initial,sizeof(initial));head(0x103,0,48);word(32,64);word(36,64);word(44,1);gpuCommand(48,0);
 for(u32 i=0;i<64;i++)cursorPixels[i]=0xff00ffff;
 head(0x101,0,40);word(24,30);word(28,1);word(32,8);word(36,8);gpuCommand(40,0);backing(30,cursorPixels,256);
 head(0x105,0,56);word(32,8);word(36,8);word(48,30);gpuCommand(56,0);cursorMove();
 for(;;){inputs();const u8 *s=color==2?blue:color==1?red:green;u32 n=color==2?sizeof(blue):color==1?sizeof(red):sizeof(green);stream(s,n);flush();readMarker();if((frames++&31)==0)text(marker==0x7a?"PAIR_FRAME_Z\n":"PAIR_FRAME_M\n");for(volatile u32 i=0;i<5000000;i++)__asm__ volatile("nop");}
}
