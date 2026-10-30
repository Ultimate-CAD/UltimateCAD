const MAX_BYTES=720_000_048;
function validateRequest(bytes){
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(b.length<48||b.length>MAX_BYTES||b.readUInt32LE(0)!==0x31474c4c||b.readUInt32LE(4)!==1)throw new Error('Unsupported native geometry request');
  const pn=b.readUInt32LE(8),tn=b.readUInt32LE(12),wall=b.readDoubleLE(16),error=b.readDoubleLE(24),pitch=b.readDoubleLE(32);
  if(pn%3||tn%3||pn<12||tn<12||pn>60e6||tn>60e6||b.length!==48+pn*8+tn*4||b.readUInt32LE(40)>1||b.readUInt32LE(44)>16)throw new Error('Invalid native geometry buffer lengths or flags');
  if(!Number.isFinite(wall)||wall<=0||!Number.isFinite(error)||error<.02||error>.5||!Number.isFinite(pitch)||pitch<0)throw new Error('Invalid native geometry settings');
  return b;
}
function encodeRequest(input,pitch=0){
  const pn=input.positions.length,tn=input.indices.length;
  if(48+pn*8+tn*4>MAX_BYTES)throw new Error('Native source transport exceeds its memory budget');
  const b=Buffer.alloc(48+pn*8+tn*4);b.writeUInt32LE(0x31474c4c);b.writeUInt32LE(1,4);b.writeUInt32LE(pn,8);b.writeUInt32LE(tn,12);b.writeDoubleLE(input.thickness,16);b.writeDoubleLE(input.options?.maxErrorMm??.1,24);b.writeDoubleLE(pitch,32);
  for(let i=0;i<pn;i++)b.writeDoubleLE(input.positions[i],48+i*8);
  for(let i=0;i<tn;i++){if(!Number.isInteger(input.indices[i])||input.indices[i]<0||input.indices[i]>=pn/3)throw new Error('Invalid native mesh index');b.writeUInt32LE(input.indices[i],48+pn*8+i*4);}
  return validateRequest(b);
}
function decodeResult(bytes,materialize=true){
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(b.length<16||b.length>MAX_BYTES||b.readUInt32LE(0)!==0x31524c4c||b.readUInt32LE(4)!==1)throw new Error('Unsupported native geometry result');
  const pn=b.readUInt32LE(8),tn=b.readUInt32LE(12);if(pn%3||tn%3||pn<12||tn<12||16+pn*8+tn*4!==b.length)throw new Error('Invalid native result lengths');
  const positions=materialize?new Float64Array(pn):null,indices=materialize?new Uint32Array(tn):null;
  for(let i=0;i<pn;i++){const value=b.readDoubleLE(16+i*8);if(!Number.isFinite(value))throw new Error('Non-finite native result');if(positions)positions[i]=value;}
  for(let i=0;i<tn;i++){const index=b.readUInt32LE(16+pn*8+i*4);if(index>=pn/3)throw new Error('Invalid native result index');if(indices)indices[i]=index;}
  return {positions,indices};
}
module.exports={validateRequest,encodeRequest,decodeResult,MAX_BYTES};
