import { Component, RxElement } from '@yaw-rx/core';
import {
    ConnectionsService,
    NoriBridgeInfraService,
    PROOF_REQUEST_CONNECTIONS_OPTIONS,
    TokenListService,
    ProofProgressService,
    type ConnectionsOptions,
} from '@nori-zk/solana-web-ui';
import { ProveBalanceService } from './app-root/services/prove-balance.service.js';
import './app-root/components/prove-form.component.js';

/** The chain, cluster, Nori websocket, queue and program this build reads, from `web/.env`. */
const connectionsOptions: ConnectionsOptions = {
    ethereum: { expectedChainId: BigInt(NORI_WEB_ENV.ethereum.chainId), wallet: true },
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
        TokenListService,
        ProofProgressService,
        ProveBalanceService,
    ],
    template: `
        <nori-page
            heading="Prove balance"
            lede="Record what an Ethereum address holds, and prove it on Solana."
        >
            <wallet-pair></wallet-pair>
            <prove-form></prove-form>
        </nori-page>
    `,
})
export class AppRoot extends RxElement {}
