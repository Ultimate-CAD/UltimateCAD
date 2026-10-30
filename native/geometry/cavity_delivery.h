#pragma once
#include <manifold/manifold.h>
#include <array>
#include <map>
#include <set>

// Construct a representable approximated cavity. Separate only independently
// indexed topological fans that coincide after float32 rounding. Shrink the void
// locally along its normal; never touch the retained source/exterior. The caller
// must remeasure the delivered cavity against the original signed-distance field.
inline manifold::Manifold cavityDelivery(const manifold::Manifold& input,double allowance,size_t& separated){
 using namespace manifold;
 const auto generated=input.GetMeshGL();MeshGL rounded;rounded.numProp=3;rounded.vertProperties=generated.vertProperties;rounded.triVerts=generated.triVerts;rounded.tolerance=std::min(1e-5,allowance/16);
 // Start a fresh generated-cavity mesh: historical face/run IDs are construction
 // provenance, and must not protect numerical slivers from conditioning.
 rounded.Merge();auto clean=Manifold(rounded).Simplify(allowance/2);
 auto mesh=clean.GetMeshGL();std::vector<size_t> parents(mesh.NumVert());
 for(size_t i=0;i<parents.size();++i)parents[i]=i;
 auto root=[&](size_t i){while(parents[i]!=i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 for(size_t i=0;i<mesh.mergeFromVert.size();++i)parents[root(mesh.mergeFromVert[i])]=root(mesh.mergeToVert[i]);
 auto point=[&](size_t i){return vec3(mesh.vertProperties[i*mesh.numProp],mesh.vertProperties[i*mesh.numProp+1],mesh.vertProperties[i*mesh.numProp+2]);};
 std::map<std::array<float,3>,std::set<size_t>> groups;std::vector<vec3> normals(mesh.NumVert(),vec3(0.0));
 for(size_t i=0;i<mesh.NumVert();++i)groups[{mesh.vertProperties[i*mesh.numProp],mesh.vertProperties[i*mesh.numProp+1],mesh.vertProperties[i*mesh.numProp+2]}].insert(root(i));
 for(size_t i=0;i<mesh.triVerts.size();i+=3){const auto a=point(mesh.triVerts[i]),b=point(mesh.triVerts[i+1]),c=point(mesh.triVerts[i+2]),n=la::cross(b-a,c-a);for(int j=0;j<3;++j)normals[root(mesh.triVerts[i+j])]+=n;}
 for(size_t i=0;i<mesh.NumVert();++i){const auto p=point(i);if(groups[{float(p.x),float(p.y),float(p.z)}].size()<2)continue;const auto n=normals[root(i)];const double length=std::sqrt(la::dot(n,n));if(!(length>0))throw std::runtime_error("Cannot construct a stable cavity fan normal");const auto q=p-n*(allowance/4/length);for(int j=0;j<3;++j)mesh.vertProperties[i*mesh.numProp+j]=float(q[j]);++separated;}
 return Manifold(mesh);
}
