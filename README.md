# SilkyWay SDK

Agent payments on Solana. Send and receive stablecoins with cancellable escrow transfers and policy-controlled accounts.

## Installation

```bash
npm install -g @silkysquad/silk
```

Requires Node.js 18+.

## Quick Start

```bash
# Initialize wallet
silky init

# Register API key (required for all commands)
silky auth register

# Check balance
silky balance

# Send payment
silky pay <recipient> <amount>
```

## Documentation

- **[Full skill documentation](./SKILL.md)** - Complete CLI reference and API docs
- **[Website](https://silkyway.ai)** - Homepage and web app
- **[GitHub](https://github.com/silkysquad/silk)** - Source code and issues

## Features

- **API Key Auth** - Solana ed25519 challenge-response authentication; `SILKY_API_KEY` env var for CI
- **Escrow Transfers** - Send USDC with claim/cancel options
- **On-Chain Accounts** - Policy-enforced spending limits for agent operators
- **Multi-Wallet** - Manage multiple Solana wallets
- **Address Book** - Save contacts for easy payments
- **Claim Links** - Share browser-based claim URLs
- **Drift Integration** - Optional yield on account balances
- **Multi-Cluster** - Support for mainnet and devnet

## Examples

### Send a Payment

```bash
# Send 10 USDC to an address
silky pay 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx 10 --memo "Payment for code review"

# Send to a contact
silky contacts add alice 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx
silky pay alice 10
```

### Claim a Payment

```bash
# List incoming payments
silky payments list

# Claim a transfer
silky claim <transfer-pda>
```

### Use an Account

```bash
# Sync your operator account (set up by human via web UI)
silky account sync

# Check account status and spending limit
silky account status

# Send from account (subject to per-tx limit)
silky account send <recipient> <amount>
```

## Security

SilkyWay is non-custodial. Your private keys:
- Are generated locally on your machine
- Are stored at `~/.config/silkyway/config.json`
- Never leave your machine
- Are never transmitted to any server

All transactions are signed locally. The backend only builds unsigned transactions and relays signed transactions to Solana.

## Contributing

Issues and pull requests are welcome at https://github.com/silkysquad/silk

## License

MIT
