/* A small supervisor guest, not Linux/Mesa. It exercises the real production
 * worker and original MMIO queues, real GPU draws, disk and trusted input.
 * Production Omarchy/Mesa acceptance is a separate recorded boot. */
typedef unsigned char u8; typedef unsigned short u16; typedef unsigned int u32; typedef unsigned long u64;
#include "commands.h"
struct desc { u64 address; u32 length; u16 flags,next; };
struct used {u32 id,length;};
struct queue {struct desc d[256] __attribute__((aligned(4096))); volatile u16 availFlags,availIndex,available[256],availEvent; volatile u16 usedFlags __attribute__((aligned(4))),usedIndex; volatile struct used used[256];u16 usedEvent;};
static struct queue gpu, cursor, disk;
#ifdef E9_GPU_BRANCH
static struct queue net, netRx;
static u8 netPacket[12+64];
#endif
static volatile u8 response[256],request[16384];
static u64 fence=0x0020000000000071UL;
static float vertices[]={-1,-1,0,1,1,-1,0,1,-1,1,0,1,1,1,0,1};
static u8 pixels[64*64*4] __attribute__((aligned(16)));
static u32 queryData[2][8] __attribute__((aligned(16)));
#ifdef E9_GPU_LAYERED
static u8 layeredPixels[96] __attribute__((aligned(16)));
#endif
static u32 expectedResponse=0x1100;

