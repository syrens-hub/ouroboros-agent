---
name: base64-encoder
description: Encode strings to base64
version: 0.1.0
tags: [generated, autonomous, encoding, utility]
---

# Base64 Encoder

Provides a tool to encode arbitrary strings (or decode base64 strings) using Node.js built-in `Buffer`.

## Tools

### `base64_encode`
Encodes a plain text string into its base64 representation.

**Input:**
- `input` (string): The text to encode.

**Output:**
- `encoded` (string): The base64-encoded result.

### `base64_decode`
Decodes a base64 string back to plain text.

**Input:**
- `input` (string): The base64 string to decode.

**Output:**
- `decoded` (string): The decoded plain text result.

## Example

```
base64_encode("hello") → "aGVsbG8="
base64_decode("aGVsbG8=") → "hello"
```