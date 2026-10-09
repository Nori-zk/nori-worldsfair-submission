/// <reference types="@nomicfoundation/hardhat-ethers" />
import { expect } from 'chai';
import { readFileSync } from 'fs';
import hre from 'hardhat';
import {
    KELP_REPLAY_VECTORS_FILE,
    LOCAL_VECTORS_FILE,
    buildKelpReplayVectors,
    buildLocalSnapshotReadVectors,
} from '../vectors/snapshotReadVectors.js';

describe('Snapshot read vectors', () => {
    it('Should match the committed vectors nori-read tests against (npm run vectors regenerates them)', async function () {
        const { ethers } = await hre.network.create('vectors');

        const vectors = await buildLocalSnapshotReadVectors(ethers);

        expect(vectors).to.deep.equal(
            JSON.parse(readFileSync(LOCAL_VECTORS_FILE, 'utf8'))
        );
    });

    it('Should match the committed Kelp replay vectors', async function () {
        const { ethers } = await hre.network.create('vectors');

        const vectors = await buildKelpReplayVectors(ethers);

        expect(vectors).to.deep.equal(
            JSON.parse(readFileSync(KELP_REPLAY_VECTORS_FILE, 'utf8'))
        );
    });
});
