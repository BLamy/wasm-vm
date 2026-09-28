// Temporary Linux diagnostic. Never writes tracee memory, registers, or input.
#define _GNU_SOURCE
#include <sys/ptrace.h>
#include <linux/ptrace.h>
#include <linux/audit.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/sysmacros.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <dirent.h>
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

enum { MAX_THREADS=128, MAX_IOV=64, MAX_BYTES=4096, TOTAL_BYTES=2097152, MAX_STOPS=20000 };
struct identity { bool valid, input; struct stat st; char path[256], subsystem[256]; int error; };
struct pending { bool valid, supported; uint64_t nr, fd, address, requested, sequence; size_t niov;
    struct iovec iov[MAX_IOV]; struct identity entry; };
struct thread { pid_t tid; bool alive, stopped, entry_seen; int pending_signal; struct pending read; };
// One emergency slot retains ownership of a clone that exceeds the limit.
static struct thread threads[MAX_THREADS+1];
static size_t count, captured;
static uint64_t stops, sequence, read_count, orphan_exits;
static pid_t target;
static volatile sig_atomic_t stopping;
static int failed;

static int64_t milliseconds(void) {
    struct timespec t;
    if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;
    return (int64_t)t.tv_sec*1000+t.tv_nsec/1000000;
}

static void signal_stop(int sig) { if(!stopping)stopping=sig; }
static void quoted(const char *s) {
    putchar('"');
    for (;*s;s++) { unsigned char c=(unsigned char)*s;
        if(c=='"'||c=='\\') { putchar('\\'); putchar(c); }
        else if(c<32||c>126) printf("\\u%04x",c); else putchar(c);
    }
    putchar('"');
}
static void error_row(const char *stage, pid_t tid) {
    int e=errno; printf("{\"kind\":\"error\",\"stage\":"); quoted(stage);
    printf(",\"tid\":%d,\"errno\":%d}\n",tid,e); failed=1;
}
static struct thread *find_thread(pid_t tid) {
    for(size_t i=0;i<count;i++) if(threads[i].tid==tid) return &threads[i];
    return NULL;
}
static struct thread *add_thread(pid_t tid) {
    struct thread *t=find_thread(tid); if(t) return t;
    if(count>=MAX_THREADS) { errno=E2BIG; error_row("thread-budget",tid); }
    if(count==MAX_THREADS+1)return NULL;
    t=&threads[count++]; t->tid=tid; t->alive=true; return t;
}
static bool process_identity(pid_t tid) {
    char path[96],line[4096],comm[256]={0},exe[512]={0},start[32]={0};
    int tgid=0,tracer=-1;
    snprintf(path,sizeof(path),"/proc/%d/status",tid);
    FILE *f=fopen(path,"r");if(!f){error_row("identity-status",tid);return false;}
    while(fgets(line,sizeof(line),f)) {
        if(sscanf(line,"Tgid: %d",&tgid)==1)continue;
        if(sscanf(line,"TracerPid: %d",&tracer)==1)continue;
        if(strncmp(line,"Name:\t",6)==0)snprintf(comm,sizeof(comm),"%.*s",(int)strcspn(line+6,"\n"),line+6);
    }
    fclose(f);
    snprintf(path,sizeof(path),"/proc/%d/stat",tid);
    f=fopen(path,"r");if(!f){error_row("identity-stat",tid);return false;}
    bool ok=fgets(line,sizeof(line),f)!=NULL;fclose(f);
    char *end=ok?strrchr(line,')'):NULL;
    if(end) {
        char *save=NULL,*field=strtok_r(end+2," ",&save);
        for(int number=3;field;number++,field=strtok_r(NULL," ",&save)) {
            if(number==22){snprintf(start,sizeof(start),"%s",field);break;}
        }
    }
    snprintf(path,sizeof(path),"/proc/%d/exe",tid);
    ssize_t n=readlink(path,exe,sizeof(exe)-1);
    if(n<0||n==(ssize_t)sizeof(exe)-1||!start[0]||tgid!=target||tracer!=getpid()) {
        errno=EPROTO;error_row("process-identity",tid);return false;
    }
    exe[n]=0;
    printf("{\"kind\":\"process-identity\",\"tid\":%d,\"tgid\":%d,\"tracerPid\":%d,\"startTime\":",tid,tgid,tracer);
    quoted(start);printf(",\"comm\":");quoted(comm);printf(",\"exe\":");quoted(exe);puts("}");
    return true;
}
static int trace_call(int request, pid_t tid, uintptr_t address, uintptr_t data) {
    return (int)ptrace(request,tid,(void*)address,(void*)data);
}
static bool memory(pid_t tid, uint64_t address, void *destination, size_t n) {
    unsigned char *out=destination;
    while(n) {
        uintptr_t aligned=(uintptr_t)address&~(sizeof(long)-1);
        size_t offset=(size_t)(address-aligned), take=sizeof(long)-offset;
        if(take>n)take=n;
        errno=0; long word=ptrace(PTRACE_PEEKDATA,tid,(void*)aligned,NULL);
        if(word==-1&&errno)return false;
        memcpy(out,(unsigned char*)&word+offset,take);
        address+=take;out+=take;n-=take;
    }
    return true;
}
static struct identity identify(pid_t tid, uint64_t fd) {
    struct identity id={0};char name[128];
    snprintf(name,sizeof(name),"/proc/%d/fd/%" PRIu64,tid,fd);
    ssize_t n=readlink(name,id.path,sizeof(id.path)-1);
    if(n<0 || n==(ssize_t)sizeof(id.path)-1 || stat(name,&id.st)) { id.error=errno?errno:ENAMETOOLONG;return id; }
    id.path[n]=0;id.valid=true;
    if(S_ISCHR(id.st.st_mode)) {
        snprintf(name,sizeof(name),"/sys/dev/char/%u:%u/subsystem",major(id.st.st_rdev),minor(id.st.st_rdev));
        n=readlink(name,id.subsystem,sizeof(id.subsystem)-1);
        if(n>=0&&(size_t)n<sizeof(id.subsystem)-1)id.subsystem[n]=0;else id.subsystem[0]=0;
        const char *number=id.path+strlen("/dev/input/event");
        bool event=strncmp(id.path,"/dev/input/event",strlen("/dev/input/event"))==0;
        if(event) { event=*number!=0; for(const char *p=number;*p;p++)if(*p<'0'||*p>'9')event=false; }
        size_t len=strlen(id.subsystem);
        id.input=event&&len>=6&&strcmp(id.subsystem+len-6,"/input")==0;
    }
    return id;
}
static bool same_identity(const struct identity *a,const struct identity *b) {
    return a->valid&&b->valid&&a->st.st_dev==b->st.st_dev&&a->st.st_ino==b->st.st_ino
        &&a->st.st_rdev==b->st.st_rdev&&a->st.st_mode==b->st.st_mode&&strcmp(a->path,b->path)==0;
}
static void print_identity(const struct identity *id) {
    printf("{\"valid\":%s,\"input\":%s,\"path\":",id->valid?"true":"false",id->input?"true":"false");quoted(id->path);
    printf(",\"subsystem\":");quoted(id->subsystem);
    printf(",\"dev\":\"%ju\",\"inode\":\"%ju\",\"rdev\":\"%ju\",\"mode\":%u,\"errno\":%d}",
        (uintmax_t)id->st.st_dev,(uintmax_t)id->st.st_ino,(uintmax_t)id->st.st_rdev,id->st.st_mode,id->error);
}
static void entry(struct thread *t,const struct ptrace_syscall_info *info) {
    struct pending *p=&t->read; memset(p,0,sizeof(*p));
    t->entry_seen=true;
    if(info->entry.nr!=SYS_read&&info->entry.nr!=SYS_readv)return;
    p->valid=true;p->supported=true;p->nr=info->entry.nr;p->fd=info->entry.args[0];p->address=info->entry.args[1];
    p->entry=identify(t->tid,p->fd);
    p->sequence=++sequence;
    printf("{\"kind\":\"read-entry\",\"op\":\"ENTRY\",\"sequence\":%" PRIu64 ",\"tid\":%d,\"nr\":%" PRIu64 ",\"fd\":%" PRIu64 ",\"address\":\"%" PRIu64 "\",\"arg2\":%" PRIu64 ",\"arch\":%u}\n",
        p->sequence,t->tid,p->nr,p->fd,p->address,(uint64_t)info->entry.args[2],info->arch);
    if(p->nr==SYS_read) { p->niov=1;p->iov[0].iov_base=(void*)(uintptr_t)p->address;p->iov[0].iov_len=info->entry.args[2]; }
    else {
        uint64_t n=info->entry.args[2];
        if(n>MAX_IOV) {p->supported=false;return;}
        p->niov=(size_t)n;
        if(!memory(t->tid,p->address,p->iov,p->niov*sizeof(struct iovec))) {p->supported=false;return;}
    }
    for(size_t i=0;i<p->niov;i++) {
        if(UINT64_MAX-p->requested<p->iov[i].iov_len){p->supported=false;return;}
        p->requested+=p->iov[i].iov_len;
    }
}
static void returned(struct thread *t,const struct ptrace_syscall_info *info) {
    struct pending *p=&t->read;
    if(!t->entry_seen)orphan_exits++;
    t->entry_seen=false;
    if(!p->valid)return;
    read_count++;
    struct identity after=identify(t->tid,p->fd);
    bool stable=same_identity(&p->entry,&after),iov_stable=true,complete=true;
    if(p->nr==SYS_readv&&p->supported) {
        struct iovec now[MAX_IOV];
        iov_stable=memory(t->tid,p->address,now,p->niov*sizeof(struct iovec))&&memcmp(now,p->iov,p->niov*sizeof(struct iovec))==0;
    }
    unsigned char data[MAX_BYTES];size_t got=0;
    uint64_t returned_bytes=info->exit.rval>0?(uint64_t)info->exit.rval:0;
    size_t limit=returned_bytes>MAX_BYTES?MAX_BYTES:(size_t)returned_bytes;
    if(limit>TOTAL_BYTES-captured)limit=TOTAL_BYTES-captured;
    if(returned_bytes>p->requested||!p->supported||!iov_stable)complete=false;
    if(complete) for(size_t i=0;i<p->niov&&got<limit;i++) {
        size_t n=p->iov[i].iov_len;if(n>limit-got)n=limit-got;
        if(!memory(t->tid,(uintptr_t)p->iov[i].iov_base,data+got,n)){complete=false;break;}got+=n;
    }
    captured+=got;
    printf("{\"kind\":\"read\",\"op\":\"EXIT\",\"sequence\":%" PRIu64 ",\"entrySequence\":%" PRIu64 ",\"tid\":%d,\"nr\":%" PRIu64 ",\"fd\":%" PRIu64,
        ++sequence,p->sequence,t->tid,p->nr,p->fd);
    printf(",\"requested\":%" PRIu64 ",\"returned\":%" PRId64 ",\"syscallError\":%s,\"entry\":",p->requested,(int64_t)info->exit.rval,info->exit.is_error?"true":"false");
    print_identity(&p->entry);printf(",\"exit\":");print_identity(&after);
    printf(",\"identityStable\":%s,\"iovStable\":%s,\"supported\":%s,\"evdev\":%s,\"captureComplete\":%s,\"hex\":\"",
        stable?"true":"false",iov_stable?"true":"false",p->supported?"true":"false",
        stable&&p->entry.input&&after.input?"true":"false",complete&&got==returned_bytes?"true":"false");
    for(size_t i=0;i<got;i++)printf("%02x",data[i]);
    printf("\"}\n");p->valid=false;
}
static bool resume(struct thread *t,int signal_number) {
    if(trace_call(PTRACE_SYSCALL,t->tid,0,(uintptr_t)signal_number)<0) {
        if(errno==ESRCH){t->alive=false;return true;}error_row("resume",t->tid);return false;
    }
    t->stopped=false;t->pending_signal=0;return true;
}
static bool stopped_event(pid_t tid,int status,bool run) {
    struct thread *t=find_thread(tid);
    if(!t){t=add_thread(tid);if(t&&!process_identity(tid))return false;}
    if(!t)return false;
    if(WIFEXITED(status)||WIFSIGNALED(status)) {
        printf("{\"kind\":\"thread-exit\",\"tid\":%d,\"status\":%d}\n",tid,status);t->alive=false;return true;
    }
    if(!WIFSTOPPED(status)){errno=EPROTO;error_row("wait-status",tid);return false;}
    t->stopped=true;int sig=WSTOPSIG(status),event=status>>16;
    if(event==PTRACE_EVENT_CLONE) {
        unsigned long child=0;
        if(ptrace(PTRACE_GETEVENTMSG,tid,NULL,&child)<0){error_row("clone-id",tid);return false;}
        if(!add_thread((pid_t)child)||failed)return false;
        if(!process_identity((pid_t)child))return false;
        printf("{\"kind\":\"clone\",\"parent\":%d,\"tid\":%lu}\n",tid,child);sig=0;
    } else if(sig==(SIGTRAP|0x80)) {
        struct ptrace_syscall_info info={0};
        long n=ptrace(PTRACE_GET_SYSCALL_INFO,tid,(void*)sizeof(info),&info);
        if(n<0){error_row("syscall-info",tid);return false;}
        size_t needed=info.op==PTRACE_SYSCALL_INFO_ENTRY?offsetof(struct ptrace_syscall_info,entry.args)+sizeof(info.entry.args)
            :offsetof(struct ptrace_syscall_info,exit.is_error)+sizeof(info.exit.is_error);
#if defined(__aarch64__)
        const uint32_t expected_arch=AUDIT_ARCH_AARCH64;
#elif defined(__riscv) && __riscv_xlen == 64
        const uint32_t expected_arch=AUDIT_ARCH_RISCV64;
#else
#error Unsupported observer architecture
#endif
        if((size_t)n<needed||info.arch!=expected_arch){errno=EPROTO;error_row("syscall-format",tid);return false;}
        if(info.op==PTRACE_SYSCALL_INFO_ENTRY)entry(t,&info);
        else if(info.op==PTRACE_SYSCALL_INFO_EXIT)returned(t,&info);
        else {errno=EPROTO;error_row("syscall-phase",tid);return false;}
        sig=0;
    } else if(event==PTRACE_EVENT_STOP) {
        if(sig!=SIGTRAP) {
            // External group-stop: do not restart the application. End this
            // observation and detach while retaining the stopping signal.
            t->pending_signal=sig;errno=EINTR;error_row("external-group-stop",tid);return false;
        }
        sig=0;
    }
    else printf("{\"kind\":\"signal\",\"tid\":%d,\"signal\":%d}\n",tid,sig);
    t->pending_signal=sig;
    return !run||resume(t,sig);
}
static int discover(void) {
    char path[80];snprintf(path,sizeof(path),"/proc/%d/task",target);
    DIR *dir=opendir(path);if(!dir){error_row("task-directory",target);return -1;}
    int added=0;struct dirent *d;
    while((d=readdir(dir))) {
        char *end;long value=strtol(d->d_name,&end,10);if(*end||value<=0||value>INT_MAX)continue;
        pid_t tid=(pid_t)value;if(find_thread(tid))continue;
        if(count>=MAX_THREADS){errno=E2BIG;error_row("thread-budget-before-seize",tid);closedir(dir);return -1;}
        if(trace_call(PTRACE_SEIZE,tid,0,PTRACE_O_TRACESYSGOOD|PTRACE_O_TRACECLONE)<0) {error_row("seize",tid);closedir(dir);return -1;}
        struct thread *t=add_thread(tid);if(!t){trace_call(PTRACE_INTERRUPT,tid,0,0);closedir(dir);return -1;}
        printf("{\"kind\":\"seized\",\"pid\":%d,\"tid\":%d}\n",target,tid);
        if(trace_call(PTRACE_INTERRUPT,tid,0,0)<0){
            if(errno==ESRCH)t->alive=false;
            else {error_row("interrupt",tid);closedir(dir);return -1;}
        }
        if(t->alive&&!process_identity(tid)){closedir(dir);return -1;}
        added++;
    }
    closedir(dir);return added;
}
static bool all_stopped(void) {
    for(size_t i=0;i<count;i++)if(threads[i].alive&&!threads[i].stopped)return false;
    return true;
}
static void cleanup(void) {
    int64_t deadline=milliseconds()+10000;
    for(size_t i=0;i<count;i++)if(threads[i].alive&&!threads[i].stopped) {
        if(trace_call(PTRACE_INTERRUPT,threads[i].tid,0,0)<0&&errno!=ESRCH)error_row("cleanup-interrupt",threads[i].tid);
    }
    while(!all_stopped()) {
        int status;pid_t tid=waitpid(-1,&status,__WALL|WNOHANG);
        if(tid==0){
            if(milliseconds()>=deadline){errno=ETIMEDOUT;error_row("cleanup-stop-timeout",target);break;}
            struct timespec pause={.tv_nsec=1000000};nanosleep(&pause,NULL);continue;
        }
        if(tid<0) {if(errno==EINTR)continue;error_row("cleanup-wait",target);break;}
        // A signal/error on one stopped TID must not abandon the other owners.
        (void)stopped_event(tid,status,false);
    }
    for(size_t i=0;i<count;i++)if(threads[i].alive) {
        if(trace_call(PTRACE_DETACH,threads[i].tid,0,(uintptr_t)threads[i].pending_signal)<0)error_row("detach",threads[i].tid);
        else printf("{\"kind\":\"detached\",\"tid\":%d}\n",threads[i].tid);
    }
}
int main(int argc,char **argv) {
    char *end=NULL;long pid=argc==2?strtol(argv[1],&end,10):0;
    if(argc!=2||!end||*end||pid<=1||pid>INT_MAX){fprintf(stderr,"usage: input-observer PID\n");return 2;}
    target=(pid_t)pid;setvbuf(stdout,NULL,_IOLBF,0);
    printf("{\"kind\":\"started\",\"pid\":%d,\"tracerPid\":%d,\"monotonicMs\":%" PRId64 "}\n",target,getpid(),milliseconds());
    struct sigaction sa={0};sa.sa_handler=signal_stop;sigemptyset(&sa.sa_mask);
    sigaction(SIGTERM,&sa,NULL);sigaction(SIGINT,&sa,NULL);sigaction(SIGALRM,&sa,NULL);alarm(180);
    // Freeze current threads, then rescan; clone events retain any new children.
    for(;;) {
        int added=discover();if(added<0)break;
        while(!all_stopped()&&!stopping) {
            int status;pid_t tid=waitpid(-1,&status,__WALL);
            if(tid<0){if(errno==EINTR)continue;error_row("initial-wait",target);break;}
            if(!stopped_event(tid,status,false))break;
        }
        if(failed||stopping||!added)break;
    }
    if(!failed&&!stopping) {
        for(size_t i=0;i<count;i++)if(threads[i].alive&&!resume(&threads[i],threads[i].pending_signal))break;
        printf("{\"kind\":\"ready\",\"pid\":%d,\"tracerPid\":%d,\"threads\":%zu,\"monotonicMs\":%" PRId64 "}\n",target,getpid(),count,milliseconds());
        while(!failed&&!stopping&&stops<MAX_STOPS) {
            int status;pid_t tid=waitpid(-1,&status,__WALL);
            if(tid<0){if(errno==EINTR)continue;if(errno==ECHILD)break;error_row("wait",target);break;}
            stops++;if(!stopped_event(tid,status,true))break;
        }
    }
    int64_t observation_end=milliseconds();
    cleanup();alarm(0);
    printf("{\"kind\":\"finished\",\"failed\":%s,\"stops\":%" PRIu64 ",\"reads\":%" PRIu64 ",\"orphanExits\":%" PRIu64 ",\"capturedBytes\":%zu,\"stopBudgetReached\":%s,\"stopSignal\":%d,\"observationEndMonotonicMs\":%" PRId64 ",\"cleanupEndMonotonicMs\":%" PRId64 "}\n",
        failed?"true":"false",stops,read_count,orphan_exits,captured,stops==MAX_STOPS?"true":"false",stopping,observation_end,milliseconds());
    return failed?1:0;
}
