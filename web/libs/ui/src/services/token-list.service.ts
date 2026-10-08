import { Injectable } from '@yaw-rx/core';
import { type Observable, of } from 'rxjs';
import { tokenIcon } from '../brand/brand.js';
import tokenList from '../tokens/token-list.json';
import { ConnectionsService } from './connections.service.js';

/** A token the list offers on the connected chain. */
export interface ListedToken {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    /** The token's icon, when the list has one. */
    logoURI: string;
}

/**
 * The tokens Uniswap's default token list offers on the chain the apps run
 * on, from the copy bundled in `src/tokens/token-list.json`
 * (`npm run tokens:fetch -w web/libs/ui` refreshes it).
 */
@Injectable([ConnectionsService])
export class TokenListService {
    /** The listed tokens on the connected chain, by symbol. */
    readonly tokens$: Observable<ListedToken[]>;

    /**
     * @param connections The connections, for the chain the apps run on.
     */
    constructor(connections: ConnectionsService) {
        const chainId = Number(connections.options.ethereum.expectedChainId);
        this.tokens$ = of(
            tokenList.tokens
                .filter((token) => token.chainId === chainId)
                .map(({ address, symbol, name, decimals, logoURI }) => ({
                    address,
                    symbol,
                    name,
                    decimals,
                    logoURI: logoURI || tokenIcon,
                }))
                .sort((a, b) => a.symbol.localeCompare(b.symbol)),
        );
    }
}
