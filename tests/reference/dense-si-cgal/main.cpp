#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Polygon_mesh_processing/self_intersections.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/boost/graph/helpers.h>
#include <boost/function_output_iterator.hpp>

#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#endif

namespace PMP = CGAL::Polygon_mesh_processing;
using Kernel = CGAL::Exact_predicates_inexact_constructions_kernel;
using Mesh = CGAL::Surface_mesh<Kernel::Point_3>;
using Clock = std::chrono::steady_clock;

struct InputMesh {
  std::vector<std::array<double, 3>> points;
  std::vector<std::array<std::uint32_t, 3>> faces;
  std::vector<std::uint32_t> sourceFaceIds;
};

struct PairCapture {
  std::uint64_t total = 0;
  std::vector<std::array<std::uint32_t, 2>> first;
};

static std::uint64_t peakWorkingSetBytes() {
#ifdef _WIN32
  PROCESS_MEMORY_COUNTERS_EX counters{};
  if (GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&counters), sizeof(counters)))
    return static_cast<std::uint64_t>(counters.PeakWorkingSetSize);
#endif
  return 0;
}

static std::string jsonEscape(const std::string& text) {
  std::string result;
  for (unsigned char ch : text) {
    switch (ch) {
    case '"': result += "\\\""; break;
    case '\\': result += "\\\\"; break;
    case '\n': result += "\\n"; break;
    case '\r': result += "\\r"; break;
    case '\t': result += "\\t"; break;
    default:
      if (ch < 0x20) {
        const char hex[] = "0123456789abcdef";
        result += "\\u00";
        result += hex[ch >> 4];
        result += hex[ch & 15];
      } else result += static_cast<char>(ch);
    }
  }
  return result;
}

static InputMesh readLlr1(const std::filesystem::path& path) {
  static_assert(sizeof(double) == 8 && sizeof(std::uint32_t) == 4);
  std::ifstream in(path, std::ios::binary | std::ios::ate);
  if (!in) throw std::runtime_error("cannot open input file");
  const auto size = in.tellg();
  if (size < 16) throw std::runtime_error("truncated LLR1 header");
  in.seekg(0);
  auto readU32 = [&]() {
    std::uint32_t value{};
    if (!in.read(reinterpret_cast<char*>(&value), sizeof(value))) throw std::runtime_error("truncated LLR1 header or body");
    return value;
  };
  const auto magic = readU32();
  const auto version = readU32();
  const auto coordinateCount = readU32();
  const auto indexCount = readU32();
  if (magic != 0x31524c4c || version != 1) throw std::runtime_error("expected native LLR1 protocol v1");
  if (coordinateCount % 3 || indexCount % 3 || coordinateCount < 3 || indexCount < 3)
    throw std::runtime_error("invalid LLR1 coordinate or index count");
  const std::uint64_t expected = 16ull + 8ull * coordinateCount + 4ull * indexCount;
  if (expected != static_cast<std::uint64_t>(size)) throw std::runtime_error("LLR1 length does not match header");

  InputMesh result;
  result.points.resize(coordinateCount / 3);
  for (auto& point : result.points) {
    for (double& coordinate : point) {
      if (!in.read(reinterpret_cast<char*>(&coordinate), sizeof(coordinate))) throw std::runtime_error("truncated LLR1 coordinates");
      if (!std::isfinite(coordinate)) throw std::runtime_error("non-finite LLR1 coordinate");
    }
  }
  result.faces.resize(indexCount / 3);
  result.sourceFaceIds.resize(result.faces.size());
  for (std::size_t faceId = 0; faceId < result.faces.size(); ++faceId) {
    result.sourceFaceIds[faceId] = static_cast<std::uint32_t>(faceId);
    for (std::uint32_t& index : result.faces[faceId]) {
      if (!in.read(reinterpret_cast<char*>(&index), sizeof(index))) throw std::runtime_error("truncated LLR1 indices");
      if (index >= result.points.size()) throw std::runtime_error("LLR1 index out of range");
    }
  }
  return result;
}

