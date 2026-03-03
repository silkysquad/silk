# Transaction Verification Architecture

**Date:** 2026-03-03
**Module:** `@silkysquad/silk` — `src/verify/`
**Status:** Implemented

---

## Overview

The transaction verification system gives AI agents a way to audit unsigned Solana transactions before signing them. When an agent asks SilkyWay's backend to build a transaction — say, "send 100 USDC to Bob" — the backend returns a serialized binary blob. Before signing that blob, the agent has no inherent visibility into what it contains. The verification module solves this by decoding the transaction into a structured, human-readable representation, flagging anything suspicious, and allowing the agent to confirm the transaction matches its original request.

This is a **client-side, trustless** system. It runs entirely within the `@silkysquad/silk` SDK on the agent's machine — there is no round-trip to our backend. The agent decodes the transaction independently, using the same on-chain program logic the backend used to build it. If the backend made an error or returned a transaction with unexpected instructions, the agent catches it before committing a signature.

---

## Problem Statement

The standard transaction flow on SilkyWay is:

1. Agent sends an intent to the backend API (e.g., `POST /api/tx/create-transfer`)
2. Backend builds an unsigned transaction and returns it as a base64 string
3. Agent signs the transaction with its local keypair
4. Agent submits the signed transaction back to the API for relay to Solana

At step 3, the agent is signing opaque binary data. Without decoding it, the agent cannot confirm:

- That the instruction inside matches what it requested (correct recipient, correct amount, correct program)
- That no additional instructions were inserted (e.g., a token drain to a third-party address)
- What all the accounts and parameters in the transaction actually are

The verification system addresses both concerns:

- **Honesty verification (primary):** Did the backend build exactly what the agent asked for?
- **Composition verification (secondary):** What does the full transaction do, including any ancillary instructions?

---

## Architecture Overview

The system is structured as a pipeline with five layers:

```
┌─────────────────────────────────────────────────────────────┐
│                    Entry Points                              │
│         analyzeTransaction()    verifyIntent()              │
└────────────────────┬───────────────────┬────────────────────┘
                     │                   │
                     ▼                   │
┌────────────────────────────────────┐   │
│       Deserialization Layer        │   │
│  base64 → VersionedTx or LegacyTx  │   │
│  → feePayer + RawInstruction[]     │   │
└────────────────────┬───────────────┘   │
                     │                   │
                     ▼                   │
┌────────────────────────────────────┐   │
│          Registry Lookup           │   │
│  programId → { name, decoderKey }  │   │
│  mint → { symbol, decimals }       │   │
└────────────────────┬───────────────┘   │
                     │                   │
                     ▼                   │
┌────────────────────────────────────┐   │
│          Decoder Layer             │   │
│  Raw bytes + accounts              │   │
│       → { type, params }           │   │
└────────────────────┬───────────────┘   │
                     │                   │
                     ▼                   │
┌────────────────────────────────────┐   │
│         Flag Engine                │   │
│  InstructionAnalysis[]             │   │
│       → RiskFlag[]                 │   │
└────────────────────┬───────────────┘   │
                     │                   │
                     ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Output Assembly                           │
│  TransactionAnalysis (for analyzeTransaction)               │
│  VerifyResult (for verifyIntent — adds discrepancy check)   │
└─────────────────────────────────────────────────────────────┘
```

### Entry Points

**`analyzeTransaction(txBase64, opts?)`**

The general-purpose function. Takes any Solana transaction (legacy or versioned) as a base64 string and returns a complete `TransactionAnalysis`: the fee payer, a decoded breakdown of every instruction, all risk flags, and a plain-English summary sentence. This is the "what does this transaction do?" function — useful both as a standalone audit tool and as the foundation for `verifyIntent`.

**`verifyIntent(txBase64, intent, opts?)`**

The intent-checking function. Calls `analyzeTransaction` internally, then compares the decoded instruction parameters against the agent's original intent. Returns a `VerifyResult` with a `verified` boolean and a `discrepancies` array containing human-readable failure messages if anything doesn't match. An agent signs only when `verified` is `true` and no error-severity flags are present.

Both functions accept an optional `opts` object with a `connection` (Solana RPC) for token metadata enrichment and a `config` override for customizing the registry.

---

## Layer 1: Deserialization

The raw transaction bytes arrive as a base64-encoded string. The first step is converting this into a structured representation: a fee payer address and a list of raw instructions, where each instruction has a program ID, an ordered list of account addresses, and a data buffer.

