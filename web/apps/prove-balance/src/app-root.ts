import { Component, Inject, RxElement } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import {
    ConnectionsService,
    PROOF_REQUEST_CONNECTIONS_OPTIONS,
    TokenListService,
    ProofProgressService,
    noriLogo,
    type ConnectionsOptions,
} from '@nori-zk/solana-web-ui';
import { ProveBalanceService } from './app-root/services/prove-balance.service.js';
import './app-root/components/prove-form.component.js';
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

/** The beam's settings: the bridge zkapp's, with the flare on the card's edge. */
const BEAM = `
    color="#64e18e"
    horizontalBeamOffset="0"
    verticalBeamOffset="-0.5"
    horizontalSizing="1"
    verticalSizing="4"
    fogIntensity="0.6"
    wispIntensity="6"
`;

@Component({
    selector: 'app-root',
    providers: [
        { provide: PROOF_REQUEST_CONNECTIONS_OPTIONS, useValue: connectionsOptions },
        ConnectionsService,
        TokenListService,
        ProofProgressService,
        ProveBalanceService,
    ],
    directives: [RxIf],
    template: `
        <nori-background></nori-background>
        <header>
            <img class="logo" src="${noriLogo}" alt="Nori" />
        </header>
        <main>
            <div class="stage">
                <div class="beam left">
                    <div rx-if="connections.ready"><laser-flow ${BEAM}></laser-flow></div>
                </div>
                <nori-card heading="Prove balance">
                    <p class="lede">
                        Record what an Ethereum address holds, and prove it on Solana.
                    </p>
                    <wallet-pair></wallet-pair>
                    <prove-form></prove-form>
                </nori-card>
                <div class="beam right">
                    <div rx-if="connections.ready"><laser-flow ${BEAM}></laser-flow></div>
                </div>
            </div>
        </main>
        <connection-pins></connection-pins>
    `,
    styles,
})
export class AppRoot extends RxElement {
    @Inject(ConnectionsService) readonly connections!: ConnectionsService;
}