static u8 diskBytes[512] __attribute__((aligned(16)));static volatile u8 diskStatus;
static u32 marker=0x4d,cursorX=8,cursorY=8;
static volatile u32 *reg(u32 slot,u32 offset){return (volatile u32 *)(0x10001000UL+4096UL*slot+offset);}
static void barrier(void){__asm__ volatile("fence iorw,iorw":::"memory");}
static void putc(char c){register u64 a0 __asm__("a0")=(u8)c;register u64 a7 __asm__("a7")=1;__asm__ volatile("ecall":"+r"(a0):"r"(a7):"memory");}
static void text(const char *s){while(*s)putc(*s++);}
static void fail(const char *s){text("SESSION_FAIL ");text(s);text("\n");for(;;)__asm__ volatile("nop");}
static void zero(volatile void *p,u32 n){volatile u8 *b=p;while(n--)*b++=0;}
static void copy(volatile void *d,const void *s,u32 n){volatile u8 *a=d;const u8 *b=s;while(n--)*a++=*b++;}
static void word(u32 at,u32 n){*(volatile u32 *)(request+at)=n;}
static void init(u32 slot,u32 low){if(*reg(slot,0)!=0x74726976)fail("MMIO");*reg(slot,0x70)=0;*reg(slot,0x70)=3;*reg(slot,0x24)=0;*reg(slot,0x20)=low;*reg(slot,0x24)=1;*reg(slot,0x20)=1;*reg(slot,0x70)=11;if(!(*reg(slot,0x70)&8))fail("FEATURES");}
static void queue(u32 slot,u32 index,struct queue *q){*reg(slot,0x30)=index;*reg(slot,0x38)=256;*reg(slot,0x80)=(u32)(u64)q->d;*reg(slot,0x84)=0;*reg(slot,0x90)=(u32)(u64)&q->availFlags;*reg(slot,0x94)=0;*reg(slot,0xa0)=(u32)(u64)&q->usedFlags;*reg(slot,0xa4)=0;*reg(slot,0x44)=1;}
static void post(u32 slot,u32 index,struct queue *q,u16 id){u16 n=q->availIndex;q->available[n&255]=id;barrier();q->availIndex=n+1;barrier();*reg(slot,0x50)=index;}
static void wait(u32 slot,struct queue *q,u16 before){while(q->usedIndex==before)__asm__ volatile("nop":::"memory");barrier();*reg(slot,0x64)=1;}
static void head(u32 type,u32 ctx,u32 bytes){zero(request,bytes);word(0,type);word(16,ctx);}
static void gpuCommand(u32 bytes,int cur){struct queue *q=cur?&cursor:&gpu;u16 before=q->usedIndex;u32 flags=*(volatile u32*)(request+4);u64 sentFence=*(volatile u64*)(request+8);zero(response,sizeof(response));q->d[0]=(struct desc){(u64)request,bytes,1,1};q->d[1]=(struct desc){(u64)response,sizeof(response),2,0};post(7,cur?1:0,q,0);wait(7,q,before);if(q->usedIndex!=(u16)(before+1))fail("GPU_USED_COUNT");if(!cur && *(volatile u32*)response!=expectedResponse)fail("GPU_RESPONSE");if(!cur && (flags&1) && (*(volatile u32*)(response+4)!=flags||*(volatile u64*)(response+8)!=sentFence))fail("GPU_FENCE");}
static void resource(u32 id,u32 target,u32 format,u32 bind,u32 w,u32 h){head(0x204,0,72);u32 values[]={id,target,format,bind,w,h,1,1,0,0,0,0};copy(request+24,values,48);gpuCommand(72,0);head(0x202,1,32);word(24,id);gpuCommand(32,0);}
static void backing(u32 id,void *address,u32 bytes){head(0x106,0,48);word(24,id);word(28,1);*(volatile u64*)(request+32)=(u64)address;word(40,bytes);gpuCommand(48,0);}
static void stream(const u8 *bytes,u32 length){head(0x207,1,32+length);word(4,1);*(volatile u64*)(request+8)=fence++;word(24,length);copy(request+32,bytes,length);gpuCommand(32+length,0);}
static void flush(void){head(0x104,0,48);word(32,64);word(36,64);word(40,1);word(4,1);*(volatile u64*)(request+8)=fence++;gpuCommand(48,0);}
static void cursorMove(void){head(0x300,0,56);word(28,cursorX);word(32,cursorY);word(40,30);gpuCommand(56,1);}
static void diskOp(u32 write){u32 h[4]={write?1:0,0,8,0};u16 before=disk.usedIndex;diskStatus=0xff;disk.d[0]=(struct desc){(u64)h,16,1,1};disk.d[1]=(struct desc){(u64)diskBytes,512,write?1:3,2};disk.d[2]=(struct desc){(u64)&diskStatus,1,2,0};post(0,0,&disk,0);wait(0,&disk,before);if(diskStatus)fail("DISK_STATUS");}
static void writeMarker(void){for(u32 i=0;i<512;i++)diskBytes[i]=(u8)marker;diskOp(1);}
static void readMarker(void){zero(diskBytes,512);diskOp(0);for(u32 i=0;i<512;i++)if(diskBytes[i]!=(u8)marker)fail("DISK_MARKER");}
#ifdef E9_GPU_BRANCH
static void sendCounter(u8 letter){
 zero(netPacket,sizeof(netPacket));
 for(u32 i=0;i<6;i++)netPacket[12+i]=255;
 const u8 src[]={0x52,0x54,0,0x12,0x34,0x56};copy(netPacket+18,src,6);
 netPacket[24]=0x88;netPacket[25]=0xb5;copy(netPacket+26,"E9_BRANCH_COUNTER_",18);netPacket[44]=letter;
 u16 before=net.usedIndex;net.d[0]=(struct desc){(u64)netPacket,sizeof(netPacket),0,0};post(1,1,&net,0);wait(1,&net,before);
}
static u8 choice(void){
 volatile u8 *uart=(volatile u8 *)0x10000000UL;
 for(;;){if(!(uart[5]&1))continue;u8 value=uart[0];
  if(value=='P'||value=='A'||value=='B')return value;
 }
}
#endif