Solana has two transaction formats: the original legacy format and the newer versioned format (V0), which supports address lookup tables for transaction size compression. The system tries versioned deserialization first and falls back to legacy. Both formats are normalized into the same internal `RawInstruction` structure before passing to subsequent layers.

**Limitation with address lookup tables:** Versioned transactions that use address lookup tables contain references to accounts by lookup table index rather than directly embedding their public keys. Full resolution of these references requires an RPC call to fetch the lookup table accounts. The current implementation only uses the `staticAccountKeys` from the message header — accounts referenced through lookup tables appear as empty strings in the account lists. This means decoded params for such instructions may have null account fields. In practice, SilkyWay's backend currently generates only legacy transactions, so this limitation does not affect production usage.

---

## Layer 2: Registry

The registry is the system's knowledge base — a static mapping from known program IDs to metadata, and from known token mint addresses to human-readable metadata.

**Program registry:** Maps each known program's public key to:
- A display name (e.g., "SPL Token", "Handshake")
- A decoder key, which is an internal string identifier telling the decoder layer which decoding function to use

**Token registry:** Maps each known mint address to:
- A token symbol (e.g., "USDC", "SOL")
- The number of decimal places, which is required to convert raw token amounts (u64 integers as stored on-chain) into human-readable values

The registry is compiled into the SDK bundle as a TypeScript module — it is not loaded from a file at runtime. This means it is always available offline, has no file I/O, and cannot be tampered with by modifying a local config file. Custom entries can be merged in at call time via the `opts.config` override.

**Current registry contents:**

| Program | Decoder |
|---|---|
| System Program | `system` |
| SPL Token | `spl-token` |
| Associated Token Account | `ata` |
| Compute Budget | `compute-budget` |
| Memo | `memo` |
| Handshake (SilkyWay) | `handshake` |
| Silkysig (SilkyWay) | `silkysig` |
| Jupiter v6 | `jupiter` |

| Token | Symbol | Decimals |
|---|---|---|
| USDC | USDC | 6 |
| Wrapped SOL | SOL | 9 |
| USDT | USDT | 6 |
| ETH (Wormhole) | ETH | 8 |
| mSOL | mSOL | 9 |
| JitoSOL | JitoSOL | 9 |

Any program or token not in this registry is considered unknown. Unknown programs are flagged as errors. Unknown token mints fall back to RPC enrichment.

---

## Layer 3: Token Cache and RPC Enrichment

Human-readable output requires knowing token symbols and decimal places. The registry covers common tokens, but on-chain transactions may involve any mint. To handle unknowns, the system creates a **token cache** at the start of each `analyzeTransaction` call.

The token cache is a session-scoped lookup table that:
1. Pre-populates from the registry (instant, no network)
2. Resolves unknown mints via Solana RPC if a `connection` was provided

When an unknown mint is encountered, the system fetches the mint account data from chain. Solana SPL mint accounts have a fixed binary layout, and the decimals value is stored at a known byte offset (byte 44), so only a single account fetch is needed. Because proper token symbols require the Metaplex Token Metadata program, which involves a separate PDA derivation and fetch, the system uses a shortened form of the mint address (first 4 + last 4 characters) as a fallback symbol for unrecognized tokens.

All mints appearing in a transaction are prefetched in a single parallel batch before decoding begins, so there is at most one round of RPC calls per `analyzeTransaction` invocation regardless of how many unique mints appear.

---

## Layer 4: Decoders

For each instruction, the system calls the decoder identified by the registry's decoder key for that program. Each decoder receives the raw instruction data buffer and the ordered list of account addresses, and returns a `{ type, params }` pair.

**`type`** is a string name for the instruction (e.g., `"create_transfer"`, `"transfer_checked"`). **`params`** is a plain-object record of decoded fields with human-readable values — amounts are expressed in both raw and human-readable form, addresses are base58 strings, and token amounts include the symbol.

### Hardcoded decoders (stable programs)

The System Program, SPL Token, ATA program, Compute Budget, and Memo program use hardcoded decoders. These programs have fixed, stable binary layouts that have not changed since their deployment and are extremely unlikely to change. Their instruction formats are documented in their source repositories and are considered canonical.

**System Program** uses a u32 little-endian integer at the start of instruction data as a discriminator. Transfer (index 2) and CreateAccount (index 0) are the most relevant instruction types for risk analysis.

