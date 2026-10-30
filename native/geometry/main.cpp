#include <manifold/manifold.h>
#include <algorithm>
#include <bit>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <vector>
#include <thread>
#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
static uint64_t peakMemory(){PROCESS_MEMORY_COUNTERS info{};GetProcessMemoryInfo(GetCurrentProcess(),&info,sizeof(info));return info.PeakWorkingSetSize;}
static HANDLE memoryJob=nullptr;
static void boundMemory(){
  memoryJob=CreateJobObjectW(nullptr,nullptr);JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_PROCESS_MEMORY;
  limits.ProcessMemoryLimit=8ull*1024*1024*1024;
  if(!memoryJob||!SetInformationJobObject(memoryJob,JobObjectExtendedLimitInformation,&limits,sizeof(limits))||!AssignProcessToJobObject(memoryJob,GetCurrentProcess()))throw std::runtime_error("Cannot establish native memory isolation");
}
#else
static uint64_t peakMemory(){return 0;}
static void boundMemory(){}
#endif
#include "distance.h"
#include "adaptive_field.h"
#include "cavity_delivery.h"
#include <oneapi/tbb/global_control.h>
using namespace manifold;
using Clock=std::chrono::steady_clock;
static double ms(Clock::time_point start){return std::chrono::duration<double,std::milli>(Clock::now()-start).count();}
template<class T>T read(std::ifstream& stream){T value{};if(!stream.read(reinterpret_cast<char*>(&value),sizeof(T)))throw std::runtime_error("Truncated binary request");return value;}
template<class T>void write(std::ofstream& stream,T value){stream.write(reinterpret_cast<const char*>(&value),sizeof(T));}
static void valid(const Manifold& shape,const char* what){if(shape.Status()!=Manifold::Error::NoError||shape.IsEmpty()||shape.Volume()<=0)throw std::runtime_error(what);}

