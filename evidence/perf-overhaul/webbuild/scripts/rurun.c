// rurun CMD...: run CMD, then print its whole-process rusage (instructions, cycles, cpu s) as JSON on stderr-free stdout line prefix "RU "
#include <libproc.h>
#include <mach/mach_time.h>
#include <signal.h>
#include <stdio.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char **argv) {
  pid_t pid = fork();
  if (pid == 0) { execvp(argv[1], argv + 1); _exit(127); }
  siginfo_t si;
  waitid(P_PID, pid, &si, WEXITED | WNOWAIT);
  struct rusage_info_v4 ri;
  int rc = proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&ri);
  mach_timebase_info_data_t tb; mach_timebase_info(&tb);
  double k = (double)tb.numer / tb.denom / 1e9;
  if (rc == 0)
    printf("RU {\"instructions\":%llu,\"cycles\":%llu,\"user_s\":%.3f,\"sys_s\":%.3f}\n", ri.ri_instructions, ri.ri_cycles,
           ri.ri_user_time * k, ri.ri_system_time * k);
  else printf("RU {\"error\":%d}\n", rc);
  int st; waitpid(pid, &st, 0);
  return WIFEXITED(st) ? WEXITSTATUS(st) : 1;
}