**SPL Token** uses a u8 at the start of instruction data as a discriminator. The `Transfer` (index 3) and `TransferChecked` (index 12) variants are most important — they identify token movements in the transaction.

**ATA and Compute Budget** are similar — single-byte discriminators with small fixed-size payloads.

### Anchor-based decoders (Handshake, Silkysig)

SilkyWay's own programs (Handshake and Silkysig) are written in Rust using the Anchor framework. Anchor uses an 8-byte instruction discriminator derived from the SHA-256 hash of the string `"global:{instruction_name}"`, taking the first 8 bytes of the digest. This discriminator is prepended to all instruction data.

After the 8-byte discriminator, Anchor serializes instruction arguments using **Borsh** (Binary Object Representation Serializer for Hashing), a deterministic binary encoding. The system includes its own minimal Borsh reader — no Anchor or Borsh library is required as a runtime dependency.

**Borsh encoding for relevant types:**
- `pubkey`: 32 bytes, raw public key bytes
- `u64` / `i64`: 8 bytes, little-endian
- `string`: 4-byte length prefix (little-endian u32) followed by UTF-8 bytes
- `Option<T>`: 1-byte presence flag (0 = None, 1 = Some), followed by the encoded T if Some
- `bool`: 1 byte (0 = false, 1 = true)

The discriminators for all Handshake and Silkysig instructions are precomputed and embedded as constant arrays in the decoder source. There is no runtime SHA-256 computation.

**Handshake decoded instructions:**

| Instruction | Key decoded params |
|---|---|
| `create_transfer` | sender, recipient, mint, amount (raw + human), memo, claimable_after, claimable_until |
| `claim_transfer` | claimer, transferPda, sender |
| `cancel_transfer` | sender, transferPda |
| `decline_transfer` | recipient, transferPda, reason |
| `reject_transfer` | operator, transferPda, reason |
| `expire_transfer` | caller, transferPda |
| `init_pool`, `pause_pool`, `withdraw_fees` | operator, pool, mint |

**Silkysig decoded instructions:**

| Instruction | Key decoded params |
|---|---|
| `transfer_from_account` | signer, silkAccount, mint, recipient, amount (raw + human) |
| `deposit` | depositor, silkAccount, mint, amount (raw + human) |
| `create_account` | owner, mint, silkAccount |
| `add_operator` | owner, silkAccount, operator, perTxLimit |
| `remove_operator` | owner, silkAccount, operator |
| `toggle_pause`, `close_account` | owner, silkAccount |

### Best-effort decoder (Jupiter)

Jupiter v6's routing instructions use a complex proprietary format that would require maintaining a full schema of its internal route structures. The Jupiter decoder takes a best-effort approach: it recognizes the discriminators of known Jupiter instruction types (route, shared_accounts_route, exact_out_route, and variants) by matching against a table of precomputed discriminator hex strings. When matched, it returns the instruction type name and extracts the source and destination token account addresses (which appear at fixed positions in the account list). Full route parameters (input/output mints, amounts, slippage) are not decoded and are documented as such in the params output.

---

## Layer 5: Flag Engine

After all instructions are decoded, the flag engine applies a set of risk rules across the full instruction list. Flags have three severity levels:

- **`error`** — something is definitively wrong or unverifiable; the agent should not sign
- **`warning`** — something unusual that warrants attention but may be legitimate
- **`info`** — informational, no action required

Flags are attached both to the per-instruction `flags` array and to the top-level `flags` array on the `TransactionAnalysis`. The top-level array is the canonical place to check for problems.

### Current rules

**`UNKNOWN_PROGRAM` (error)**
Any instruction whose program ID is not in the registry. There is no safe way to interpret what an unknown program does, so this is always an error. There is intentionally no RPC fallback for unknown programs — the absence of a program from the registry is itself a signal worth surfacing.

**`UNEXPECTED_SOL_DRAIN` (error)**
A System Program `transfer` instruction whose destination is not the fee payer, not a known program, and not any other address that appears elsewhere in the transaction. A System Program transfer to an address that has no other role in the transaction is a classic drain pattern. Transfers to known programs (e.g., rent for account creation) are permitted and not flagged.

**`UNEXPECTED_TOKEN_TRANSFER` (warning)**
An SPL Token `transfer` or `transfer_checked` instruction whose destination token account is not part of the set of addresses known from the intent. This rule only fires when `verifyIntent` is called (not from `analyzeTransaction` directly), because it requires knowledge of which addresses are expected. A warning rather than an error because some transactions legitimately involve more token movements than the top-level intent implies.