static InputMesh fixture(const std::string& name) {
  InputMesh result;
  auto addPoint = [&](double x, double y, double z) {
    result.points.push_back({x, y, z});
  };
  if (name == "captured-false-pair") {
    // Captured from .codex-run/export11/intersection-proof.json, triangles 4361 and 4369.
    addPoint(-29.98192596435547, 0.75, -26.459205627441406);
    addPoint(-29.652000427246094, 1.5, -26.833057403564453);
    addPoint(-29.81696319580078, 0.75, -26.64613151550293);
    addPoint(-29.98192596435547, 1.5, -26.459205627441406);
    addPoint(-29.98192596435547, 2.25, -26.459205627441406);
    addPoint(-29.81696319580078, 2.25, -26.64613151550293);
    result.faces = {{{0, 1, 2}}, {{3, 4, 5}}};
    result.sourceFaceIds = {4361, 4369};
  } else if (name == "crossing-triangles") {
    addPoint(-1, -1, 0); addPoint(1, -1, 0); addPoint(0, 1, 0);
    addPoint(0, -0.5, -1); addPoint(0, -0.5, 1); addPoint(0, 0.75, 0);
    result.faces = {{{0, 1, 2}}, {{3, 4, 5}}};
    result.sourceFaceIds = {0, 1};
  } else if (name == "shared-edge-only") {
    addPoint(0, 0, 0); addPoint(1, 0, 0); addPoint(0, 1, 0); addPoint(1, -1, 0);
    result.faces = {{{0, 1, 2}}, {{1, 0, 3}}};
    result.sourceFaceIds = {0, 1};
  } else if (name == "crossing-tetrahedra") {
    const std::array<std::array<double, 3>, 4> tetra = {{{0,0,0}, {2,0,0}, {0,2,0}, {0,0,2}}};
    for (const auto& p : tetra) addPoint(p[0], p[1], p[2]);
    for (const auto& p : tetra) addPoint(p[0] + 0.3, p[1] + 0.3, p[2] + 0.3);
    const std::array<std::array<std::uint32_t, 3>, 4> shell = {{{0,2,1}, {0,1,3}, {0,3,2}, {1,2,3}}};
    result.faces.assign(shell.begin(), shell.end());
    for (const auto& face : shell) result.faces.push_back({face[0] + 4, face[1] + 4, face[2] + 4});
    for (std::uint32_t i = 0; i < result.faces.size(); ++i) result.sourceFaceIds.push_back(i);
  } else {
    throw std::runtime_error("unknown fixture: " + name);
  }
  return result;
}

static void emit(const std::string& inputName, const InputMesh& input) {
  const auto start = Clock::now();
  Mesh mesh;
  using Vertex = Mesh::Vertex_index;
  using Face = Mesh::Face_index;
  std::vector<Vertex> vertices;
  vertices.reserve(input.points.size());
  for (const auto& point : input.points)
    vertices.push_back(mesh.add_vertex(Kernel::Point_3(point[0], point[1], point[2])));
  auto sourceFace = mesh.add_property_map<Face, std::uint32_t>("f:input_id", std::numeric_limits<std::uint32_t>::max()).first;
  for (std::size_t i = 0; i < input.faces.size(); ++i) {
    const auto& triangle = input.faces[i];
    const Face face = mesh.add_face(vertices[triangle[0]], vertices[triangle[1]], vertices[triangle[2]]);
    if (face == Mesh::null_face()) throw std::runtime_error("Surface_mesh rejected input face " + std::to_string(input.sourceFaceIds[i]));
    sourceFace[face] = input.sourceFaceIds[i];
  }
  const bool validMesh = CGAL::is_valid_polygon_mesh(mesh);
  const bool triangleMesh = CGAL::is_triangle_mesh(mesh);
  if (!validMesh || !triangleMesh) throw std::runtime_error("Surface_mesh is invalid or not triangular");

  PairCapture captured;
  const auto sink = boost::make_function_output_iterator([&](const auto& pair) {
    ++captured.total;
    if (captured.first.size() < 64)
      captured.first.push_back({sourceFace[pair.first], sourceFace[pair.second]});
  });
  bool complete = false;
  PMP::self_intersections(mesh, sink, CGAL::parameters::geom_traits(Kernel{}));
  complete = true;
  const double elapsedMs = std::chrono::duration<double, std::milli>(Clock::now() - start).count();

  std::cout << std::setprecision(17)
            << "{\"checker\":\"CGAL-6.2.1-PMP-self_intersections\","
            << "\"kernel\":\"Exact_predicates_inexact_constructions_kernel\","
            << "\"input\":\"" << jsonEscape(inputName) << "\","
            << "\"status\":\"" << (captured.total == 0 ? "valid" : "invalid") << "\","
            << "\"complete\":" << (complete ? "true" : "false") << ","
            << "\"surfaceMeshValid\":true,\"triangleMesh\":true,"
            << "\"triangleCount\":" << input.faces.size() << ","
            << "\"vertexCount\":" << input.points.size() << ","
            << "\"intersectionCount\":" << captured.total << ","
            << "\"firstPairsStored\":" << captured.first.size() << ","
            << "\"firstPairs\":[";
  for (std::size_t i = 0; i < captured.first.size(); ++i) {
    if (i) std::cout << ',';
    std::cout << '[' << captured.first[i][0] << ',' << captured.first[i][1] << ']';
  }
  std::cout << "],\"broadPhaseCandidatePairs\":null,"
            << "\"broadPhaseCandidatePairsNote\":\"CGAL PMP does not expose broad-phase candidate counts\","
            << "\"durationMs\":" << elapsedMs << ","
            << "\"peakWorkingSetBytes\":" << peakWorkingSetBytes() << "}\n";
}

int main(int argc, char** argv) {
  try {
    if (argc == 3 && std::string(argv[1]) == "--fixture") {
      const auto input = fixture(argv[2]);
      emit("fixture:" + std::string(argv[2]), input);
      return 0;
    }
    if (argc != 2) throw std::runtime_error("usage: dense-si-cgal-reference <LLR1-result.mesh.bin> | --fixture <name>");
    const auto input = readLlr1(argv[1]);
    emit(argv[1], input);
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "{\"checker\":\"CGAL-6.2.1-PMP-self_intersections\",\"complete\":false,\"error\":\""
              << jsonEscape(error.what()) << "\"}\n";
    return 2;
  }
}
