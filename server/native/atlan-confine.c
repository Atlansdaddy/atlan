/* atlan-confine — Atlan's homebuilt confinement launcher.
 *
 * WHAT THIS IS, PRECISELY. It sits between Node and an agent process, MEASURES
 * what this device will actually enforce by attempting the operation, installs
 * the strongest of {capability removal, egress denial, filesystem confinement}
 * the device proved it can hold, then execve()s the agent. It is not a sandbox
 * on an unrooted phone and this file never says it is. On Android there is no
 * filesystem boundary available to an app — not to Atlan, not to anything — so
 * the phone tier is capability removal and the UI string says exactly that.
 *
 * WHY IT IS A SEPARATE BINARY AND NOT A NODE ADDON. Landlock's domain and
 * seccomp's filter are per-THREAD unless you ask for TSYNC. Node runs a libuv
 * threadpool. An addon would jail the calling thread while every pool thread
 * stayed unrestricted, and a synchronous probe would report "confined" — the
 * exact shape of lie this project exists to refuse. A freshly exec'd process
 * has spawned no threads, so per-thread semantics and TSYNC are both non-issues
 * BY CONSTRUCTION rather than by a flag we hope was honoured.
 *
 * WHY EVERY CHECK IS AN ATTEMPT AND NEVER A FILE READ. Hard project rule, and
 * it was earned:  /sys/kernel/security/lsm reads "n/a" on hosts where Landlock
 * is actively enforcing; /proc/sys/user/max_user_namespaces is registered
 * unconditionally by kernel/ucount.c with no CONFIG_USER_NS guard and fork_init()
 * fills every ucount_max, so it reads a large positive number on a kernel built
 * WITHOUT user namespaces. A flag file lies in both directions. Nothing in this
 * file reads /proc/sys, /sys/kernel, uname, an Android release, ANDROID_*, or
 * TracerPid. Every rung below forks a child, performs the operation, and reports
 * what the kernel did.
 *
 * WHY THE PROBE FORKS. On Android a syscall the platform forbids arrives as
 * SECCOMP_RET_TRAP — a fatal SIGSYS, not an errno. An in-process probe would
 * kill the Atlan server. Every rung is a forked child with a SIGSYS handler
 * installed first, and the parent reads the verdict off the wait status.
 *
 * LAYER ORDER IS A CORRECTNESS CONSTRAINT, NOT A PREFERENCE:
 *   L1 fd + env hygiene   close_range(3,~0U) · chdir · no tty on 0/1/2
 *   L2 PR_SET_NO_NEW_PRIVS   free, irrevocable, inherited, prerequisite for L3/L4
 *   L3 Landlock restrict_self   BEFORE L4 — our own allow-list would otherwise
 *                               deny the landlock_* syscalls we are about to make
 *   L4 seccomp cBPF          arch guard first · explicit deny · allow-list · default KILL
 *   execve                   filter + domain survive exec and every fork after it
 *
 * L1 IS NOT HARDENING, IT IS A PRECONDITION. Landlock checks at open() and never
 * at read(); seccomp cannot see an existing handle at all. Atlan spawns from a
 * long-lived Node process holding the session store, the key store and a live
 * WebSocket. Skip L1 and L2-L4 are decorative. An inherited tty on 0/1/2 is
 * TIOCSTI keystroke injection into the parent's shell on any kernel below
 * Landlock ABI 5, so confine mode REFUSES rather than silently discarding it.
 *
 * MODES
 *   atlan-confine --probe                  one JSON object on stdout, exit 0
 *   atlan-confine --learn -- <argv>         observed syscall set (allow-list authoring)
 *   atlan-confine <policy>|@<fd> -- <argv>  confine and exec
 *
 * THE POLICY IS NEWLINE-DELIMITED key=value, NEVER JSON, AND NEVER A PATH.
 * A JSON parser is ~150 lines of attack surface in the one process that must not
 * have bugs; a flat directive list has no nesting, no escapes and no ambiguity.
 * A PATH would be a TOCTOU surface — the launcher's own configuration is the last
 * thing that should be swappable between resolution and read — so we accept only
 * an argv literal (frozen by execve, unswappable) or a file descriptor.
 */

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <dirent.h>
#include <netinet/in.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>

/* ── ABI identity. Refusing to build for a syscall table we cannot name is the
 * first fail-closed decision in the program: a filter written against the wrong
 * table is not a weak filter, it is a silent total bypass. ── */
#if defined(__x86_64__)
#define ATLAN_ARCH AUDIT_ARCH_X86_64
#define ATLAN_ARCH_NAME "x86_64"
#elif defined(__aarch64__)
#define ATLAN_ARCH AUDIT_ARCH_AARCH64
#define ATLAN_ARCH_NAME "aarch64"
#elif defined(__arm__)
#define ATLAN_ARCH AUDIT_ARCH_ARM
#define ATLAN_ARCH_NAME "arm"
#elif defined(__i386__)
#define ATLAN_ARCH AUDIT_ARCH_I386
#define ATLAN_ARCH_NAME "i386"
#elif defined(__riscv) && __riscv_xlen == 64
#define ATLAN_ARCH AUDIT_ARCH_RISCV64
#define ATLAN_ARCH_NAME "riscv64"
#else
#error "atlan-confine: unnamed ABI - refusing to emit a filter for a syscall table we cannot identify"
#endif

#ifndef SECCOMP_SET_MODE_FILTER
#define SECCOMP_SET_MODE_FILTER 1
#endif
#ifndef SECCOMP_FILTER_FLAG_TSYNC
#define SECCOMP_FILTER_FLAG_TSYNC (1UL << 0)
#endif
#ifndef SECCOMP_FILTER_FLAG_NEW_LISTENER
#define SECCOMP_FILTER_FLAG_NEW_LISTENER (1UL << 3)
#endif
#ifndef SECCOMP_RET_KILL_PROCESS
#define SECCOMP_RET_KILL_PROCESS 0x80000000U
#endif
#ifndef SECCOMP_RET_TRAP
#define SECCOMP_RET_TRAP 0x00030000U
#endif
#ifndef SECCOMP_RET_ERRNO
#define SECCOMP_RET_ERRNO 0x00050000U
#endif
#ifndef SECCOMP_RET_TRACE
#define SECCOMP_RET_TRACE 0x7ff00000U
#endif
#ifndef SECCOMP_RET_LOG
#define SECCOMP_RET_LOG 0x7ffc0000U
#endif
#ifndef SECCOMP_RET_ALLOW
#define SECCOMP_RET_ALLOW 0x7fff0000U
#endif
#ifndef SECCOMP_RET_DATA
#define SECCOMP_RET_DATA 0x0000ffffU
#endif
#ifndef PR_SET_NO_NEW_PRIVS
#define PR_SET_NO_NEW_PRIVS 38
#endif
#ifndef EOWNERDEAD
#define EOWNERDEAD 130
#endif

/* Syscall numbers for the post-4.x additions are ABI-NEUTRAL (same number on
 * x86_64 and aarch64), so a missing header constant is a toolchain-age problem,
 * not an ABI problem, and hardcoding the neutral number is correct. Anything
 * ABI-SPECIFIC is left to <sys/syscall.h> and guarded with -1 below. */
#ifndef __NR_close_range
#define __NR_close_range 436
#endif
#ifndef __NR_landlock_create_ruleset
#define __NR_landlock_create_ruleset 444
#endif
#ifndef __NR_landlock_add_rule
#define __NR_landlock_add_rule 445
#endif
#ifndef __NR_landlock_restrict_self
#define __NR_landlock_restrict_self 446
#endif
#ifndef __NR_io_uring_setup
#define __NR_io_uring_setup 425
#endif
#ifndef __NR_io_uring_enter
#define __NR_io_uring_enter 426
#endif
#ifndef __NR_io_uring_register
#define __NR_io_uring_register 427
#endif
#ifndef __NR_pidfd_open
#define __NR_pidfd_open 434
#endif
#ifndef __NR_pidfd_getfd
#define __NR_pidfd_getfd 438
#endif
#ifndef __NR_pidfd_send_signal
#define __NR_pidfd_send_signal 424
#endif
#ifndef __NR_openat2
#define __NR_openat2 437
#endif
#ifndef __NR_faccessat2
#define __NR_faccessat2 439
#endif
#ifndef __NR_memfd_secret
#define __NR_memfd_secret 447
#endif
#ifndef __NR_open_tree
#define __NR_open_tree 428
#endif
#ifndef __NR_move_mount
#define __NR_move_mount 429
#endif
#ifndef __NR_fsopen
#define __NR_fsopen 430
#endif
#ifndef __NR_fsconfig
#define __NR_fsconfig 431
#endif
#ifndef __NR_fsmount
#define __NR_fsmount 432
#endif
#ifndef __NR_fspick
#define __NR_fspick 433
#endif
#ifndef __NR_mount_setattr
#define __NR_mount_setattr 442
#endif
#ifndef __NR_futex_waitv
#define __NR_futex_waitv 449
#endif
#ifndef __NR_process_madvise
#define __NR_process_madvise 440
#endif
#ifndef __NR_epoll_pwait2
#define __NR_epoll_pwait2 441
#endif
#ifndef __NR_clone3
#define __NR_clone3 435
#endif
#ifndef __NR_statx
#define __NR_statx 291
#endif
#ifndef __NR_rseq
#define __NR_rseq 293
#endif
#ifndef __NR_copy_file_range
#define __NR_copy_file_range 285
#endif
#ifndef __NR_vhangup
#define __NR_vhangup -1
#endif

/* The legacy syscalls that genuinely differ between ABIs: present on x86_64,
 * absent from the aarch64 generic table. -1 means "this ABI does not have it",
 * and the emitter skips -1 rather than emitting a rule for syscall -1 — which
 * would match the "unknown syscall" pseudo-number and open a hole. */