**`LARGE_COMPUTE_BUDGET` (info)**
A Compute Budget `set_compute_unit_price` instruction. Priority fees are common on Solana mainnet and are not themselves suspicious, but agents should be aware they are paying them.

---

## Output Structure

### `TransactionAnalysis`

The top-level output of `analyzeTransaction`:

- **`feePayer`**: The address that will pay transaction fees and is typically the signing agent's wallet
- **`instructions`**: An ordered array of `InstructionAnalysis` objects, one per instruction in the transaction
- **`flags`**: All `RiskFlag` objects raised across all instructions
- **`summary`**: A single plain-English sentence describing what the transaction does, with any error/warning flags appended. This field is optimized for LLM consumption — it is what an agent model would include in its reasoning about whether to sign.

### `InstructionAnalysis`

Per-instruction breakdown:

- **`index`**: Zero-based position in the transaction
- **`programId`**: Base58 public key of the program being called
- **`programName`**: Display name from the registry, or `null` if unknown
- **`type`**: Instruction name string, or `null` if the discriminator wasn't recognized
- **`known`**: Whether the program was found in the registry
- **`params`**: Decoded fields as a plain object. All addresses are base58 strings. Amounts appear in two forms: `amount` (raw u64 string) and `amountHuman` (decimal string with symbol, e.g., `"100 USDC"`)
- **`flags`**: Risk flags specifically about this instruction

### `VerifyResult`

Output of `verifyIntent`:

- **`verified`**: `true` only if no error-severity flags exist and all checked intent fields match
- **`discrepancies`**: Array of human-readable strings describing mismatches (empty when `verified` is `true`)
- **`analysis`**: The full `TransactionAnalysis` for inspection

---

## Intent Verification Logic

`verifyIntent` layers on top of `analyzeTransaction`. After getting the full analysis, it:

1. **Checks for any error-severity flags.** If any exist, they are added to `discrepancies` immediately. An error flag means the transaction contains something unverifiable or suspicious, so `verified` is `false` regardless of whether the core intent matches.

2. **Finds the matching instruction.** It searches the decoded instructions for one whose `type` matches the intent's `type` (e.g., `"create_transfer"`). If none is found, a discrepancy is added and verification fails.

3. **Field-compares decoded params against the intent.** Each intent type has a specific set of fields to check:

   | Intent type | Checked fields |
   |---|---|
   | `create_transfer` | sender, recipient, amount (±0.01% tolerance), memo (if provided) |
   | `claim_transfer` | claimer, transferPda |
   | `cancel_transfer` | canceller (mapped to sender in decoded params), transferPda |
   | `transfer_from_account` | owner (mapped to signer), recipient, amount |
   | `deposit` | owner (mapped to depositor), amount |

   Public key comparisons normalize both addresses through the `PublicKey` constructor before comparing, tolerating different representations of the same address.

4. **Amount tolerance.** Token amounts are stored as integers on-chain but expressed as decimals in the intent. Floating-point conversion introduces rounding. A tolerance of 0.01% (1 basis point) is applied to amount comparisons to prevent false failures from precision loss.

---

## Data Flow Diagram

```
Agent makes API request to backend
        │
        ▼
Backend returns: { transaction: "base64...", ...metadata }
        │
        ▼
Agent calls verifyIntent(transaction, {
  type: 'create_transfer',
  sender: agentWallet,
  recipient: bob,
  amount: 100,
  token: 'USDC'
})
        │
        ├── deserializeTx(txBase64)
        │       └── Buffer.from(base64) → VersionedTx or LegacyTx
        │           → { feePayer, RawInstruction[] }
        │
        ├── loadRegistry(opts.config)
        │       └── REGISTRY merged with any custom overrides
        │
        ├── createTokenCache(registry.tokens, connection?)
        │       └── Pre-populated from registry
        │           └── prefetch() → RPC batch for unknown mints
        │
        ├── for each RawInstruction:
        │       ├── registry.programs[programId] → { name, decoderKey }
        │       └── decodeInstruction(decoderKey, data, accounts, tokenCache)
        │               → { type: "create_transfer", params: { sender, recipient, amount, ... } }
        │
        ├── applyGlobalFlags(instructions, feePayer, knownAddresses)
        │       → RiskFlag[]
        │
        ├── buildSummary(...)
        │       → "Transaction creates Handshake transfer of 100 USDC from AgXx..w1 to BobA..c2."
        │
        │   [verifyIntent continues here]
        │
        ├── Check for error-severity flags → discrepancies
        │
        ├── Find instruction where type === 'create_transfer'
        │
        └── Compare params vs intent fields
                sender match? recipient match? amount within 0.01%?
                → { verified: true, discrepancies: [], analysis }
                   or
                → { verified: false, discrepancies: ["Recipient mismatch..."], analysis }
```

