import { Component } from '@yaw-rx/core';
import { combineLatest, map, take, type Observable } from 'rxjs';
import type { EthereumWalletState } from '@nori-zk/nori-bridge-solana-sdk';
import { ethereumLogo } from '../../brand/brand.js';
import { ChainButton } from './chain-button.component.js';

/** Where users without a wallet get one. */
const METAMASK_DOWNLOAD_URL = 'https://metamask.io/download/';

/** Names of the chains the apps run on. */
const CHAIN_NAMES: Record<string, string> = {
    '1': 'Ethereum',
    '11155111': 'Sepolia',
    '560048': 'Hoodi',
};

/**
 * A chain's name, or its id when it has none.
 *
 * @param chainId The chain id.
 * @returns The chain's name.
 */
const chainName = (chainId: bigint | string): string =>
    CHAIN_NAMES[chainId.toString()] ?? `chain ${chainId.toString()}`;

/**
 * The button's text for each node of the wallet machine.
 *
 * @param wallet The wallet machine's state.
 * @param expectedChainId The chain the apps read.
 * @returns The text for the button.
 */
const ethereumText = (wallet: EthereumWalletState, expectedChainId: bigint): string => {
    switch (wallet.node) {
        case 'lookingForWallets':
            return 'Looking for a wallet';
        case 'noWalletFound':
            return 'Install MetaMask';
        case 'choosingWallet':
            return 'Choose a wallet';
        case 'checking':
            return `Checking ${wallet.data.wallet.name}`;
        case 'ready':
            return `${wallet.data.wallet.name} · ${chainName(expectedChainId)}`;
        case 'wrongNetwork':
            return `Switch to ${chainName(wallet.data.expected)}`;
        case 'askingToSwitchChain':
            return `Confirm in ${wallet.data.wallet.name}`;
        case 'switchDeclined':
            return `Switch ${wallet.data.wallet.name} to ${chainName(wallet.data.expected)}`;
        case 'unreachable':
            return `${wallet.data.wallet.name} not responding`;
        case 'offline':
            return 'Offline';
        case 'closed':
            return 'Closed';
    }
};

/**
 * The wallet's own error, when its state carries one.
 *
 * @param wallet The wallet machine's state.
 * @returns The error, or an empty string.
 */
const walletError = (wallet: EthereumWalletState): string => {
    if (wallet.node === 'unreachable') return wallet.data.error;
    if (wallet.node === 'wrongNetwork') return wallet.data.lastSwitchError;
    return '';
};

/**
 * Whether the wallet is on the expected chain and reads can run, but it has
 * shared no account yet.
 *
 * @param wallet The wallet machine's state.
 * @param account The wallet's first account, or an empty string.
 * @returns Whether the user still has to share an account.
 */
const needsAccount = (
    wallet: EthereumWalletState,
    account: string,
): wallet is Extract<EthereumWalletState, { node: 'ready' }> =>
    wallet.node === 'ready' && account === '';

/**
 * The Ethereum side of the wallet pair: the user's wallet, which Ethereum
 * reads go through. A click does what the wallet's state asks for: install
 * MetaMask, switch to the expected chain, or share an account.
 */
@Component({
    selector: 'ethereum-button',
    template: `
        <button [class.ready]="ready" [disabled]="idle" [title]="detail" onclick="act">
            <img class="logo" src="${ethereumLogo}" alt="Ethereum" />
            <span class="text">{{ text }}</span>
        </button>
    `,
})
export class EthereumButton extends ChainButton {
    private get states$(): Observable<[EthereumWalletState, string]> {
        return combineLatest([this.connections.walletState$, this.connections.account$]);
    }

    private get expectedChainId(): bigint {
        return this.connections.options.ethereum.expectedChainId;
    }

    get text$(): Observable<string> {
        return this.states$.pipe(
            map(([wallet, account]) =>
                needsAccount(wallet, account)
                    ? `Connect ${wallet.data.wallet.name}`
                    : ethereumText(wallet, this.expectedChainId),
            ),
        );
    }

    /** The button's text, or the wallet's error when it has one. */
    get detail$(): Observable<string> {
        return this.states$.pipe(
            map(([wallet]) => walletError(wallet) || ethereumText(wallet, this.expectedChainId)),
        );
    }

    get ready$(): Observable<boolean> {
        return this.states$.pipe(
            map(([wallet, account]) => wallet.node === 'ready' && account !== ''),
        );
    }

    get idle$(): Observable<boolean> {
        return this.states$.pipe(
            map(
                ([wallet, account]) =>
                    wallet.node !== 'noWalletFound' &&
                    wallet.node !== 'wrongNetwork' &&
                    !needsAccount(wallet, account),
            ),
        );
    }

    act(): void {
        this.states$.pipe(take(1)).subscribe(([wallet, account]) => {
            if (wallet.node === 'noWalletFound')
                window.open(METAMASK_DOWNLOAD_URL, '_blank', 'noopener');
            if (wallet.node === 'wrongNetwork') this.connections.wallet.switchToExpectedChain();
            if (needsAccount(wallet, account)) this.connections.connectAccount();
        });
    }
}
