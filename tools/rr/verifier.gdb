# Verifier helpers for adversarial rr replay sessions.
# Load inside a session:   (rr) source tools/rr/verifier.gdb

define whowrote
  watch -l $arg0
  reverse-continue
end
document whowrote
Run BACKWARDS to the most recent write of a memory location.
Usage: whowrote cpu.regs[5]   |   whowrote cpu.csrs.mstatus
The single highest-value query in the toolbox: lands on the exact line that
produced a corrupted value, no matter how long ago it executed.
end

define whoread
  awatch -l $arg0
  reverse-continue
end
document whoread
Run backwards to the most recent ACCESS (read or write) of a memory location.
Usage: whoread bus.ram[0x1000]
end

define cite
  when
  info line
  frame
end
document cite
Print the citation for a finding: current rr event number plus source position.
Every verifier finding must include the event number — anyone can re-open the
exact moment with:  rr replay -g <event> <trace-dir>
end
