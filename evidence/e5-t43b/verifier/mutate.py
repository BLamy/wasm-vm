import sys,re
src=open(sys.argv[1]).read()
start=src.index("    fn idle(&self) -> bool {\n        self.egress.is_empty()")
end=src.index("    }\n", start)
body=src[start:end]
lines=body.split("\n")
# lines[1] is 'self.egress.is_empty()', lines[2..] are '&& cond'
idx=int(sys.argv[2])
conds=[l for l in lines[1:] if l.strip()]
if idx==0:
    # drop the first; promote second
    newconds=[conds[1].replace("&& ","",1)]+conds[2:]
else:
    newconds=conds[:idx]+conds[idx+1:]
print(conds[idx].strip(), file=sys.stderr)
newbody="\n".join([lines[0]]+newconds)+"\n"
open(sys.argv[1],"w").write(src[:start]+newbody+src[end:])