#ifndef __NR_open
#define __NR_open -1
#endif
#ifndef __NR_creat
#define __NR_creat -1
#endif
#ifndef __NR_access
#define __NR_access -1
#endif
#ifndef __NR_stat
#define __NR_stat -1
#endif
#ifndef __NR_lstat
#define __NR_lstat -1
#endif
#ifndef __NR_poll
#define __NR_poll -1
#endif
#ifndef __NR_select
#define __NR_select -1
#endif
#ifndef __NR_dup2
#define __NR_dup2 -1
#endif
#ifndef __NR_pipe
#define __NR_pipe -1
#endif
#ifndef __NR_fork
#define __NR_fork -1
#endif
#ifndef __NR_vfork
#define __NR_vfork -1
#endif
#ifndef __NR_getdents
#define __NR_getdents -1
#endif
#ifndef __NR_mkdir
#define __NR_mkdir -1
#endif
#ifndef __NR_rmdir
#define __NR_rmdir -1
#endif
#ifndef __NR_unlink
#define __NR_unlink -1
#endif
#ifndef __NR_symlink
#define __NR_symlink -1
#endif
#ifndef __NR_readlink
#define __NR_readlink -1
#endif
#ifndef __NR_chmod
#define __NR_chmod -1
#endif
#ifndef __NR_chown
#define __NR_chown -1
#endif
#ifndef __NR_lchown
#define __NR_lchown -1
#endif
#ifndef __NR_rename
#define __NR_rename -1
#endif
#ifndef __NR_link
#define __NR_link -1
#endif
#ifndef __NR_epoll_create
#define __NR_epoll_create -1
#endif
#ifndef __NR_epoll_wait
#define __NR_epoll_wait -1
#endif
#ifndef __NR_inotify_init
#define __NR_inotify_init -1
#endif
#ifndef __NR_alarm
#define __NR_alarm -1
#endif
#ifndef __NR_pause
#define __NR_pause -1
#endif
#ifndef __NR_time
#define __NR_time -1
#endif
#ifndef __NR_utime
#define __NR_utime -1
#endif
#ifndef __NR_utimes
#define __NR_utimes -1
#endif
#ifndef __NR_futimesat
#define __NR_futimesat -1
#endif
#ifndef __NR_getpgrp
#define __NR_getpgrp -1
#endif
#ifndef __NR_arch_prctl
#define __NR_arch_prctl -1
#endif
#ifndef __NR_mmap2
#define __NR_mmap2 -1
#endif
#ifndef __NR_socketcall
#define __NR_socketcall -1
#endif
#ifndef __NR_uselib
#define __NR_uselib -1
#endif
#ifndef __NR_modify_ldt
#define __NR_modify_ldt -1
#endif
#ifndef __NR_umount
#define __NR_umount -1
#endif
#ifndef __NR_create_module
#define __NR_create_module -1
#endif
#ifndef __NR_nfsservctl
#define __NR_nfsservctl -1
#endif
#ifndef __NR_getcpu
#define __NR_getcpu -1
#endif
#ifndef __NR_sync_file_range
#define __NR_sync_file_range -1
#endif
#ifndef __NR_signalfd
#define __NR_signalfd -1
#endif
#ifndef __NR_eventfd
#define __NR_eventfd -1
#endif
#ifndef __NR_epoll_create1
#define __NR_epoll_create1 -1
#endif
#ifndef __NR_sysinfo
#define __NR_sysinfo -1
#endif

/* The marker syscall the sentinel/arch/exec rungs arbitrate on. It must be one
 * NOTHING in libc startup or the loader calls, or a rung would measure the
 * loader instead of our decision. getcpu(2) qualifies on every ABI Atlan ships
 * to; ioprio_get is the fallback if a future ABI drops it. */
#if __NR_getcpu > 0
#define MARKER_NR __NR_getcpu
#define MARKER_NAME "getcpu"
#else
#define MARKER_NR __NR_ioprio_get
#define MARKER_NAME "ioprio_get"
#endif

/* ── Landlock ABI. Defined here rather than included: a build box with 5.x
 * headers must still emit a correct ruleset for a 6.x kernel, and the struct
 * layout is uapi-frozen. ── */
struct ll_ruleset_attr { uint64_t handled_access_fs; };
struct ll_path_beneath_attr { uint64_t allowed_access; int32_t parent_fd; } __attribute__((packed));
#define LL_CREATE_RULESET_VERSION (1U << 0)
#define LL_RULE_PATH_BENEATH 1
#define LL_EXECUTE      (1ULL << 0)
#define LL_WRITE_FILE   (1ULL << 1)
#define LL_READ_FILE    (1ULL << 2)
#define LL_READ_DIR     (1ULL << 3)
#define LL_ABI1_MASK 0x1fffULL /* bits 0-12  */
#define LL_ABI2_MASK 0x3fffULL /* + REFER    */
#define LL_ABI3_MASK 0x7fffULL /* + TRUNCATE */
#define LL_ABI5_MASK 0xffffULL /* + IOCTL_DEV */
#define LL_RO (LL_EXECUTE | LL_READ_FILE | LL_READ_DIR)

static char g_self[4096];

static void die(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  fprintf(stderr, "atlan-confine: "); vfprintf(stderr, fmt, ap); fprintf(stderr, "\n");
  va_end(ap); _exit(70);
}

/* ─────────────────────────── filter construction ─────────────────────────── */

#define MAXI 3800
static struct sock_filter F[MAXI];
static int FN;

static void emit(struct sock_filter i) { if (FN >= MAXI) die("filter overflow"); F[FN++] = i; }

/* Every comparison carries its own RET, so jt/jf are always 0/1 and can never
 * overflow the 8-bit jump field. 2 instructions per syscall is the price of a
 * table that stays correct as it grows past 128 entries — the classic cBPF bug. */
static void rule(int nr, uint32_t action) {
  if (nr < 0) return; /* absent on this ABI: emitting a rule for -1 would match
                       * the "unknown syscall" pseudo-number and open a hole */
  emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)nr, 0, 1));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, action));
}
#define ERRNO(e) (SECCOMP_RET_ERRNO | ((uint32_t)(e) & SECCOMP_RET_DATA))

/* Arch guard FIRST and unconditionally. A compat (32-bit) process entering
 * through the same filter would index a DIFFERENT syscall table, so every
 * allow-rule below would name the wrong call. We do not narrow there, we kill. */
static void emit_arch_guard(void) {
  FN = 0;
  emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)));
  emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, ATLAN_ARCH, 1, 0));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
}

/* The named capability-removal set. These are the syscalls the T1 UI string
 * promises are gone, plus the structural set that makes that promise hold.
 * They are emitted BEFORE the allow-list so a future widening of the allow-list
 * can never resurrect one — deny wins by POSITION, not by review discipline.
 * EPERM rather than KILL because a program that finds ptrace/mount refused is a
 * program in a situation it already handles; the DEFAULT tail kills instead,
 * because there we did not anticipate the call and quiet is the wrong answer. */
static void emit_deny_set(void) {
  static const int deny[] = {
    /* the io_uring family: ring opcodes never become syscalls, so a filter that
     * io_uring walks around is decorative — this is why rung 6 exists */
    __NR_io_uring_setup, __NR_io_uring_enter, __NR_io_uring_register,
    /* cross-process memory + descriptor theft */
    __NR_ptrace, __NR_process_vm_readv, __NR_process_vm_writev, __NR_process_madvise,
    __NR_pidfd_open, __NR_pidfd_getfd, __NR_pidfd_send_signal,
    /* fault handling as a primitive for TOCTOU-widening */
    __NR_userfaultfd,
    /* kernel programmability + observation */
    __NR_bpf, __NR_perf_event_open,
    __NR_keyctl, __NR_add_key, __NR_request_key,
    /* namespace + mount surface. Absent on Android, present on the accessory,
     * denied on both so the tier means the same thing on both. */
    __NR_unshare, __NR_setns, __NR_mount, __NR_umount2, __NR_umount,
    __NR_pivot_root, __NR_chroot, __NR_open_tree, __NR_move_mount,
    __NR_fsopen, __NR_fsconfig, __NR_fsmount, __NR_fspick, __NR_mount_setattr,
    /* the classic chroot/Landlock escape: a handle names an inode with no path */
    __NR_open_by_handle_at, __NR_name_to_handle_at,
    /* kernel image + module surface */
    __NR_init_module, __NR_finit_module, __NR_delete_module,
    __NR_kexec_load, __NR_kexec_file_load, __NR_create_module, __NR_nfsservctl,
    /* machine-wide effects */
    __NR_reboot, __NR_swapon, __NR_swapoff, __NR_acct, __NR_quotactl, __NR_syslog,
    __NR_settimeofday, __NR_clock_settime, __NR_adjtimex, __NR_clock_adjtime,
    /* ABI and address-space games */
    __NR_personality, __NR_modify_ldt, __NR_uselib, __NR_memfd_secret,
    /* identity. NO_NEW_PRIVS already makes these unable to GAIN privilege, but
     * a confined process has no business changing who it is at all. */
    __NR_setuid, __NR_setgid, __NR_setreuid, __NR_setregid,
    __NR_setresuid, __NR_setresgid, __NR_setfsuid, __NR_setfsgid,
    __NR_setgroups, __NR_capset,
  };
  for (unsigned i = 0; i < sizeof(deny) / sizeof(deny[0]); i++) rule(deny[i], ERRNO(EPERM));
}

/* Egress. Four instructions on a scalar register, exact and irrevocable: no
 * string is inspected, no hostname is resolved, no address is parsed. Denying
 * socket() at the source also closes Android's DNS resolver socket and loopback
 * to Atlan's own cockpit, which is the confused-deputy path. It is applied ONLY
 * where the process has no legitimate reason to open one — never to an agent CLI,
 * because THAT process IS the thing talking to the model provider. */
static void emit_egress_deny(void) {
  rule(__NR_socket, ERRNO(EACCES));
  rule(__NR_socketcall, ERRNO(EACCES));
}