int main(int argc,char** argv){
 try{
  if(argc!=3&&argc!=4)throw std::runtime_error("Expected request and result paths");
  boundMemory();
#ifdef _WIN32
  if(argc==4){
    const auto pid=std::stoul(argv[3]);HANDLE parent=OpenProcess(SYNCHRONIZE,FALSE,pid);
    if(!parent)throw std::runtime_error("Cannot monitor native job owner");
    std::thread([parent]{WaitForSingleObject(parent,INFINITE);CloseHandle(parent);TerminateProcess(GetCurrentProcess(),130);}).detach();
  }
#endif
  static_assert(std::endian::native==std::endian::little);
  const auto start=Clock::now();std::ifstream in(argv[1],std::ios::binary|std::ios::ate);
  if(!in)throw std::runtime_error("Cannot open request");const auto bytes=in.tellg();in.seekg(0);
  if(read<uint32_t>(in)!=0x31474c4c||read<uint32_t>(in)!=1)throw std::runtime_error("Unsupported geometry protocol");
  const auto pn=read<uint32_t>(in),tn=read<uint32_t>(in);
  const double wall=read<double>(in),error=read<double>(in),requestedCell=read<double>(in);
  const auto flags=read<uint32_t>(in),threads=read<uint32_t>(in);
  if(threads>16)throw std::runtime_error("Native concurrency exceeds bounded worker count");
  tbb::global_control concurrency(tbb::global_control::max_allowed_parallelism,threads?threads:8);
  if(flags>1||pn%3||tn%3||tn<12||pn<12||pn>60'000'000||tn>60'000'000||bytes!=std::streamoff(48ull+8ull*pn+4ull*tn))throw std::runtime_error("Invalid or excessive binary mesh lengths");
  if(!(wall>0&&std::isfinite(wall))||!(error>=0.02&&error<=0.5)||!(requestedCell>=0&&std::isfinite(requestedCell)))throw std::runtime_error("Invalid wall, accuracy or grid pitch");
  if(uint64_t(pn)*32+uint64_t(tn/3)*900+1024ull*1024*1024>7ull*1024*1024*1024)throw std::runtime_error("Estimated native source and topology memory exceed the isolated job budget; reduce source size");
  MeshGL mesh;mesh.numProp=3;mesh.vertProperties.resize(pn);mesh.triVerts.resize(tn);
  for(auto& value:mesh.vertProperties){const double x=read<double>(in);value=static_cast<float>(x);if(!std::isfinite(x)||!std::isfinite(value))throw std::runtime_error("Non-finite mesh coordinate");}
  for(auto& index:mesh.triVerts){index=read<uint32_t>(in);if(index>=pn/3)throw std::runtime_error("Invalid triangle index");}
  // Match the existing WASM source ingest, including float32 normalization.
  mesh.tolerance=1e-5;mesh.Merge();Manifold source(mesh);valid(source,"Source must be a closed consistently oriented solid");
  mesh=source.GetMeshGL();auto bounds=source.BoundingBox();const double sourceVolume=source.Volume();
  std::cerr<<"Building native distance index\n";DistanceQuery distance(mesh);const double prepareMs=ms(start);
  double cell=requestedCell>0?requestedCell:std::min(wall*.6,std::sqrt(wall*error*4));
  Manifold cavity;double measured=INFINITY;size_t omitted=0,conditionedVertices=0;uint64_t gridLocations=0,skipped=0,nodes=0;
  const auto samplingStart=Clock::now();
  for(int pass=0;pass<4;++pass,cell/=2){
    std::cerr<<"Building native cavity, grid "<<cell<<" mm\n";
    auto low=bounds.min-vec3(cell*2),high=bounds.max+vec3(cell*2);
    const auto span=high-low;const double logical=std::ceil(span.x/cell)*std::ceil(span.y/cell)*std::ceil(span.z/cell)*3;
    if(!std::isfinite(logical)||logical>128'000'000)throw std::runtime_error("Requested native accuracy exceeds bounded grid work; choose a larger accuracy value");
    gridLocations+=static_cast<uint64_t>(logical);
    std::unique_ptr<AdaptiveField> adaptive;
    if(flags==0){adaptive=std::make_unique<AdaptiveField>(distance,Box(low,high),cell,wall);nodes+=adaptive->size();}
    auto build=[&](vec3 a,vec3 b){return Manifold::LevelSet([&](vec3 p){return adaptive?(*adaptive)(p):distance(p);},Box(a,b),cell,wall,std::min(error/8,.01),true);};
    Manifold made;
    if(logical<=16'000'000)made=build(low,high);
    else{
      int axis=span.y>span.x?1:0;if(span.z>span[axis])axis=2;
      const int count=static_cast<int>(std::ceil(logical/(16'000'000*.7)));std::vector<Manifold> parts;
      for(int tile=0;tile<count;++tile){auto a=low,b=high;a[axis]=std::max(low[axis],low[axis]+span[axis]*tile/count-cell*2);b[axis]=std::min(high[axis],low[axis]+span[axis]*(tile+1)/count+cell*2);parts.push_back(build(a,b));}
      made=Manifold::BatchBoolean(parts,OpType::Add);made.NumTri();
    }
    if(adaptive)skipped+=adaptive->skipped;
    valid(made,"No internal cavity fits the requested wall thickness");auto components=made.Decompose();
    std::sort(components.begin(),components.end(),[](auto& a,auto& b){return std::abs(a.Volume())>std::abs(b.Volume());});
    omitted=components.size()-1;cavity=components.front().Simplify(error/4);valid(cavity,"Cavity simplification failed");
    // Resolve numerical slivers in the cavity's actual float32 delivery frame,
    // before measuring it and before cutting the untouched original exterior.
    // This is construction of the approximated cavity, not a repair of source.
    size_t separated=0;cavity=cavityDelivery(cavity,std::min(error/16,1e-4),separated);valid(cavity,"Cavity float32 conditioning failed");
    conditionedVertices+=separated;
    std::cerr<<"Generated cavity float32 conditioning: "<<separated<<" fan vertices; remeasuring offset\n";
    const auto sample=cavity.GetMeshGL();measured=0;
    auto point=[&](uint32_t i){return vec3(sample.vertProperties[i*sample.numProp],sample.vertProperties[i*sample.numProp+1],sample.vertProperties[i*sample.numProp+2]);};
    auto check=[&](vec3 p){measured=std::max(measured,std::abs(distance(p)-wall));};
    for(size_t i=0;i<sample.triVerts.size();i+=3){auto a=point(sample.triVerts[i]),b=point(sample.triVerts[i+1]),c=point(sample.triVerts[i+2]);check(a);check((a+b+c)/3.0);check((a+b)/2.0);check((b+c)/2.0);check((c+a)/2.0);}
    if(measured<=error)break;
  }
  if(measured>error)throw std::runtime_error("Sampled native offset error exceeds the requested accuracy; original preserved");
  const double samplingMs=ms(samplingStart);std::cerr<<"Validating and cutting native cavity\n";
  const auto cuttingStart=Clock::now();auto result=source-cavity;valid(result,"Native cavity did not leave a valid hollow solid");
  if(result.Volume()>=sourceVolume)throw std::runtime_error("Native cavity did not remove positive volume");
  const auto output=result.GetMeshGL();std::ofstream out(argv[2],std::ios::binary|std::ios::trunc);
  if(16ull+output.NumVert()*3ull*8+output.triVerts.size()*4ull>720'000'048)throw std::runtime_error("Native result exceeds its binary transport budget");
  write(out,uint32_t(0x31524c4c));write(out,uint32_t(1));write(out,uint32_t(output.NumVert()*3));write(out,uint32_t(output.triVerts.size()));
  for(size_t i=0;i<output.vertProperties.size();i+=output.numProp)for(int j=0;j<3;++j)write(out,double(output.vertProperties[i+j]));
  for(auto index:output.triVerts)write(out,uint32_t(index));out.close();if(!out)throw std::runtime_error("Native result write failed");
  std::cout.precision(17);
  std::cerr<<"Adaptive nodes "<<nodes<<", skipped exact queries "<<skipped<<"\n";
  std::cout<<"{\"method\":\"mesh-sdf\",\"backend\":\"native-cpu\",\"cellSizeMm\":"<<cell
    <<",\"cavityConditioningMm\":"<<std::min(error/16,1e-4)<<",\"conditionedCavityVertices\":"<<conditionedVertices
    <<",\"maxErrorMm\":"<<error<<",\"measuredErrorMm\":"<<measured<<",\"sourceTriangles\":"<<source.NumTri()<<",\"resultTriangles\":"<<result.NumTri()
    <<",\"sourceVolumeMm3\":"<<sourceVolume<<",\"resultVolumeMm3\":"<<result.Volume()<<",\"cavityVolumeMm3\":"<<cavity.Volume()
    <<",\"evaluations\":"<<distance.queries<<",\"durationMs\":"<<ms(start)<<",\"prepareMs\":"<<prepareMs<<",\"samplingMs\":"<<samplingMs
    <<",\"cuttingMs\":"<<ms(cuttingStart)<<",\"logicalGridLocations\":"<<gridLocations<<",\"peakWorkingSetBytes\":"<<peakMemory()<<",\"omittedCavities\":"<<omitted<<"}\n";
  return 0;
 }catch(const std::exception& e){std::cerr<<"Native geometry error: "<<e.what()<<'\n';return 1;}
}
