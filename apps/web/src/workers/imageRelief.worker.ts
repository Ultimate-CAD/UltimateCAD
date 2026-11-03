/// <reference lib="webworker" />
import {buildReliefMesh,validateImageRelief,type ImageRelief} from "@/lib/imageRelief";
self.onmessage=async(e:MessageEvent<{source:ImageRelief}>)=>{
 try{
  const {source}=e.data;validateImageRelief(source);
  const image=await createImageBitmap(await(await fetch(source.dataUrl)).blob());
  let result;
  try{
   if(image.width*image.height>100000000)throw Error("Image exceeds the 100 megapixel decode budget");
   const size=source.settings.resolution,ratio=image.width/image.height;
   const nx=Math.max(2,Math.round(ratio>=1?size:size*ratio)),ny=Math.max(2,Math.round(ratio>=1?size/ratio:size));
   const canvas=new OffscreenCanvas(nx,ny),context=canvas.getContext("2d",{willReadFrequently:true});
   if(!context)throw Error("Image sampling is unavailable");
   context.drawImage(image,0,0,nx,ny);
   result=buildReliefMesh(context.getImageData(0,0,nx,ny).data,nx,ny,source.settings);
  }finally{image.close();}
  self.postMessage({result},{transfer:[result.positions.buffer]});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
export {};