static void emit_allow_set(void) {
  static const int allow[] = {
    /* process lifecycle */
    __NR_execve, __NR_execveat, __NR_exit, __NR_exit_group, __NR_wait4, __NR_waitid,
    __NR_fork, __NR_vfork, __NR_clone, __NR_clone3,
    __NR_getpid, __NR_getppid, __NR_gettid, __NR_set_tid_address,
    __NR_set_robust_list, __NR_get_robust_list, __NR_rseq, __NR_prctl, __NR_arch_prctl,
    __NR_restart_syscall, __NR_sched_yield, __NR_sched_getaffinity, __NR_sched_setaffinity,
    __NR_sched_getparam, __NR_sched_getscheduler, __NR_sched_setscheduler,
    __NR_sched_get_priority_max, __NR_sched_get_priority_min, __NR_sched_rr_get_interval,
    __NR_getrandom, __NR_uname, __NR_sysinfo, __NR_getcpu, __NR_membarrier,
    /* narrowing further is always allowed: a nested atlan-confine may only
     * subtract. Letting it run is how offload-to-the-accessory composes. */
    __NR_seccomp, __NR_landlock_create_ruleset, __NR_landlock_add_rule, __NR_landlock_restrict_self,
    /* memory */
    __NR_brk, __NR_mmap, __NR_mmap2, __NR_munmap, __NR_mremap, __NR_mprotect,
    __NR_madvise, __NR_mlock, __NR_munlock, __NR_mlockall, __NR_munlockall,
    __NR_msync, __NR_mincore, __NR_memfd_create,
    /* file io */
    __NR_read, __NR_write, __NR_readv, __NR_writev, __NR_pread64, __NR_pwrite64,
    __NR_preadv, __NR_pwritev, __NR_preadv2, __NR_pwritev2,
    __NR_open, __NR_openat, __NR_openat2, __NR_creat, __NR_close, __NR_close_range,
    __NR_stat, __NR_fstat, __NR_lstat, __NR_newfstatat, __NR_statx,
    __NR_statfs, __NR_fstatfs, __NR_lseek, __NR_access, __NR_faccessat, __NR_faccessat2,
    __NR_getdents, __NR_getdents64, __NR_getcwd, __NR_chdir, __NR_fchdir,
    __NR_mkdir, __NR_mkdirat, __NR_rmdir, __NR_unlink, __NR_unlinkat,
    __NR_rename, __NR_renameat, __NR_renameat2, __NR_link, __NR_linkat,
    __NR_symlink, __NR_symlinkat, __NR_readlink, __NR_readlinkat,
    __NR_chmod, __NR_fchmod, __NR_fchmodat, __NR_chown, __NR_fchown, __NR_lchown, __NR_fchownat,
    __NR_truncate, __NR_ftruncate, __NR_dup, __NR_dup2, __NR_dup3,
    __NR_pipe, __NR_pipe2, __NR_fcntl, __NR_ioctl, __NR_flock,
    __NR_fsync, __NR_fdatasync, __NR_sync, __NR_syncfs, __NR_sync_file_range,
    __NR_fallocate, __NR_utimensat, __NR_utime, __NR_utimes, __NR_futimesat,
    __NR_umask, __NR_sendfile, __NR_copy_file_range, __NR_splice, __NR_tee,
    __NR_fadvise64, __NR_readahead,
    __NR_inotify_init, __NR_inotify_init1, __NR_inotify_add_watch, __NR_inotify_rm_watch,
    __NR_getxattr, __NR_lgetxattr, __NR_fgetxattr, __NR_listxattr, __NR_llistxattr, __NR_flistxattr,
    __NR_setxattr, __NR_lsetxattr, __NR_fsetxattr, __NR_removexattr, __NR_lremovexattr, __NR_fremovexattr,
    /* signals */
    __NR_rt_sigaction, __NR_rt_sigprocmask, __NR_rt_sigreturn, __NR_rt_sigpending,
    __NR_rt_sigtimedwait, __NR_rt_sigqueueinfo, __NR_rt_sigsuspend, __NR_sigaltstack,
    __NR_kill, __NR_tkill, __NR_tgkill, __NR_signalfd, __NR_signalfd4,
    __NR_eventfd, __NR_eventfd2,
    __NR_timerfd_create, __NR_timerfd_settime, __NR_timerfd_gettime,
    __NR_timer_create, __NR_timer_settime, __NR_timer_gettime, __NR_timer_delete, __NR_timer_getoverrun,
    __NR_setitimer, __NR_getitimer, __NR_alarm, __NR_pause,
    /* time */
    __NR_clock_gettime, __NR_clock_getres, __NR_clock_nanosleep, __NR_nanosleep,
    __NR_gettimeofday, __NR_time, __NR_times,
    /* multiplexing */
    __NR_poll, __NR_ppoll, __NR_select, __NR_pselect6,
    __NR_epoll_create, __NR_epoll_create1, __NR_epoll_ctl,
    __NR_epoll_wait, __NR_epoll_pwait, __NR_epoll_pwait2,
    __NR_futex, __NR_futex_waitv,
    /* identity: reads only. Every setter is in the deny set above. */
    __NR_getuid, __NR_geteuid, __NR_getgid, __NR_getegid,
    __NR_getresuid, __NR_getresgid, __NR_getgroups, __NR_capget,
    __NR_setpgid, __NR_getpgid, __NR_getpgrp, __NR_setsid, __NR_getsid,
    __NR_getpriority, __NR_setpriority, __NR_getrlimit, __NR_setrlimit,
    __NR_prlimit64, __NR_getrusage,
    /* sockets. Present at T1 because an agent CLI reaching its provider IS the
     * product; removed wholesale by emit_egress_deny() at T2, where the process
     * is a shell the agent asked for and has no such need. */
    __NR_socket, __NR_socketpair, __NR_bind, __NR_connect, __NR_listen,
    __NR_accept, __NR_accept4, __NR_getsockname, __NR_getpeername,
    __NR_sendto, __NR_recvfrom, __NR_sendmsg, __NR_recvmsg,
    __NR_sendmmsg, __NR_recvmmsg, __NR_shutdown, __NR_setsockopt, __NR_getsockopt,
  };
  for (unsigned i = 0; i < sizeof(allow) / sizeof(allow[0]); i++) rule(allow[i], SECCOMP_RET_ALLOW);
}

/* A syscall number the kernel CANNOT DISPATCH is not the same thing as a syscall
 * we failed to anticipate, and conflating them is what made the phone tier T0.
 *
 * A ptrace supervisor voids a syscall by rewriting nr to a sentinel. PRoot does
 * this for unshare, setns, mount and others — its own source says why: "sandbox
 * helpers like bubblewrap only check the return value". Measured here, from the
 * kernel's audit ring, running our own launcher under proot:
 *
 *     type=1326 ... comm="atlan-confine" sig=31 arch=c000003e syscall=-2
 *                   code=0x80000000        (SECCOMP_RET_KILL_PROCESS)
 *
 * -2 read as unsigned is 0xFFFFFFFE, far above any real syscall number, so
 * do_syscall_64's `unr < NR_syscalls` bound check fails and the kernel returns
 * ENOSYS without reaching a handler. It cannot dispatch, therefore it cannot be
 * a capability. But our default tail KILLED it — and since proot voids syscalls
 * on the way past, every proot-hosted process died. Atlan runs inside proot on
 * the phone, so that was the whole platform.
 *
 * So the tail splits in two, by what the number can actually DO:
 *   out of range   -> ENOSYS, quietly. There is nothing to refuse loudly; the
 *                     kernel's own answer is ENOSYS and we give the same one
 *                     without letting the call through at all.
 *   in range, unlisted -> KILL_PROCESS, unchanged. That is a hole in our model
 *                     and quiet is still the wrong answer there.
 *
 * The ceiling is deliberately far above any current ABI (x86_64 and arm64 are
 * both under 500) and far below any sentinel. It is a range test, not a list of
 * one supervisor's magic numbers, so it composes with any supervisor that voids
 * this way rather than only with the one we happened to measure.
 *
 * This does NOT relax rule()'s `if (nr < 0) return`. That guard stops an
 * undefined __NR_foo — which the preprocessor makes -1 — from silently emitting
 * an ALLOW that matches every unknown syscall. It is right and it stays. This is
 * a separate, deliberate, single rule with its own reasoning. */
#define SYSCALL_NR_CEILING 1024u
static void emit_undispatchable_enosys(void) {
  /* nr is already loaded in A by emit_arch_guard(). */
  emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, SYSCALL_NR_CEILING, 0, 1));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, ERRNO(ENOSYS)));
}

/* Default-deny tail. KILL_PROCESS, not EPERM: a syscall we did not anticipate is
 * a hole in our model, and the acceptable failure direction for a too-tight
 * allow-list is LOUD — the engine dies at startup, in CI, on the smoke corpus,
 * at the point of change. Old kernels that do not know KILL_PROCESS fall back to
 * KILL_THREAD, which is also fatal, so this never degrades to "allow". */
static int build_filter(int deny_egress) {
  emit_arch_guard();
  /* Before the deny set on purpose: every deny-set entry is a real, in-range
   * syscall, so this cannot shadow one — and putting it first means the cheapest
   * test runs first on the hot path. */
  emit_undispatchable_enosys();
  emit_deny_set();
  if (deny_egress) emit_egress_deny();
  emit_allow_set();
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  return FN;
}

static int install_prog(struct sock_filter *f, int n) {
  struct sock_fprog prog = { .len = (unsigned short)n, .filter = f };
  return (int)syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog);
}
static int nnp(void) { return prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0); }

/* A one-syscall filter, used by the rungs that need to prove the kernel is
 * arbitrating OUR decision rather than that a syscall happened to fail. */
static int install_marker_filter(uint32_t action) {
  FN = 0;
  emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
  emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MARKER_NR, 0, 1));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, action));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
  return install_prog(F, FN);
}
static long marker(void) { return syscall(MARKER_NR, NULL, NULL, NULL); }

/* ───────────────────────────────── L1-L4 ─────────────────────────────────── */

/* Proof, not effort. close_range(2) is a kernel primitive with defined
 * semantics, so its success IS the proof; the fallback path must instead
 * re-enumerate and show nothing above 2 survived, and refuse if it cannot look. */
static int fd_hygiene(int keep_open_max, int spare, char *err, size_t errn) {
  /* `spare` is ONLY ever set by rung 10, whose report pipe would otherwise be
   * swept by the very sweep it is reporting on. The confine path passes -1 and
   * keeps nothing: an exemption there would be the hole this layer exists for. */
  if (spare < 0 && syscall(__NR_close_range, (unsigned)(keep_open_max + 1), ~0U, 0) == 0) return 0;
  if (spare >= 0 && spare > keep_open_max + 1
      && syscall(__NR_close_range, (unsigned)(keep_open_max + 1), (unsigned)(spare - 1), 0) == 0
      && syscall(__NR_close_range, (unsigned)(spare + 1), ~0U, 0) == 0) return 0;
  DIR *d = opendir("/proc/self/fd");
  if (!d) { snprintf(err, errn, "close_range unavailable (%s) and /proc/self/fd unreadable — cannot PROVE fd %d+ are closed", strerror(errno), keep_open_max + 1); return -1; }
  int dfd = dirfd(d);
  struct dirent *e;
  while ((e = readdir(d))) { int fd = atoi(e->d_name); if (fd > keep_open_max && fd != dfd && fd != spare) close(fd); }
  closedir(d);
  d = opendir("/proc/self/fd");
  if (!d) { snprintf(err, errn, "/proc/self/fd vanished mid-sweep — cannot prove closure"); return -1; }
  dfd = dirfd(d); int leaked = -1;
  while ((e = readdir(d))) { int fd = atoi(e->d_name); if (fd > keep_open_max && fd != dfd && fd != spare && e->d_name[0] >= '0' && e->d_name[0] <= '9') leaked = fd; }
  closedir(d);
  if (leaked >= 0) { snprintf(err, errn, "fd %d survived the sweep — an inherited descriptor defeats every layer below", leaked); return -1; }
  return 0;
}