static void transfer(u32 id,u32 width,u32 height,u32 stride,u32 layerStride,u32 direction){
 head(direction,1,72);word(36,width);word(40,height);word(44,1);word(56,id);word(64,stride);word(68,layerStride);word(4,1);*(volatile u64*)(request+8)=fence++;gpuCommand(72,0);
}
#ifdef E9_GPU_LAYERED
void *memcpy(void *d,const void *s,u64 n){volatile u8 *a=d;const u8 *b=s;while(n--)*a++=*b++;return d;}
static void layeredTransfer(u32 direction){
 head(direction,1,72);word(36,2);word(40,2);word(44,2);*(volatile u64*)(request+48)=5;word(56,20);word(64,13);word(68,37);word(4,1);*(volatile u64*)(request+8)=fence++;gpuCommand(72,0);
}
static void layeredProof(void){
 head(0x204,0,72);u32 values[]={20,3,67,10,2,2,2,1,0,0,0,0};copy(request+24,values,48);gpuCommand(72,0);
 head(0x202,1,32);word(24,20);gpuCommand(32,0);backing(20,layeredPixels,sizeof(layeredPixels));
 for(u32 i=0;i<sizeof(layeredPixels);i++)layeredPixels[i]=0xa3;
 for(u32 layer=0;layer<2;layer++)for(u32 row=0;row<2;row++)for(u32 byte=0;byte<8;byte++)layeredPixels[5+37*layer+13*row+byte]=(byte%4==3)?255:((layer?0x44:0x11)+0x11*(byte%4));
 layeredTransfer(0x205);
 for(u32 i=0;i<sizeof(layeredPixels);i++)layeredPixels[i]=0xc7;
 layeredTransfer(0x206);
 for(u32 i=0;i<sizeof(layeredPixels);i++){
  u32 wanted=0xc7;
  for(u32 layer=0;layer<2;layer++)for(u32 row=0;row<2;row++)if(i>=5+37*layer+13*row&&i<5+37*layer+13*row+8){u32 byte=i-(5+37*layer+13*row);wanted=(byte%4==3)?255:((layer?0x44:0x11)+0x11*(byte%4));}
  if(layeredPixels[i]!=wanted)fail("LAYERED_PADDING_OR_PIXEL");
 }
 text("SESSION_LAYERED_GUARD_BYTES_OK\n");
}
#endif
void main(void){
 text("SESSION_GUEST_START\n");
#ifdef E9_GPU_BRANCH
 init(1,0);queue(1,0,&netRx);queue(1,1,&net);*reg(1,0x70)=15;sendCounter('S');
#endif
 init(0,0);queue(0,0,&disk);*reg(0,0x70)=15;writeMarker();readMarker();
 init(7,1);queue(7,0,&gpu);queue(7,1,&cursor);*reg(7,0x70)=15;
 head(0x200,1,96);word(24,7);copy(request+32,"session",7);gpuCommand(96,0);
 resource(1,2,67,2,64,64);resource(2,0,64,16,64,1);backing(1,pixels,sizeof(pixels));backing(2,vertices,64);
 transfer(2,64,1,0,0,0x205);stream(initial,sizeof(initial));
#ifdef E9_GPU_LAYERED
 layeredProof();
#endif
 for(u32 i=0;i<2;i++){resource(10+i,0,64,131072,32,1);backing(10+i,queryData[i],32);transfer(10+i,32,1,0,0,0x205);}
 stream(visible_query,sizeof(visible_query));transfer(10,32,1,0,0,0x206);
 if(queryData[0][0]!=1||queryData[0][1]!=4||queryData[0][2]!=1||queryData[0][3]!=0)fail("VISIBLE_QUERY");
 text("SESSION_QUERY_VISIBLE_1\n");
 stream(empty_query,sizeof(empty_query));transfer(11,32,1,0,0,0x206);
 if(queryData[1][0]!=1||queryData[1][1]!=4||queryData[1][2]!=0||queryData[1][3]!=0)fail("EMPTY_QUERY");
 text("SESSION_QUERY_EMPTY_0\n");
 transfer(1,64,64,256,16384,0x206);
 for(u32 i=0;i<sizeof(pixels);i++)if(pixels[i]!=(i%4==1||i%4==3?255:0))fail("GREEN_READBACK");
 text("SESSION_READBACK_GREEN_16384\n");
 head(0x103,0,48);word(32,64);word(36,64);word(44,1);gpuCommand(48,0);flush();readMarker();
 text("SESSION_FRAME_AND_DISK_OK\n");
#ifdef E9_GPU_BRANCH
 text("BRANCH_READY\n");
 u8 selected=choice();marker=selected;writeMarker();readMarker();sendCounter(selected);
 if(selected=='P')stream(red,sizeof(red));else if(selected=='A')stream(blue,sizeof(blue));else stream(green,sizeof(green));
 transfer(1,64,64,256,16384,0x206);
 u32 component=selected=='P'?0:selected=='A'?2:1;
 for(u32 i=0;i<sizeof(pixels);i++)if(pixels[i]!=(i%4==component||i%4==3?255:0))fail("BRANCH_FRESH_GPU_READBACK");
 flush();readMarker();text("BRANCH_GPU_DONE_");putc(selected);text("\n");
#else
 for(volatile u32 i=0;i<20000;i++)__asm__ volatile("nop");
 expectedResponse=0x1205;stream(invalid_query,sizeof(invalid_query));expectedResponse=0x1100;
 text("SESSION_EXPECTED_GPU_ERROR_1205\n");
 text("SESSION_DONE\n");
#endif
 for(;;)__asm__ volatile("nop");
}
