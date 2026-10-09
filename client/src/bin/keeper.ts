#!/usr/bin/env node
import { loadConfig, loadEnv } from '../keeper/config.js';
import { Keeper } from '../keeper/keeper.js';

const USAGE = `Usage: keeper <command> [--send] [config.json]

  create-guards   create each configured guard (the keeper key is admin)
  snapshot        one NoriSnapshot transaction for every configured query
  checkpoint      record each guard's mint supply
  submit          submit reads of pending snapshots whose batch is proven
  status          print each guard's status
  assert          simulate each guard's assert_healthy, the call a lender
                  makes: allowed, or blocked with the error; --send lands it
                  even when it fails and prints the transaction
  unlatch         clear a tripped guard's latch (the keeper key is admin);
                  testing and demos only
  run             all of the above on the configured intervals; snapshots
                  on the heartbeat and as soon as a watched result changes

Config: keeper.demo.json by default. Its \${VAR}s come from the repo's .env
and the deploy outputs in ethereum/. ETH_PRIVATE_KEY signs Ethereum transactions.`;

const args = process.argv.slice(2);
const send = args.includes('--send');
const [command, configPath = 'keeper.demo.json'] = args.filter(
    (arg) => arg !== '--send'
);
const commands = [
    'create-guards',
    'snapshot',
    'checkpoint',
    'submit',
    'status',
    'assert',
    'unlatch',
    'run',
];
if (!command || !commands.includes(command) || (send && command !== 'assert')) {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
}

loadEnv();
const keeper = await Keeper.connect(loadConfig(configPath));
switch (command) {
    case 'create-guards':
        await keeper.createGuards();
        break;
    case 'snapshot':
        await keeper.snapshot();
        break;
    case 'checkpoint':
        await keeper.checkpoint();
        break;
    case 'submit':
        await keeper.submit();
        break;
    case 'status':
        await keeper.status();
        break;
    case 'assert':
        await keeper.assertHealthy(send);
        break;
    case 'unlatch':
        await keeper.unlatch();
        break;
    case 'run':
        await keeper.run();
        break;
}
if (command !== 'run') process.exit(0);
