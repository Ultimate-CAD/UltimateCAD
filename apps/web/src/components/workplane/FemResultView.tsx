"use client";
import {useEffect,useRef} from "react";
import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import type {FemResult} from "@/lib/femStudy";
export function FemResultView({result,scale,field}:{result:FemResult;scale:number;field:"stress"|"displacement"}){
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const node=host.current;if(!node)return;
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(640,360);renderer.setPixelRatio(Math.min(devicePixelRatio,2));node.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color("#111111");
  const positions=new Float32Array(result.positions.length),colors=new Float32Array(result.positions.length);
  const max=field==="stress"?result.maxVonMisesPa:result.maxDisplacementM;
  for(let i=0;i<result.nodes;i++){
   for(let j=0;j<3;j++)positions[i*3+j]=result.positions[i*3+j]+scale*result.displacements[i*3+j];
   const value=field==="stress"?result.vonMises[i]:Math.hypot(...result.displacements.slice(i*3,i*3+3));
   const color=new THREE.Color().setHSL((1-Math.min(1,value/(max||1)))*.65,.9,.55);
   colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));geometry.setIndex(result.indices);geometry.computeVertexNormals();geometry.computeBoundingBox();
  const box=geometry.boundingBox!,center=box.getCenter(new THREE.Vector3()),span=box.getSize(new THREE.Vector3()).length()||1;
  const camera=new THREE.PerspectiveCamera(40,640/360,span/10000,span*100);camera.position.copy(center).add(new THREE.Vector3(span,span*.6,span));
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(center);controls.update();
  const material=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.65});
  scene.add(new THREE.Mesh(geometry,material));scene.add(new THREE.HemisphereLight(0xffffff,0x555555,3));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(span,span,span);scene.add(light);
  let frame=0;function render(){controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(render);}render();
  return()=>{cancelAnimationFrame(frame);controls.dispose();geometry.dispose();material.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
 },[result,scale,field]);
 return <div ref={host} style={{width:"100%",overflow:"auto"}} aria-label="Deformed FEM result preview"/>;
}
