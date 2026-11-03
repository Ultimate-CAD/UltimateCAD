export interface ReliefSettings {
 mode:"lithophane"|"relief";width:number;height:number;minThickness:number;maxThickness:number;
 gamma:number;brightness:number;contrast:number;invert:boolean;resolution:number;smoothing:number;borderWidth:number;borderThickness:number;
}
export interface ImageRelief {schema:1;fileName:string;dataUrl:string;imageWidth:number;imageHeight:number;settings:ReliefSettings}
export interface ReliefMesh {positions:Float64Array;triangleCount:number;height:number;sampleWidth:number;sampleHeight:number}
export const DEFAULT_RELIEF:ReliefSettings={mode:"lithophane",width:100,height:100,minThickness:.8,maxThickness:3,gamma:1,brightness:0,contrast:1,invert:false,resolution:160,smoothing:0,borderWidth:0,borderThickness:3};
export function validateReliefSettings(s:ReliefSettings){
 if(!s||!["lithophane","relief"].includes(s.mode)||typeof s.invert!=="boolean" ||
   ![s.width,s.height,s.minThickness,s.maxThickness,s.gamma,s.brightness,s.contrast,s.resolution,s.smoothing,s.borderWidth,s.borderThickness].every(Number.isFinite) ||
   s.width<.1||s.height<.1||s.width>20000||s.height>20000||s.minThickness<.1||s.maxThickness<s.minThickness||s.maxThickness>1000 ||
   s.gamma<.05||s.gamma>20||Math.abs(s.brightness)>1||s.contrast<0||s.contrast>5||
   !Number.isInteger(s.resolution)||s.resolution<2||s.resolution>512||!Number.isInteger(s.smoothing)||s.smoothing<0||s.smoothing>10||
   s.borderWidth<0||s.borderWidth>=Math.min(s.width,s.height)/2||s.borderThickness<.1||s.borderThickness>1000)throw Error("Image relief settings exceed supported dimensions or resource bounds");
}
export function validateImageRelief(source:ImageRelief){
 if(source?.schema!==1||typeof source.fileName!=="string"||source.fileName.length>512||typeof source.dataUrl!=="string"||
   !/^data:image\/(png|jpeg|webp);base64,/.test(source.dataUrl)||source.dataUrl.length>90e6||
   !Number.isInteger(source.imageWidth)||source.imageWidth<1||!Number.isInteger(source.imageHeight)||source.imageHeight<1)throw Error("Invalid retained image source");
 validateReliefSettings(source.settings);
}
const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
export function reliefThickness(r:number,g:number,b:number,a:number,s:ReliefSettings){
 const luminance=(linear(r/255)*.2126+linear(g/255)*.7152+linear(b/255)*.0722)*(a/255)+1-a/255;
 let value=Math.max(0,Math.min(1,(luminance-.5)*s.contrast+.5+s.brightness));
 value=value**(1/s.gamma);if(s.invert)value=1-value;
 return s.minThickness+(s.maxThickness-s.minThickness)*(s.mode==="lithophane"?1-value:value);
}
export function buildReliefMesh(pixels:Uint8ClampedArray,nx:number,ny:number,s:ReliefSettings):ReliefMesh {
 validateReliefSettings(s);
 if(!Number.isInteger(nx)||!Number.isInteger(ny)||nx<2||ny<2||nx>512||ny>512||pixels.length!==nx*ny*4)throw Error("Unsupported sampled image dimensions");
 let heights=new Float64Array(nx*ny);
 for(let i=0;i<heights.length;i++)heights[i]=reliefThickness(...[pixels[i*4],pixels[i*4+1],pixels[i*4+2],pixels[i*4+3]] as [number,number,number,number],s);
 for(let pass=0;pass<s.smoothing;pass++){
  const next=new Float64Array(heights.length);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   let sum=0,count=0;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const xx=x+dx,yy=y+dy;
    if(xx>=0&&xx<nx&&yy>=0&&yy<ny){sum+=heights[yy*nx+xx];count++;}
   }
   next[y*nx+x]=sum/count;
  }
  heights=next;
 }
 let max=0;
 const vertices:number[]=[];
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const xx=x*s.width/(nx-1),zz=y*s.height/(ny-1);
  const border=s.borderWidth>0&&Math.min(xx,s.width-xx,zz,s.height-zz)<s.borderWidth;
  const h=border?s.borderThickness:heights[y*nx+x];max=Math.max(max,h);
  vertices.push(xx-s.width/2,h,zz-s.height/2);
 }
 const boundary:number[]=[];
 for(let x=0;x<nx;x++)boundary.push(x);
 for(let y=1;y<ny;y++)boundary.push(y*nx+nx-1);
 for(let x=nx-2;x>=0;x--)boundary.push((ny-1)*nx+x);
 for(let y=ny-2;y>0;y--)boundary.push(y*nx);
 const bottom=vertices.length/3;
 for(const top of boundary)vertices.push(vertices[top*3],0,vertices[top*3+2]);
 const center=vertices.length/3;vertices.push(0,0,0);
 const triangles=(nx-1)*(ny-1)*2+boundary.length*3;
 const positions=new Float64Array(triangles*9);let offset=0;
 function triangle(a:number,b:number,c:number){
  for(const i of [a,b,c]){positions[offset++]=vertices[i*3];positions[offset++]=vertices[i*3+1];positions[offset++]=vertices[i*3+2];}
 }
 for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
  const a=y*nx+x,b=a+1,c=a+nx,d=c+1;triangle(a,c,b);triangle(b,c,d);
 }
 for(let i=0;i<boundary.length;i++){
  const next=(i+1)%boundary.length,a=boundary[i],b=boundary[next],c=bottom+i,d=bottom+next;
  triangle(a,b,c);triangle(b,d,c);triangle(center,c,d);
 }
 return {positions,triangleCount:triangles,height:max,sampleWidth:nx,sampleHeight:ny};
}
