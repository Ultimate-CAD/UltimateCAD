#pragma once
#include <Eigen/Core>
#include <igl/AABB.h>
#include <igl/per_face_normals.h>
#include <igl/per_vertex_normals.h>
#include <igl/per_edge_normals.h>
#include <igl/pseudonormal_test.h>
#include <manifold/manifold.h>
#include <cmath>
#include <atomic>

// Valid only after Manifold has accepted a closed oriented solid. Angle-weighted
// vertex and edge normals avoid the ambiguous closest-face sign at shared edges.
struct DistanceQuery {
  Eigen::MatrixXd v, fn, vn, en;
  Eigen::MatrixXi f, e;
  Eigen::VectorXi emap;
  igl::AABB<Eigen::MatrixXd,3> tree;
  std::atomic<uint64_t> queries{0};
  explicit DistanceQuery(const manifold::MeshGL& mesh) {
    v.resize(mesh.NumVert(),3);f.resize(mesh.NumTri(),3);
    for(int i=0;i<v.rows();++i)for(int j=0;j<3;++j)v(i,j)=mesh.vertProperties[i*mesh.numProp+j];
    for(int i=0;i<f.rows();++i)for(int j=0;j<3;++j)f(i,j)=mesh.triVerts[i*3+j];
    tree.init(v,f);
    igl::per_face_normals(v,f,fn);
    igl::per_vertex_normals(v,f,igl::PER_VERTEX_NORMALS_WEIGHTING_TYPE_ANGLE,fn,vn);
    igl::per_edge_normals(v,f,igl::PER_EDGE_NORMALS_WEIGHTING_TYPE_UNIFORM,fn,en,e,emap);
  }
  double operator()(manifold::vec3 p) {
    queries.fetch_add(1,std::memory_order_relaxed);Eigen::RowVector3d q(p.x,p.y,p.z),c,n;int face=-1;
    const double squared=tree.squared_distance(v,f,q,face,c);
    if(face<0||!std::isfinite(squared))throw std::runtime_error("Distance query failed");
    double sign;igl::pseudonormal_test(v,f,fn,vn,en,emap,q,face,c,sign,n);
    return -sign*std::sqrt(std::max(0.0,squared));
  }
};
