import { Component, RxElement } from '@yaw-rx/core';
import {
    ConnectionsService,
    GuardBoardService,
    PROOF_REQUEST_CONNECTIONS_OPTIONS,
    type ConnectionsOptions,
} from '@nori-zk/solana-web-ui';
import './app-root/components/guard-list.component.js';

/** The chain, cluster, Nori websocket, queue and program this build reads, from `web/.env`. */
const connectionsOptions: ConnectionsOptions = {
    ethereum: {
        expectedChainId: BigInt(NORI_WEB_ENV.ethereum.chainId),
        http: { rpcUrl: NORI_WEB_ENV.ethereum.rpcUrl },
        wallet: true,
        // The wallet when there is one, else the public RPC: the page reads Solana only.
        order: { calls: ['wallet', 'http'], logs: ['wallet', 'http'] },
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
        GuardBoardService,
    ],
    template: `
        <nori-page
            heading="Guard status"
            lede="Each bridged asset's proven Ethereum backing against its Solana supply, checked by Backstop."
        >
            <guard-list></guard-list>
        </nori-page>
    `,
})
export class AppRoot extends RxElement {}
