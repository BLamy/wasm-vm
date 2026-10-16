/* Dedicated original-MMIO page-flip fixture. The existing paired guest is unchanged. */
#define main legacy_pair_main
#include "main.c"
#undef main

static void scanout(u32 id) {
    head(0x103,0,48);
    if(id) { word(32,64);word(36,64);word(44,id); }
    gpuCommand(48,0);
}

void main(void) {
    text("CONTINUITY_GUEST_START\n");
    inputInit(3,&keyboard,keyEvents);
    init(7,1);queue(7,0,&gpu);queue(7,1,&cursor);*reg(7,0x70)=15;
    head(0x200,1,96);word(24,4);copy(request+32,"flip",4);gpuCommand(96,0);
    resource(1,2,67,2,64,64);resource(2,0,64,16,64,1);backing(2,vertices,64);
    head(0x205,1,72);word(36,64);word(40,1);word(44,1);word(56,2);gpuCommand(72,0);
    stream(initial,sizeof(initial));stream(green,sizeof(green));scanout(1);flush();
    text("CONTINUITY_GREEN\n");
    for(;;) {
        while(keyUsed!=keyboard.usedIndex) {
            u32 id=keyboard.used[keyUsed&255].id;
            volatile u16 *event=(volatile u16*)keyEvents[id];
            u32 value=*(volatile u32*)(keyEvents[id]+4);
            if(event[0]==1&&value==1) {
                if(event[1]==19) { scanout(1);text("CONTINUITY_REBOUND\n"); }
                if(event[1]==49) { stream(red,sizeof(red));flush();text("CONTINUITY_RED\n"); }
                if(event[1]==48) { scanout(1);stream(blue,sizeof(blue));flush();text("CONTINUITY_BLUE\n"); }
                if(event[1]==32) { scanout(0);text("CONTINUITY_DISABLED\n"); }
                if(event[1]==18) { scanout(1);text("CONTINUITY_ENABLED\n"); }
            }
            keyUsed++;post(3,0,&keyboard,id);
        }
    }
}
