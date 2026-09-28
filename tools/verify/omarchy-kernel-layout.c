/* Offline T03n layout probe: compile against the matching kernel build only. */
#include <linux/kbuild.h>
#include <linux/mm.h>
#include <linux/sched.h>
#include <linux/sched/signal.h>
#include <asm/ptrace.h>
#include <asm/thread_info.h>

void omarchy_offsets(void);
void omarchy_offsets(void)
{
    DEFINE(TASK_SIZE, sizeof(struct task_struct));
    OFFSET(TASK_TASKS, task_struct, tasks);
    OFFSET(TASK_THREAD_NODE, task_struct, thread_node);
    OFFSET(TASK_SIGNAL, task_struct, signal);
    OFFSET(SIGNAL_THREAD_HEAD, signal_struct, thread_head);
    OFFSET(TASK_PID, task_struct, pid);
    OFFSET(TASK_TGID, task_struct, tgid);
    OFFSET(TASK_GROUP_LEADER, task_struct, group_leader);
    OFFSET(TASK_COMM, task_struct, comm);
    OFFSET(TASK_STATE, task_struct, __state);
    OFFSET(TASK_ON_CPU, task_struct, on_cpu);
    OFFSET(TASK_STACK, task_struct, stack);
    OFFSET(TASK_MM, task_struct, mm);
    OFFSET(MM_PGD, mm_struct, pgd);
    OFFSET(TASK_START_BOOTTIME, task_struct, start_boottime);
    OFFSET(TASK_UTIME, task_struct, utime);
    OFFSET(TASK_STIME, task_struct, stime);
    OFFSET(TASK_THREAD_RA, task_struct, thread.ra);
    OFFSET(TASK_THREAD_SP, task_struct, thread.sp);
    OFFSET(TASK_THREAD_S0, task_struct, thread.s[0]);
    DEFINE(THREAD_SIZE_BYTES, THREAD_SIZE);
    DEFINE(PT_SIZE, sizeof(struct pt_regs));
    OFFSET(PT_EPC, pt_regs, epc);
    OFFSET(PT_RA, pt_regs, ra);
    OFFSET(PT_SP, pt_regs, sp);
    OFFSET(PT_S0, pt_regs, s0);
    OFFSET(PT_A0, pt_regs, a0);
    OFFSET(PT_A1, pt_regs, a1);
    OFFSET(PT_A2, pt_regs, a2);
    OFFSET(PT_A3, pt_regs, a3);
    OFFSET(PT_A4, pt_regs, a4);
    OFFSET(PT_A5, pt_regs, a5);
    OFFSET(PT_A6, pt_regs, a6);
    OFFSET(PT_A7, pt_regs, a7);
    OFFSET(PT_STATUS, pt_regs, status);
    OFFSET(PT_CAUSE, pt_regs, cause);
    OFFSET(PT_ORIG_A0, pt_regs, orig_a0);
}
