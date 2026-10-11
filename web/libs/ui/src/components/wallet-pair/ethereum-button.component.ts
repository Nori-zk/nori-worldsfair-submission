import { Component } from '@yaw-rx/core';
import { combineLatest, map, take, type Observable } from 'rxjs';
import type { EthereumWalletState, WalletAccountState } from '@nori-zk/nori-bridge-solana-sdk';
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
        case 'connecting':
            return `Checking ${wallet.data.wallet.name}`;
        case 'ready':
        case 'overwhelmed':
            return `${wallet.data.wallet.name} · ${chainName(expectedChainId)}`;
        case 'wrongNetwork':
            return `Switch to ${chainName(wallet.data.expected)}`;
        case 'askingToSwitchChain':
            return `Confirm in ${wallet.data.wallet.name}`;
        case 'switchDeclined':
            return `Switch ${wallet.data.wallet.name} to ${chainName(wallet.data.expected)}`;
        case 'waitingToRetry':
            return `${wallet.data.wallet.name} not responding`;
        case 'offline':
            return 'Offline';
        case 'closed':
            return 'Closed';
    }
};

/**
 * Whether the wallet shares no account: none yet, or the user declined.
 * The account machine waits for the wallet itself, so it is only here
 * while the wallet is ready.
 *
 * @param account The account machine's state.
 * @returns Whether the user still has to share an account.
 */
const needsAccount = (account: WalletAccountState): boolean =>
    (account.node === 'current' && account.data.account === undefined) ||
    account.node === 'shareDeclined';

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
    private get states$(): Observable<[EthereumWalletState, WalletAccountState]> {
        return combineLatest([this.connections.walletState$, this.connections.accountState$]);
    }

    private get expectedChainId(): bigint {
        return this.connections.options.ethereum.expectedChainId;
    }

    get text$(): Observable<string> {
        return this.states$.pipe(
            map(([wallet, account]) => {
                if (wallet.node !== 'ready' && wallet.node !== 'overwhelmed')
                    return ethereumText(wallet, this.expectedChainId);
                if (account.node === 'askingToShareAccount')
                    return `Confirm in ${wallet.data.wallet.name}`;
                if (needsAccount(account)) return `Connect ${wallet.data.wallet.name}`;
                return ethereumText(wallet, this.expectedChainId);
            }),
        );
    }

    /** The wallet's state in words, as the button's tooltip. */
    get detail$(): Observable<string> {
        return this.states$.pipe(map(([wallet]) => ethereumText(wallet, this.expectedChainId)));
    }

    get ready$(): Observable<boolean> {
        return this.states$.pipe(
            map(
                ([wallet, account]) =>
                    (wallet.node === 'ready' || wallet.node === 'overwhelmed') &&
                    account.node === 'current' &&
                    account.data.account !== undefined,
            ),
        );
    }

    get idle$(): Observable<boolean> {
        return this.states$.pipe(
            map(
                ([wallet, account]) =>
                    wallet.node !== 'noWalletFound' &&
                    wallet.node !== 'wrongNetwork' &&
                    !needsAccount(account),
            ),
        );
    }

    act(): void {
        this.states$.pipe(take(1)).subscribe(([wallet, account]) => {
            if (wallet.node === 'noWalletFound')
                window.open(METAMASK_DOWNLOAD_URL, '_blank', 'noopener');
            if (wallet.node === 'wrongNetwork') this.connections.wallet.switchToExpectedChain();
            if (needsAccount(account)) this.connections.connectAccount();
        });
    }
}
