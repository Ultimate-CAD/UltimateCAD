"use client";
import {useEffect,useRef} from "react";
import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import type {ReliefMesh} from "@/lib/imageRelief";
export function ImageReliefPreview({mesh,backlit}:{mesh:ReliefMesh;backlit:boolean}){
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const node=host.current;if(!node)return;
  const scene=new THREE.Scene();scene.background=new THREE.Color(backlit?"#000000":"#111111");
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(640,360);renderer.setPixelRatio(Math.min(devicePixelRatio,2));node.appendChild(renderer.domElement);
  const positions=new Float32Array(mesh.positions),geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));geometry.computeVertexNormals();geometry.computeBoundingBox();
  if(backlit){
   const colors=new Float32Array(positions.length),thickness=new Map<string,number>();
   for(let i=0;i<positions.length;i+=3){const key=positions[i]+","+positions[i+2];thickness.set(key,Math.max(thickness.get(key)??0,positions[i+1]));}
   const nonzero=[...thickness.values()].filter(v=>v>0),mean=nonzero.reduce((a,b)=>a+b,0)/(nonzero.length||1);
   for(let i=0;i<positions.length;i+=3){const brightness=Math.exp(-1.1*(thickness.get(positions[i]+","+positions[i+2])||mean));colors[i]=brightness;colors[i+1]=brightness*.97;colors[i+2]=brightness*.92;}
   geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
  }
  const material=backlit?new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}):new THREE.MeshStandardMaterial({color:"#f5ecdc",side:THREE.DoubleSide});
  scene.add(new THREE.Mesh(geometry,material));scene.add(new THREE.HemisphereLight(0xffffff,0x666666,3));
  const center=geometry.boundingBox!.getCenter(new THREE.Vector3()),span=geometry.boundingBox!.getSize(new THREE.Vector3()).length()||1;
  const camera=new THREE.PerspectiveCamera(40,640/360,span/10000,span*100);
  camera.position.copy(center).add(new THREE.Vector3(0,span,span*.25));
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(center);controls.update();
  const render=()=>renderer.render(scene,camera);controls.addEventListener("change",render);render();
  return()=>{controls.removeEventListener("change",render);controls.dispose();geometry.dispose();material.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
 },[mesh,backlit]);
 return <div ref={host} style={{overflow:"auto"}} aria-label={backlit?"Simulated backlit preview":"Image geometry preview"}/>;
}
