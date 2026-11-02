#pragma once
#include <manifold/manifold.h>
#include <iosfwd>
// Research only: no app selection, staging or automatic fallback changes.
manifold::Manifold makeSparseCavity(const manifold::MeshGL& source, double cell, double wall);
void printSparseStats(std::ostream& stream);
