---
name: silk
description: Agent payments on Solana. Policy-controlled accounts with spending limits, plus cancellable escrow transfers. Use when you need to make payments or manage funds.
metadata:
  author: silkysquad
  version: "0.1.0"
compatibility: Requires Node.js 18+, npm, and internet access to Solana.
---

# Silkyway Payments

Agent payments on Solana — two modes:

1. **Accounts (recommended)** — Your human creates an on-chain account, adds you as an operator with a spending limit, and funds it. You send payments directly. The on-chain program enforces your limit.
2. **Escrow transfers** — Send USDC into escrow. Recipient claims it, or you cancel for a refund.

## Installation

```bash
npm install -g https://silkyway.ai/sdk/silkyway-sdk-0.1.0.tgz
```

## Cluster Configuration

Silkyway supports both **mainnet** (real USDC) and **devnet** (test USDC). Default is `mainnet-beta`.

```bash
# Check current cluster
silk config get-cluster

# Switch to devnet for testing
silk config set-cluster devnet

# Switch back to mainnet
silk config set-cluster mainnet-beta
```

The cluster determines which Solana network and API backend are used:

| Cluster | API Base URL | Network |
|---------|-------------|---------|
| `mainnet-beta` | `https://api.silkyway.ai` | Mainnet (real USDC) |
| `devnet` | `https://devnet-api.silkyway.ai` | Devnet (test USDC) |

Use `devnet` for testing and development; use `mainnet-beta` for real payments.

## First-Time Setup

If you're using Silk CLI for the first time:

```bash
# 1. Initialize (creates wallet and agent ID)
silk init

# 2. Fund it with devnet SOL and USDC (devnet only)
silk config set-cluster devnet
silk wallet fund
```

The `silk init` command:
- Creates a default wallet named "main" if no wallets exist
- Generates a unique agent ID if one doesn't exist
- Is safe to run multiple times (idempotent)
- Reports what was created vs what already existed

Your wallet and agent ID are saved at `~/.config/silk/config.json`. You only need to do this once.

Alternatively, you can create wallets manually with `silk wallet create [label]`.

## Escrow Transfers

If you don't have an account set up, or need to send a one-off payment with cancellation support, use escrow transfers.

### Sending a Payment

```bash
silk pay <recipient-address> <amount>
```

Example:
```bash
silk pay 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx 25 --memo "Payment for code review"
```

This sends USDC into escrow. The recipient must claim it. You'll get back a **Transfer PDA** and a **claim link** (`claimUrl`).

- **Claim link** — A URL you can share with the recipient (or their human). They open it in a browser, connect their wallet, and claim the payment. This is the easiest way for a non-technical recipient to claim. Example: `https://app.silkyway.so/transfers/9aE5kBqRvF3...?cluster=devnet`
- **Transfer PDA** — Save this if you need to cancel later.

### Checking Your Balance

```bash
silk balance
```

### Viewing Transfers

```bash
# List active (unclaimed) transfers
silk payments list

# Get details on a specific transfer
silk payments get <transfer-pda>
```

### Claiming a Payment

If someone sent you a payment, claim it:

```bash
silk payments list
silk claim <transfer-pda>
```

### Cancelling a Payment