static uint64_t ll_handled(int abi) {
  if (abi >= 5) return LL_ABI5_MASK;
  if (abi >= 3) return LL_ABI3_MASK;
  if (abi >= 2) return LL_ABI2_MASK;
  return LL_ABI1_MASK;
}
static int ll_abi(void) { return (int)syscall(__NR_landlock_create_ruleset, NULL, 0, LL_CREATE_RULESET_VERSION); }

/* The same question, asked in a CHILD, because on some platforms asking it is
 * fatal to the asker.
 *
 * Landlock is syscall 444. An Android whose app seccomp policy predates Landlock
 * does not have 444 in its allowlist, and the platform's filter does not answer
 * ENOSYS — it KILLS the caller. SIGSYS, uncatchable, from Android's filter rather
 * than from ours, so no handler and no allow-rule of ours can change it.
 *
 * ll_abi() was called inline as a printf argument in do_probe, in the main
 * process, after all sixteen rungs had already run and their results were
 * collected. On a Galaxy S9 (Android 10, kernel 4.9.186) the probe therefore died
 * while formatting its output line and printed NOTHING — every rung measured,
 * the whole report lost on the last statement, and the device read as "no output"
 * rather than as the T0 it actually is.
 *
 * rung() already survives exactly this, and says so in its own message: "SIGSYS —
 * this platform's own seccomp filter denies the call outright". This asks the
 * same way. A device that kills on 444 costs one child and reports abi 0, which
 * is the truth there: no Landlock. */
static int ll_abi_safe(void) {
  int pfd[2];
  if (pipe(pfd)) return 0;
  pid_t c = fork();
  if (c < 0) { close(pfd[0]); close(pfd[1]); return 0; }
  if (c == 0) {
    close(pfd[0]);
    int a = ll_abi();
    ssize_t w = write(pfd[1], &a, sizeof(a));
    (void)w;
    _exit(0);
  }
  close(pfd[1]);
  int a = 0;
  ssize_t got = read(pfd[0], &a, sizeof(a));
  close(pfd[0]);
  int st = 0;
  waitpid(c, &st, 0);
  /* Killed by the platform's filter, short read, or a non-zero exit: no ABI.
   * Reporting 0 rather than a negative errno keeps "landlockAbi" meaning the
   * same thing on every host — the number of the ABI, or none. */
  if (got != (ssize_t)sizeof(a) || WIFSIGNALED(st) || a < 0) return 0;
  return a;
}

/* File-applicable rights only. Landlock rejects a rule with EINVAL when the mask
 * carries a directory-only right and parent_fd names a regular file — which is
 * how a single-FILE grant (one auth store, one ld.so.cache) fails closed rather
 * than being silently dropped. Narrowing the mask is what makes those grants
 * expressible at all, and it is why the grant list can be per-file instead of
 * per-directory: a per-directory /etc grant would hand over /etc/shadow. */
#define LL_FILE_RIGHTS (LL_EXECUTE | LL_WRITE_FILE | LL_READ_FILE | (1ULL << 14) /*TRUNCATE*/ | (1ULL << 15) /*IOCTL_DEV*/)
static int ll_grant(int rs, const char *path, uint64_t access, char *err, size_t errn) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) { snprintf(err, errn, "grant path not openable: %s (%s)", path, strerror(errno)); return -1; }
  struct stat sb;
  if (fstat(fd, &sb) == 0 && !S_ISDIR(sb.st_mode)) access &= LL_FILE_RIGHTS;
  struct ll_path_beneath_attr pb = { .allowed_access = access, .parent_fd = fd };
  int r = (int)syscall(__NR_landlock_add_rule, rs, LL_RULE_PATH_BENEATH, &pb, 0);
  int e = errno; close(fd);
  if (r) { snprintf(err, errn, "landlock_add_rule(%s) failed: %s", path, strerror(e)); return -1; }
  return 0;
}

/* ─────────────────────────────── policy ──────────────────────────────────── */

#define MAXG 64
struct policy {
  char tier[8];
  int deny_egress;
  int want_fs;
  char *ro[MAXG]; int nro;
  char *rw[MAXG]; int nrw;
  char *cwd;
  char *scratch;
};

/* Unknown key => refuse. A launcher that shrugs at a directive it does not
 * understand is a launcher that silently runs a policy nobody wrote. */
static void parse_policy(char *buf, struct policy *p) {
  memset(p, 0, sizeof(*p));
  strcpy(p->tier, "T0");
  for (char *line = buf, *nl; line && *line; line = nl) {
    nl = strchr(line, '\n');
    if (nl) *nl++ = 0;
    if (!*line || *line == '#') continue;
    char *eq = strchr(line, '=');
    if (!eq) die("policy: line without '=': %.40s", line);
    *eq = 0;
    char *k = line, *v = eq + 1;
    if (!strcmp(k, "tier")) { snprintf(p->tier, sizeof(p->tier), "%s", v); }
    else if (!strcmp(k, "egress")) { p->deny_egress = !strcmp(v, "deny"); if (strcmp(v, "deny") && strcmp(v, "open")) die("policy: egress must be deny|open"); }
    else if (!strcmp(k, "fs")) { p->want_fs = !strcmp(v, "landlock"); if (strcmp(v, "landlock") && strcmp(v, "none")) die("policy: fs must be landlock|none"); }
    else if (!strcmp(k, "cwd")) { p->cwd = v; }
    /* Single-purpose on purpose. A general env= directive would let a policy set
     * LD_PRELOAD, which is a loader-level hook we would then have to reason
     * about; `scratch` does the one thing that is actually needed. It exists
     * because granting /tmp is the alternative, and /tmp is a shared surface
     * between agents that can also, on some layouts, make a credential
     * directory reachable — assertGrantsSafe caught exactly that. */
    else if (!strcmp(k, "scratch")) { p->scratch = v; }
    else if (!strcmp(k, "ro")) { if (p->nro >= MAXG) die("policy: too many ro grants"); p->ro[p->nro++] = v; }
    else if (!strcmp(k, "rw")) { if (p->nrw >= MAXG) die("policy: too many rw grants"); p->rw[p->nrw++] = v; }
    else die("policy: unknown directive '%s' — refusing a policy we do not fully understand", k);
  }
  if (p->want_fs && p->nrw == 0 && p->nro == 0) die("policy: fs=landlock with no grants would deny every open() — that is breakage, not enforcement");
}

/* ─────────────────────────────── confine ─────────────────────────────────── */

static int confine_and_exec(struct policy *p, char **argv) {
  char err[512] = { 0 };

  /* L1. Order inside L1 matters too: read the policy (done), then close, then
   * re-establish stdio, then chdir. */
  if (fd_hygiene(2, -1, err, sizeof(err))) die("L1 fd hygiene: %s", err);
  for (int fd = 0; fd <= 2; fd++) {
    if (fcntl(fd, F_GETFD) < 0) { int n = open("/dev/null", fd == 0 ? O_RDONLY : O_WRONLY); if (n != fd) { if (n >= 0) { dup2(n, fd); close(n); } } }
  }
  /* stdin is never a legitimate channel for a confined agent and IS a channel
   * back into whoever spawned us. Replace it unconditionally. */
  { int n = open("/dev/null", O_RDONLY); if (n >= 0 && n != 0) { dup2(n, 0); close(n); } }
  /* A tty on 1/2 is TIOCSTI keystroke injection into the parent's shell on any
   * kernel below Landlock ABI 5. We refuse rather than silently discard the
   * agent's output — a silent degrade is the failure mode this project forbids. */
  if (isatty(1) || isatty(2)) die("stdout/stderr is a tty — refusing: an inherited tty fd is TIOCSTI keystroke injection into the parent shell. Pipe them (2>&1 | cat) or spawn with stdio pipes.");
  if (p->cwd && chdir(p->cwd)) die("chdir(%s): %s", p->cwd, strerror(errno));
  /* Point every temp-dir convention at the granted scratch, so a toolchain that
   * hardcodes /tmp lands inside the boundary instead of forcing us to widen it. */
  if (p->scratch) for (const char *k[] = { "TMPDIR", "TMP", "TEMP" }, **kp = k; kp < k + 3; kp++)
    if (setenv(*kp, p->scratch, 1)) die("setenv(%s): %s", *kp, strerror(errno));

  /* L2. Free, irrevocable, inherited across fork AND exec, and a hard
   * prerequisite for an unprivileged L3/L4. */
  if (nnp()) die("L2 PR_SET_NO_NEW_PRIVS failed: %s", strerror(errno));

  /* L3 BEFORE L4 — the allow-list denies landlock_* only after we are done with
   * them, and inverting these two lines is a silent total loss of the FS tier. */
  if (p->want_fs) {
    /* ll_abi(), NOT ll_abi_safe(): a ruleset belongs to the process that will be
     * restricted by it, so this question must be asked here and cannot be handed
     * to a child. The honest limit — on an Android whose app seccomp policy
     * predates Landlock, syscall 444 is not refused with ENOSYS, it KILLS the
     * caller, so on those devices the die() below is unreachable and the process
     * dies of SIGSYS without explaining itself. Getting here at all means a policy
     * asked for a filesystem boundary on a host the probe reports as landlockAbi
     * 0, which plan.js does not do. */
    int abi = ll_abi();
    if (abi < 1) die("L3 Landlock unavailable (landlock_create_ruleset: %s) — this device cannot establish a filesystem boundary, and the run declared one", strerror(errno));
    uint64_t handled = ll_handled(abi);
    struct ll_ruleset_attr attr = { .handled_access_fs = handled };
    int rs = (int)syscall(__NR_landlock_create_ruleset, &attr, sizeof(attr), 0);
    if (rs < 0) die("L3 landlock_create_ruleset: %s", strerror(errno));
    for (int i = 0; i < p->nro; i++) if (ll_grant(rs, p->ro[i], LL_RO & handled, err, sizeof(err))) die("L3 %s", err);
    for (int i = 0; i < p->nrw; i++) if (ll_grant(rs, p->rw[i], handled, err, sizeof(err))) die("L3 %s", err);
    if (syscall(__NR_landlock_restrict_self, rs, 0)) die("L3 landlock_restrict_self: %s", strerror(errno));
    close(rs);
  }

  /* L4. */
  int n = build_filter(p->deny_egress);
  if (install_prog(F, n)) die("L4 seccomp(SET_MODE_FILTER): %s%s", strerror(errno),
                              errno == EINVAL ? " — no CONFIG_SECCOMP_FILTER on this kernel" : "");

  execvp(argv[0], argv);
  die("execvp(%s): %s", argv[0], strerror(errno));
  return 70;
}

/* ────────────────────────── internal exec targets ────────────────────────── */
/* These are the far side of the inheritance rungs. execve() resets signal
 * handlers, so a SIGSYS here arrives as a fatal signal and the parent reads it
 * off the wait status — which is exactly the evidence the rung wants. */

