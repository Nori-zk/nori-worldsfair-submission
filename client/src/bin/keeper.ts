#!/usr/bin/env node
import { loadConfig } from '../keeper/config.js';
import { Keeper } from '../keeper/keeper.js';

const USAGE = `Usage: keeper <command> [config.json]

  create-guards   create each configured guard (the keeper key is admin)
  snapshot        one NoriSnapshot transaction for every configured query
  checkpoint      record each guard's mint supply
  submit          submit reads of pending snapshots whose batch is proven
  status          print each guard's status
  run             all of the above on the configured intervals

ETH_PRIVATE_KEY signs Ethereum transactions. Config: keeper.example.json`;

const [command, configPath = 'keeper.json'] = process.argv.slice(2);
const commands = [
    'create-guards',
    'snapshot',
    'checkpoint',
    'submit',
    'status',
    'run',
];
if (!command || !commands.includes(command)) {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
}

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
    case 'run':
        await keeper.run();
        break;
}
if (command !== 'run') process.exit(0);
