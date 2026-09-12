# Development Proceedings & Technical Architecture Report
**Project:** Odoo STEP/STP 3D CAD Viewer & Interactive Product Customizer  
**Target Audience:** Engineering & Executive Management  
**Scope:** Full R&D and Production Engineering History (Oct 2025 – Sep 2026)  
**Total Development Time:** 230 Hours  

---

## Executive Summary

This document provides a detailed technical and operational account of the engineering journey behind the **Odoo 3D CAD Viewer & Interactive Product Customizer**. What originated as an exploratory R&D effort to preview raw CAD exchange files (`.step`, `.stp`) inside Odoo ERP has matured into an enterprise-grade, asynchronous 3D processing pipeline and real-time interactive product configurator.

Throughout this project, engineering challenges specific to industrial CAD integration—such as high-polygon mesh parsing, browser memory limits, asynchronous pipeline orchestration, and ERP transactional integrity—were solved systematically. Early functional prototypes served as critical alignment milestones, allowing technical requirements to be refined iteratively alongside real-world engineering use cases.

---

## Technical Architecture Overview

The solution is divided into three modular layers designed for scalability, loose coupling, and maintainability:

```
+-------------------------------------------------------------------------------+
|                       Odoo ERP Presentation & Commerce Layer                  |
|  - Website Product Page (Customizer Modal)                                    |
|  - Customer Portal (Quotation / Sale Order Line 3D Review)                    |
|  - Backend Product & Purchase Views                                           |
+---------------------------------------+---------------------------------------+
                                        |
+---------------------------------------v---------------------------------------+
|                 Product Model Colors & Hierarchy Engine (`product_model_colors`)|
|  - Part Name Extraction (GLB Chunk 0 Parser)                                  |
|  - Parts Grouping & Color Template Mapping                                    |
|  - Real-Time Shader & Texture Mapping Pipeline                                |
+---------------------------------------+---------------------------------------+
                                        |
+---------------------------------------v---------------------------------------+
|            Core CAD Ingestion & Pipeline Service (`cyb_step_file_viewer`)     |
|  - STEP / STP Attachment Detection & Model Validation                         |
|  - Asynchronous Conversion Queue (`odoo.addons.queue_job`)                    |
|  - Server-Side CAD Tessellation & Optimization (`step_to_glb_ocp`)            |
+-------------------------------------------------------------------------------+
```

---

## Development Phases & Technical Proceedings

```
================================================================================
TIMELINE & EFFORT ALLOCATION
--------------------------------------------------------------------------------
Phase 1: Foundation & WebGL Engine Feasibility (Oct 2025 – Apr 2026)    50 Hours
Phase 2: Asynchronous Conversion & Queue Architecture (May 2026)        40 Hours
Phase 3: Deep ERP Workflow Integration (Jun 2026)                        50 Hours
Phase 4: Mesh Extraction & Advanced Customizer Engine (Jul – Sep 2026)  90 Hours
--------------------------------------------------------------------------------
TOTAL PROJECT INVESTMENT:                                              230 Hours
================================================================================
```

---

### Phase 1: Foundation & WebGL Engine Feasibility (Oct 2025 – Apr 2026)
**Effort:** 50 Hours  
**Repository State:** Initial exploration in monolithic environment (`stp_viewer` / `cyb_step_file_viewer`)  

#### 1. Objectives & Technical Challenges
* Investigate feasibility of rendering complex 3D boundary representation (B-Rep) CAD files inside Odoo's native OWL (Odoo Web Library) and JavaScript web client.
* Establish asset pipeline handling for standard industrial formats (`.step`, `.stp`, `.glb`).
* Solve WebGL canvas lifecycle issues within dynamic Odoo dialogs and form views.

