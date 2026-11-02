cmake_minimum_required(VERSION 3.24)
project(ultimate_openvdb14_prototype LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreaded)
get_filename_component(REPO "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)
set(NATIVE_CACHE "${REPO}/.codex-run/adaptive10" CACHE PATH "Existing pinned native sources")
set(VDB_PREFIX "${REPO}/.codex-run/sparse14/deps/openvdb-install" CACHE PATH "Isolated OpenVDB install")
list(APPEND CMAKE_PREFIX_PATH "${REPO}/.codex-run/sparse14/deps/tbb-install")
list(APPEND CMAKE_MODULE_PATH "${VDB_PREFIX}/lib/cmake/OpenVDB")
set(OpenVDB_ROOT "${VDB_PREFIX}")
set(OPENVDB_USE_STATIC_LIBS ON)
find_package(OpenVDB 14.0 REQUIRED COMPONENTS openvdb)
find_package(TBB REQUIRED COMPONENTS tbb)
add_executable(ultimate-openvdb14 ../../geometry/main.cpp sparse_cavity.cpp)
target_include_directories(ultimate-openvdb14 PRIVATE
  "${NATIVE_CACHE}/manifold/include" "${NATIVE_CACHE}/libigl/include" "${NATIVE_CACHE}/eigen")
target_link_libraries(ultimate-openvdb14 PRIVATE OpenVDB::openvdb TBB::tbb
  "${NATIVE_CACHE}/build/_deps/manifold-build/lib/Release/manifold.lib")
target_compile_definitions(ultimate-openvdb14 PRIVATE LAYERLING_OPENVDB_EXPERIMENT NOMINMAX
  WIN32_LEAN_AND_MEAN IGL_PARALLEL_FOR_FORCE_SERIAL EIGEN_MPL2_ONLY)
target_compile_options(ultimate-openvdb14 PRIVATE /O2 /EHsc /bigobj)
set(SPARSE_CAVITY_SIMPLIFY_DIVISOR 0 CACHE STRING "Research comparison only: 0 disables simplification")
if(NOT SPARSE_CAVITY_SIMPLIFY_DIVISOR MATCHES "^(0|[1-9][0-9]*)$")
  message(FATAL_ERROR "Expected zero or positive integer simplification divisor")
endif()
if(SPARSE_CAVITY_SIMPLIFY_DIVISOR GREATER 0)
  target_compile_definitions(ultimate-openvdb14 PRIVATE
    LAYERLING_OPENVDB_SIMPLIFY_DIVISOR=${SPARSE_CAVITY_SIMPLIFY_DIVISOR})
endif()
# Control target proves the experimental preprocessor seam leaves the normal
# backend executable without a new OpenVDB dependency or selection path.
add_executable(ultimate-native-control ../../geometry/main.cpp)
target_include_directories(ultimate-native-control PRIVATE
  "${NATIVE_CACHE}/manifold/include" "${NATIVE_CACHE}/libigl/include" "${NATIVE_CACHE}/eigen")
target_link_libraries(ultimate-native-control PRIVATE TBB::tbb
  "${NATIVE_CACHE}/build/_deps/manifold-build/lib/Release/manifold.lib")
target_compile_definitions(ultimate-native-control PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN
  IGL_PARALLEL_FOR_FORCE_SERIAL EIGEN_MPL2_ONLY)
target_compile_options(ultimate-native-control PRIVATE /O2 /EHsc /bigobj)
