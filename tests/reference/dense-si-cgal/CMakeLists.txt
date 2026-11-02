cmake_minimum_required(VERSION 3.24)
project(dense_si_cgal_reference LANGUAGES CXX)

if(NOT DEFINED CGAL_SOURCE_ROOT OR NOT EXISTS "${CGAL_SOURCE_ROOT}/include/CGAL/Surface_mesh.h")
  message(FATAL_ERROR "Set CGAL_SOURCE_ROOT to the extracted pinned CGAL-6.2.1 library tree")
endif()
if(NOT DEFINED BOOST_INCLUDE_ROOT OR NOT EXISTS "${BOOST_INCLUDE_ROOT}/boost/version.hpp")
  message(FATAL_ERROR "Set BOOST_INCLUDE_ROOT to the extracted Boost 1.88.0 include root")
endif()

add_executable(dense-si-cgal-reference main.cpp)
target_compile_features(dense-si-cgal-reference PRIVATE cxx_std_17)
target_include_directories(dense-si-cgal-reference PRIVATE
  "${CGAL_SOURCE_ROOT}/include"
  "${BOOST_INCLUDE_ROOT}"
)
target_compile_definitions(dense-si-cgal-reference PRIVATE CGAL_DISABLE_GMP=1)
if(MSVC)
  target_compile_options(dense-si-cgal-reference PRIVATE /O2 /EHsc /bigobj /utf-8)
  target_link_libraries(dense-si-cgal-reference PRIVATE Psapi)
endif()
