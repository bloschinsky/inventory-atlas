# ADR-025: Scan tokens use reproducible versioned derivation

- **Status:** Accepted

## Context

Plaintext-free random tokens cannot be reprinted after issuance, while label
reprints must preserve already deployed codes.

## Decision

Derive the active token deterministically with HMAC-SHA-256 from purpose, entity
identity, generation, and retained key version; store only lookup prefix and
hash. Revocation increments generation.

## Consequences

Reprints are stable, old generations are invalid, and key rotation requires a
managed key ring until referenced codes are retired.