static int x_inherit(void) { errno = 0; marker(); return errno == EOWNERDEAD ? 0 : 1; }
/* NO_NEW_PRIVS asserted by SYSCALL, not by reading /proc/self/status. Its real
 * effect — a setuid binary failing to gain privilege — is unobservable in a
 * process already running as uid 0, which is every proot process on the phone.
 * PR_GET_NO_NEW_PRIVS is the observation that works everywhere. */
static int x_nnp(void) { return prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) == 1 ? 0 : 1; }
static int x_sock(void) { int s = socket(AF_INET, SOCK_STREAM, 0); if (s >= 0) { close(s); return 1; } return errno == EACCES ? 0 : 2; }
/* ANDROID HAS NO /tmp, AND TWO RUNGS ASSUMED IT DID.
 *
 * Measured 2026-08-08 in the emulator: /tmp is absent on Android 10 and present
 * on Android 15. Both `x_sane` and the Landlock canary fixture hardcoded it, so
 * on Android 10 the sanity rung returned its mkstemp failure code and
 * landlock-canary reported "could not build the canary fixture" — a device that
 * establishes T0 for reasons that have nothing to do with its kernel. That is
 * the worst kind of wrong answer this ladder can give: it under-reports the
 * primary platform and blames the platform.
 *
 * TMPDIR is what Android gives instead (/data/local/tmp for a shell,
 * $PREFIX/tmp under Termux). Only an absolute path is accepted — this runs
 * before any confinement, so a relative or empty value is a malformed
 * environment, not a location. */
static const char *tmpbase(void) {
  /* TMPDIR first — Termux sets it to $PREFIX/tmp, and inside an app that is the
   * only writable scratch there is. But measured 2026-08-08: on Android 7.0 and
   * 8.0 a shell has NO TMPDIR at all and no /tmp either, so a single fallback is
   * not enough. The candidates are ATTEMPTED in order rather than assumed,
   * which is the same rule the rest of this file follows about capabilities. */
  const char *t = getenv("TMPDIR");
  if (t && t[0] == '/' && access(t, W_OK | X_OK) == 0) return t;
  static const char *cand[] = { "/data/local/tmp", "/tmp", "/var/tmp" };
  for (unsigned i = 0; i < sizeof(cand) / sizeof(cand[0]); i++)
    if (access(cand[i], W_OK | X_OK) == 0) return cand[i];
  return "/tmp";   /* nothing worked; the fixture will fail loudly and say so */
}

static int x_sane(void) {
  /* Ordinary work under the real filter: identity, fork+wait, file io, exec-less
   * exit. If the allow-list is too tight this is where it dies, loudly. */
  if (getpid() <= 0) return 1;
  char tmp[288];
  snprintf(tmp, sizeof tmp, "%s/atlan-confine-sane-XXXXXX", tmpbase());
  int fd = mkstemp(tmp);
  if (fd < 0) return 2;
  if (write(fd, "ok", 2) != 2) return 3;
  if (lseek(fd, 0, SEEK_SET) != 0) return 4;
  char b[4] = { 0 };
  if (read(fd, b, 2) != 2) return 5;
  close(fd); unlink(tmp);
  pid_t c = fork();
  if (c == 0) _exit(0);
  if (c < 0) return 6;
  int st = 0; if (waitpid(c, &st, 0) != c) return 7;
  struct stat sb; if (stat("/", &sb)) return 8;
  void *m = malloc(1 << 16); if (!m) return 9; free(m);
  return 0;
}

/* ──────────────────────────────── probe ──────────────────────────────────── */

struct verdict { int ok; int fatal; char detail[240]; };
static struct verdict V[24];
static const char *VID[24];
static int VN;

static void on_sigsys(int s) { (void)s; _exit(90); }

/* Rungs 5/8/15 end in execve() and never return, so the normal "fill the detail
 * buffer, then write it" order would report a bare "ok" for the three rungs
 * whose evidence matters most. They post the detail BEFORE crossing exec. */
static int g_pipe_w = -1;
static void pre_detail(const char *fmt, ...) {
  if (g_pipe_w < 0) return;
  char b[200];
  va_list ap; va_start(ap, fmt); vsnprintf(b, sizeof(b), fmt, ap); va_end(ap);
  ssize_t w = write(g_pipe_w, b, strlen(b)); (void)w;
  close(g_pipe_w); g_pipe_w = -1;
}

/* Every rung: fork, install a SIGSYS handler FIRST, run, report through a pipe.
 * The handler covers RET_TRAP inside the child; the wait status covers a kill
 * the handler could not catch (KILL_PROCESS, or a TRAP after execve reset it). */
static void rung(const char *id, int (*fn)(char *d, size_t n)) {
  int pfd[2];
  if (pipe(pfd)) die("pipe: %s", strerror(errno));
  pid_t c = fork();
  if (c == 0) {
    close(pfd[0]);
    signal(SIGSYS, on_sigsys);
    g_pipe_w = pfd[1];
    char d[200] = { 0 };
    int r = fn(d, sizeof(d));
    if (g_pipe_w >= 0) { ssize_t w = write(g_pipe_w, d, strlen(d)); (void)w; }
    _exit(r ? 1 : 0);
  }
  close(pfd[1]);
  char buf[200] = { 0 };
  ssize_t got = read(pfd[0], buf, sizeof(buf) - 1);
  if (got < 0) got = 0;
  buf[got] = 0;
  close(pfd[0]);
  int st = 0;
  waitpid(c, &st, 0);
  VID[VN] = id;
  /* `fatal` = the child DIED for the syscall, either killed outright
   * (KILL_PROCESS / an uncatchable TRAP) or caught by our own SIGSYS handler
   * (Android's RET_TRAP). The default-deny rung inverts on THIS, not on the
   * exit code — a setup failure also exits non-zero, and inverting on
   * "non-zero" made a broken setup read as a pass. Found by mutation-testing
   * this file: M02 (default tail returns ALLOW) escaped the first version of
   * the ladder because both outcomes inverted to green. */
  V[VN].fatal = WIFSIGNALED(st) || (WIFEXITED(st) && WEXITSTATUS(st) == 90);
  if (WIFSIGNALED(st)) {
    V[VN].ok = 0;
    snprintf(V[VN].detail, sizeof(V[VN].detail), "child killed by signal %d%s%s%s", WTERMSIG(st),
             WTERMSIG(st) == SIGSYS ? " (SIGSYS — this platform's own seccomp filter denies the call outright)" : "",
             buf[0] ? " · " : "", buf);
  } else if (WEXITSTATUS(st) == 90) {
    V[VN].ok = 0;
    snprintf(V[VN].detail, sizeof(V[VN].detail), "SIGSYS trapped in-child%s%s", buf[0] ? " · " : "", buf);
  } else {
    V[VN].ok = WEXITSTATUS(st) == 0;
    snprintf(V[VN].detail, sizeof(V[VN].detail), "%s", buf[0] ? buf : (V[VN].ok ? "ok" : "failed"));
  }
  VN++;
}

static int r_nnp(char *d, size_t n) {
  if (nnp()) { snprintf(d, n, "prctl(PR_SET_NO_NEW_PRIVS): %s", strerror(errno)); return 1; }
  snprintf(d, n, "prctl(PR_SET_NO_NEW_PRIVS,1)=0");
  return 0;
}
static int r_seccomp(char *d, size_t n) {
  if (nnp()) { snprintf(d, n, "NNP failed first: %s", strerror(errno)); return 1; }
  FN = 0;
  emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
  if (install_prog(F, FN)) {
    snprintf(d, n, "seccomp(SET_MODE_FILTER): %s%s", strerror(errno),
             errno == EINVAL || errno == ENOSYS ? " — no CONFIG_SECCOMP_FILTER" : "");
    return 1;
  }
  snprintf(d, n, "2-instruction filter installed");
  return 0;
}
/* THE FLOOR. Not "a syscall failed" — the kernel returned the SPECIFIC errno we
 * asked it to, on the syscall we named. Anything else and the kernel is not
 * arbitrating our decision end to end, and every tier above is unfounded. */
static int r_sentinel(char *d, size_t n) {
  if (nnp() || install_marker_filter(ERRNO(EOWNERDEAD))) { snprintf(d, n, "setup failed: %s", strerror(errno)); return 1; }
  errno = 0; marker();
  if (errno != EOWNERDEAD) { snprintf(d, n, "%s returned errno %d (%s), expected EOWNERDEAD=%d", MARKER_NAME, errno, strerror(errno), EOWNERDEAD); return 1; }
  snprintf(d, n, "%s -> EOWNERDEAD as instructed", MARKER_NAME);
  return 0;
}
/* The errno IS the answer: no /proc read, no uname, no compat flag. A compat
 * process would take the other branch and tell us so. */
static int r_arch(char *d, size_t n) {
  if (nnp()) { snprintf(d, n, "NNP: %s", strerror(errno)); return 1; }
  FN = 0;
  emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
  emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MARKER_NR, 0, 4));
  emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)));
  emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, ATLAN_ARCH, 0, 1));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, ERRNO(77)));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, ERRNO(78)));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
  if (install_prog(F, FN)) { snprintf(d, n, "install: %s", strerror(errno)); return 1; }
  errno = 0; marker();
  if (errno != 77) { snprintf(d, n, "arch echo returned %d, not 77 — this process does not run on %s (%#x); a filter written against the wrong table is a silent total bypass", errno, ATLAN_ARCH_NAME, ATLAN_ARCH); return 1; }
  snprintf(d, n, "seccomp_data.arch == %s (%#x)", ATLAN_ARCH_NAME, ATLAN_ARCH);
  return 0;
}
static int r_execinherit(char *d, size_t n) {
  if (nnp() || install_marker_filter(ERRNO(EOWNERDEAD))) { snprintf(d, n, "setup: %s", strerror(errno)); return 1; }
  pre_detail("filter installed, then execve — %s still -> EOWNERDEAD on the far side", MARKER_NAME);
  char *av[] = { g_self, (char *)"--x-inherit", NULL };
  execv(g_self, av);
  snprintf(d, n, "execv(%s): %s", g_self, strerror(errno));
  return 1;
}
/* "Happens to fail" is not a design. This rung passes ONLY on the EPERM our own
 * filter returns — a kernel that lacks io_uring entirely still goes through
 * seccomp first, so EPERM is the load-bearing evidence either way. */
