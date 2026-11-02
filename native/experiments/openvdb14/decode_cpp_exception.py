#!/usr/bin/env python3
"""Decode an MSVC x64 C++ EH ThrowInfo record from a saved CDB log and PE."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_LOG = ROOT / ".codex-run" / "sparse14-offset" / "dilate-002-debug-v3" / "debugger.log"
DEFAULT_EXE = ROOT / ".codex-run" / "sparse14-offset" / "bin" / "bench-matrix.exe"
DEFAULT_OUTPUT = ROOT / ".codex-run" / "sparse14-offset" / "dilate-002-debug-v3" / "cpp-exception.json"
PARAMETER_RE = re.compile(r"Parameter\[(\d+)\]:\s*([0-9a-fA-F`]+)")
EXCEPTION_RE = re.compile(r"ExceptionCode:\s*([0-9a-fA-F`]+)")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_log(path: Path) -> tuple[dict[int, int], str | None]:
    content = path.read_text(encoding="utf-8", errors="replace")
    parameters: dict[int, int] = {}
    for index, value in PARAMETER_RE.findall(content):
        parameters.setdefault(int(index), int(value.replace("`", ""), 16))
    exception = EXCEPTION_RE.search(content)
    if len(parameters) < 4:
        raise ValueError("CDB log does not contain all four C++ exception parameters")
    return parameters, exception.group(1).replace("`", "") if exception else None


class PEImage:
    def __init__(self, path: Path):
        self.data = path.read_bytes()
        if self.data[:2] != b"MZ":
            raise ValueError("Input executable has no DOS MZ signature")
        pe_offset = struct.unpack_from("<I", self.data, 0x3C)[0]
        if self.data[pe_offset : pe_offset + 4] != b"PE\0\0":
            raise ValueError("Input executable has no PE signature")
        machine, section_count = struct.unpack_from("<HH", self.data, pe_offset + 4)
        optional_size = struct.unpack_from("<H", self.data, pe_offset + 20)[0]
        optional = pe_offset + 24
        magic = struct.unpack_from("<H", self.data, optional)[0]
        if machine != 0x8664 or magic != 0x20B:
            raise ValueError("This helper expects an x64 PE32+ image")
        self.image_base = struct.unpack_from("<Q", self.data, optional + 24)[0]
        self.sections: list[dict[str, Any]] = []
        section_offset = optional + optional_size
        for index in range(section_count):
            off = section_offset + index * 40
            name = self.data[off : off + 8].split(b"\0", 1)[0].decode("ascii", errors="replace")
            virtual_size, virtual_address, raw_size, raw_pointer = struct.unpack_from("<IIII", self.data, off + 8)
            self.sections.append({
                "name": name,
                "virtualAddressRva": virtual_address,
                "virtualSize": virtual_size,
                "rawPointer": raw_pointer,
                "rawSize": raw_size,
            })

    def rva_to_offset(self, rva: int) -> int:
        for section in self.sections:
            start = section["virtualAddressRva"]
            span = max(section["virtualSize"], section["rawSize"])
            delta = rva - start
            if 0 <= delta < span:
                if delta >= section["rawSize"]:
                    raise ValueError(f"RVA 0x{rva:x} points into zero-filled section data")
                return section["rawPointer"] + delta
        if 0 <= rva < len(self.data):
            return rva
        raise ValueError(f"RVA 0x{rva:x} is not mapped by a PE section")

    def read(self, rva: int, size: int) -> tuple[bytes, int]:
        offset = self.rva_to_offset(rva)
        end = offset + size
        if size < 0 or end > len(self.data):
            raise ValueError(f"File read for RVA 0x{rva:x} exceeds image bounds")
        return self.data[offset:end], offset

    def c_string(self, rva: int, limit: int = 512) -> tuple[str, int]:
        offset = self.rva_to_offset(rva)
        end = self.data.find(b"\0", offset, min(offset + limit, len(self.data)))
        if end < 0:
            raise ValueError(f"Unterminated RTTI name at RVA 0x{rva:x}")
        return self.data[offset:end].decode("ascii", errors="replace"), offset


def demangle_msvc_rtti(name: str) -> str:
    known = {
        ".?AVbad_alloc@std@@": "std::bad_alloc",
        ".?AVexception@std@@": "std::exception",
    }
    return known.get(name, name)


def decode(log_path: Path, exe_path: Path) -> dict[str, Any]:
    parameters, exception_code = parse_log(log_path)
    if exception_code and int(exception_code, 16) != 0xE06D7363:
        raise ValueError(f"Log exception code is 0x{exception_code}, not MSVC C++ EH e06d7363")
    if 2 not in parameters or 3 not in parameters:
        raise ValueError("CDB parameters 2 (ThrowInfo VA) and 3 (image base) are required")

    image = PEImage(exe_path)
    throw_info_va = parameters[2]
    log_image_base = parameters[3]
    throw_info_rva = throw_info_va - log_image_base
    throw_bytes, throw_offset = image.read(throw_info_rva, 16)
    attributes, unwind_rva, forward_compat_rva, catchable_array_rva = struct.unpack("<IIII", throw_bytes)
    array_header, array_offset = image.read(catchable_array_rva, 4)
    count = struct.unpack("<I", array_header)[0]
    if count > 64:
        raise ValueError(f"Implausible catchable type count: {count}")
    array_bytes, _ = image.read(catchable_array_rva + 4, count * 4)

    types: list[dict[str, Any]] = []
    for index in range(count):
        catchable_rva = struct.unpack_from("<I", array_bytes, index * 4)[0]
        catchable_bytes, catchable_offset = image.read(catchable_rva, 28)
        fields = struct.unpack("<IIiiiII", catchable_bytes)
        properties, type_descriptor_rva = fields[0], fields[1]
        decorated_name, type_offset = image.c_string(type_descriptor_rva + 16)
        types.append({
            "index": index,
            "catchableTypeRva": f"0x{catchable_rva:x}",
            "catchableTypeFileOffset": f"0x{catchable_offset:x}",
            "properties": f"0x{properties:x}",
            "typeDescriptorRva": f"0x{type_descriptor_rva:x}",
            "typeDescriptorVa": f"0x{log_image_base + type_descriptor_rva:x}",
            "typeDescriptorFileOffset": f"0x{type_offset - 16:x}",
            "decoratedName": decorated_name,
            "typeName": demangle_msvc_rtti(decorated_name),
            "catchableTypeFields": {
                "thisDisplacement": list(fields[2:5]),
                "sizeOrOffset": fields[5],
                "copyFunctionRva": f"0x{fields[6]:x}",
            },
        })

    return {
        "log": str(log_path),
        "logSha256": sha256(log_path),
        "executable": str(exe_path),
        "executableSha256": sha256(exe_path),
        "exceptionCode": f"0x{exception_code}" if exception_code else None,
        "exceptionParameters": {str(key): f"0x{value:x}" for key, value in sorted(parameters.items())},
        "image": {
            "preferredImageBase": f"0x{image.image_base:x}",
            "runtimeImageBaseFromLog": f"0x{log_image_base:x}",
            "runtimeRelocationDelta": f"0x{log_image_base - image.image_base:x}",
            "sections": image.sections,
        },
        "throwInfo": {
            "va": f"0x{throw_info_va:x}",
            "rva": f"0x{throw_info_rva:x}",
            "fileOffset": f"0x{throw_offset:x}",
            "attributes": f"0x{attributes:x}",
            "unwindRva": f"0x{unwind_rva:x}",
            "forwardCompatRva": f"0x{forward_compat_rva:x}",
            "catchableTypeArrayRva": f"0x{catchable_array_rva:x}",
            "catchableTypeArrayVa": f"0x{log_image_base + catchable_array_rva:x}",
            "catchableTypeArrayFileOffset": f"0x{array_offset:x}",
            "catchableTypeCount": count,
        },
        "catchableTypes": types,
        "diagnosis": types[0]["typeName"] if types else "unknown C++ exception type",
        "method": "Offline PE section RVA mapping and MSVC x64 RTTI decoding; no debugger or benchmark launched.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--exe", type=Path, default=DEFAULT_EXE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    report = decode(args.log.resolve(), args.exe.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"diagnosis": report["diagnosis"], "output": str(args.output.resolve())}))


if __name__ == "__main__":
    main()
