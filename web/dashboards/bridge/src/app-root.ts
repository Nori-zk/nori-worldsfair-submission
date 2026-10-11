import { Component, RxElement } from '@yaw-rx/core';
import {
    ConnectionsService,
    NoriBridgeInfraService,
    PROOF_REQUEST_CONNECTIONS_OPTIONS,
    type ConnectionsOptions,
    LatencyService,
} from '@nori-zk/solana-web-ui';
import { BridgeDashboardService } from './app-root/services/bridge-dashboard.service.js';
import './app-root/components/dashboard-views.component.js';

/** The chain, cluster, bridge websocket, queue and program this build reads, from `web/.env`. */
const connectionsOptions: ConnectionsOptions = {
    ethereum: {
        expectedChainId: BigInt(NORI_WEB_ENV.ethereum.chainId),
        http: { rpcUrl: NORI_WEB_ENV.ethereum.rpcUrl },
        order: { calls: ['http'], logs: ['http'] },
    },
    solana: {
        cluster: NORI_WEB_ENV.solana.cluster,
        ...(NORI_WEB_ENV.solana.rpcUrl === ''
            ? {}
            : { http: { rpcUrls: [NORI_WEB_ENV.solana.rpcUrl] } }),
    },
    nori: { websocket: { url: NORI_WEB_ENV.bridge.wssUrl } },
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
        NoriBridgeInfraService,
        BridgeDashboardService,
        LatencyService,
    ],
    template: `
        <nori-page
            heading="Bridge dashboard"
            lede="The proof queue from Ethereum to Solana, and how long reads take."
        >
            <dashboard-views></dashboard-views>
        </nori-page>
    `,
})
export class AppRoot extends RxElement {}
