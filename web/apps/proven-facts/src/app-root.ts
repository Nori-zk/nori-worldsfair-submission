import { Component, RxElement } from '@yaw-rx/core';
import {
    ConnectionsService,
    PROOF_REQUEST_CONNECTIONS_OPTIONS,
    type ConnectionsOptions,
    FactsService,
    GuardBoardService,
    LatencyService,
} from '@nori-zk/solana-web-ui';
import './app-root/components/latency-headline.component.js';
import './app-root/components/snapshot-list.component.js';

/**
 * The chain, cluster, Nori websocket, queue and program this build reads,
 * from `web/.env`: the bridge dashboard's, so Ethereum reads go through the
 * public RPC. The page sends nothing, so it has no wallet.
 */
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
        GuardBoardService,
        FactsService,
        LatencyService,
    ],
    template: `
        <nori-page
            heading="Proven facts"
            lede="What NoriSnapshot read on Ethereum, proven on Solana."
        >
            <latency-headline></latency-headline>
            <snapshot-list></snapshot-list>
        </nori-page>
    `,
})
export class AppRoot extends RxElement {}
