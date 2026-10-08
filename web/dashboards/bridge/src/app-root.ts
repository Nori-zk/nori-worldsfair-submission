import { Component, RxElement } from '@yaw-rx/core';
import {
    ConnectionsService,
    PROOF_REQUEST_CONNECTIONS_OPTIONS,
    noriLogo,
    type ConnectionsOptions,
} from '@nori-zk/solana-web-ui';
import styles from './app-root.css';

/** The chain, cluster, bridge websocket, queue and program this build reads, from `web/.env`. */
const connectionsOptions: ConnectionsOptions = {
    ethereum: { expectedChainId: BigInt(NORI_WEB_ENV.ethereum.chainId) },
    solana: { cluster: NORI_WEB_ENV.solana.cluster },
    bridge: { wssUrl: NORI_WEB_ENV.bridge.wssUrl },
    proofRequests: {
        proofQueueAddress: NORI_WEB_ENV.ethereum.proofQueueAddress,
        programAddress: NORI_WEB_ENV.solana.programAddress,
    },
};

@Component({
    selector: 'app-root',
    providers: [
        { provide: PROOF_REQUEST_CONNECTIONS_OPTIONS, useValue: connectionsOptions },
        ConnectionsService,
    ],
    template: `
        <nori-background></nori-background>
        <header>
            <img class="logo" src="${noriLogo}" alt="Nori" />
        </header>
        <main>
            <nori-card heading="Bridge dashboard">
                <wallet-pair></wallet-pair>
                <p class="lede">
                    Every proof request a contract has submitted, from Ethereum to Solana.
                </p>
            </nori-card>
        </main>
        <connection-pins></connection-pins>
    `,
    styles,
})
export class AppRoot extends RxElement {}
