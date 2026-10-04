// Exact rational comparisons with independently precomputed real enclosures.
export function rationalWord(w){
 const e=(w>>>23)&255,m=w&0x7fffff;if(e===255)return null;
 let n=BigInt(e?m|0x800000:m),d=1n,p=e?e-150:-149;
 if(p>=0)n<<=BigInt(p);else d<<=BigInt(-p);if(w&0x80000000)n=-n;return {n,d};
}
export function within(row,w){
 if(Object.hasOwn(row,'exact'))return w===row.exact;
 const x=rationalWord(w);if(!x)return false;
 const low=row.allowedLower,high=row.allowedUpper;
 const left=x.n*BigInt(low.d)-BigInt(low.n)*x.d,right=x.n*BigInt(high.d)-BigInt(high.n)*x.d;
 return row.strict?left>0n&&right<0n:left>=0n&&right<=0n;
}
export const resolve=(selected,references)=>Object.hasOwn(selected,'exact')?selected:references.get(selected.op+'/'+selected.word);