static int r_iouring(char *d, size_t n) {
  if (nnp()) { snprintf(d, n, "NNP: %s", strerror(errno)); return 1; }
  int k = build_filter(0);
  if (install_prog(F, k)) { snprintf(d, n, "install real filter: %s", strerror(errno)); return 1; }
  char params[256] = { 0 };
  errno = 0;
  long r = syscall(__NR_io_uring_setup, 1, params);
  if (r >= 0) { snprintf(d, n, "io_uring_setup SUCCEEDED under the real filter — ring opcodes never become syscalls, so the filter is decorative"); return 1; }
  if (errno != EPERM) { snprintf(d, n, "io_uring_setup failed with %s, not our EPERM — it merely happens to be unavailable, which is not enforcement", strerror(errno)); return 1; }
  snprintf(d, n, "io_uring_setup -> EPERM from our filter");
  return 0;
}
/* Replaces parsing /proc/self/status TracerPid, which any tracer can hide. With
 * no tracer the kernel fails a RET_TRACE syscall with ENOSYS; under proot it
 * does not.
 *
 * THIS RUNG SAYS A TRACER IS PRESENT. IT DOES NOT SAY USER_NOTIF IS DEAD — this
 * comment and the string below both used to claim a traced verdict "permanently
 * disables USER_NOTIF here", and that is false. Measured 2026-08-08 in the SAME
 * probe run that fails this rung: `user-notif` completes a full
 * RECV -> ID_VALID -> SEND round trip under `proot -0` on a WSL2 kernel, and
 * again on an Android 15 GKI kernel (6.6.30-android15) in the emulator.
 *
 * Why the correction matters more than it looks. A seccomp FILTER cannot refuse
 * an open() by path — it may not dereference the pointer. A user_notify
 * SUPERVISOR can, because it is a process rather than a BPF program. That makes
 * user_notify the only mechanism in reach that could shut /proc/<pid>/mem on a
 * kernel with no Landlock — which is every Android before the android16-6.12
 * GKI, i.e. the phone this project is for. A comment asserting it is unavailable
 * closes a door nobody thinks to re-open. */
static int r_traced(char *d, size_t n) {
  if (nnp() || install_marker_filter(SECCOMP_RET_TRACE)) { snprintf(d, n, "setup: %s", strerror(errno)); return 1; }
  errno = 0; long r = marker();
  if (r < 0 && errno == ENOSYS) { snprintf(d, n, "RET_TRACE -> ENOSYS: no ptracer is arbitrating this process"); return 0; }
  snprintf(d, n, "RET_TRACE returned %ld/%s — a ptracer (proot?) is between us and the kernel", r, strerror(errno));
  return 1;
}
static uint16_t g_port;
/* BASELINE FIRST. Airplane mode and working egress control are indistinguishable
 * without it: a denial proves nothing unless the identical operation succeeded
 * moments earlier. */
static int r_egress(char *d, size_t n) {
  struct sockaddr_in a = { 0 };
  a.sin_family = AF_INET; a.sin_port = htons(g_port); a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  int s = socket(AF_INET, SOCK_STREAM, 0);
  if (s < 0 || connect(s, (struct sockaddr *)&a, sizeof(a))) { snprintf(d, n, "BASELINE connect to 127.0.0.1:%u failed (%s) — cannot certify egress denial without proving egress worked first", g_port, strerror(errno)); return 1; }
  close(s);
  if (nnp()) { snprintf(d, n, "NNP: %s", strerror(errno)); return 1; }
  int k = build_filter(1);
  if (install_prog(F, k)) { snprintf(d, n, "install: %s", strerror(errno)); return 1; }
  errno = 0;
  s = socket(AF_INET, SOCK_STREAM, 0);
  if (s >= 0) { close(s); snprintf(d, n, "socket() still succeeds under the egress filter"); return 1; }
  if (errno != EACCES) { snprintf(d, n, "socket() failed with %s, not our EACCES", strerror(errno)); return 1; }
  pre_detail("baseline connect to 127.0.0.1:%u OK, then socket() -> EACCES, and still EACCES after execve", g_port);
  char *av[] = { g_self, (char *)"--x-sock", NULL };
  execv(g_self, av);
  snprintf(d, n, "execv for the post-exec leg: %s", strerror(errno));
  return 1;
}
static char g_lldir[256], g_llcanary[320], g_llscratch[320], g_llinside[360];
/* Two halves, and BOTH are required. (a) the canary outside the grant must stop
 * resolving, and (b) the scratch inside it must still open — denying everything
 * is not enforcing something, and a ruleset that breaks every open() would
 * otherwise read as a pass. */
static int r_landlock(char *d, size_t n) {
  int f = open(g_llcanary, O_RDONLY);
  if (f < 0) { snprintf(d, n, "canary unreadable BEFORE restriction (%s) — nothing was proven", strerror(errno)); return 1; }
  close(f);
  int abi = ll_abi();
  if (abi < 1) { snprintf(d, n, "landlock_create_ruleset(VERSION): %s%s", strerror(errno), errno == ENOSYS ? " — no kernel support" : errno == EOPNOTSUPP ? " — compiled in, disabled at boot" : ""); return 1; }
  if (nnp()) { snprintf(d, n, "NNP: %s", strerror(errno)); return 1; }
  uint64_t handled = ll_handled(abi);
  struct ll_ruleset_attr attr = { .handled_access_fs = handled };
  int rs = (int)syscall(__NR_landlock_create_ruleset, &attr, sizeof(attr), 0);
  if (rs < 0) { snprintf(d, n, "create_ruleset(abi %d): %s", abi, strerror(errno)); return 1; }
  char err[200];
  if (ll_grant(rs, g_llscratch, handled, err, sizeof(err))) { snprintf(d, n, "%s", err); return 1; }
  if (syscall(__NR_landlock_restrict_self, rs, 0)) { snprintf(d, n, "restrict_self: %s", strerror(errno)); return 1; }
  errno = 0;
  f = open(g_llcanary, O_RDONLY);
  if (f >= 0) { close(f); snprintf(d, n, "canary OUTSIDE the grant is still readable after restrict_self — abi %d claims support it does not enforce", abi); return 1; }
  if (errno != EACCES) { snprintf(d, n, "canary failed with %s, not EACCES", strerror(errno)); return 1; }
  f = open(g_llinside, O_RDONLY);
  if (f < 0) { snprintf(d, n, "scratch INSIDE the grant is not openable (%s) — that is breakage, not a boundary", strerror(errno)); return 1; }
  close(f);
  snprintf(d, n, "abi %d: outside-grant open -> EACCES, inside-grant open -> ok", abi);
  return 0;
}
/* ── the file door ─────────────────────────────────────────────────────────
 * Every capability this launcher removes is a SYSCALL, and the tier statements
 * name syscalls. A reader takes "it cannot use ptrace or process_vm_readv" to
 * mean it cannot get inside another process, and that inference is FALSE:
 * /proc/<pid>/mem is a file. open() + pread() reaches another process's address
 * space with no filtered syscall anywhere on the path.
 *
 * seccomp cannot single that path out, and not by oversight. A filter sees the
 * syscall number and the register values; it is forbidden from following a
 * pointer argument into the path, because another thread can rewrite that memory
 * between the check and the use.
 *
 * A filter CAN shut the door by refusing open()/openat() outright — that was
 * measured on 2026-08-08 after a contextless checker refuted the stronger claim
 * — and in the same run it refused /etc/hostname too, which is what makes it
 * useless as a boundary rather than clever. So the only layer here that can
 * close this ONE path while leaving a toolchain runnable is L3 — and
 * whether L3 actually does is a fact about this kernel's procfs, not something
 * the Landlock canary already established on a regular file. Hence its own rung.
 *
 * Both halves are required, exactly as for the canary: the sibling's memory must
 * be readable BEFORE the boundary — otherwise "blocked" proves nothing, since a
 * wrong address fails too — and unreadable after, while a GRANTED /proc entry
 * keeps opening, otherwise we broke procfs and called it enforcement. */
#define SIBMARK "atlan-sibling-memory-marker"

static int sib_read(pid_t pid, unsigned long addr, char *out, size_t outn) {
  char path[64];
  snprintf(path, sizeof(path), "/proc/%d/mem", (int)pid);
  int fd = open(path, O_RDONLY);
  if (fd < 0) return -1;
  memset(out, 0, outn);
  ssize_t r = pread(fd, out, outn - 1, (off_t)addr);
  int e = errno;
  close(fd);
  errno = e;
  return r > 0 ? 0 : -2;
}

static int sib_attack(pid_t v, unsigned long addr, char *d, size_t n) {
  char buf[64];
  int before = sib_read(v, addr, buf, sizeof(buf));
  if (!(before == 0 && !strcmp(buf, SIBMARK))) {
    /* A device that already refuses this passes — the rung measures the
     * PROPERTY, not Landlock — but it has to say which reason applied, because
     * "isolated by this kernel" and "isolated by our boundary" fail differently
     * later. Yama's ptrace_scope and a hardened procfs both land here. */
    snprintf(d, n, "a sibling's /proc/<pid>/mem was ALREADY unreadable before any boundary was applied (%s) — this kernel isolates process memory on its own",
             before == -1 ? strerror(errno) : "opened, but the read returned nothing");
    return 0;
  }
  int abi = ll_abi();
  if (abi < 1) {
    snprintf(d, n, "a sibling's memory IS readable through /proc/<pid>/mem and this device has no Landlock to close it (%s) — a filter can only refuse this path by refusing open() for every path", strerror(errno));
    return 1;
  }
  if (nnp()) { snprintf(d, n, "NNP: %s", strerror(errno)); return 1; }
  uint64_t handled = ll_handled(abi);
  struct ll_ruleset_attr attr = { .handled_access_fs = handled };
  int rs = (int)syscall(__NR_landlock_create_ruleset, &attr, sizeof(attr), 0);
  if (rs < 0) { snprintf(d, n, "create_ruleset(abi %d): %s", abi, strerror(errno)); return 1; }
  char err[200];
  /* Granting a /proc entry the way the real policy does, so this measures
   * DISCRIMINATION WITHIN procfs. A ruleset that simply denied all of /proc
   * would pass a weaker test and break every toolchain that reads a counter. */
  if (ll_grant(rs, "/proc/stat", LL_RO & handled, err, sizeof(err))) { snprintf(d, n, "%s", err); return 1; }
  if (syscall(__NR_landlock_restrict_self, rs, 0)) { snprintf(d, n, "restrict_self: %s", strerror(errno)); return 1; }
  close(rs);
  int g = open("/proc/stat", O_RDONLY);
  if (g < 0) { snprintf(d, n, "the GRANTED /proc/stat stopped opening (%s) — that is breakage, not a boundary", strerror(errno)); return 1; }
  close(g);
  errno = 0;
  if (sib_read(v, addr, buf, sizeof(buf)) == 0 && !strcmp(buf, SIBMARK)) {
    snprintf(d, n, "the boundary is applied and a sibling's memory is STILL readable through /proc/<pid>/mem");
    return 1;
  }
  snprintf(d, n, "sibling memory readable before the boundary, %s after, while the granted /proc/stat still opens", strerror(errno));
  return 0;
}