---

## Design Decisions

### Why client-side, not a backend verification endpoint?

A backend endpoint (`POST /api/tx/verify`) would be circular: the same system that builds the transaction would be confirming it is correct. If there is a bug or a compromise in the backend, the verify endpoint would reflect the same bug. Client-side verification with SDK-bundled decoders is trustless by construction — the agent verifies independently of the builder.

### Why precomputed discriminators instead of runtime SHA-256?

Computing Anchor discriminators at runtime requires a SHA-256 implementation and a specific string formatting convention (`"global:{name}"`). Embedding the precomputed byte arrays eliminates the dependency, makes the decoder logic trivially auditable (the bytes are right there in the source), and avoids any subtle bugs in discriminator computation.

### Why compile the registry into TypeScript rather than load from a JSON file?

A JSON file in the filesystem can be modified without changing the SDK. Embedding the registry as a TypeScript module means it is compiled into the JS bundle and its contents are part of the signed, versioned SDK release. An agent that installs `@silkysquad/silk@1.0.x` gets exactly the registry that was shipped with that version. This also eliminates file I/O and eliminates `fs` permission requirements for environments that sandbox file access.

### Why is `UNKNOWN_PROGRAM` an error and not a warning?

Unknown programs cannot be interpreted at all. A warning implies the agent might reasonably proceed despite the issue. There is no reasonable basis for an agent to sign a transaction calling an unknown program — the agent has no information about what that program will do. Making it an error enforces a hard stop and forces the agent to either add the program to a custom registry (with explicit opt-in) or refuse to sign.

### Why is amount tolerance 0.01%?

Token amounts are stored on-chain as raw u64 integers (e.g., `100000000` for 100 USDC at 6 decimals). When an agent expresses an intent with a floating-point amount (e.g., `100.0`), the backend converts it to a raw integer, and the decoder converts it back. IEEE 754 double-precision floating point has sufficient precision for these values up to very large amounts, but keeping a small tolerance avoids any edge case where rounding in either direction produces a false mismatch.

---

## Known Limitations

**Address lookup table resolution.** Versioned (V0) transactions that use address lookup tables will have empty/null account fields for any accounts referenced through the lookup table. Full resolution requires fetching the lookup table accounts via RPC, which the current implementation does not do. SilkyWay's backend currently builds only legacy transactions.

**Jupiter full decoding.** Jupiter v6 route instructions are not fully decoded. The instruction type is identified and source/destination token accounts are extracted, but route parameters (input/output mints, minimum amount out, slippage) are not parsed. An agent relying on `verifyIntent` for a swap transaction would need to check the decoded params manually.

**Token symbol quality.** For mints not in the registry, the symbol falls back to a shortened address string. This is readable but not informative. Full symbol resolution requires the Metaplex Token Metadata program, which is not currently implemented.

**No simulation.** The system analyzes the transaction statically — it does not simulate execution. Static analysis cannot detect runtime conditions such as insufficient balance, expired blockhash, or program logic that behaves differently based on on-chain state.

---

## Extension Points

**Adding new programs.** To add decoding support for a new program (e.g., Raydium, Orca), add an entry to `registry.ts` with a new decoder key, then implement the corresponding decoder module in `src/verify/decoders/`. The decoder key string is the routing mechanism — it only needs to be unique within the registry.

**Custom registries.** Consumers can extend the bundled registry at call time via `opts.config.programs` and `opts.config.tokens`. Custom entries override bundled entries with the same key. This allows consumer applications to add support for their own programs without forking the SDK.

**Additional flag rules.** New risk rules can be added to `flags.ts` without touching any other module. Each rule receives the full `InstructionAnalysis[]` and can inspect decoded params from any instruction, enabling cross-instruction rules (e.g., "flag if a token transfer and an unknown program call appear in the same transaction").

**New intent types.** New intent types (e.g., covering future SilkyWay protocol instructions) are added to the `Intent` union type in `index.ts` and handled with a new `case` block in `verifyIntent`. The existing decoder for the corresponding program handles the heavy lifting.