Cancel a payment you sent (if it hasn't been claimed yet):

```bash
silk cancel <transfer-pda>
```

## Multi-Wallet Support

Create additional wallets for testing:

```bash
silk wallet create second-wallet
silk wallet fund --wallet second-wallet
silk wallet list
```

Use `--wallet <label>` on any command to specify which wallet to use:

```bash
silk pay <address> 10 --wallet second-wallet
silk claim <transfer-pda> --wallet second-wallet
silk balance --wallet second-wallet
```

## Support Chat

Ask the Silkyway support agent questions about payments, accounts, or the protocol:

```bash
silk chat "How do I send a payment?"
```

The first time you use `silk chat`, a persistent `agentId` (UUID) is auto-generated and saved in your config at `~/.config/silk/config.json`. This gives you session continuity across conversations — the support agent remembers your context.

## Account Setup (Recommended)

A Silkyway account is an on-chain wallet controlled by a **human owner** who delegates spending authority to **operator agents**. Each operator has a per-transaction spending limit enforced on-chain — if you try to exceed it, the transaction is rejected by the Solana program, not the backend.

**Key concepts:**
- **Owner** — The human who creates and funds the account. Has full control (no spending limits, can pause, add/remove operators).
- **Operator** — You (the agent). Authorized to send tokens from the account, subject to a per-transaction limit set by the owner.
- **Per-transaction limit** — Maximum USDC you can send in one transaction. A limit of $5 means you can send $5 or less per transaction, as many times as you want. A limit of 0 means unlimited.
- **Pause** — The owner can pause the account, blocking all operator transfers until unpaused. You cannot unpause it.

### Setup flow

1. Initialize your CLI (if you haven't already):
   ```bash
   silk init
   ```

2. Share the setup URL with your human (replace with your address from `silk wallet list`):
   ```
   https://app.silkyway.ai/account/setup?agent=YOUR_ADDRESS
   ```
   Your human will connect their wallet, set your spending limit, and fund the account.

   **Important:** Your human must select the same network (mainnet/devnet) on the setup page as your CLI cluster. The setup page has a cluster toggle in the header. If you're on devnet (`silk config get-cluster`), tell your human to switch to devnet before creating the account.

3. After your human creates the account, sync it:
   ```bash
   silk account sync
   ```

4. Check your account status:
   ```bash
   silk account status
   ```

5. Send payments (policy-enforced on-chain):
   ```bash
   silk account send <recipient> <amount>
   ```

If the amount exceeds your per-transaction limit, the on-chain program rejects it with `ExceedsPerTxLimit`. If the account is paused, you'll get `AccountPaused`. If you're not an operator on the account, you'll get `Unauthorized`.

If `silk account sync` returns "No account found", your human hasn't set up the account yet — share the setup URL with them.

## Address Book

Save contacts so you can send payments by name instead of address.

```bash
# Add a contact
silk contacts add alice 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx

# List all contacts
silk contacts list

# Look up a contact
silk contacts get alice

# Remove a contact
silk contacts remove alice
```

Once a contact is saved, use their name anywhere you'd use an address:

```bash
silk pay alice 10 --memo "Thanks for the review"
silk account send alice 5
```

Contact names are case-insensitive and stored lowercase. Contacts are saved at `~/.config/silk/contacts.json`.

## Command Reference

| Command | Description |
|---------|-------------|
| `init` | Initialize CLI (create default wallet and agent ID if needed) |
| `wallet create [label]` | Create a new wallet (first one is named "main") |
| `wallet list` | List all wallets with addresses |
| `wallet fund [--sol] [--usdc] [--wallet <label>]` | Fund wallet from devnet faucet |
| `balance [--wallet <label>]` | Show SOL and USDC balances |
| `pay <recipient> <amount> [--memo <text>] [--wallet <label>]` | Send USDC payment |
| `claim <transfer-pda> [--wallet <label>]` | Claim a received payment |
| `cancel <transfer-pda> [--wallet <label>]` | Cancel a sent payment |
| `payments list [--wallet <label>]` | List transfers |
| `payments get <transfer-pda>` | Get transfer details |
| `config set-cluster <cluster>` | Set cluster (`mainnet-beta` or `devnet`) |
| `config get-cluster` | Show current cluster and API URL |
| `config reset-cluster` | Reset cluster to default (`mainnet-beta`) |
| `contacts add <name> <address>` | Save a contact to the address book |
| `contacts remove <name>` | Remove a contact from the address book |
| `contacts list` | List all saved contacts |
| `contacts get <name>` | Look up a contact's address |
| `account sync [--wallet <label>] [--account <pda>]` | Discover your account (must be set up by human first) |
| `account status [--wallet <label>]` | Show balance and spending policy |
| `account send <recipient> <amount> [--memo <text>] [--wallet <label>]` | Send tokens (policy-enforced on-chain) |
| `chat <message>` | Ask Silkyway support agent a question |

## Security

Your private keys are stored locally at `~/.config/silk/config.json`. Never share this file or transmit your private keys to any service other than signing transactions locally.
