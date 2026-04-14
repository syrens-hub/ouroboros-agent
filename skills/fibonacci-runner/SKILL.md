---
name: fibonacci-runner
description: Compute fibonacci numbers
version: 0.1.0
tags: [generated, autonomous, math]
---

# Fibonacci Runner

Computes Fibonacci numbers efficiently using an iterative approach.

## Tools

### `fibonacci`

Given a non-negative integer `n`, returns the nth Fibonacci number (0-indexed).

**Input:**
- `n` (`number`, required): The index of the Fibonacci number to compute (0-indexed, e.g. n=10 → 55).

**Output:**
- `n`: The input index.
- `result`: The nth Fibonacci number as a string (to handle large values safely).

**Examples:**
- `n=0` → `0`
- `n=1` → `1`
- `n=10` → `55`
- `n=50` → `12586269025`