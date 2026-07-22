// Atlan hardened execution worker (scaffold, proving the toolchain).
// Will become the out-of-process security boundary: run agent Bash/builds
// inside real OS sandboxing (bubblewrap/Landlock/seccomp on Linux) with a
// resource governor, honest-degrade on proot. Speaks a typed JSON-RPC line
// protocol with the Node control plane over stdio.
fn main() {
    println!("{{\"worker\":\"atlan-worker\",\"version\":\"0.1.0\",\"sandbox\":\"probing\"}}");
}