static int r_siblingmem(char *d, size_t n) {
  int vp[2], ap[2];
  if (pipe(vp)) { snprintf(d, n, "pipe: %s", strerror(errno)); return 1; }
  if (pipe(ap)) { snprintf(d, n, "pipe: %s", strerror(errno)); return 1; }

  /* Victim and attacker are BOTH children of this rung, so they are siblings of
   * each other. Parent-reads-child is the shape the kernel special-cases and
   * Yama's scope 1 permits outright, so measuring that would flatter the answer
   * — and two agents under one cockpit are siblings, which is the shape a tier
   * statement is actually about. */
  pid_t v = fork();
  if (v == 0) {
    close(vp[0]); close(ap[0]); close(ap[1]);
    char *buf = malloc(64);
    if (!buf) _exit(1);
    memset(buf, 0, 64);
    memcpy(buf, SIBMARK, sizeof(SIBMARK));
    char line[64];
    int k = snprintf(line, sizeof(line), "%llu", (unsigned long long)(uintptr_t)buf);
    ssize_t w = write(vp[1], line, (size_t)k); (void)w;
    close(vp[1]);
    for (;;) sleep(1);   /* killed by the rung once the attacker has reported */
  }
  close(vp[1]);
  char ab[64] = { 0 };
  ssize_t got = read(vp[0], ab, sizeof(ab) - 1);
  close(vp[0]);
  if (got <= 0) {
    if (v > 0) { kill(v, SIGKILL); waitpid(v, NULL, 0); }
    close(ap[0]); close(ap[1]);
    snprintf(d, n, "the victim child never published an address — nothing was measured, which is not a pass");
    return 1;
  }
  unsigned long addr = (unsigned long)strtoull(ab, NULL, 10);

  pid_t a = fork();
  if (a == 0) {
    close(ap[0]);
    char det[200] = { 0 };
    int rc = sib_attack(v, addr, det, sizeof(det));
    ssize_t w = write(ap[1], det, strlen(det)); (void)w;
    close(ap[1]);
    _exit(rc ? 1 : 0);
  }
  close(ap[1]);
  char det[200] = { 0 };
  ssize_t dg = read(ap[0], det, sizeof(det) - 1);
  if (dg < 0) dg = 0;
  det[dg] = 0;
  close(ap[0]);
  int st = 0;
  waitpid(a, &st, 0);
  kill(v, SIGKILL);
  waitpid(v, NULL, 0);
  snprintf(d, n, "%s", det[0] ? det : "the attacker child produced no verdict");
  return (WIFEXITED(st) && WEXITSTATUS(st) == 0) ? 0 : 1;
}

static int r_fdhygiene(char *d, size_t n) {
  int f = open("/dev/null", O_RDONLY);
  if (f < 0) { snprintf(d, n, "cannot open a marker fd: %s", strerror(errno)); return 1; }
  int hi = fcntl(f, F_DUPFD, 40);
  if (hi < 0) { snprintf(d, n, "F_DUPFD: %s", strerror(errno)); return 1; }
  char err[200];
  if (fd_hygiene(2, g_pipe_w, err, sizeof(err))) { snprintf(d, n, "%s", err); return 1; }
  struct stat sb;
  if (fstat(hi, &sb) == 0) { snprintf(d, n, "fd %d survived close_range — an inherited descriptor is checked at open(), never at read(), so every layer below is decorative", hi); return 1; }
  if (errno != EBADF) { snprintf(d, n, "fstat on the swept fd gave %s, not EBADF", strerror(errno)); return 1; }
  snprintf(d, n, "fd %d -> EBADF after close_range(3,~0U)", hi);
  return 0;
}
static int r_tsync(char *d, size_t n) {
  if (nnp()) { snprintf(d, n, "NNP: %s", strerror(errno)); return 1; }
  FN = 0;
  emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
  struct sock_fprog prog = { .len = (unsigned short)FN, .filter = F };
  if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_TSYNC, &prog)) { snprintf(d, n, "TSYNC rejected: %s (recorded; the launcher is single-threaded by construction so nothing depends on this)", strerror(errno)); return 1; }
  snprintf(d, n, "TSYNC accepted (recorded, never depended on)");
  return 0;
}
/* A returned listener fd alone proves nothing. Only the completed round trip
 * counts, and this is recorded for a broker that is DEFERRED, not shipped. */
static int r_usernotif(char *d, size_t n) {
#ifndef SECCOMP_IOCTL_NOTIF_RECV
  snprintf(d, n, "build headers have no SECCOMP_IOCTL_NOTIF_* — round trip untested");
  return 1;
#else
  if (nnp()) { snprintf(d, n, "NNP: %s", strerror(errno)); return 1; }
  FN = 0;
  emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
  emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MARKER_NR, 0, 1));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF));
  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
  struct sock_fprog prog = { .len = (unsigned short)FN, .filter = F };
  int lfd = (int)syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_NEW_LISTENER, &prog);
  if (lfd < 0) { snprintf(d, n, "NEW_LISTENER: %s", strerror(errno)); return 1; }
  pid_t c = fork();
  if (c == 0) { errno = 0; marker(); _exit(errno == EOWNERDEAD ? 0 : 1); }
  struct seccomp_notif *req = calloc(1, sizeof(*req));
  struct seccomp_notif_resp *resp = calloc(1, sizeof(*resp));
  if (!req || !resp) { snprintf(d, n, "alloc"); return 1; }
  if (ioctl(lfd, SECCOMP_IOCTL_NOTIF_RECV, req)) { snprintf(d, n, "NOTIF_RECV: %s", strerror(errno)); return 1; }
  if (ioctl(lfd, SECCOMP_IOCTL_NOTIF_ID_VALID, &req->id)) { snprintf(d, n, "ID_VALID: %s", strerror(errno)); return 1; }
  resp->id = req->id; resp->error = -EOWNERDEAD; resp->val = 0; resp->flags = 0;
  if (ioctl(lfd, SECCOMP_IOCTL_NOTIF_SEND, resp)) { snprintf(d, n, "NOTIF_SEND: %s", strerror(errno)); return 1; }
  int st = 0; waitpid(c, &st, 0);
  if (!WIFEXITED(st) || WEXITSTATUS(st)) { snprintf(d, n, "supervised child did not observe the injected errno"); return 1; }
  snprintf(d, n, "RECV->ID_VALID->SEND round trip completed (ADDFD_SETFD untested — recorded, not claimed)");
  return 0;
#endif
}
/* Selftest rungs. A probe that only tests the happy path is measuring itself.
 * These assert the REAL filter's negatives on every boot, not a toy filter's. */
static int r_denyset(char *d, size_t n) {
  if (nnp()) { snprintf(d, n, "NNP: %s", strerror(errno)); return 1; }
  int k = build_filter(0);
  if (install_prog(F, k)) { snprintf(d, n, "install: %s", strerror(errno)); return 1; }
  struct { int nr; const char *nm; } probes[] = {
    { __NR_ptrace, "ptrace" }, { __NR_process_vm_readv, "process_vm_readv" },
    { __NR_userfaultfd, "userfaultfd" }, { __NR_bpf, "bpf" },
    { __NR_perf_event_open, "perf_event_open" }, { __NR_keyctl, "keyctl" },
    { __NR_unshare, "unshare" }, { __NR_setns, "setns" }, { __NR_mount, "mount" },
    { __NR_pidfd_getfd, "pidfd_getfd" }, { __NR_name_to_handle_at, "name_to_handle_at" },
  };
  for (unsigned i = 0; i < sizeof(probes) / sizeof(probes[0]); i++) {
    if (probes[i].nr < 0) continue;
    errno = 0;
    long r = syscall(probes[i].nr, 0, 0, 0, 0, 0, 0);
    if (r >= 0 || errno != EPERM) { snprintf(d, n, "%s was NOT denied by the real filter (ret %ld, %s)", probes[i].nm, r, strerror(errno)); return 1; }
  }
  snprintf(d, n, "every named capability returns EPERM under the real filter");
  return 0;
}
static int r_defaultdeny(char *d, size_t n) {
  if (nnp()) { snprintf(d, n, "NNP: %s", strerror(errno)); return 1; }
  int k = build_filter(0);
  if (install_prog(F, k)) { snprintf(d, n, "install: %s", strerror(errno)); return 1; }
  /* vhangup is in NEITHER list. The pass for this rung is the child DYING here;
   * every line after the syscall is the failure report. */
  syscall(__NR_vhangup);
  snprintf(d, n, "an unlisted syscall (vhangup) RETURNED — the default tail is not deny");
  return 0;
}
static int r_allowsanity(char *d, size_t n) {
  if (nnp()) { snprintf(d, n, "NNP: %s", strerror(errno)); return 1; }
  int k = build_filter(0);
  if (install_prog(F, k)) { snprintf(d, n, "install: %s", strerror(errno)); return 1; }
  pre_detail("real filter (%d insns) permits ordinary work across execve: open/write/read/unlink, fork+wait, stat, brk/mmap", k);
  char *av[] = { g_self, (char *)"--x-sane", NULL };
  execv(g_self, av);
  snprintf(d, n, "execv: %s", strerror(errno));
  return 1;
}

/* r_defaultdeny inverts: the child DYING FOR THE SYSCALL is the pass. Keyed on
 * `fatal`, never on the exit code — see the note in rung(). */
static void rung_inverted(const char *id, int (*fn)(char *, size_t), const char *pass_detail) {
  int before = VN;
  rung(id, fn);
  if (V[before].fatal) { V[before].ok = 1; snprintf(V[before].detail, sizeof(V[before].detail), "%s", pass_detail); }
  else { V[before].ok = 0; }
}

static void jstr(const char *s) {
  putchar('"');
  for (; *s; s++) {
    if (*s == '"' || *s == '\\') { putchar('\\'); putchar(*s); }
    else if ((unsigned char)*s < 0x20) printf("\\u%04x", *s);
    else putchar(*s);
  }
  putchar('"');
}

/* The ONE control whose effect cannot be observed on a host with no compat
 * process: the arch guard. We cannot spawn a 32-bit process on an arm64 phone
 * or a pure x86_64 box to watch it die, so the assertion is on the ARTIFACT —
 * the actual instruction stream we hand the kernel. Added after mutation-testing
 * showed a mutant that turned the guard's KILL into ALLOW passed every
 * behavioural test on this node, which is true and useless. */
