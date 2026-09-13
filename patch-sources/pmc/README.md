# PMC loader framework

Status: **source-copied**.

Bundled artifacts: `PMC_B2.rpm`, `PMC_W2.rpm`.

Local framework, interface, print-service sources and build metadata. External libraries/toolchains are not vendored. This is a current-source snapshot, not a claim that the historical bundled RPMs were rebuilt from this exact revision. Existing license is retained.

These are bookkeeping copies only. Existing source/build locations remain authoritative. Shared headers and metadata are in [../shared](../shared/). See the root manifest for file hashes and repo-relative origins.

## Original source references

- `PMC: CMakeLists.txt`
- `PMC: LICENSE`
- `PMC: .gitmodules`
- `PMC: BuildFiles/version_b2.yml`
- `PMC: BuildFiles/version_w2.yml`
- `PMC: Framework/CMakeLists.txt`
- `PMC: Framework/PMC_Common.h`
- `PMC: Framework/PMC_NTRExternalRelocator.h`
- `PMC: Framework/PMC_RPMFramework.cpp`
- `PMC: Framework/PMC_RPMFramework.h`
- `PMC: Interface/PMC_Interface.cpp`
- `PMC: Interface/PMC_Interface.h`
- `PMC: Interface/PMC_AsmInterface.s`
- `PMC: PrintService/CMakeLists.txt`
- `PMC: PrintService/PrintService/PMC_ExceptionPrint.cpp`
- `PMC: PrintService/PrintService/PMC_ExceptionPrint.h`
- `PMC: PrintService/PrintService/PMC_Print.cpp`
- `PMC: PrintService/PrintService/PMC_Print.h`
- `PMC: PrintService/PrintService/PMC_PrintService.cpp`
- `PMC: PrintService/PrintService/PMC_PrintService.h`
