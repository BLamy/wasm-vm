import {checks} from './standard-instanced-draws.mjs';
import {originalFormats} from '../../../tools/virgl-command/standard-packed-normalized-fixtures.mjs';
import {imageView,surface,hex} from '../../../tools/virgl-command/standard-byte-color-fixtures.mjs';
import * as decoders from '../decoder.mjs';
export function runWireAcceptance(){
 const c=checks(),records=[];
 const selected=decoders.decodeStandardPackedNormalizedImageSubmission;
 const prior=Object.entries(decoders).filter(([name])=>/^decode.*Submission$/.test(name)&&name!=='decodeStandardPackedNormalizedImageSubmission');
 const emptyProfiles=[];
 for(const [name,decoder]of prior){const result=c.ok(decoder(new Uint8Array()),'historical empty packet profile '+name);c.same(result.profile===decoders.STANDARD_PACKED_NORMALIZED_IMAGE_PROFILE,false,'historical profiles do not acquire packed authority');emptyProfiles.push({name,result});}
 for(const f of originalFormats)for(const [kind,wire]of [['base-view',imageView(9,6,f.originalFormat,0,0,[0,1,2,3])],['swizzled-mip-view',imageView(9,6,f.originalFormat,1,3,[2,4,0,5])],['mip-surface',surface(10,6,f.originalFormat,2)]]){
  const result=c.ok(selected(wire),'selected original packed normalized '+kind);
  c.same(result.profile,decoders.STANDARD_PACKED_NORMALIZED_IMAGE_PROFILE,'separate original packed consumer authority');
  const refused=[];for(const [name,decoder]of prior){const r=decoder(wire);c.same(r.ok,false,'historical decoder stays closed '+name);refused.push({name,result:r});}
  records.push({kind,format:f.originalFormat,hex:hex(wire),selected:result,prior:refused});
 }
 for(const [reason,index,value]of [['target',3,8|3<<24],['layer',4,1],['reverse',5,3|1<<8],['extent',5,0xf00],['swizzle',6,6],['swizzle-bits',6,0x1000]]){
  const wire=imageView(9,6,8,1,3);new DataView(wire.buffer).setUint32(index*4,value,true);
  const r=selected(wire);c.same(r.ok,false,'original malformed packed view '+reason);records.push({kind:'invalid-view',reason,hex:hex(wire),result:r});
 }
 for(const format of [0,17,20,225,253,0xffffff]){
  const wire=surface(10,6,format,2),r=selected(wire);c.same(r.ok,false,'unqualified packed surface stays closed');records.push({kind:'unqualified-surface',format,hex:hex(wire),result:r});
 }
 return{status:'passed',records,emptyProfiles,predictions:c.rows};
}