static int do_dump_filter(int deny_egress) {
  int n = build_filter(deny_egress);
  printf("{\"sentinel\":\"atlan-confine/1\",\"auditArch\":%u,\"len\":%d,\"kill\":%u,\"allow\":%u,\"insns\":[",
         (unsigned)ATLAN_ARCH, n, SECCOMP_RET_KILL_PROCESS, SECCOMP_RET_ALLOW);
  for (int i = 0; i < n; i++)
    printf("%s{\"code\":%u,\"jt\":%u,\"jf\":%u,\"k\":%u}", i ? "," : "", F[i].code, F[i].jt, F[i].jf, F[i].k);
  printf("]}\n");
  return 0;
}

static int do_probe(void) {
  /* rung 8 needs a real listener to prove the baseline against */
  int srv = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in a = { 0 };
  a.sin_family = AF_INET; a.sin_addr.s_addr = htonl(INADDR_LOOPBACK); a.sin_port = 0;
  socklen_t al = sizeof(a);
  if (srv >= 0 && bind(srv, (struct sockaddr *)&a, sizeof(a)) == 0 && listen(srv, 8) == 0 && getsockname(srv, (struct sockaddr *)&a, &al) == 0) g_port = ntohs(a.sin_port);

  /* rung 9 needs a canary OUTSIDE the grant, proven readable first */
  snprintf(g_lldir, sizeof(g_lldir), "%s/atlan-confine-ll-XXXXXX", tmpbase());
  int have_ll_fixture = 0;
  if (mkdtemp(g_lldir)) {
    snprintf(g_llcanary, sizeof(g_llcanary), "%s/canary", g_lldir);
    snprintf(g_llscratch, sizeof(g_llscratch), "%s/scratch", g_lldir);
    snprintf(g_llinside, sizeof(g_llinside), "%s/scratch/inside", g_lldir);
    int f = open(g_llcanary, O_CREAT | O_WRONLY, 0600);
    if (f >= 0) { ssize_t w = write(f, "canary", 6); (void)w; close(f); }
    mkdir(g_llscratch, 0700);
    f = open(g_llinside, O_CREAT | O_WRONLY, 0600);
    if (f >= 0) { ssize_t w = write(f, "inside", 6); (void)w; close(f); have_ll_fixture = 1; }
  }

  rung("nnp", r_nnp);
  rung("seccomp-reachable", r_seccomp);
  rung("sentinel-errno", r_sentinel);
  rung("arch-echo", r_arch);
  rung("exec-inherit", r_execinherit);
  rung("iouring-closed", r_iouring);
  rung("ptrace-arbitration", r_traced);
  rung("egress-denial", r_egress);
  if (have_ll_fixture) rung("landlock-canary", r_landlock);
  else { VID[VN] = "landlock-canary"; V[VN].ok = 0; snprintf(V[VN].detail, sizeof(V[VN].detail), "could not build the canary fixture in /tmp — rung not run, so nothing is claimed"); VN++; }
  rung("sibling-memory", r_siblingmem);
  rung("fd-hygiene", r_fdhygiene);
  rung("tsync", r_tsync);
  rung("user-notif", r_usernotif);
  rung("selftest-denyset", r_denyset);
  rung_inverted("selftest-defaultdeny", r_defaultdeny, "an unlisted syscall (vhangup) is fatal under the real filter — the tail is default-deny");
  rung("selftest-allowsanity", r_allowsanity);

  if (srv >= 0) close(srv);
  if (have_ll_fixture) { unlink(g_llcanary); unlink(g_llinside); rmdir(g_llscratch); rmdir(g_lldir); }

  printf("{\"sentinel\":\"atlan-confine/1\",\"arch\":\"%s\",\"auditArch\":%u,\"marker\":\"%s\",\"pageSize\":%ld,\"landlockAbi\":%d,\"rungs\":[",
         ATLAN_ARCH_NAME, (unsigned)ATLAN_ARCH, MARKER_NAME, sysconf(_SC_PAGESIZE), ll_abi_safe());
  for (int i = 0; i < VN; i++) {
    printf("%s{\"n\":%d,\"id\":", i ? "," : "", i + 1);
    jstr(VID[i]);
    printf(",\"ok\":%s,\"detail\":", V[i].ok ? "true" : "false");
    jstr(V[i].detail);
    putchar('}');
  }
  printf("]}\n");
  return 0;
}

/* ──────────────────────────────── learn ──────────────────────────────────── */
/* Authoring aid, not a runtime path. The honest answer to "how do you build an
 * allow-list without breaking the agent": run the engine over a smoke corpus and
 * observe. We use RET_TRACE + PTRACE_EVENT_SECCOMP with the syscall number
 * carried in the filter's RET_DATA, so PTRACE_GETEVENTMSG hands it back directly
 * and no architecture-specific register decoding is needed — which is what makes
 * this work identically on the phone and the accessory. Refuses under an existing
 * tracer (proot), because a second tracer cannot attach and a silent partial
 * observation would produce an allow-list with holes. */
#include <sys/ptrace.h>
#ifndef PTRACE_O_TRACESECCOMP
#define PTRACE_O_TRACESECCOMP 0x00000080
#endif
#ifndef PTRACE_EVENT_SECCOMP
#define PTRACE_EVENT_SECCOMP 7
#endif
#define LEARN_MAX 1024
static int do_learn(int argc, char **argv) {
  int i = 2;
  if (i < argc && !strcmp(argv[i], "--")) i++;
  if (i >= argc) die("--learn -- <argv>");
  pid_t c = fork();
  if (c == 0) {
    if (ptrace(PTRACE_TRACEME, 0, 0, 0)) { fprintf(stderr, "atlan-confine: PTRACE_TRACEME failed (%s) — refusing to emit a partial allow-list\n", strerror(errno)); _exit(71); }
    if (nnp()) _exit(71);
    FN = 0;
    emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
    for (int nr = 0; nr < LEARN_MAX && FN < MAXI - 4; nr++) {
      emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)nr, 0, 1));
      emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_TRACE | ((uint32_t)nr & SECCOMP_RET_DATA)));
    }
    emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_TRACE | 0xffffU));
    if (install_prog(F, FN)) _exit(71);
    raise(SIGSTOP);
    execvp(argv[i], argv + i);
    _exit(72);
  }
  int st = 0;
  waitpid(c, &st, 0);
  ptrace(PTRACE_SETOPTIONS, c, 0, (void *)(long)(PTRACE_O_TRACESECCOMP | 0x00100000 /*EXITKILL*/ | 0x00000002 /*TRACEFORK*/ | 0x00000004 /*TRACEVFORK*/ | 0x00000008 /*TRACECLONE*/));
  static unsigned char seen[LEARN_MAX + 1];
  ptrace(PTRACE_CONT, c, 0, 0);
  for (;;) {
    pid_t w = waitpid(-1, &st, __WALL);
    if (w < 0) break;
    if (WIFEXITED(st) || WIFSIGNALED(st)) { if (w == c) break; continue; }
    if (WIFSTOPPED(st) && (st >> 8) == (SIGTRAP | (PTRACE_EVENT_SECCOMP << 8))) {
      unsigned long msg = 0;
      if (ptrace(PTRACE_GETEVENTMSG, w, 0, &msg) == 0) seen[msg <= LEARN_MAX ? msg : LEARN_MAX] = 1;
      ptrace(PTRACE_CONT, w, 0, 0);
      continue;
    }
    ptrace(PTRACE_CONT, w, 0, WIFSTOPPED(st) && WSTOPSIG(st) != SIGTRAP ? (void *)(long)WSTOPSIG(st) : 0);
  }
  printf("{\"observed\":[");
  int first = 1;
  for (int nr = 0; nr < LEARN_MAX; nr++) if (seen[nr]) { printf("%s%d", first ? "" : ",", nr); first = 0; }
  printf("],\"truncatedAbove\":%d,\"arch\":\"%s\"}\n", seen[LEARN_MAX] ? 1 : 0, ATLAN_ARCH_NAME);
  return 0;
}

/* ──────────────────────────────── main ───────────────────────────────────── */

static void self_init(char *argv0) {
  ssize_t k = readlink("/proc/self/exe", g_self, sizeof(g_self) - 1);
  if (k > 0) { g_self[k] = 0; return; }
  snprintf(g_self, sizeof(g_self), "%s", argv0 ? argv0 : "atlan-confine");
}

int main(int argc, char **argv) {
  self_init(argv[0]);
  if (argc < 2) { fprintf(stderr, "usage: atlan-confine --probe | --learn -- <argv> | <policy>|@<fd> -- <argv>\n"); return 64; }
  if (!strcmp(argv[1], "--probe")) return do_probe();
  if (!strcmp(argv[1], "--dump-filter")) return do_dump_filter(argc > 2 && !strcmp(argv[2], "deny-egress"));
  if (!strcmp(argv[1], "--learn")) return do_learn(argc, argv);
  if (!strcmp(argv[1], "--x-inherit")) return x_inherit();
  if (!strcmp(argv[1], "--x-nnp")) return x_nnp();
  if (!strcmp(argv[1], "--x-fds")) { /* prints the fds that survived L1 */
    DIR *d = opendir("/proc/self/fd");
    if (!d) { printf("noproc\n"); return 0; }
    struct dirent *e; int dfd = dirfd(d);
    while ((e = readdir(d))) { int fd = atoi(e->d_name); if (e->d_name[0] >= '0' && e->d_name[0] <= '9' && fd != dfd) printf("%d ", fd); }
    closedir(d); printf("\n"); return 0;
  }
  if (!strcmp(argv[1], "--x-sock")) return x_sock();
  if (!strcmp(argv[1], "--x-sane")) return x_sane();

  char *spec = argv[1];
  int sep = -1;
  for (int i = 2; i < argc; i++) if (!strcmp(argv[i], "--")) { sep = i; break; }
  if (sep < 0 || sep + 1 >= argc) die("missing `-- <command>`");

  static char blob[65536];
  if (spec[0] == '@') {
    int fd = atoi(spec + 1);
    size_t off = 0;
    for (;;) {
      ssize_t r = read(fd, blob + off, sizeof(blob) - 1 - off);
      if (r < 0) { if (errno == EINTR) continue; die("policy fd %d: %s", fd, strerror(errno)); }
      if (r == 0) break;
      off += (size_t)r;
      if (off >= sizeof(blob) - 1) die("policy too large");
    }
    blob[off] = 0;
    close(fd);
  } else {
    /* argv literal: frozen by execve, so there is nothing to swap between
     * resolution and read. A PATH is what the TOCTOU rule forbids, not this. */
    snprintf(blob, sizeof(blob), "%s", spec);
    for (char *q = blob; *q; q++) if (*q == ';') *q = '\n';
  }
  struct policy p;
  parse_policy(blob, &p);
  return confine_and_exec(&p, argv + sep + 1);
}
