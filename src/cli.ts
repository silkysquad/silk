#!/usr/bin/env node
import { Command } from 'commander';
import { walletCreate, walletList, walletFund } from './commands/wallet.js';
import { balance } from './commands/balance.js';
import { pay } from './commands/pay.js';
import { claim } from './commands/claim.js';
import { cancel } from './commands/cancel.js';
import { paymentsList, paymentsGet } from './commands/payments.js';
import { configSetApiUrl, configGetApiUrl, configResetApiUrl, configSetCluster, configGetCluster, configResetCluster } from './commands/config.js';
import { accountSync, accountStatus, accountSend } from './commands/account.js';
import { contactsAdd, contactsRemove, contactsList, contactsGet } from './commands/contacts.js';
import { chat } from './commands/chat.js';
import { init } from './commands/init.js';
import { wrapCommand } from './output.js';

const program = new Command();
program
  .name('silk')
  .description('Silkyway SDK — Agent payments on Solana')
  .version('0.1.0')
  .option('--human', 'Human-readable output');

// init
program
  .command('init')
  .description('Initialize Silk CLI (create default wallet and agent ID)')
  .action(wrapCommand(init));

// wallet commands
const wallet = program.command('wallet').description('Manage wallets');
wallet
  .command('create')
  .argument('[label]', 'wallet label', 'main')
  .description('Create a new wallet')
  .action(wrapCommand(walletCreate));
wallet
  .command('list')
  .description('List all wallets')
  .action(wrapCommand(walletList));
wallet
  .command('fund')
  .option('--sol', 'Request SOL only')
  .option('--usdc', 'Request USDC only')
  .option('--wallet <label>', 'Wallet to fund')
  .description('Fund wallet from devnet faucet (devnet only)')
  .action(wrapCommand(walletFund));

// balance
program
  .command('balance')
  .option('--wallet <label>', 'Wallet to check')
  .description('Check wallet balances')
  .action(wrapCommand(balance));

// pay
program
  .command('pay')
  .argument('<recipient>', 'Recipient wallet address')
  .argument('<amount>', 'Amount in USDC')
  .option('--memo <text>', 'Payment memo')
  .option('--wallet <label>', 'Sender wallet')
  .description('Send a USDC payment')
  .action(wrapCommand(pay));

// claim
program
  .command('claim')
  .argument('<transferPda>', 'Transfer PDA to claim')
  .option('--wallet <label>', 'Wallet to claim with')
  .description('Claim a received payment')
  .action(wrapCommand(claim));

// cancel
program
  .command('cancel')
  .argument('<transferPda>', 'Transfer PDA to cancel')
  .option('--wallet <label>', 'Wallet to cancel with')
  .description('Cancel a sent payment')
  .action(wrapCommand(cancel));

// payments
const payments = program.command('payments').description('View payment history');
payments
  .command('list')
  .option('--wallet <label>', 'Wallet to query')
  .description('List transfers')
  .action(wrapCommand(paymentsList));
payments
  .command('get')
  .argument('<transferPda>', 'Transfer PDA')
  .description('Get transfer details')
  .action(wrapCommand(paymentsGet));

// config
const config = program.command('config').description('SDK configuration');
config
  .command('set-api-url')
  .argument('<url>', 'API base URL')
  .description('Set the API base URL')
  .action(wrapCommand(configSetApiUrl));
config
  .command('get-api-url')
  .description('Show the current API base URL')
  .action(wrapCommand(configGetApiUrl));
config
  .command('reset-api-url')
  .description('Reset API URL to default')
  .action(wrapCommand(configResetApiUrl));
config
  .command('set-cluster')
  .argument('<cluster>', 'Cluster: mainnet-beta or devnet')
  .description('Set the Solana cluster')
  .action(wrapCommand(configSetCluster));
config
  .command('get-cluster')
  .description('Show the current Solana cluster')
  .action(wrapCommand(configGetCluster));
config
  .command('reset-cluster')
  .description('Reset cluster to default (mainnet-beta)')
  .action(wrapCommand(configResetCluster));

// account commands
const account = program.command('account').description('Manage Silkysig account');
account
  .command('sync')
  .option('--wallet <label>', 'Wallet to sync')
  .option('--account <pda>', 'Sync a specific account by PDA')
  .description('Discover and sync your account')
  .action(wrapCommand(accountSync));
account
  .command('status')
  .option('--wallet <label>', 'Wallet to check')
  .description('Show account balance and policy')
  .action(wrapCommand(accountStatus));
account
  .command('send')
  .argument('<recipient>', 'Recipient wallet address')
  .argument('<amount>', 'Amount in USDC')
  .option('--memo <text>', 'Payment memo')
  .option('--wallet <label>', 'Sender wallet')
  .description('Send from account (policy-enforced)')
  .action(wrapCommand(accountSend));

// contacts commands
const contacts = program.command('contacts').description('Manage address book');
contacts
  .command('add')
  .argument('<name>', 'Contact name')
  .argument('<address>', 'Solana wallet address')
  .description('Add a contact')
  .action(wrapCommand(contactsAdd));
contacts
  .command('remove')
  .argument('<name>', 'Contact name')
  .description('Remove a contact')
  .action(wrapCommand(contactsRemove));
contacts
  .command('list')
  .description('List all contacts')
  .action(wrapCommand(contactsList));
contacts
  .command('get')
  .argument('<name>', 'Contact name')
  .description('Get a contact address')
  .action(wrapCommand(contactsGet));

// chat
program
  .command('chat')
  .argument('<message>', 'Message to send to support')
  .description('Chat with Silkyway support agent')
  .action(wrapCommand(chat));

program.parse();
