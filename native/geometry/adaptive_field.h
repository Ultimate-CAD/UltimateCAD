#pragma once
#include "distance.h"
#include <vector>

// Signed Euclidean distance is 1-Lipschitz for a valid closed oriented source.
// A block may use a constant only when its entire extent, plus two extraction
// cell diagonals, lies strictly on one side of the requested isovalue. Thus every
// tetrahedron that can cross the isosurface still receives exact distance queries;
// no approximate sample participates in surface interpolation or root refinement.
// This reduces distance queries, not the dense storage used by Manifold LevelSet.
class AdaptiveField {
 struct Node {double value=0,split=0;int left=-1,right=-1,axis=0;bool inactive=false;};
 std::vector<Node> nodes;
 DistanceQuery& distance;
 double level,guard,minWidth;
 int build(manifold::vec3 low,manifold::vec3 high,int depth){
   if(nodes.size()>=2'000'000)throw std::runtime_error("Adaptive field index exceeds its memory budget");
   const int id=static_cast<int>(nodes.size());nodes.emplace_back();
   const auto center=(low+high)/2.0,span=high-low;
   const double value=distance(center),radius=std::sqrt(manifold::la::dot(span,span))/2.0;
   nodes[id].value=value;
   if(std::abs(value-level)>radius+guard){nodes[id].inactive=true;return id;}
   int axis=span.y>span.x?1:0;if(span.z>span[axis])axis=2;
   if(span[axis]<=minWidth||depth>=30)return id;
   nodes[id].axis=axis;nodes[id].split=center[axis];auto a=high,b=low;a[axis]=center[axis];b[axis]=center[axis];
   const int left=build(low,a,depth+1),right=build(b,high,depth+1);nodes[id].left=left;nodes[id].right=right;
   return id;
 }
public:
 std::atomic<uint64_t> skipped{0};
 AdaptiveField(DistanceQuery& query,manifold::Box bounds,double pitch,double iso):distance(query),level(iso),guard(2*std::sqrt(3.0)*pitch),minWidth(pitch*8){build(bounds.min,bounds.max,0);}
 double operator()(manifold::vec3 p){
   int id=0;
   while(nodes[id].left>=0)id=p[nodes[id].axis]<nodes[id].split?nodes[id].left:nodes[id].right;
   if(nodes[id].inactive){skipped.fetch_add(1,std::memory_order_relaxed);return nodes[id].value;}
   return distance(p);
 }
 size_t size()const{return nodes.size();}
};
