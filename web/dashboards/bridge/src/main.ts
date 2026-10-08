import { bootstrap } from '@yaw-rx/core';
import { brandStyles } from '@nori-zk/solana-web-ui';
import { AppRoot } from './app-root.js';
import globalStyles from './main.css';

await bootstrap({
    root: AppRoot,
    globals: { styles: brandStyles + globalStyles },
    providers: [],
});
