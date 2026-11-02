#include <openvdb/openvdb.h>
#include <openvdb/tools/MeshToVolume.h>
#include <openvdb/tools/VolumeToMesh.h>
#include <openvdb/tools/LevelSetFilter.h>
#include <openvdb/tools/FastSweeping.h>
#include <manifold/manifold.h>
#include "../../geometry/distance.h"
#include <oneapi/tbb/global_control.h>
#include <oneapi/tbb/parallel_for.h>
#include <oneapi/tbb/parallel_sort.h>
#include <windows.h>
#include <psapi.h>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <mutex>
#include <thread>

namespace {
using namespace manifold;
using Clock=std::chrono::steady_clock;
const auto started=Clock::now();
std::filesystem::path output;
std::vector<std::string> stages;
std::string method;
double pitch=0,wall=0,error=0,measured=0;
vec3 worst(0.0); uint64_t worstTriangle=0; std::string worstKind;
bool accuracyPass=false; uint64_t inputTriangles=0,resultTriangles=0;
HANDLE memoryJob=nullptr;
double ms(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
std::string quote(const std::string& s){std::string r="\"";for(char c:s){if(c=='\n')r+="\\n";else if(c=='\r')r+="\\r";else {if(c=='"'||c=='\\')r+='\\';r+=c;}}return r+'"';}
PROCESS_MEMORY_COUNTERS_EX memory(){PROCESS_MEMORY_COUNTERS_EX m{};if(!GetProcessMemoryInfo(GetCurrentProcess(),reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&m),sizeof(m)))throw std::runtime_error("Memory measurement failed");return m;}
void isolate(){
  memoryJob=CreateJobObjectW(nullptr,nullptr);JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_PROCESS_MEMORY;
  limits.ProcessMemoryLimit=8ull*1024*1024*1024;
  if(!memoryJob||!SetInformationJobObject(memoryJob,JobObjectExtendedLimitInformation,&limits,sizeof(limits))||!AssignProcessToJobObject(memoryJob,GetCurrentProcess()))throw std::runtime_error("Memory job isolation failed");
  if(const char* owner=std::getenv("LAYERLING_BENCH_OWNER_PID")){
    HANDLE p=OpenProcess(SYNCHRONIZE,FALSE,std::stoul(owner));if(!p)throw std::runtime_error("Cannot monitor owner");
    std::thread([p]{WaitForSingleObject(p,INFINITE);CloseHandle(p);TerminateProcess(GetCurrentProcess(),130);}).detach();
  }
}
void record(const char* phase,Clock::time_point start,const openvdb::FloatGrid::Ptr& grid={},bool done=true){
  const auto m=memory();std::ostringstream s;s<<std::setprecision(17);
  s<<"{\"phase\":"<<quote(phase)<<",\"complete\":"<<(done?"true":"false")<<",\"elapsedMs\":"<<ms(started)<<",\"durationMs\":"<<ms(start)
    <<",\"rssBytes\":"<<m.WorkingSetSize<<",\"peakRssBytes\":"<<m.PeakWorkingSetSize<<",\"privateCommitBytes\":"<<m.PrivateUsage<<",\"peakPrivateCommitBytes\":"<<m.PeakPagefileUsage;
  if(grid)s<<",\"activeVoxels\":"<<grid->activeVoxelCount()<<",\"gridBytes\":"<<grid->memUsage()<<",\"leafNodes\":"<<grid->tree().leafCount();
  s<<"}";stages.push_back(s.str());std::ofstream(output/"stages.jsonl",std::ios::app)<<s.str()<<'\n';
  std::cerr<<phase<<(done?" completed ":" started ")<<ms(start)<<" ms\n";
}
template<class T>T read(std::ifstream& in){T x{};if(!in.read(reinterpret_cast<char*>(&x),sizeof(x)))throw std::runtime_error("Truncated request");return x;}
template<class T>void write(std::ofstream& out,T x){out.write(reinterpret_cast<const char*>(&x),sizeof(x));}
template<class M>void save(const char* name,const M& mesh){
  if(mesh.NumVert()>UINT32_MAX/3||mesh.triVerts.size()>UINT32_MAX)throw std::runtime_error("Protocol index bound exceeded");
  std::ofstream out(output/name,std::ios::binary);write(out,uint32_t(0x31524c4c));write(out,uint32_t(1));write(out,uint32_t(mesh.NumVert()*3));write(out,uint32_t(mesh.triVerts.size()));
  for(size_t i=0;i<mesh.vertProperties.size();i+=mesh.numProp)for(int j=0;j<3;++j)write(out,double(mesh.vertProperties[i+j]));
  for(auto i:mesh.triVerts)write(out,uint32_t(i));out.close();if(!out)throw std::runtime_error("Mesh write failed");
}
void valid(const Manifold& m,const char* stage){if(m.Status()!=Manifold::Error::NoError||m.IsEmpty()||m.Volume()<=0)throw std::runtime_error(std::string(stage)+" is not a positive-volume closed Manifold solid");}
struct Adapter {
  const MeshGL& mesh;const openvdb::math::Transform& transform;
  size_t polygonCount()const{return mesh.NumTri();}size_t pointCount()const{return mesh.NumVert();}size_t vertexCount(size_t)const{return 3;}
  void getIndexSpacePoint(size_t n,size_t v,openvdb::Vec3d& p)const{size_t i=mesh.triVerts[n*3+v]*mesh.numProp;p=transform.worldToIndex(openvdb::Vec3d(mesh.vertProperties[i],mesh.vertProperties[i+1],mesh.vertProperties[i+2]));}
};
void stats(const std::string& status,const std::string& reason=""){
  auto m=memory();std::ofstream s(output/"stats.json");s<<std::setprecision(17);
  s<<"{\"status\":"<<quote(status)<<",\"reason\":"<<quote(reason)<<",\"method\":"<<quote(method)<<",\"pitchMm\":"<<pitch<<",\"wallMm\":"<<wall<<",\"requestedErrorMm\":"<<error
    <<",\"durationMs\":"<<ms(started)<<",\"peakRssBytes\":"<<m.PeakWorkingSetSize<<",\"peakPrivateCommitBytes\":"<<m.PeakPagefileUsage
    <<",\"sourceTriangles\":"<<inputTriangles<<",\"resultTriangles\":"<<resultTriangles<<",\"sampledOffsetErrorMm\":"<<measured<<",\"accuracyPass\":"<<(accuracyPass?"true":"false")
    <<",\"worstSample\":{\"point\":["<<worst.x<<','<<worst.y<<','<<worst.z<<"],\"triangle\":"<<worstTriangle<<",\"kind\":"<<quote(worstKind)<<"},\"smoothingApplied\":false,\"adaptivity\":0,\"manufacturingVerdict\":\"pending-independent-check\",\"stages\":[";
  for(size_t i=0;i<stages.size();++i)s<<(i?",":"")<<stages[i];s<<"]}\n";
}
}

