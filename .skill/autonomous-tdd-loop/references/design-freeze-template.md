# [Project Name] High-Level Design Freeze

## Status

This document is the design lock for product direction and system architecture.
All contributions must preserve the invariants defined here.

## 1. Project Essence

[One paragraph: what is this product? What is its core asset? What problems
does it solve?]

## 2. Design Philosophy

[List the principles that guide all decisions. Examples:]

- Less is more: minimize top-level concepts.
- Data first: data quality over UI polish.
- Local-first: data enters through local access, not remote federation.
- Explainable: every derived object must be traceable back to raw evidence.
- One semantic pipeline: all surfaces consume the same canonical objects.

## 3. Core Job To Be Done

Primary job:

- [What is the single most important thing this product does for the user?]

Secondary jobs:

- [Supporting capabilities that serve the primary job.]

## 4. Kernel Pattern

[Define the core reusable pattern that all features plug into. Example:]

1. Capture raw input.
2. Derive stable objects from raw input.
3. Govern lifecycle of derived objects.
4. Project derived objects to UI and API.

## 5. Canonical Objects

[Define every domain object. Use precise, stable terminology. These terms
become the shared vocabulary for all code, docs, and conversation.]

### Evidence Objects

- [Object]: [one-sentence definition]

### Derivation Objects

- [Object]: [one-sentence definition]

### Identity Objects

[Define logical identity vs revision identity if applicable.]

### Projection Objects

- [Object]: [one-sentence definition]

## 6. Canonical Pipeline

[Define the ordered stages that data or work flows through:]

1. Stage 1
2. Stage 2
3. ...

Rules:

- [Which stages may be domain-specific?]
- [Where must stages converge on shared semantics?]

## 7. System Invariants

The following invariants are frozen:

- [Invariant 1: e.g., "Raw evidence is retained unless explicitly purged."]
- [Invariant 2: e.g., "UI and API cannot bypass the derivation layer."]
- [Invariant 3]
- ...

## 8. Operational Envelope

[Define scale assumptions, deployment model, and user model:]

- Single-user or multi-user?
- Expected data volume ranges.
- Performance expectations.
- What is acceptable to do manually vs what must be automated?

## 9. MVP Boundaries

The MVP includes:

- [Feature 1]
- [Feature 2]
- ...

The MVP excludes:

- [Excluded 1]
- [Excluded 2]
- ...

## 10. Complexity Budget

Allowed complexity:

- [What complexity is acceptable now?]

Deferred complexity:

- [What complexity is explicitly postponed?]

Rule: the system may grow through new capabilities within frozen boundaries,
but not through ambiguous semantics.

## 11. Success Criteria

The design is aligned only if the delivered system satisfies:

- [Criterion 1]
- [Criterion 2]
- ...
