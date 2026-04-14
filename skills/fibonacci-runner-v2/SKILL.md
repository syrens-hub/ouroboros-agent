---
name: fibonacci-runner-v2
description: Compute Fibonacci numbers or sequences by index.
version: 0.1.0
tags: [generated, autonomous, math]
---

# fibonacci-runner-v2

Provides tools to compute Fibonacci numbers and sequences.

## Tools

### `fibonacci_v2`
Compute the nth Fibonacci number (0-indexed, BigInt-safe for large n).

**Input:**
- `n` (number, ≥ 0): The index of the Fibonacci number to compute.

**Output:**
- `n`: The input index.
- `result`: The Fibonacci number as a string (supports arbitrarily large values).

**Example:** `n=10` → `55`

---

### `fibonacci_sequence`
Compute a sequence of Fibonacci numbers from index `start` to `end` (inclusive).

**Input:**
- `start` (number, ≥ 0): Start index.
- `end` (number, ≥ start): End index (max range: 1000).

**Output:**
- `sequence`: Array of `{ index, value }` objects.

**Example:** `start=0, end=7` → `[0,1,1,2,3,5,8,13]`