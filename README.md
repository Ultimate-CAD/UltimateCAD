# UltimateCAD

**UltimateCAD** is a desktop parametric and direct 3D CAD workstation with integrated OpenSCAD script modeling, interactive customizer controls, and a built-in Finite Element Method (FEM) structural analysis workbench.

---

## Key Capabilities

* **Hybrid Parametric & Direct Modeling:** Combine script-driven OpenSCAD parametric geometry with interactive viewport manipulation and real-time customizer parameter generation.
* **Native C++20 Geometry & Solver Engine:** Fast boolean operations, mesh healing, and built-in linear static structural analysis powered by Eigen.
* **Integrated FEM Workbench:** Apply fixed constraints, distributed loads, and material properties directly on 3D solids, with support for external tetrahedral meshing via **Gmsh** and advanced solving via **CalculiX (`ccx`)** *(Experimental)*.
* **Production Export Pipeline:** Export watertight `.stl`, `.obj`, `.step`, `.scad`, and `.inp` analysis decks.

---

## Installation (Windows x64)

1. Download the latest **`Ultimate-CAD-Setup-x64.exe`** from the [GitHub Releases](../../releases) page.
2. Run the installer. Standard CAD modeling, OpenSCAD rendering, and built-in analysis work out of the box with no external dependencies required.

---

## Optional External Setup: Gmsh 4.15.2 (FEM Meshing)

To keep the core distribution lightweight and modular, **Gmsh** is not bundled inside the UltimateCAD installer. If you use the external Gmsh tetrahedral mesher inside the FEM Workbench:

1. Download the official **Gmsh 4.15.2** Windows 64-bit zip from [gmsh.info](https://gmsh.info/).
2. Extract the archive to a permanent folder on your machine (for example, `C:\Tools\gmsh-4.15.2-Windows64\`).
3. Open **UltimateCAD** -> **FEM Workbench**.
4. When prompted on first use, click **Browse for `gmsh.exe`** and select your extracted `gmsh.exe` binary. UltimateCAD verifies the version (`4.15.2`) and saves the executable path automatically for future sessions.

---

## Third-Party Notices & Open-Source Compliance

UltimateCAD integrates and interoperates with established open-source engineering tools. Full attribution and license texts are provided in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md):

* **Eigen 3.4.0** — Licensed under the Mozilla Public License 2.0 (MPL-2.0).
* **OpenSCAD** — Licensed under GPLv2; invoked as an isolated command-line subprocess. Unmodified upstream source archives are provided alongside release binaries and at [openscad.org](https://openscad.org/).
* **CalculiX (`ccx`)** — Licensed under GPLv2; invoked as an isolated command-line subprocess *(Experimental)*. Unmodified upstream source archives are provided alongside release binaries and at [dhondt.de](http://www.dhondt.de/).
* **Gmsh** — Optional external dependency installed independently by the user from [gmsh.info](https://gmsh.info/).

---

## Building from Source

```bash
# Install dependencies
npm install

# Build native C++ geometry/solver modules and frontend bundle
npm run build

# Package Windows x64 installer
npm run dist