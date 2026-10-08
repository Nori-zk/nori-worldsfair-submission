import { Component, RxElement } from '@yaw-rx/core';
import {
    ConnectionsService,
    NoriBridgeInfraService,
    PROOF_REQUEST_CONNECTIONS_OPTIONS,
    type ConnectionsOptions,
} from '@nori-zk/solana-web-ui';
import { BridgeDashboardService } from './app-root/services/bridge-dashboard.service.js';
import './app-root/components/batch-table.component.js';

/** The chain, cluster, bridge websocket, queue and program this build reads, from `web/.env`. */
const connectionsOptions: ConnectionsOptions = {
    ethereum: {
        expectedChainId: BigInt(NORI_WEB_ENV.ethereum.chainId),
        http: { rpcUrl: NORI_WEB_ENV.ethereum.rpcUrl },
        wallet: true,
        // TEMPORARY: the wallet first; the public RPC first lets the dashboard read without one.
        order: { calls: ['wallet', 'http'], logs: ['wallet', 'http'] },
    },
    solana: { cluster: NORI_WEB_ENV.solana.cluster },
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
    ],
    template: `
        <nori-page
            heading="Bridge dashboard"
            lede="Every proof request a contract has submitted, from Ethereum to Solana."
        >
            <wallet-pair></wallet-pair>
            <batch-table></batch-table>
        </nori-page>
    `,
})
export class AppRoot extends RxElement {}
