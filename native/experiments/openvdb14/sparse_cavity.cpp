#include "sparse_cavity.h"
#include <openvdb/openvdb.h>
#include <openvdb/tools/MeshToVolume.h>
#include <openvdb/tools/VolumeToMesh.h>
#include <chrono>
#include <cmath>
#include <iostream>
#include <windows.h>
#include <psapi.h>

namespace {
using Clock = std::chrono::steady_clock;
double elapsed(Clock::time_point t) { return std::chrono::duration<double,std::milli>(Clock::now()-t).count(); }
double conversionMs=0, extractionMs=0;
uint64_t activeVoxels=0, treeBytes=0, leafNodes=0, passes=0;
struct MeshAdapter {
  const manifold::MeshGL& mesh;
  const double pitch;
  size_t polygonCount() const { return mesh.NumTri(); }
  size_t pointCount() const { return mesh.NumVert(); }
  size_t vertexCount(size_t) const { return 3; }
  void getIndexSpacePoint(size_t n,size_t v,openvdb::Vec3d& p) const {
    const size_t i=mesh.triVerts[n*3+v]*mesh.numProp;
    p=openvdb::Vec3d(mesh.vertProperties[i],mesh.vertProperties[i+1],mesh.vertProperties[i+2])/pitch;
  }
};
}

manifold::Manifold makeSparseCavity(const manifold::MeshGL& source,double cell,double wall) {
  openvdb::initialize();
  auto transform=openvdb::math::Transform::createLinearTransform(cell);
  const auto start=Clock::now();
  // OpenVDB is negative inside; widths are voxel counts, values are world mm.
  // Cover the requested interior isosurface plus three interpolation voxels.
  auto grid=openvdb::tools::meshToVolume<openvdb::FloatGrid>(
    MeshAdapter{source,cell},*transform,3.0f,float(std::ceil(wall/cell)+3));
  if(!grid || grid->empty()) throw std::runtime_error("OpenVDB generated an empty narrow band");
  conversionMs+=elapsed(start); ++passes;
  activeVoxels=std::max(activeVoxels,uint64_t(grid->activeVoxelCount()));
  treeBytes=std::max(treeBytes,uint64_t(grid->memUsage()));
  leafNodes=std::max(leafNodes,uint64_t(grid->tree().leafCount()));
  std::cerr<<"OpenVDB active voxels "<<grid->activeVoxelCount()<<", grid bytes "<<grid->memUsage()<<"\n";
  const auto extracting=Clock::now();
  std::vector<openvdb::Vec3s> points;
  std::vector<openvdb::Vec3I> triangles;
  std::vector<openvdb::Vec4I> quads;
  // Zero adaptivity: establish accuracy before testing coarser meshing heuristics.
  openvdb::tools::volumeToMesh(*grid,points,triangles,quads,-wall,0.0,false);
  manifold::MeshGL mesh; mesh.numProp=3;
  mesh.vertProperties.reserve(points.size()*3);
  for(const auto& p:points) for(int j=0;j<3;++j) mesh.vertProperties.push_back(p[j]);
  mesh.triVerts.reserve(triangles.size()*3+quads.size()*6);
  for(const auto& t:triangles) for(int j=0;j<3;++j) mesh.triVerts.push_back(t[j]);
  for(const auto& q:quads) {
    mesh.triVerts.insert(mesh.triVerts.end(),{q[0],q[1],q[2],q[0],q[2],q[3]});
  }
  // VDB negative-inside mesher winding is opposite Manifold's positive volume.
  // This representation conversion changes indices only, never coordinates.
  for(size_t i=0;i<mesh.triVerts.size();i+=3) std::swap(mesh.triVerts[i+1],mesh.triVerts[i+2]);
  mesh.tolerance=1e-5; mesh.Merge();
  manifold::Manifold cavity(mesh);
  std::cerr<<"OpenVDB extracted "<<mesh.NumTri()<<" triangles, manifold status "
    <<int(cavity.Status())<<", signed volume "<<cavity.Volume()<<"\n";
  extractionMs+=elapsed(extracting);
  return cavity;
}

void printSparseStats(std::ostream& stream) {
  PROCESS_MEMORY_COUNTERS_EX info{};
  if(!GetProcessMemoryInfo(GetCurrentProcess(),reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&info),sizeof(info)))
    throw std::runtime_error("Cannot measure prototype process memory");
  stream<<",\"sparse\":{\"version\":\"14.0.0\",\"passes\":"<<passes
    <<",\"conversionMs\":"<<conversionMs<<",\"extractionMs\":"<<extractionMs
    <<",\"maxActiveVoxels\":"<<activeVoxels<<",\"maxGridMemoryBytes\":"<<treeBytes
    <<",\"maxLeafNodes\":"<<leafNodes<<",\"peakPrivateCommitBytes\":"<<info.PeakPagefileUsage
    <<",\"allocationPeakMeasured\":false,\"allocatorNote\":\"Private commit and grid memUsage are not allocation-event peaks\"}";
}
