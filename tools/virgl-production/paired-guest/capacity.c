/* Original-MMIO count/roster/checkpoint fixture, not Linux/Mesa. */
#define main legacy_pair_main
#include "main.c"
#undef main

static void rejected(u32 bytes) {
    u16 before=gpu.usedIndex;u64 sent=fence++;
    word(4,1);*(volatile u64*)(request+8)=sent;zero(response,sizeof(response));
    gpu.d[0]=(struct desc){(u64)request,bytes,1,1};gpu.d[1]=(struct desc){(u64)response,sizeof(response),2,0};
    post(7,0,&gpu,0);wait(7,&gpu,before);
    if(gpu.usedIndex!=(u16)(before+1)||gpu.used[before&255].length!=24||*(volatile u32*)response!=0x1201||*(volatile u32*)(response+4)!=1||*(volatile u64*)(response+8)!=sent)fail("CAPACITY_REFUSAL");
}
static void context(u32 id) {
    head(0x200,id,96);word(24,4);copy(request+32,"caps",4);gpuCommand(96,0);
}
void main(void) {
    text("CAPACITY_GUEST_START\n");
    init(0,0);queue(0,0,&disk);*reg(0,0x70)=15;writeMarker();readMarker();
    inputInit(3,&keyboard,keyEvents);
    init(7,1);queue(7,0,&gpu);queue(7,1,&cursor);*reg(7,0x70)=15;
    for(u32 id=1;id<=32;id++)context(id);
    head(0x200,33,96);word(24,4);copy(request+32,"caps",4);rejected(96);
    head(0x201,32,24);gpuCommand(24,0);context(33);
    for(u32 id=1;id<=33;id++)if(id!=32) {
        /* CREATE_SUB_CTX1 and return to default0:64 actual native subcontexts. */
        head(0x207,id,48);word(4,1);*(volatile u64*)(request+8)=fence++;
        word(24,16);word(32,0x0001001d);word(36,1);word(40,0x0001001c);word(44,0);gpuCommand(48,0);
    }
    resource(1,2,67,2,64,64);resource(2,0,64,16,64,1);backing(2,vertices,64);
    for(u32 i=0;i<62;i++)resource(1000+i,0,64,16,16,1);
    /* Exact original refused popup descriptor, now the65th allocation. */
    resource(104,2,67,10,24,24);text("CAPACITY_POPUP_AFTER64\n");
    for(u32 i=62;i<509;i++)resource(1000+i,0,64,16,16,1);
    head(0x204,0,72);static const u32 denied[]={9999,0,64,16,16,1,1,1,0,0,0,0};copy(request+24,denied,48);rejected(72);
    head(0x102,0,32);word(24,1000);gpuCommand(32,0);resource(9999,0,64,16,16,1);
    head(0x205,1,72);word(36,64);word(40,1);word(44,1);word(56,2);gpuCommand(72,0);
    stream(initial,sizeof(initial));head(0x103,0,48);word(32,64);word(36,64);word(44,1);gpuCommand(48,0);
    text("CAPACITY_READY_512_32\n");
    for(;;) {
        inputs();const u8 *s=color==2?blue:color==1?red:green;u32 n=color==2?sizeof(blue):color==1?sizeof(red):sizeof(green);
        stream(s,n);flush();readMarker();if((frames++&31)==0)text(marker==0x7a?"PAIR_FRAME_Z\n":"PAIR_FRAME_M\n");
        for(volatile u32 i=0;i<5000000;i++)__asm__ volatile("nop");
    }
}