#### 2. Key Technical Implementations
* **Initial WebGL Pipeline:** Integrated a modular Three.js rendering viewport into Odoo’s web client asset registry. Implemented OrbitControls for smooth inspection (pan, zoom, orbit, isometric orientation).
* **Attachment Interception:** Extended `ir.attachment` models with format-detection constraints and mime-type handling, enabling direct 3D previews within Odoo document previews without third-party desktop viewers.
* **Prototyping & CAD Tessellation Evaluation:** Tested various browser-side and server-side tessellation techniques. Early evaluations proved that client-side tessellation of raw STEP files created severe browser freezing on models exceeding 10MB, demonstrating the necessity of server-side preprocessing.

#### 3. Engineering Outcome & Justification of Hours
* Iterative prototypes served as the proof-of-concept for internal stakeholders to define exact CAD viewing requirements.
* Detailed hours account for establishing the Odoo frontend asset bundle, debugging WebGL context management during tab navigation, and resolving geometry normalization across different CAD exporter systems.

---

### Phase 2: Asynchronous Conversion & Queue Architecture (May 2026)
**Effort:** 40 Hours  
**Repository State:** Architecture consolidation (`cyb_3d_viewer`, `step_viewer/` sub-architecture)  

#### 1. Objectives & Technical Challenges
* Eliminate user interface blocking during CAD tessellation.
* Handle multi-megabyte STEP assemblies efficiently on the server.
* Decouple the frontend rendering engine from bloated monolithic asset bundles to minimize page load latency.

#### 2. Key Technical Implementations
* **Asynchronous Queue Job Integration:** Integrated Odoo’s `queue_job` backend engine (`step.file.service`). Uploading an industrial STEP model offloads the intensive conversion task into a dedicated background worker, notifying the user via bus notifications upon completion without holding the HTTP worker thread.
* **Server-Side Tessellation Pipeline (`step_to_glb_ocp`):** Built automated server-side transformation scripts leveraging OpenCASCADE / CadQuery libraries to convert CAD boundary representations into highly optimized, compressed GLB (binary glTF) assets.
* **Engine Modernization:** Replaced heavy, legacy Three.js dependencies (which were adding tens of thousands of lines to backend asset bundles) with a lightweight, specialized 3D viewing container (`occt-import-js` / `o3dv`).
* **Photorealistic Lighting & Environment Maps:** Integrated HDR/cube environment maps (`citadella`, `fishermans_bastion`, `ice_river`) for realistic metallic and non-metallic surface reflections essential for engineering components.

#### 3. Engineering Outcome & Justification of Hours
* Solved the fundamental scalability bottleneck of enterprise CAD viewing: heavy files could now be ingested without degradation of Odoo’s core transactional performance.
* Significant time was devoted to queue error-handling routines, worker memory limit configurations, and asset bundle pruning.

---

### Phase 3: Deep ERP Workflow Integration & Portal Deployment (Jun 2026)
**Effort:** 50 Hours  
**Repository State:** Migration to dedicated standalone repository (`/step_viewer/`)  

#### 1. Objectives & Technical Challenges
* Extract the codebase into a dedicated repository to support isolated versioning and independent release cycles.
* Embed 3D visual verification directly into core business transactions: Sale Orders, Purchase Orders, and the external Customer Portal.
* Ensure zero-leakage security boundaries between internal backend users and external portal customers.

#### 2. Key Technical Implementations
* **Repository Architecture:** Refactored modules into clean separation:
  * `cyb_step_file_viewer`: Core attachment viewer and background processing engine.
  * `cyb_product_step_viewer`: Business document and e-commerce integrations.
* **Procurement & Vendor Integration (Purchase Orders):** Enabled 3D model inspection directly on Purchase Order lines (`purchase.order.line`). Purchasing agents and technical approvers can inspect engineering parts before issuing supplier contracts.
* **Sales & Quotation Integration (Sale Orders):** Linked CAD configurations to Quotation lines (`sale.order.line`), allowing sales engineers to verify complex customized assemblies.
* **Customer Portal 3D Experience:** Developed responsive frontend templates and OWL modals allowing external clients to interactively rotate, inspect, and approve 3D product specifications directly within their quote review portal.

