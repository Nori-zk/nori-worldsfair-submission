import { Component } from '@yaw-rx/core';
import { combineLatest, map, of, take, type Observable } from 'rxjs';
import type {
    EthereumProviderConnection,
    EthereumWalletState,
} from '@nori-zk/nori-bridge-solana-sdk';
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
const chainName = (chainId: bigint): string =>
    CHAIN_NAMES[chainId.toString()] ?? `chain ${chainId.toString()}`;

/**
 * The button's text for each node of the Ethereum provider machine, while
 * the wallet is on the expected chain or reads go through an RPC URL.
 *
 * @param readyText The text once reads can run.
 * @param provider The Ethereum provider machine's state.
 * @returns The text for the button.
 */
const providerText = (readyText: string, provider: EthereumProviderConnection): string => {
    switch (provider.node) {
        case 'ready':
            return readyText;
        case 'offline':
            return 'Offline';
        case 'unreachable':
        case 'wrongNetwork':
            return 'Reconnecting to Ethereum';
        case 'waitingForWallet':
        case 'checking':
        case 'closed':
            return 'Connecting to Ethereum';
    }
};

/**
 * The button's text for each node of the wallet machine, and for the
 * Ethereum provider's state once the wallet is on the expected chain.
 *
 * @param wallet The wallet machine's state, when reads go through the wallet.
 * @param provider The Ethereum provider machine's state.
 * @returns The text for the button.
 */
const ethereumText = (
    wallet: EthereumWalletState | undefined,
    provider: EthereumProviderConnection,
): string => {
    if (wallet === undefined) return providerText('Ethereum', provider);
    switch (wallet.node) {
        case 'lookingForWallets':
            return 'Looking for a wallet';
        case 'noWalletFound':
            return 'Install MetaMask';
        case 'choosingWallet':
            return 'Choose a wallet';
        case 'checkingChain':
            return `Checking ${wallet.data.wallet.name}`;
        case 'walletNotResponding':
            return `${wallet.data.wallet.name} not responding`;
        case 'onExpectedChain':
            return providerText(
                `${wallet.data.wallet.name} · ${chainName(wallet.data.chainId)}`,
                provider,
            );
        case 'onOtherChain':
            return `Switch to ${chainName(wallet.data.expectedChainId)}`;
        case 'askingToSwitchChain':
            return `Confirm in ${wallet.data.wallet.name}`;
        case 'switchDeclined':
            return `Switch ${wallet.data.wallet.name} to ${chainName(wallet.data.expectedChainId)}`;
        case 'closed':
            return 'Closed';
    }
};

/**
 * The wallet's own error, when its state carries one.
 *
 * @param wallet The wallet machine's state, when reads go through the wallet.
 * @returns The error, or an empty string.
 */
const walletError = (wallet: EthereumWalletState | undefined): string => {
    if (wallet?.node === 'walletNotResponding') return wallet.data.error;
    if (wallet?.node === 'onOtherChain') return wallet.data.lastSwitchError;
    return '';
};

/**
 * Whether the wallet is on the expected chain and reads can run, but it has
 * shared no account yet.
 *
 * @param wallet The wallet machine's state, when reads go through the wallet.
 * @param provider The Ethereum provider machine's state.
 * @param account The wallet's first account, or an empty string.
 * @returns Whether the user still has to share an account.
 */
const needsAccount = (
    wallet: EthereumWalletState | undefined,
    provider: EthereumProviderConnection,
    account: string,
): wallet is Extract<EthereumWalletState, { node: 'onExpectedChain' }> =>
    wallet?.node === 'onExpectedChain' && provider.node === 'ready' && account === '';

/**
 * The Ethereum side of the wallet pair: the user's wallet and the Ethereum
 * connection through it. A click does what the wallet's state asks for:
 * install MetaMask, or switch to the expected chain.
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
    private get states$(): Observable<
        [EthereumWalletState | undefined, EthereumProviderConnection, string]
    > {
        return combineLatest([
            this.connections.wallet?.ethereumWallet.state$ ?? of(undefined),
            this.connections.connections.ethereum.ethereumProviderConnectivity.state$,
            this.connections.account$,
        ]);
    }

    get text$(): Observable<string> {
        return this.states$.pipe(
            map(([wallet, provider, account]) =>
                needsAccount(wallet, provider, account)
                    ? `Connect ${wallet.data.wallet.name}`
                    : ethereumText(wallet, provider),
            ),
        );
    }

    /** The button's text, or the wallet's error when it has one. */
    get detail$(): Observable<string> {
        return this.states$.pipe(
            map(([wallet, provider]) => walletError(wallet) || ethereumText(wallet, provider)),
        );
    }

    get ready$(): Observable<boolean> {
        return this.states$.pipe(
            map(
                ([wallet, provider, account]) =>
                    (wallet === undefined ||
                        (wallet.node === 'onExpectedChain' && account !== '')) &&
                    provider.node === 'ready',
            ),
        );
    }

    get idle$(): Observable<boolean> {
        return this.states$.pipe(
            map(
                ([wallet, provider, account]) =>
                    wallet?.node !== 'noWalletFound' &&
                    wallet?.node !== 'onOtherChain' &&
                    !needsAccount(wallet, provider, account),
            ),
        );
    }

    act(): void {
        this.states$.pipe(take(1)).subscribe(([wallet, provider, account]) => {
            if (wallet?.node === 'noWalletFound')
                window.open(METAMASK_DOWNLOAD_URL, '_blank', 'noopener');
            if (wallet?.node === 'onOtherChain') this.connections.wallet?.switchToExpectedChain();
            if (needsAccount(wallet, provider, account)) this.connections.connectAccount();
        });
    }
}
