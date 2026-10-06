/// <reference types="@nomicfoundation/hardhat-ethers" />
/// <reference types="@nomicfoundation/hardhat-ethers-chai-matchers" />
import { expect } from 'chai';
import hre from 'hardhat';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-solana-bridge';
import {
    DemoLockbox__factory,
    NoriSnapshot__factory,
} from '../types/ethers-contracts/index.js';
import { encodeQueryData } from '../queries.js';
const { ethers } = await hre.network.getOrCreate();

describe('DemoLockbox', () => {
    it('Should let only the owner set the locked amount and pause flag', async function () {
        const [owner, other] = await ethers.getSigners();
        const lockbox = await new DemoLockbox__factory(owner).deploy(
            ethers.parseEther('116723.52')
        );

        expect(await lockbox.locked()).to.equal(ethers.parseEther('116723.52'));
        await expect(lockbox.set(ethers.parseEther('223.52'), true))
            .to.emit(lockbox, 'Set')
            .withArgs(ethers.parseEther('223.52'), true);
        expect(await lockbox.paused()).to.equal(true);
        await expect(
            lockbox.connect(other).set(0n, false)
        ).to.be.revertedWithCustomError(lockbox, 'NotOwner');
    });

    it('Should be snapshottable as backing and pause queries', async function () {
        const [owner] = await ethers.getSigners();
        const queue = await new NoriProofRequestQueue__factory(owner).deploy(
            owner.address,
            owner.address,
            0n
        );
        const snapshot = await new NoriSnapshot__factory(owner).deploy(
            await queue.getAddress()
        );
        const lockbox = await new DemoLockbox__factory(owner).deploy(
            ethers.parseEther('1')
        );
        const target = await lockbox.getAddress();

        await expect(
            snapshot.snapshot([
                {
                    target,
                    data: encodeQueryData({ signature: 'locked()', args: [] }),
                },
                {
                    target,
                    data: encodeQueryData({ signature: 'paused()', args: [] }),
                },
            ])
        ).to.emit(snapshot, 'Snapshot');
    });
});