#### 3. Engineering Outcome & Justification of Hours
* Elevated the tool from an engineering utility to an operational business driver across sales, procurement, and client onboarding.
* Hours covered bidirectional relation mapping across Odoo models, portal security access rules (`ir.rule` and `ir.model.access.csv`), and cross-device browser compatibility testing.

---

### Phase 4: Mesh Extraction, Customizer Engine & Shader Texturing (Jul – Sep 2026)
**Effort:** 90 Hours  
**Repository State:** Production expansion (`product_model_colors`, shader enhancements)  

#### 1. Objectives & Technical Challenges
* Enable granular, part-by-part inspection and aesthetic customization of complex CAD assemblies without requiring specialized CAD software.
* Extract structural hierarchy directly from binary GLB files.
* Provide dynamic material customization: solid color palettes, custom WebGL surface shaders, and continuous texture/image mapping across 3D meshes.
* Persist customized state across sessions (save, reload, and downstream order submission).

#### 2. Key Technical Implementations
* **Binary GLB Parser (`_extract_names_from_glb_bytes`):** Engineered a native binary unpacker reading GLB Chunk 0 (JSON structure) using Python `struct` and stream reading. Extracted exact CAD node and mesh labels without loading entire geometries into memory.
* **Dynamic Part Grouping & Template Engine (`product_model_colors`):**
  * Created `colors.template` and `template.colors.values` for establishing reusable corporate and engineering color palettes.
  * Created `parts.group` and `part.search` algorithms to automatically classify extracted CAD mesh nodes into logical functional groups (e.g., casing, fasteners, structural brackets) with overlap prevention validation.
* **Interactive Customizer UI:** Engineered a split-view workspace featuring a responsive left-hand customization drawer, part hierarchy search/filtering, active part isolation, and real-time loading feedback.
* **Shader & Full-Image Texture Mapping:**
  * Implemented custom WebGL shader logic to combine base color values with graphic image overlays seamlessly on targeted mesh geometries.
  * Developed texture orientation and scaling controls to ensure industrial graphics and logos map accurately without distortion.
* **State Serialization & Re-hydration:** Engineered data persistence routines that capture the configured state (selected colors, active textures, modified components), store it in Odoo records, and re-hydrate the 3D scene identically upon subsequent loads.

#### 3. Engineering Outcome & Justification of Hours
* Represents the largest, most sophisticated component of the system, transforming Odoo into a full real-time 3D product configurator.
* Extensive development hours were invested into matrix transforms for texture mapping, binary chunk parsing, reactive UI synchronization, and persistence stability.

---

## Comprehensive Hours & Milestone Summary

| Phase | Core Functional Modules | Key Engineering Focus | Hours |
|---|---|---|---|
| **Phase 1: Foundation & WebGL Engine** | `stp_viewer`<br>`cyb_step_file_viewer` | WebGL canvas integration, OWL wrapper, CAD attachment interception, client-side tessellation feasibility studies. | **50 hrs** |
| **Phase 2: Asynchronous Architecture** | `cyb_step_file_viewer`<br>`cyb_3d_viewer` | Queue Job offloading, server-side OpenCASCADE/GLB tessellation, asset library optimization, HDR environment lighting. | **40 hrs** |
| **Phase 3: ERP Workflow & Portal** | `cyb_product_step_viewer` | Standalone repo refactoring, Sale Order & Purchase Order line bindings, secure customer portal 3D viewer. | **50 hrs** |
| **Phase 4: Customizer & Shader Engine** | `product_model_colors`<br>Customizer Frontend | Binary GLB chunk parsing, dynamic part grouping, WebGL custom shaders, full image/texture mapping, save/load state engine. | **90 hrs** |
| **TOTAL PROJECT INVESTMENT** | | | **230 hrs** |

---

## Conclusion

The engineering development of the **Odoo 3D STEP Viewer and Interactive Customizer** has delivered a robust, production-ready enterprise solution. By combining server-side asynchronous CAD processing with modern WebGL shader capabilities, the platform provides seamless performance without compromising Odoo's business transaction speed. The architecture is modular, scalable, and fully aligned with modern engineering standards.