int main(int argc,char** argv){
  try{
    if(argc!=5&&argc!=8)throw std::runtime_error("Expected request outdir method pitch [gridOriginXYZ]");
    output=argv[2];std::filesystem::create_directories(output);method=argv[3];pitch=std::stod(argv[4]);
    if((method!="offset"&&method!="dilate")||!(pitch>=.02&&pitch<=.10))throw std::runtime_error("Invalid method or pitch");
    isolate();tbb::global_control concurrency(tbb::global_control::max_allowed_parallelism,8);
    auto t=Clock::now();record("source-prepare",t,{},false);
    std::ifstream in(argv[1],std::ios::binary|std::ios::ate);if(!in)throw std::runtime_error("Request unavailable");auto bytes=in.tellg();in.seekg(0);
    if(read<uint32_t>(in)!=0x31474c4c||read<uint32_t>(in)!=1)throw std::runtime_error("Bad request header");
    auto pn=read<uint32_t>(in),tn=read<uint32_t>(in);wall=read<double>(in);error=read<double>(in);read<double>(in);read<uint32_t>(in);read<uint32_t>(in);
    if(pn%3||tn%3||pn<12||tn<12||bytes!=std::streamoff(48ull+8ull*pn+4ull*tn)||pn>60'000'000||tn>60'000'000||!(wall>0&&std::isfinite(wall))||!(error>=.02&&error<=.5))throw std::runtime_error("Invalid source request");
    MeshGL mesh;mesh.numProp=3;mesh.vertProperties.resize(pn);mesh.triVerts.resize(tn);
    for(auto& p:mesh.vertProperties){p=float(read<double>(in));if(!std::isfinite(p))throw std::runtime_error("Non-finite source");}
    for(auto& i:mesh.triVerts){i=read<uint32_t>(in);if(i>=pn/3)throw std::runtime_error("Source index out of range");}
    mesh.tolerance=1e-5;mesh.Merge();Manifold source(mesh);valid(source,"Source");mesh=source.GetMeshGL();inputTriangles=source.NumTri();
    save("source.mesh.bin",mesh);DistanceQuery distance(mesh);record("source-prepare",t);
    openvdb::initialize();auto transform=openvdb::math::Transform::createLinearTransform(pitch);
    if(argc==8)transform->postTranslate(openvdb::Vec3d(std::stod(argv[5]),std::stod(argv[6]),std::stod(argv[7])));
    // Adapter expects index coordinates, VolumeToMesh emits world coordinates.
    t=Clock::now();record("voxelization",t,{},false);
    auto grid=openvdb::tools::meshToVolume<openvdb::FloatGrid>(Adapter{mesh,*transform},*transform,3.0f,3.0f);
    if(!grid||grid->empty())throw std::runtime_error("Empty initial level set");record("voxelization",t,grid);
    double iso=0;
    if(method=="offset"){
      t=Clock::now();record("offset-interface-tracking",t,grid,false);
      openvdb::tools::LevelSetFilter<openvdb::FloatGrid> filter(*grid);filter.offset(float(wall));record("offset-interface-tracking",t,grid);
    }else{
      // Same operations as documented dilateSdf, split only to profile init vs sweep.
      openvdb::tools::FastSweeping<openvdb::FloatGrid> sweep;
      t=Clock::now();record("dilate-topology-init",t,grid,false);
      // A face-only stencil grows a Manhattan ball and is too shallow along
      // diagonal normals at wall/pitch steps. The 26-neighbor stencil covers
      // the requested Euclidean interior distance in every direction.
      if(!sweep.initDilate(*grid,int(std::ceil(wall/pitch)),openvdb::tools::NN_FACE_EDGE_VERTEX,openvdb::tools::FastSweepingDomain::SWEEP_LESS_THAN_ISOVALUE))throw std::runtime_error("Interior dilation initialization failed");
      record("dilate-topology-init",t,sweep.sdfGrid());
      t=Clock::now();record("fast-sweeping",t,sweep.sdfGrid(),false);sweep.sweep(1,true);grid=sweep.sdfGrid();record("fast-sweeping",t,grid);iso=-wall;
    }
    t=Clock::now();record("polygonization",t,grid,false);
    std::vector<openvdb::Vec3s> points;std::vector<openvdb::Vec4I> quads;
    openvdb::tools::volumeToMesh(*grid,points,quads,iso);record("polygonization",t,grid);
    t=Clock::now();uint64_t inactiveStencilVertices=0;auto accessor=grid->getConstAccessor();
    std::ofstream fieldWitness(output/"iso-active-stencil.json");fieldWitness<<std::setprecision(17)<<"{\"firstPoints\":[";
    for(auto p:points){auto index=grid->worldToIndex(openvdb::Vec3d(p));auto corner=openvdb::Coord::floor(index);bool all=true;for(int x=0;x<2;++x)for(int y=0;y<2;++y)for(int z=0;z<2;++z)all&=accessor.isValueOn(corner+openvdb::Coord(x,y,z));if(!all){if(inactiveStencilVertices<8)fieldWitness<<(inactiveStencilVertices?",":"")<<'['<<p.x()<<','<<p.y()<<','<<p.z()<<']';++inactiveStencilVertices;}}
    fieldWitness<<"],\"verticesTouchingInactiveStencil\":"<<inactiveStencilVertices<<",\"vertices\":"<<points.size()<<",\"isoValueWorldMm\":"<<iso<<"}\n";
    record("iso-active-stencil-check",t,grid);grid.reset();
    t=Clock::now();record("triangulation",t,{},false);
    MeshGL64 raw;raw.numProp=3;raw.vertProperties.reserve(points.size()*3);raw.triVerts.reserve(quads.size()*6);
    for(auto p:points)for(int j=0;j<3;++j)raw.vertProperties.push_back(p[j]);
    uint64_t split02=0,split13=0,invalidQuads=0;
    for(auto q:quads){
      auto a=openvdb::Vec3d(points[q[0]]),b=openvdb::Vec3d(points[q[1]]),c=openvdb::Vec3d(points[q[2]]),d=openvdb::Vec3d(points[q[3]]);
      auto n0=(b-a).cross(c-a),n1=(c-a).cross(d-a),n2=(b-a).cross(d-a),n3=(c-b).cross(d-b),normal=n0+n1;
      bool ok02=n0.dot(normal)>0&&n1.dot(normal)>0,ok13=n2.dot(normal)>0&&n3.dot(normal)>0;
      if(!ok02&&!ok13)++invalidQuads;
      bool diagonal02=ok02&&(!ok13||(a-c).lengthSqr()<=(b-d).lengthSqr());
      // Reverse the VDB winding for Manifold; no vertex movement or face removal.
      if(diagonal02){raw.triVerts.insert(raw.triVerts.end(),{q[0],q[2],q[1],q[0],q[3],q[2]});++split02;}
      else {raw.triVerts.insert(raw.triVerts.end(),{q[0],q[3],q[1],q[1],q[3],q[2]});++split13;}
    }
    points.clear();points.shrink_to_fit();quads.clear();quads.shrink_to_fit();
    std::ofstream(output/"triangulation.json")<<"{\"diagonal02\":"<<split02<<",\"diagonal13\":"<<split13<<",\"noPositiveAreaSplitQuads\":"<<invalidQuads<<",\"coordinates\":\"world-mm\",\"vertexMovement\":0,\"removedFaces\":0}\n";
    save("cavity-raw.mesh.bin",raw);record("triangulation",t);
    t=Clock::now();record("manifold-ingest",t,{},false);Manifold cavity(raw);valid(cavity,"Cavity");record("manifold-ingest",t);
    // Validate raw emitted coordinates, not a smoothed or simplified surface.
    t=Clock::now();record("exact-source-distance-check",t,{},false);
    std::mutex lock;std::atomic<double> maxError{0};
    auto point=[&](uint64_t i){return vec3(raw.vertProperties[i*3],raw.vertProperties[i*3+1],raw.vertProperties[i*3+2]);};
    auto check=[&](vec3 p,uint64_t tri,const char* kind){double e=std::abs(distance(p)-wall);double old=maxError.load();while(e>old&&!maxError.compare_exchange_weak(old,e)){}if(e>old){std::lock_guard<std::mutex> g(lock);if(e>=measured){measured=e;worst=p;worstTriangle=tri;worstKind=kind;}}};
    tbb::parallel_for(size_t(0),raw.NumVert(),[&](size_t i){check(point(i),i,"vertex");});
    tbb::parallel_for(size_t(0),raw.NumTri(),[&](size_t i){auto a=point(raw.triVerts[i*3]),b=point(raw.triVerts[i*3+1]),c=point(raw.triVerts[i*3+2]);check((a+b+c)/3.0,i,"centroid");});
    // Same midpoint coverage, one query for each shared topological edge.
    std::vector<uint64_t> edges(raw.triVerts.size());
    tbb::parallel_for(size_t(0),raw.NumTri(),[&](size_t i){for(int j=0;j<3;++j){uint64_t a=raw.triVerts[i*3+j],b=raw.triVerts[i*3+(j+1)%3];if(a>b)std::swap(a,b);edges[i*3+j]=(a<<32)|b;}});
    tbb::parallel_sort(edges.begin(),edges.end());edges.erase(std::unique(edges.begin(),edges.end()),edges.end());
    tbb::parallel_for(size_t(0),edges.size(),[&](size_t i){auto e=edges[i];check((point(e>>32)+point(e&0xffffffff))/2.0,i,"unique-edge-midpoint");});
    std::ofstream(output/"accuracy-coverage.json")<<"{\"uniqueVertices\":"<<raw.NumVert()<<",\"triangleCentroids\":"<<raw.NumTri()<<",\"uniqueEdgeMidpoints\":"<<edges.size()<<",\"exactQueryCount\":"<<distance.queries.load()<<",\"duplicateEdgeQueriesEliminated\":"<<raw.triVerts.size()-edges.size()<<"}\n";
    edges.clear();edges.shrink_to_fit();
    accuracyPass=measured<=error;record("exact-source-distance-check",t);
    Eigen::RowVector3d p(worst.x,worst.y,worst.z),closest;int face=-1;distance.tree.squared_distance(distance.v,distance.f,p,face,closest);
    std::ofstream witness(output/"accuracy-witness.json");witness<<std::setprecision(17)<<"{\"point\":["<<worst.x<<','<<worst.y<<','<<worst.z<<"],\"signedInsideDistanceMm\":"<<distance(worst)<<",\"offsetErrorMm\":"<<measured<<",\"sourceFace\":"<<face<<",\"closestPoint\":["<<closest[0]<<','<<closest[1]<<','<<closest[2]<<"]}\n";
    raw={};t=Clock::now();record("source-minus-cavity",t,{},false);auto result=source-cavity;valid(result,"Hollow result");resultTriangles=result.NumTri();record("source-minus-cavity",t);
    t=Clock::now();save("result.mesh.bin",result.GetMeshGL64());record("result-write",t);
    stats(accuracyPass?"generated-awaiting-independent-validation":"accuracy-rejected");return accuracyPass?0:2;
  }catch(const std::exception& e){std::cerr<<"Experiment failed: "<<e.what()<<'\n';if(!output.empty())try{stats("failed",e.what());}catch(...){}return 1;}
}
