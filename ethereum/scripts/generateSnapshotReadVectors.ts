import { writeFileSync } from 'fs';
import hre from 'hardhat';
import {
    KELP_REPLAY_VECTORS_FILE,
    LOCAL_VECTORS_FILE,
    MAINNET_VECTORS_FILE,
    buildKelpReplayVectors,
    buildLocalSnapshotReadVectors,
    buildMainnetSnapshotReadVectors,
} from '../vectors/snapshotReadVectors.js';

// Writes test-vectors/nori-snapshot: the reproducible sets by default, the
// mainnet fork set with VECTORS_NETWORK=mainnetFork.
const write = (file: string, vectors: unknown) => {
    writeFileSync(file, JSON.stringify(vectors, null, 4) + '\n');
    console.log(`Wrote ${file}`);
};

if (process.env.VECTORS_NETWORK === 'mainnetFork') {
    const { ethers } = await hre.network.create('mainnetFork');
    write(MAINNET_VECTORS_FILE, await buildMainnetSnapshotReadVectors(ethers));
} else {
    const local = await hre.network.create('vectors');
    write(
        LOCAL_VECTORS_FILE,
        await buildLocalSnapshotReadVectors(local.ethers)
    );
    const replay = await hre.network.create('vectors');
    write(
        KELP_REPLAY_VECTORS_FILE,
        await buildKelpReplayVectors(replay.ethers)
    );
}
