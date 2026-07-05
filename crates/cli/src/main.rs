use clap::Parser;

/// Native runner for the wasm-vm emulator core.
#[derive(Parser)]
#[command(name = "wasm-vm", version, about)]
struct Args {
    /// Guest RAM size in bytes.
    #[arg(long, default_value_t = 128 * 1024 * 1024)]
    ram_bytes: usize,
}

fn main() {
    let args = Args::parse();
    let machine = wasm_vm_core::Machine::new(args.ram_bytes);
    println!(
        "wasm-vm-core {} · machine up with {} bytes of guest RAM",
        wasm_vm_core::version(),
        machine.ram_len()
    );
}
