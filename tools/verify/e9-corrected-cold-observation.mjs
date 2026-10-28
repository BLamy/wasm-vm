// Fresh cold boots record new RTC/entropy. Their request identities are stable
// acceptance inputs; a historical RAM digest or transition is not one.
export const CORRECTED_COLD_WRITE=Object.freeze({type:1,sector:'24928880',bytes:1179648});
export const CORRECTED_COLD_LOG_MAX_BYTES=128*1024**2;
const need=(ok,detail)=>{if(!ok)throw Error('corrected cold block observation: '+detail);};
const uint=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)
  &&BigInt(value)<=0xffffffffffffffffn;
const position=value=>{
  need(value&&['transition','retired','sequence'].every(key=>uint(value[key]))
    &&['before','observe'].includes(value.phase)&&Number.isInteger(value.ordinal)
    &&value.ordinal>=0&&value.ordinal<=0xffffffff,'exact event position');
  need(BigInt(value.retired)<=BigInt(value.transition),'retired position bound');
  return Object.fromEntries(['transition','retired','sequence','phase','ordinal'].map(key=>[key,value[key]]));
};
const within=(value,from,to)=>['transition','retired','sequence'].every(key=>
  BigInt(value[key])>=BigInt(from[key])&&BigInt(value[key])<=BigInt(to[key]));
export const createCorrectedColdObservation=from=>{
  from=position(from);need(from.transition==='0'&&from.retired==='0'&&from.sequence==='0',
    'logging starts before the fresh guest executes');
  return {version:1,from,through:{...from},requests:0,logBytes:0,parts:[],matching:[],firstFailure:null};
};
export const recordCorrectedColdBatch=(observation,rows,through,artifact)=>{
  const from=position(observation.through);through=position(through);
  need(within(from,observation.from,through),'observation moved backward');
  need(Array.isArray(rows)&&rows.length>0,'nonempty diagnostic batch');
  need(artifact&&/^block-log-[0-9]+\.json$/.test(artifact.file)
    &&/^[a-f0-9]{64}$/.test(artifact.sha256)&&Number.isSafeInteger(artifact.bytes)
    &&artifact.bytes>0,'retained diagnostic batch');
  need(artifact.file==='block-log-'+observation.parts.length+'.json','diagnostic batch order');
  need(observation.logBytes+artifact.bytes<=CORRECTED_COLD_LOG_MAX_BYTES,'128 MiB diagnostic log bound');
  const matches=[];let previous=from;
  for(const row of rows){
    const at=position(row.eventPosition);
    need(within(at,previous,through),'request position outside its observed interval');
    need(Number.isInteger(row.type)&&row.type>=0&&row.type<=0xffffffff&&uint(row.sector)
      &&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&Number.isInteger(row.head)
      &&row.head>=0&&row.head<=0xffff&&[0,1,2].includes(row.status)
      &&typeof row.statusDmaWritten==='boolean'&&typeof row.usedRingCommitted==='boolean',
      'request fields');
    if(row.type===CORRECTED_COLD_WRITE.type&&row.sector===CORRECTED_COLD_WRITE.sector
      &&row.bytes===CORRECTED_COLD_WRITE.bytes){
      need(row.status===0&&row.statusDmaWritten&&row.usedRingCommitted,
        'original large write did not complete S_OK in guest memory and the used ring');
      matches.push({...row,eventPosition:at,artifact:artifact.file});
    }
    previous=at;
  }
  need(observation.matching.length+matches.length<=1,'original large write completed more than once');
  observation.parts.push({from,through,rows:rows.length,...artifact});
  observation.requests+=rows.length;observation.logBytes+=artifact.bytes;
  observation.through=through;observation.matching.push(...matches);
  return matches;
};
export const finishCorrectedColdObservation=(observation,through,firstFailure)=>{
  through=position(through);need(within(observation.through,observation.from,through),
    'terminal observation moved backward');
  need(firstFailure===null,'guest observed a block I/O error');
  need(observation.matching.length===1,'original large write was not observed exactly once');
  const witness=observation.witness;
  need(witness&&/^[a-f0-9]{64}$/.test(witness.digest)
    &&/^[a-f0-9]{64}$/.test(witness.ramDigest)&&/^[a-f0-9]{64}$/.test(witness.state?.sha256),
    'post-completion guest and RAM witness');
  need(within(observation.matching[0].eventPosition,observation.from,position(witness))
    &&within(position(witness),observation.from,through),'completion witness position');
  need(observation.parts.reduce((sum,part)=>sum+part.rows,0)===observation.requests,
    'complete diagnostic part count');
  need(observation.parts.reduce((sum,part)=>sum+part.bytes,0)===observation.logBytes,
    'complete diagnostic byte count');
  observation.through=through;observation.firstFailure=firstFailure;
  return observation;
};
